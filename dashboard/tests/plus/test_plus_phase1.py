"""Dashboard Plus, Phase 1: the new tabs' builders and the snapshot job,
with fake BigQuery, store and Sheets (made-up numbers; nothing real)."""

import datetime as dt

import pytest

from app import settings
from app.plus import build, bqx, config

D1 = "2026-11-10"


class FakeStore:
    def __init__(self, data=None):
        self.data = dict(data or {})

    def get_json(self, path):
        return self.data.get(path)

    def put_json(self, path, obj):
        self.data[path] = obj


def fake_run(name, params=None, **subs):
    if name == "ga4_sessions":
        return [{"date": "2026-11-09", "source_medium": "facebook / cpc", "sessions": 1000, "engaged": 400},
                {"date": "2026-11-10", "source_medium": "reddit / cpc", "sessions": 5000, "engaged": 300}]
    if name == "ga4_purchases":
        return [{"date": "2026-11-10", "source_medium": "facebook / cpc", "purchases": 12, "revenue": 9000.0}]
    if name == "table_freshness":
        return [{"table_name": t, "last_modified": "2026-11-10T22:00:00"} for t in params["tables"]]
    raise AssertionError(name)


def store_with_status():
    return FakeStore({
        "status/latest.json": {"checks": [{"source": "shopify_orders", "latest_date": D1}, {"source": "google_ads", "latest_date": "2026-11-07"}]},
        "pages/channel_days.json": {"channels": ["Meta Ads", "Google Ads"], "rows": [[D1, 0, 0, 10, 1, 1, 750.0], [D1, 1, 0, 10, 1, 1, 250.0]]},
    })


def test_new_tables_are_written_only_inside_dashboard_plus():
    assert bqx.plus_dataset().endswith(".dashboard_plus")
    with pytest.raises(ValueError):
        bqx._check_target("Maplemonk.Shopify_All_orders")
    assert config()["bq"]["write_dataset"] == "dashboard_plus"
    assert "Maplemonk" in config()["bq"]["read_dataset"]


def test_the_new_sql_reads_maplemonk_and_never_writes_it():
    for f in (settings.SQL_DIR / "plus").glob("*.sql"):
        body = f.read_text().upper()
        for verb in ("INSERT ", "UPDATE ", "DELETE ", "MERGE ", "DROP ", "ALTER ", "CREATE ", "TRUNCATE "):
            assert verb not in body, f"{f.name} contains {verb.strip()}"


def test_traffic_page_carries_ga4_and_the_health_score():
    p = build.build_traffic(store_with_status(), D1, fake_run)
    assert p["ga4"]["keys"] == ["facebook / cpc", "reddit / cpc"] or set(p["ga4"]["keys"]) == {"facebook / cpc", "reddit / cpc"}
    assert len(p["ga4"]["rows"]) == 2 and p["ga4"]["purchases"][0][2] == 12
    h = {r["name"]: r for r in p["health"]["inputs"]}
    assert h["Shopify orders"]["ok"] is True
    assert h["Google ads"]["ok"] is False and h["Google ads"]["age_days"] == 3
    assert h["Meta ads"]["ok"] is None  # not tracked: left out of the score, never counted as fresh
    assert h["Google ads"]["weight"] == pytest.approx(0.25)  # its share of last-click sales
    assert 0 < p["health"]["score"] < 1


def test_ga4_failure_is_shown_not_zero():
    def broken(name, params=None, **subs):
        raise RuntimeError("no access")
    p = build.build_traffic(FakeStore(), D1, broken)
    assert "no access" in p["ga4"]["na"]


def test_profit_inputs_are_input_needed_until_supplied(monkeypatch):
    for env in ("PLUS_COGS_SHEET", "PLUS_RATE_CARD_SHEET", "PLUS_INFLUENCER_SHEET"):
        monkeypatch.delenv(env, raising=False)
    p = build.build_profit(FakeStore(), D1)
    for k in ("cogs", "rate_card", "influencer", "gst"):
        assert p[k]["na"].startswith("Input needed:"), k
    assert p["reference"]["roas"] == 1.7


def test_profit_sheets_are_read_when_set(monkeypatch):
    tabs = {
        "COGS": [["SKU", "Landed cost", "Effective from"], ["UAS-1", "120", "2026-10-01"], ["ITB-1", "₹150.5", "2026-11-01"]],
        "Rate card": [["Item", "Value", "Unit", "Effective from"], ["forward_shipping", "55", "INR/order", "2026-10-01"]],
        "Spend": [["Month", "Influencer", "Awareness other"], ["2026-11", "500000", "100000"]],
    }
    monkeypatch.setattr(build.sheets, "fetch_rows", lambda sid, tab, first: tabs[tab])
    for env in ("PLUS_COGS_SHEET", "PLUS_RATE_CARD_SHEET", "PLUS_INFLUENCER_SHEET"):
        monkeypatch.setenv(env, "x")
    p = build.build_profit(FakeStore(), D1)
    assert p["cogs"]["rows"] == [["ITB-1", 150.5, "2026-11-01"], ["UAS-1", 120.0, "2026-10-01"]]
    assert p["rate_card"]["rows"][0][:2] == ["forward_shipping", 55.0]
    assert p["influencer"]["months"]["2026-11"] == [500000.0, 100000.0]


