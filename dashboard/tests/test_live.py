import datetime as dt

import pytest

from app import live, settings

CFG = settings.config()
IST = live.IST
NOW = dt.datetime(2026, 10, 31, 14, 30, tzinfo=IST)  # a Saturday


def flat(per_hour, hours=24):
    return [per_hour] * hours


def day_arrays(orders=2, aov=800, sessions=100, atc=6):
    return {
        "orders": flat(orders),
        "gmv": flat(orders * aov),
        "sessions": flat(sessions),
        "atc": flat(atc),
    }


def so_far(arrays, t):
    """Today as Shopify returns it at time t: full hours, the current hour
    holding only the minutes so far, nothing after."""
    h = int(t)
    out = {}
    for k, v in arrays.items():
        out[k] = [x if i < h else (x * (t - h) if i == h else 0) for i, x in enumerate(v)]
    return out


def inputs(**kw):
    base = {
        "2026-10-30": day_arrays(orders=2),  # yesterday (Friday)
        "2026-10-24": day_arrays(orders=2),  # Saturdays
        "2026-10-17": day_arrays(orders=4),
        "2026-10-10": day_arrays(orders=6),
    }
    today = so_far(day_arrays(orders=3), 14.5)
    inp = {
        "base": base,
        "phases": {
            "2026-10-30": "bau",
            "2026-10-24": "bau",
            "2026-10-17": "bau",
            "2026-10-10": "sale",
        },
        "today": today,
        "unavailable": {},
    }
    inp.update(kw)
    return inp


def tile(page, key):
    return next(x for x in page["shopify"]["tiles"] if x["key"] == key)


def test_cum_at_spreads_the_current_hour():
    assert live.cum_at([10] * 24, 2.5) == 25
    assert live.cum_at([10] * 24, 24) == 240


def test_orders_are_counted_with_the_same_rule_as_d1():
    orders = [
        {
            "name": "#1",
            "created_at": "2026-10-30T18:35:00Z",
            "total": 500.0,
            "test": False,
            "cancelled": False,
        },  # 00:05 IST on the 31st
        {
            "name": "#2",
            "created_at": "2026-10-31T05:00:00Z",
            "total": 700.0,
            "test": False,
            "cancelled": False,
        },  # 10:30 IST
        {
            "name": "#3",
            "created_at": "2026-10-31T05:00:00Z",
            "total": 100.0,
            "test": True,
            "cancelled": False,
        },
        {
            "name": "#4",
            "created_at": "2026-10-31T05:00:00Z",
            "total": 100.0,
            "test": False,
            "cancelled": True,
        },
        {
            "name": "ASAYASS-9",
            "created_at": "2026-10-31T05:00:00Z",
            "total": 0.0,
            "test": False,
            "cancelled": False,
        },
    ]
    counts, gmv = live.order_hours(
        orders, "2026-10-31", CFG["orders"]["exclude_name_regex"]
    )
    assert counts[0] == 1 and counts[10] == 1 and sum(counts) == 2
    assert gmv[0] == 500 and gmv[10] == 700


def test_typical_days_are_the_same_weekday_and_the_same_phase():
    page = live.build(inputs(), CFG, NOW)
    assert page["assumed_phase"] == "bau"
    assert page["shopify"]["typical_dates"] == ["2026-10-24", "2026-10-17"]
    assert "BAU" in page["shopify"]["typical_label"]


def test_orders_so_far_are_read_against_the_same_time_not_the_full_day():
    page = live.build(inputs(), CFG, NOW)
    t = tile(page, "orders")
    assert t["value"] == pytest.approx(3 * 14.5)
    assert t["yesterday"] == pytest.approx(2 * 14.5)
    assert t["vs_yesterday"] == pytest.approx(0.5)
    assert t["typical"] == pytest.approx(3 * 14.5)  # median of 2 and 4
    assert t["vs_typical"] == pytest.approx(0.0)


