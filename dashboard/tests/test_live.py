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


def inputs(**kw):
    base = {
        "2026-10-30": day_arrays(orders=2),  # yesterday (Friday)
        "2026-10-24": day_arrays(orders=2),  # Saturdays
        "2026-10-17": day_arrays(orders=4),
        "2026-10-10": day_arrays(orders=6),
    }
    today = day_arrays(orders=3)
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
        r("2026-10-31", "WOA_Awareness_Reach", 500, 0),
        r("2026-10-30", "WOA_Sales_BOF", y_spend, y_spend * 2),
        r("2026-10-30", "WOA_Awareness_Reach", 800, 0),
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