def test_change_markers_from_the_tracker_sheet(monkeypatch):
    monkeypatch.delenv("PLUS_CHANGES_SHEET", raising=False)
    assert build.build_site(FakeStore(), D1)["changes"]["na"].startswith("Input needed:")
    monkeypatch.setenv("PLUS_CHANGES_SHEET", "x")
    monkeypatch.setattr(build.sheets, "fetch_rows", lambda sid, tab, first: [["Date", "Change", "Area", "Owner"], ["2026-11-03", "New PDP layout", "theme", "web"], ["bad", "x", "", ""]])
    rows = build.build_site(FakeStore(), D1)["changes"]["rows"]
    assert rows == [["2026-11-03", "New PDP layout", "theme", "web"]]


class FakeBQ:
    def __init__(self):
        self.tables = {}

    def has_date(self, table, day):
        return any(r.get("snapshot_date") == day for r in self.tables.get(table, []))

    def append_rows(self, table, rows, schema):
        self.tables.setdefault(table, []).extend(rows)
        return len(rows)

    def append_query(self, name, table, **subs):
        self.tables.setdefault(table, []).append({"snapshot_date": TODAY, "sku": "UAS-1", "inventory": 40})
        return 1


TODAY = "2026-11-12"


class FakeShop:
    def graphql(self, q, v):
        return {"productVariants": {"pageInfo": {"hasNextPage": False, "endCursor": None}, "nodes": [
            {"id": "gid://shopify/ProductVariant/11", "sku": "UAS-1", "title": "100 ml", "inventoryQuantity": 25,
             "product": {"id": "gid://shopify/Product/1", "title": "Mist", "status": "ACTIVE"}}]}}


def test_snapshots_are_taken_once_a_day():
    bq = FakeBQ()
    first = build.take_snapshots(TODAY, FakeShop, bq)
    assert first == {"shopify": "1 variants written", "unicommerce": "written"}
    again = build.take_snapshots(TODAY, FakeShop, bq)
    assert again == {"shopify": "already taken today", "unicommerce": "already taken today"}
    row = bq.tables[config()["stock"]["shopify_table"]][0]
    assert row["available"] == 25 and row["variant_id"] == "11" and row["snapshot_date"] == TODAY


def test_a_snapshot_failure_is_reported_not_hidden():
    class NoScope:
        def graphql(self, q, v):
            raise RuntimeError("Access denied for inventoryQuantity")
    out = build.take_snapshots(TODAY, NoScope, FakeBQ())
    assert out["shopify"].startswith("not taken:") and "Access denied" in out["shopify"]


class MemStore:
    def __init__(self, pages=None):
        self.pages = dict(pages or {})

    def get_json(self, p):
        return self.pages.get(p)

    def put_json(self, p, v):
        self.pages[p] = v


def test_job_writes_one_plus_page_and_a_failing_module_says_so(monkeypatch):
    from app.plus import job

    st = MemStore({"pages/days.json": {"as_of": "2026-11-11"}})
    monkeypatch.setattr(job, "default_store", lambda: st)
    monkeypatch.setattr(job.build, "build_traffic", lambda s, d1, run: {"title": "Traffic Quality", "as_of": d1})
    monkeypatch.setattr(job.build, "build_profit", lambda s, d1: {"title": "Profit"})
    monkeypatch.setattr(job.build, "build_site", lambda s, d1: (_ for _ in ()).throw(RuntimeError("sheet down")))
    monkeypatch.setattr(job.build, "build_stock", lambda d1, bq, taken: {"title": "Inventory"})
    rc = job.main(["--no-snapshot"])
    page = st.pages["pages/plus.json"]
    assert rc == 1 and page["as_of"] == "2026-11-11" and set(page) >= {"traffic", "profit", "site", "stock"}
    assert page["site"]["na"].startswith("Data unavailable") and "sheet down" in page["site"]["na"]
    # the job only ever writes its own page
    assert set(st.pages) == {"pages/days.json", "pages/plus.json"}
    # --only rebuilds one module and keeps the others
    monkeypatch.setattr(job.build, "build_site", lambda s, d1: {"title": "Site"})
    assert job.main(["--no-snapshot", "--only", "site"]) == 0
    assert st.pages["pages/plus.json"]["site"] == {"title": "Site"} and st.pages["pages/plus.json"]["profit"] == {"title": "Profit"}
