"""Today fixes (flag today_fixes_v2): additive only (made-up numbers)."""

import copy
import datetime as dt

import pytest

from app import features, gokwik_csv, live, settings

from test_live import MemStore, day_arrays, inputs

NOW = dt.datetime(2026, 10, 31, 14, 34, tzinfo=live.IST)
V2 = {"placed": {"2026-10-31": [100.0] * 24, "2026-10-30": [90.0] * 24, "2026-10-24": [80.0] * 24},
      "partial": {"hour": 14, "minutes": 34, "yesterday": {"sessions": 40, "atc": 3, "orders": 1, "gmv": 700.0, "placed": 900.0}},
      "perf_atc_now": 12, "perf_atc_snaps": {"2026-10-30": [[14.5, 10]]}}


def test_the_existing_page_is_unchanged_with_the_fixes_on():
    cfg = settings.config()
    off = live.build(inputs(), cfg, NOW)
    on = live.build(inputs(v2=copy.deepcopy(V2), perf_sessions={"value": 200}, perf_snapshots={"2026-10-30": [[14.5, 180]]}), cfg, NOW)
    assert "v2" not in off
    base = live.build(inputs(perf_sessions={"value": 200}, perf_snapshots={"2026-10-30": [[14.5, 180]]}), cfg, NOW)
    assert {k: v for k, v in on.items() if k != "v2"} == base


def test_v2_carries_atc_placed_partial_and_perf_atc():
    cfg = settings.config()
    p = live.build(inputs(v2=copy.deepcopy(V2), perf_sessions={"value": 200}, perf_snapshots={"2026-10-30": [[14.5, 180]]}), cfg, NOW)["v2"]
    assert p["curves"]["atc"]["today"][0] == 6 and p["curves"]["atc"]["today"][15] is None
    assert p["curves"]["placed"]["today"][23] is None and p["placed_today"] == 2400.0
    assert p["partial"]["yesterday"]["sessions"] == 40
    assert p["perf_atc"]["value"] == pytest.approx(12 / 200)
    assert p["perf_atc"]["yesterday"] == pytest.approx(10 / 180)


def test_gokwik_lateness():
    now = dt.datetime(2026, 11, 25, 12, 0, tzinfo=dt.timezone.utc)
    rows = lambda mins: {"d": {"loaded_at": (now - dt.timedelta(minutes=mins)).isoformat()}}  # noqa: E731
    assert live.gokwik_lateness(rows(30), now, 60, 180)["state"] == "ok"
    assert live.gokwik_lateness(rows(61), now, 60, 180)["state"] == "amber"
    assert live.gokwik_lateness(rows(181), now, 60, 180)["state"] == "red"
    assert live.gokwik_lateness({}, now, 60, 180) == {"last_at": None, "age_minutes": None, "state": "red"}


class FakeShop:
    def __init__(self):
        self.calls = []

    def placed_hourly(self, since, until, names):
        self.calls.append(("placed", since, until))
        d0, d1 = dt.date.fromisoformat(since), dt.date.fromisoformat(until)
        return {(d0 + dt.timedelta(days=i)).isoformat(): [1.0] * 24 for i in range((d1 - d0).days + 1)}

    def sessions_by_hour_utm(self, day):
        return [{"hour": 9, "utm_source": "facebook", "utm_campaign": "WOA_MOF_Sales", "sessions": 30, "atc": 4},
                {"hour": 9, "utm_source": "", "utm_campaign": "", "sessions": 50, "atc": 2},
                {"hour": 10, "utm_source": "facebook", "utm_campaign": "WOA_MOF_Sales", "sessions": 20, "atc": 1}]

    def window(self, start, end, names):
        self.calls.append(("window", start, end))
        return {"sessions": 5, "atc": 1, "orders": 0, "gmv": 0.0, "placed": 0.0}


def test_collect_v2_reads_past_days_once_and_the_same_minutes_yesterday():
    cfg = settings.config()
    st, shop = MemStore(), FakeShop()
    rows = [{"utm_source": "facebook", "utm_campaign": "WOA_MOF_Sales", "sessions": 10, "atc": 2}]
    out = live.collect_v2(cfg, st, shop, NOW, {"session_rows": rows}, set(), set())
    assert ("window", "2026-10-30T14:00:00", "2026-10-30T14:33:59") in shop.calls
    assert out["perf_atc_now"] == 2
    assert out["perf_hours"]["sessions"][9] == 30 and out["perf_hours"]["sessions"][10] == 20
    assert out["perf_hours"]["atc"][9] == 4
    n = len([c for c in shop.calls if c[0] == "placed"])
    shop.calls.clear()
    live.collect_v2(cfg, st, shop, NOW, {"session_rows": rows}, set(), set())
    assert len([c for c in shop.calls if c[0] == "placed"]) == 1 < n  # only today again
    assert "pages/live_history_v2.json" in st.d


def test_flags_default_off_and_the_bucket_overrides():
    st = MemStore()
    assert features.flags(st, fresh=True) == {"today_fixes_v2": False, "atc_drilldown": False}
    st.d[features.FLAGS_PATH] = {"today_fixes_v2": True, "unknown": True}
    assert features.flags(st, fresh=True) == {"today_fixes_v2": True, "atc_drilldown": False}
    features._cache.update(at=0.0, flags=None)


HEAD = "Date,UTM Source,UTM Medium,UTM Campaign,UTM Term,UTM Content,Landing Page,Origin Referrer,Checkout Started,Address Landed,Payment Step Reached,Payment Method Selected,Sessions Converted,Conversion %\n"


def csv(*rows):
    return (HEAD + "".join(f"2026-11-24,{src},cpc,C,T,A,/products/x,ref,{cs},{al},{ps},{pm},{cv},1%\n" for src, cs, al, ps, pm, cv in rows)).encode()


def test_gokwik_csv_checks_columns_dedupes_and_diffs():
    with pytest.raises(gokwik_csv.UploadError):
        gokwik_csv.parse(b"Date,Foo\n2026-11-24,1\n")
    st = MemStore()
    t0 = dt.datetime(2026, 11, 24, 7, 2, tzinfo=dt.timezone.utc)
    a = gokwik_csv.save(st, csv(("facebook", 100, 80, 70, 60, 50), ("direct", 50, 10, 8, 6, 5)), "a.csv", "x", t0)
    assert not a["duplicate"]
    assert gokwik_csv.save(st, csv(("facebook", 100, 80, 70, 60, 50), ("direct", 50, 10, 8, 6, 5)), "a2.csv", "x", t0)["duplicate"]
    gokwik_csv.save(st, csv(("facebook", 160, 120, 100, 90, 70), ("direct", 60, 12, 9, 7, 6)), "b.csv", "x", t0 + dt.timedelta(hours=3))
    s = gokwik_csv.summary(st, "2026-11-24")
    assert s["tagged"]["checkout_started"] == 160 and s["all"]["checkout_started"] == 220
    assert s["since_last"]["tagged"]["converted"] == 20 and s["since_last"]["tagged"]["method_to_order"] == pytest.approx(20 / 30)
    assert s["uploads_for_day"] == 2
    assert gokwik_csv.summary(st, "2026-11-23") is None


def test_gokwiks_serial_number_column_is_ignored():
    rows = gokwik_csv.parse(("S.no," + HEAD.replace("\n", "") + "\n1,2026-11-26,facebook,cpc,C,,,/,blank,3,3,3,2,1,33.33\n").encode())
    assert rows[0]["checkout_started"] == 3 and rows[0]["converted"] == 1 and rows[0]["date"] == "2026-11-26"