def test_todays_current_hour_is_not_cut_twice():
    """The current hour's bucket already holds only the minutes so far; the
    tiles must count all of it (a bug read only half of it at :30)."""
    today = so_far(day_arrays(orders=4), 14.5)  # 14 full hours, then 2 in 14:00-14:30
    page = live.build(inputs(today=today), CFG, NOW)
    assert tile(page, "orders")["value"] == pytest.approx(4 * 14 + 2)
    assert tile(page, "gmv")["value"] == pytest.approx((4 * 14 + 2) * 800)


def test_mixed_phases_are_flagged_when_too_few_match():
    inp = inputs()
    inp["phases"]["2026-10-24"] = "sale"
    page = live.build(inp, CFG, NOW)
    assert any("mixes sale and BAU" in n for n in page["notes"])


def test_todays_phase_can_be_set_in_config():
    cfg = {
        **CFG,
        "phases": {**CFG["phases"], "overrides": {"2026-10-31": "sale"}},
    }
    page = live.build(inputs(), cfg, NOW)
    assert page["assumed_phase"] == "sale"


def test_sessions_missing_shows_a_reason_never_zero():
    inp = inputs()
    inp["today"]["sessions_ok"] = False
    page = live.build(inp, CFG, NOW)
    cvr = tile(page, "cvr")
    assert cvr["value"] is None and "sessions" in cvr["na"].lower()
    assert tile(page, "orders")["value"] is not None


def gk(day_rows):
    return {"rows": day_rows}


def gk_row(cs, ad, pay, conv, loaded=None):
    return {
        "checkout_started": cs,
        "address_landed": ad,
        "payment_step_reached": pay,
        "converted": conv,
        "loaded_at": loaded,
    }


def test_gokwik_compares_rates_and_flags_a_stale_load():
    loaded = (NOW - dt.timedelta(minutes=200)).astimezone(dt.timezone.utc)
    rows = {
        "2026-10-29": gk_row(1000, 600, 400, 300),
        "2026-10-30": gk_row(1000, 600, 400, 300),
        "2026-10-31": gk_row(400, 200, 120, 60, loaded.isoformat()),
    }
    page = live.build(inputs(gokwik=gk(rows)), CFG, NOW)
    g = page["gokwik"]
    assert g["age_minutes"] == 200 and g["stale"] is True
    assert g["steps"][1]["rate"] == pytest.approx(0.5)
    assert g["steps"][1]["typical"] == pytest.approx(0.6)
    assert g["steps"][1]["delta"] == pytest.approx(0.5 / 0.6 - 1)
    src = next(s for s in page["sources"] if s["key"] == "gokwik")
    assert src["ok"] is False


def test_gokwik_without_rows_for_today_says_why():
    rows = {"2026-10-30": gk_row(1000, 600, 400, 300)}
    page = live.build(inputs(gokwik=gk(rows)), CFG, NOW)
    assert "not loaded any rows for today" in page["gokwik"]["na"]


def ad_rows(today_spend, y_spend):
    def r(day, name, spend, value):
        return {
            "date": day,
            "campaign_name": name,
            "spend": spend,
            "purchase_value": value,
            "purchases": 1,
            "clicks": 10,
        }

    return [
        r("2026-10-31", "WOA_Sales_BOF", today_spend, today_spend * 3),
        r("2026-10-31", "WOA_Awareness_TOF_Sales_Skincare_ATC_UAS", 500, 0),
        r("2026-10-30", "WOA_Sales_BOF", y_spend, y_spend * 2),
        r("2026-10-30", "WOA_Awareness_TOF_Sales_Skincare_ATC_UAS", 800, 0),
    ]


def test_awareness_is_left_out_of_roas_but_counted_in_spend():
    page = live.build(inputs(meta_rows=ad_rows(1000, 3000)), CFG, NOW)
    m = page["meta"]
    assert m["today"]["spend"] == 1500 and m["today"]["perf_spend"] == 1000
    assert m["today"]["roas"] == pytest.approx(3.0)
    assert m["yesterday"]["roas"] == pytest.approx(2.0)
    assert m["spend_pct_of_yesterday"] == pytest.approx(1500 / 3800)
    aw = next(c for c in m["campaigns"] if "Awareness" in c["campaign"])
    assert aw["awareness"] is True and aw["roas"] is None


