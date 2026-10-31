import datetime as dt

import pytest

from app import health, reconcile, refresh, settings
from app.shopify import Shopify, ShopifyError

RULE = {"pct": 0.01, "min_abs": 3, "block": True}


def test_a_small_difference_is_inside_the_tolerance():
    ok = reconcile.compare("orders", "Orders", "int", 457, 459, RULE)
    assert ok["ok"] is True and ok["diff"] == -2 and ok["note"] is None


def test_a_partial_sync_is_flagged_with_a_readable_message():
    bad = reconcile.compare("orders", "Orders", "int", 400, 459, RULE)
    assert bad["ok"] is False
    assert "400" in bad["note"] and "459" in bad["note"]
    assert reconcile.failed([bad]) == {"reconcile_orders": bad["note"]}


def test_only_blocking_checks_hold_the_day_open():
    soft = reconcile.compare(
        "meta_spend",
        "Meta",
        "inr",
        100.0,
        200.0,
        {"pct": 0.005, "min_abs": 50, "block": False},
    )
    assert soft["ok"] is False and reconcile.failed([soft]) == {}


def test_a_missing_figure_is_not_checked_rather_than_failed():
    row = reconcile.compare("orders", "Orders", "int", None, 459, RULE)
    assert row["ok"] is None and "Not checked" in row["note"]


class FakeShop(Shopify):
    def __init__(self, reply):
        self.reply = reply
        self.seen = None

    def graphql(self, query, variables=None):
        self.seen = variables["q"]
        return {"ordersCount": self.reply}


def test_shopify_order_count_uses_the_ist_day_and_skips_test_orders():
    shop = FakeShop({"count": 459, "precision": "EXACT"})
    assert shop.orders_count("2026-10-30") == 459
    assert "2026-10-30T00:00:00+05:30" in shop.seen
    assert "created_at:<'2026-10-31T00:00:00+05:30'" in shop.seen
    assert "test:false" in shop.seen


def test_an_approximate_shopify_count_is_refused():
    with pytest.raises(ShopifyError):
        FakeShop({"count": 10000, "precision": "AT_LEAST"}).orders_count(
            "2026-10-30"
        )


def _data(d1="2026-10-30"):
    return {
        "d1": d1,
        "checks": [
            {"source": "shopify_orders", "latest_date": d1, "d1_rows": 459},
            {"source": "google_ads", "latest_date": d1, "d1_rows": 7},
        ],
        "meta": {d1: [{"spend": 1.0}], "2026-10-29": []},
        "sessions": {d1: {"totals": {"sessions": 90000}}},
        "google_source": {"mode": "api", "note": None},
        "reconcile": [],
    }


def test_the_health_page_lists_every_source_with_its_state():
    status = {
        "attempts": 4,
        "arrived": {"google_ads": "2026-10-31T07:12:00+05:30"},
    }
    page = health.build(
        {}, _data(), {"gokwik_funnel": "no rows yet"}, status, [status], "t"
    )
    by_key = {s["key"]: s for s in page["sources"]}
    assert set(by_key) == set(health.KEYS)
    assert by_key["gokwik_funnel"]["state"] == "waiting"
    assert by_key["google_ads"]["state"] == "ok"
    assert by_key["google_ads"]["arrived_at"] == "2026-10-31T07:12:00+05:30"
    assert by_key["meta_ads"]["d1_rows"] == 1
    assert by_key["shopify_sessions"]["d1_rows"] == 90000
    assert page["complete"] is False and page["waiting_on"] == ["gokwik_funnel"]


def test_the_health_history_runs_newest_first_and_skips_empty_days():
    today = {"complete": True, "completed_at": "c1", "arrived": {}}
    page = health.build(
        {}, _data(), {}, today, [today, None, {"complete": False}], "t"
    )
    assert [d["day"] for d in page["history"]] == ["2026-10-30", "2026-10-28"]


def test_the_bigquery_fallback_is_named_on_the_health_page():
    data = _data()
    data["google_source"] = {"mode": "bigquery", "note": "API: no access"}
    page = health.build({}, data, {}, {}, [], "t")
    google = next(s for s in page["sources"] if s["key"] == "google_ads")
    assert "BigQuery" in google["origin"] and "no access" in google["note"]


CFG = settings.config()


def test_a_short_order_sync_holds_the_day_open(monkeypatch):
    class Shop:
        def orders_count(self, day):
            return 459

    monkeypatch.setattr(refresh.bq, "run", lambda name, **k: [{"orders": 380}])
    missing = {}
    out = refresh._reconcile(
        CFG,
        {"meta": {}},
        "2026-10-30",
        dt.date(2026, 10, 30),
        None,
        Shop(),
        None,
        missing,
    )
    assert out[0]["ok"] is False
    assert "reconcile_orders" in missing


def test_a_matching_day_stays_complete(monkeypatch):
    class Shop:
        def orders_count(self, day):
            return 459

    monkeypatch.setattr(refresh.bq, "run", lambda name, **k: [{"orders": 459}])
    missing = {}
    out = refresh._reconcile(
        CFG,
        {"meta": {}},
        "2026-10-30",
        dt.date(2026, 10, 30),
        None,
        Shop(),
        None,
        missing,
    )
    assert out[0]["ok"] is True and missing == {}


def test_a_check_that_errors_never_blocks_the_day(monkeypatch):
    class Shop:
        def orders_count(self, day):
            raise ShopifyError("throttled")

    monkeypatch.setattr(refresh.bq, "run", lambda name, **k: [{"orders": 459}])
    missing = {}
    out = refresh._reconcile(
        CFG,
        {"meta": {}},
        "2026-10-30",
        dt.date(2026, 10, 30),
        None,
        Shop(),
        None,
        missing,
    )
    assert out[0]["ok"] is None and "throttled" in out[0]["note"]
    assert missing == {}


def test_crash_alerts_are_sent_once_per_few_hours(monkeypatch):
    class Store:
        saved = {}

        def get_json(self, path):
            return self.saved.get(path)

        def put_json(self, path, value):
            self.saved[path] = value

    store, sent = Store(), []
    monkeypatch.setattr(refresh, "default_store", lambda: store)
    monkeypatch.setattr(refresh.alerts, "send", lambda t, lines: sent.append(t))
    refresh._alert_crash(RuntimeError("boom"))
    refresh._alert_crash(RuntimeError("boom again"))
    assert len(sent) == 1 and "crashed" in sent[0]