def test_reach_is_social_spend_in_neither_view():
    rows = ad_rows(1000, 3000) + [
        {
            "date": "2026-10-31",
            "campaign_name": "WOA_Awareness_TOF_Reach",
            "spend": 200,
            "purchase_value": 0,
            "purchases": 0,
            "clicks": 10,
        }
    ]
    m = live.build(inputs(meta_rows=rows), CFG, NOW)["meta"]
    assert m["today"]["spend"] == 1700 and m["today"]["perf_spend"] == 1000
    reach = next(c for c in m["campaigns"] if "Reach" in c["campaign"])
    assert reach["kind"] == "social" and reach["awareness"] is False
    assert reach["roas"] is None


def test_returns_cards_say_what_is_missing_instead_of_zero():
    page = live.build(
        inputs(
            unavailable={"google": "Google Ads API: boom"},
            meta_rows=ad_rows(1000, 3000),
        ),
        CFG,
        NOW,
    )
    cards = {c["key"]: c for c in page["cards"]}
    assert cards["meta_roas"]["value"] == pytest.approx(3.0)
    assert cards["google_roas"]["value"] is None
    assert "boom" in cards["google_roas"]["na"]
    assert cards["mer"]["value"] is None and cards["perf_roas"]["value"] is None


def test_shopify_failure_leaves_a_reason_and_no_numbers():
    inp = inputs(unavailable={"shopify_orders": "Shopify API: down"})
    inp.pop("today")
    page = live.build(inp, CFG, NOW)
    assert page["shopify"] is None
    assert "shopify_orders" in page["unavailable"]


def manual_days(n=12, phase="bau", gmv=300000.0, aff_pct=0.03, crm=10000.0):
    dates = [
        (dt.date(2026, 10, 18) + dt.timedelta(days=i)).isoformat()
        for i in range(n)
    ]
    return {
        "dates": dates,
        "phase": [phase] * n,
        "values": {
            "gmv": [gmv] * n,
            "affiliate_spend": [gmv * aff_pct] * n,
            "crm_spend": [crm] * n,
            "all_spend": [None] * n,
        },
    }


def test_affiliate_follows_sales_and_crm_follows_the_clock():
    est = live.estimate_other_spend(manual_days(), "bau", 120000.0, 12.0, CFG)
    assert est["affiliate"]["value"] == pytest.approx(0.03 * 120000)
    assert est["crm"]["value"] == pytest.approx(10000 * 12 / 24)
    assert est["total"] == pytest.approx(3600 + 5000)
    assert "BAU" in est["crm"]["basis"] and "12.0/24" in est["crm"]["basis"]


def test_the_basis_is_the_same_kind_of_day_when_there_are_enough():
    d = manual_days(n=14)
    d["phase"] = ["sale"] * 4 + ["bau"] * 10
    d["values"]["crm_spend"] = [40000.0] * 4 + [10000.0] * 10
    sale = live.estimate_other_spend(d, "sale", 100000.0, 12.0, CFG)
    bau = live.estimate_other_spend(d, "bau", 100000.0, 12.0, CFG)
    assert sale["crm"]["value"] == pytest.approx(40000 * 12 / 24)
    assert bau["crm"]["value"] == pytest.approx(10000 * 12 / 24)


def test_overall_roas_is_blank_not_guessed_when_a_sheet_has_too_few_days():
    est = live.estimate_other_spend(manual_days(n=1), "bau", 1e5, 12.0, CFG)
    assert est["total"] is None
    page = live.build(
        inputs(meta_rows=ad_rows(1000, 3000), google_rows=ad_rows(500, 800)),
        CFG,
        NOW,
    )
    card = next(c for c in page["cards"] if c["key"] == "overall_roas")
    assert card["value"] is None and "estimate" in card["na"]


def test_overall_roas_uses_actual_ads_plus_the_two_estimates():
    inp = inputs(meta_rows=ad_rows(1000, 3000), google_rows=ad_rows(500, 800))
    inp["days_manual"] = manual_days()
    page = live.build(inp, CFG, NOW)
    card = next(c for c in page["cards"] if c["key"] == "overall_roas")
    gmv = next(
        x["value"] for x in page["shopify"]["tiles"] if x["key"] == "gmv"
    )
    meta_spend, google_spend = 1500.0, 1000.0  # incl. awareness
    est = 0.03 * gmv + 10000 * NOW.hour / 24 + 10000 * NOW.minute / 60 / 24
    assert card["value"] == pytest.approx(
        gmv / (meta_spend + google_spend + est), rel=1e-3
    )
    kinds = {r["label"]: r["kind"] for r in page["spend_breakdown"]}
    assert kinds["Meta"] == "actual" and kinds["Affiliate"] == "estimate"


class _Store:
    def __init__(self):
        self.saved = {}

    def get_json(self, path):
        return self.saved.get(path)

    def put_json(self, path, value):
        self.saved[path] = value


class _Shop:
    def __init__(self, orders):
        self._orders = orders

    def orders_between(self, start, end):
        return self._orders

    def sessions_hourly(self, day):
        return [[10] * 24, [1] * 24, [0] * 24]


def test_yesterday_comes_from_shopify_not_the_half_synced_bigquery_copy(
    monkeypatch,
):
    rows = []
    for d in range(1, 31):  # BigQuery: 30 older days, yesterday nearly empty
        day = (NOW.date() - dt.timedelta(days=d)).isoformat()
        n = 3 if d == 1 else 40
        rows += [
            {"date": day, "hour": h, "orders": n, "gmv": n * 800.0}
            for h in range(24)
        ]
    monkeypatch.setattr(live.bq, "run", lambda *a, **k: rows)
    yday = (NOW.date() - dt.timedelta(days=1)).isoformat()
    api = [
        {
            "name": f"#{i}",
            "created_at": f"{yday}T08:00:00Z",
            "total": 900.0,
            "test": False,
            "cancelled": False,
        }
        for i in range(500)
    ]
    out = live.baseline(CFG, _Store(), _Shop(api), NOW, {})
    assert sum(out[yday]["orders"]) == 500  # not BigQuery's 72
    assert sum(out[yday]["gmv"]) == pytest.approx(500 * 900)
    older = (NOW.date() - dt.timedelta(days=7)).isoformat()
    assert sum(out[older]["orders"]) == 40 * 24  # older days stay on BigQuery


def test_spend_follows_the_campaign_type_switch():
    """Performance shows sales-campaign spend only, Awareness awareness only,
    All every campaign with each platform split by campaign type. A Google
    awareness campaign is found by its id even without "awareness" in its
    name, and the awareness totals cover every campaign, not just the top 15."""
    meta = ad_rows(1000, 3000) + [
        {"date": "2026-10-31", "campaign_name": "WOA_Reach_Social", "spend": 200, "purchase_value": 0, "purchases": 0, "clicks": 1},
    ] + [
        {"date": "2026-10-31", "campaign_name": f"WOA_Awareness_Small_{i}", "spend": 1, "purchase_value": 0, "purchases": 0, "clicks": 0, "impressions": 10}
        for i in range(20)
    ]
    google = [
        {"date": "2026-10-31", "campaign_id": "111", "campaign_name": "WOA_Pmax_ITB", "spend": 700, "conversion_value": 1400, "conversions": 2, "clicks": 5},
        {"date": "2026-10-31", "campaign_id": "999", "campaign_name": "WOA_YT_Video_Hyd", "spend": 300, "conversion_value": 0, "conversions": 0, "clicks": 5},
        {"date": "2026-10-30", "campaign_id": "111", "campaign_name": "WOA_Pmax_ITB", "spend": 600, "conversion_value": 900, "conversions": 1, "clicks": 5},
    ]
    inp = inputs(meta_rows=meta, google_rows=google, google_aware_ids=["999"])
    inp["days_manual"] = manual_days()
    page = live.build(inp, CFG, NOW)
    v = page["views"]

    perf = {r["label"]: r["value"] for r in v["perf"]["spend_breakdown"]}
    assert perf["Meta"] == 1000 and perf["Google Ads"] == 700
    assert [c["key"] for c in v["perf"]["cards"]][-1] == "overall_perf_roas"

    aw = {r["label"]: r["value"] for r in v["aw"]["spend_breakdown"]}
    assert aw["Meta"] == 520 and aw["Google Ads"] == 300 and aw["All channels"] == 820
    assert v["aw"]["totals"]["spend"] == 820

    rows = v["all"]["spend_breakdown"]
    assert rows[0]["label"] == "Meta" and rows[0]["value"] == 1720
    subs = [(r["label"], r["value"]) for r in rows[1:4]]
    assert subs == [("Performance", 1000), ("Awareness", 520), ("Reach & Amazon", 200)]
    assert all(r.get("level") == 1 for r in rows[1:4])
    g = next(i for i, r in enumerate(rows) if r["label"] == "Google Ads")
    assert rows[g]["value"] == 1000 and rows[g + 1]["value"] == 700 and rows[g + 2]["value"] == 300
    assert page["google"]["today"]["roas"] == pytest.approx(2.0)  # awareness out of ROAS


def test_reddit_today_is_the_sheets_plan_for_today_scaled_to_the_hour():
    est = live.estimate_other_spend(manual_days(), "bau", 1e5, 12.0, CFG, targets={"reddit": {"2026-10-31": 5000}}, today="2026-10-31")
    assert est["reddit"]["value"] == pytest.approx(5000 * 12 / 24)
    assert "target" in est["reddit"]["basis"]
    # no plan for today: only days since the block became sales-only count
    d = manual_days()
    d["dates"] = [f"2026-10-{i:02d}" for i in range(20, 32)][: len(d["dates"])]
    d["values"]["reddit_spend"] = [26000.0] * len(d["dates"])
    est = live.estimate_other_spend(d, "bau", 1e5, 12.0, CFG, targets={}, today="2026-11-04")
    assert est["reddit"] is None  # October (all Reddit campaigns) is not a basis


def test_perf_sessions_follow_the_d1_rule():
    rows = [
        {"utm_source": "facebook", "utm_campaign": "WOA_MOF_Sales", "sessions": 100},
        {"utm_source": "facebook", "utm_campaign": "WOA_Awareness_TOF_Sales", "sessions": 50},
        {"utm_source": "facebook", "utm_campaign": "", "sessions": 30},
        {"utm_source": "ig", "utm_campaign": "story", "sessions": 20},
        {"utm_source": "reddit", "utm_campaign": "WOA_traffic_campaign", "sessions": 40},
        {"utm_source": "google", "utm_campaign": "23901960000", "sessions": 10},
        {"utm_source": "google", "utm_campaign": "21100000000", "sessions": 5},
    ]
    assert live.report_perf_sessions(rows, "2026-11-04", {"23901960000"}, {"23901960000", "21100000000"}, CFG) == 105


def test_saved_runs_give_the_same_time_yesterday():
    snaps = {"2026-10-30": [[9.0, 10], [14.25, 100], [15.0, 120]]}
    assert live.snap_at(snaps, "2026-10-30", 14.5) == 100
    assert live.snap_at(snaps, "2026-10-30", 20.0) is None  # too far from any run
    assert live.snap_at(snaps, "2026-10-29", 14.5) is None


def test_scorecard_is_the_teams_sheet_with_one_performance_roas():
    inp = inputs(meta_rows=ad_rows(1000, 3000), google_rows=[
        {"date": "2026-10-31", "campaign_id": "1", "campaign_name": "WOA_Pmax_ITB", "spend": 500, "conversion_value": 900, "conversions": 1, "clicks": 1},
    ])
    d = manual_days()
    n = len(d["dates"])
    d["values"].update(reddit_spend=[7000.0] * n, perf_all_spend=[50000.0] * n, sessions=[40000] * n)
    inp.update(days_manual=d, spend_targets={"reddit": {"2026-10-31": 5000}}, perf_sessions={"value": 900},
               perf_snapshots={"2026-10-30": [[14.4, 800]]})
    page = live.build(inp, CFG, NOW)
    items = {i["key"]: i for g in page["scorecard"]["groups"] for i in g["items"]}
    assert [i["label"] for g in page["scorecard"]["groups"] for i in g["items"]] == [
        "Orders", "GMV", "AOV", "Meta spends", "Google", "Reddit", "CRM + Affiliates", "Total Spends",
        "ROAS", "CPS", "Sessions", "Perf Sessions", "CVR % on overall sessions", "CVR % on Perf"]
    # awareness spend (500 on Meta) is in no spend and not in ROAS
    assert items["meta_spend"]["value"] == 1000
    total = 1000 + 500 + items["reddit_spend"]["value"] + items["crm_aff_spend"]["value"]
    assert items["total_spend"]["value"] == pytest.approx(total)
    assert items["roas"]["value"] == pytest.approx(items["gmv"]["value"] / total)
    assert items["cps"]["value"] == pytest.approx(total / items["sessions"]["value"])
    assert items["cvr_perf"]["value"] == pytest.approx(items["orders"]["value"] / 900)
    assert items["perf_sessions"]["yesterday"] == 800
    # the sheets are behind: compared with the latest day they are filled for
    assert "29 Oct" in items["roas"]["ref"]["label"]


def test_sales_by_hour_is_shopifys_report_in_ist_hours():
    from app.shopify import Shopify

    shop = Shopify.__new__(Shopify)
    seen = {}

    def fake(q):
        seen["q"] = q
        return [
            {"hour": "2026-11-03T18:30:00Z", "orders": "10", "total_sales": "8000.00"},  # 00:00 IST 4 Nov
            {"hour": "2026-11-04T17:30:00Z", "orders": "12", "total_sales": "9600.50"},  # 23:00 IST
            {"hour": "2026-11-04T18:30:00Z", "orders": "5", "total_sales": "100"},  # 5 Nov: dropped
        ]

    shop.shopifyql = fake
    out = shop.sales_hourly("2026-11-04", "2026-11-04", ["ASAYAINF", "ASAYASS"])
    assert list(out) == ["2026-11-04"]
    assert out["2026-11-04"]["orders"][0] == 10 and out["2026-11-04"]["orders"][23] == 12
    assert out["2026-11-04"]["gmv"][23] == pytest.approx(9600.50)
    assert "FROM sales" in seen["q"] and "NOT CONTAINS 'ASAYAINF'" in seen["q"]


class _HistShop:
    """Shopify's hourly reports for any range: one order of ₹500 and 20
    sessions every hour, except days in `blank`."""

    def __init__(self, blank=()):
        self.calls, self.blank = [], set(blank)

    def _days(self, a, b):
        d, out = dt.date.fromisoformat(a), []
        while d <= dt.date.fromisoformat(b):
            if d.isoformat() not in self.blank:
                out.append(d.isoformat())
            d += dt.timedelta(days=1)
        return out

    def sales_hourly(self, a, b, names):
        self.calls.append(("sales", a, b))
        assert names == ["ASAYASS", "ASAYAINF"]
        return {d: {"orders": [1] * 24, "gmv": [500.0] * 24} for d in self._days(a, b)}

    def sessions_hourly_range(self, a, b):
        self.calls.append(("sessions", a, b))
        return {d: {"sessions": [20] * 24, "atc": [2] * 24} for d in self._days(a, b)}


def test_past_days_are_filled_a_month_at_a_time_newest_first_and_published():
    cfg = {**CFG, "live": {**CFG["live"], "history": {"days": 70, "chunk_days": 31, "chunks_per_run": 2}}}
    store, shop = _Store(), _HistShop(blank={"2026-08-25"})
    y = "2026-10-30"
    base = {y: {**day_arrays(orders=3), "orders": [3] * 24}}  # the baseline's copy wins
    left = live.history(cfg, store, shop, NOW, base, {"2026-10-01": "sale"}, {"2026-10-01": [[14.0, 900]]}, {})
    # yesterday is the baseline's; then a month at a time, newest first
    assert shop.calls[0] == ("sales", "2026-09-29", "2026-10-29") and shop.calls[2] == ("sales", "2026-08-29", "2026-09-28")
    assert left == 7  # 22-28 Aug: 70 days back, 1 from the baseline, 62 read this run
    page = store.saved["pages/live_history.json"]
    assert page["days"][y][0] == [3] * 24 and page["days"]["2026-09-15"][1] == [500.0] * 24
    assert page["phases"] == {"2026-10-01": "sale"} and page["perf"] == {"2026-10-01": [[14.0, 900]]}
    assert NOW.date().isoformat() not in page["days"]
    # the next run reads only what is left; a day with no data is not asked for again
    shop.calls.clear()
    assert live.history(cfg, store, shop, NOW, base, {}, {}, {}) == 0
    assert shop.calls == [("sales", "2026-08-22", "2026-08-28"), ("sessions", "2026-08-22", "2026-08-28")]
    assert "2026-08-25" in store.saved["cache/live/history.json"]["empty"]
    shop.calls.clear()
    live.history(cfg, store, shop, NOW, base, {}, {}, {})
    assert shop.calls == []


def test_a_failed_history_read_is_a_note_not_a_broken_live_page():
    class Down(_HistShop):
        def sales_hourly(self, a, b, names):
            raise RuntimeError("throttled")
    cfg = {**CFG, "live": {**CFG["live"], "history": {"days": 10, "chunk_days": 31, "chunks_per_run": 2}}}
    notes = {}
    assert live.history(cfg, _Store(), Down(), NOW, {}, {}, {}, notes) == 10
    assert "throttled" in notes["history"]


def test_sessions_by_hour_for_a_range_is_in_ist_hours():
    from app.shopify import Shopify

    shop = Shopify.__new__(Shopify)
    shop.shopifyql = lambda q: [
        {"hour": "2026-06-30T18:30:00Z", "sessions": "3410", "sessions_with_cart_additions": "234"},  # 00:00 IST 1 Jul
        {"hour": "2026-07-09T14:30:00Z", "sessions": "4797", "sessions_with_cart_additions": "1229"},  # 20:00 IST 9 Jul
        {"hour": "2026-07-09T18:30:00Z", "sessions": "1", "sessions_with_cart_additions": "1"},  # 10 Jul: outside
    ]
    out = shop.sessions_hourly_range("2026-07-01", "2026-07-09")
    assert sorted(out) == ["2026-07-01", "2026-07-09"]
    assert out["2026-07-01"]["sessions"][0] == 3410 and out["2026-07-09"]["atc"][20] == 1229



def test_crm_and_affiliates_today_are_the_sheets_targets_scaled_to_the_hour():
    plan = {"days": {"2026-10-31": {"crm_flow": [13280, 15645], "crm_broadcast": [22000, 77754], "affiliate": [11500, 31702],
                                    "reddit": [8800, 2592], "meta": [747274, 1]}}}
    targets = live.spend_targets(plan)
    assert targets["crm"]["2026-10-31"] == 35280 and targets["affiliate"]["2026-10-31"] == 11500
    est = live.estimate_other_spend(manual_days(), "bau", 120000.0, 15.0, CFG, targets=targets, today="2026-10-31")
    assert est["crm"]["value"] == pytest.approx(35280 * 15 / 24)
    assert est["affiliate"]["value"] == pytest.approx(11500 * 15 / 24)
    assert est["reddit"]["value"] == pytest.approx(8800 * 15 / 24)
    assert "Target vs Achieved" in est["crm"]["basis"]
    assert est["total"] == pytest.approx((35280 + 11500 + 8800) * 15 / 24)
    # a day with no target in the sheet falls back to the old estimates
    est2 = live.estimate_other_spend(manual_days(), "bau", 120000.0, 12.0, CFG, targets=targets, today="2026-11-30")
    assert est2["affiliate"]["value"] == pytest.approx(0.03 * 120000) and est2["crm"]["value"] == pytest.approx(10000 * 12 / 24)
