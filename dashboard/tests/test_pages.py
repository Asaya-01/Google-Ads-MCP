"""Builds every page from a small synthetic dataset (no network)."""

import datetime as dt
import json

import pytest

from app import rules, settings
from app.pages import build_all

CFG = settings.config()
CFG = {
    **CFG,
    "phases": {**CFG["phases"], "overrides": {}},
    # Real config pins 2026 dates; these tests build their own gaps.
    "google_ads": {**CFG["google_ads"], "zero_spend_dates": {}},
}
D1 = "2026-10-28"
START = "2026-08-01"


def _dataset(with_meta: bool):
    days = rules.date_range(START, D1)
    sale = set(rules.date_range("2026-09-25", "2026-09-29")) | set(
        rules.date_range("2026-10-22", "2026-10-26")
    )
    data = {
        "d1": D1,
        "history_start": START,
        "funnel_start": "2026-04-30",
        "unavailable": {},
        "checks": [
            {"source": "google_ads", "latest_date": D1, "d1_rows": 10},
            {"source": "gokwik_funnel", "latest_date": D1, "d1_rows": 10},
        ],
        "orders_daily": [],
        "order_attribution": [],
        "products": [],
        "funnel": [],
        "google_ads": [],
        "google_campaigns": [
            {"campaign_id": "24394676551", "campaign_name": "WOA_Awareness_YT"},
            {"campaign_id": "23832479262", "campaign_name": "WOA_Pmax_ITB"},
        ],
        "sessions": {},
        "landing": {},
        "catalog": {
            "mrp_by_sku": {"UAS-1": 899.0},
            "mrp_by_product": {},
            "product_types": {"serum": 3, "freebie": 2, "gift": 1},
        },
    }
    meta = {}
    for d in days:
        boost = 2.4 if d in sale else 1.0
        orders = int(500 * boost)
        data["orders_daily"].append(
            {
                "date": d,
                "orders": orders,
                "gmv": orders * 800.0,
                "new_orders": int(orders * 0.7),
                "repeat_orders": orders - int(orders * 0.7),
                "new_gmv": 0.0,
                "repeat_gmv": 0.0,
            }
        )
        data["order_attribution"] += [
            {
                "date": d,
                "in_gokwik": True,
                "utm_source": "facebook",
                "utm_medium": "cpc",
                "utm_campaign": "WOA_MOF_Sales",
                "orders": orders - 5,
                "gmv": (orders - 5) * 800.0,
            },
            {
                "date": d,
                "in_gokwik": False,
                "utm_source": "",
                "utm_medium": "",
                "utm_campaign": "",
                "orders": 5,
                "gmv": 4000.0,
            },
        ]
        data["products"] += [
            {
                "date": d,
                "product_id": "9",
                "sku": "UAS-1",
                "product_title": "Underarm Spray",
                "product_type": "serum",
                "drop_reason": None,
                "paid_minis_kept": False,
                "line_count": orders,
                "units": orders,
                "revenue": orders * 799.0,
                "gross_sales": 0,
            },
            {
                "date": d,
                "product_id": "8",
                "sku": "FREE",
                "product_title": "Sunshine Charm",
                "product_type": "freebie",
                "drop_reason": "product_type",
                "paid_minis_kept": False,
                "line_count": orders,
                "units": orders,
                "revenue": orders * 1.0,
                "gross_sales": 0,
            },
        ]
        data["funnel"].append(
            {
                "date": d,
                "utm_source": "facebook",
                "utm_medium": "cpc",
                "utm_campaign": "WOA_MOF_Sales",
                "landing_page": "/products/underarm-spray",
                "checkout_started": orders * 3,
                "converted": orders,
            }
        )
        data["google_ads"] += [
            {
                "date": d,
                "campaign_id": "24394676551",
                "campaign_name": "WOA_Awareness_YT",
                "spend": 5000.0,
                "impressions": 1,
                "clicks": 1,
                "conversions": 0,
                "conversion_value": 0,
            },
            {
                "date": d,
                "campaign_id": "23832479262",
                "campaign_name": "WOA_Pmax_ITB",
                "spend": 20000.0,
                "impressions": 1,
                "clicks": 1,
                "conversions": 10,
                "conversion_value": 60000,
            },
        ]
        data["sessions"][d] = {
            "totals": {
                "sessions": int(60000 * boost),
                "atc": int(2500 * boost),
                "reached_checkout": 10,
            },
            "rows": [
                {
                    "referrer_source": "social",
                    "referrer_name": "instagram",
                    "utm_source": "facebook",
                    "utm_medium": "cpc",
                    "utm_campaign": "WOA_Awareness_TOF_Sales_UAS",
                    "sessions": 30000,
                    "atc": 500,
                },
                {
                    "referrer_source": "social",
                    "referrer_name": "instagram",
                    "utm_source": "facebook",
                    "utm_medium": "cpc",
                    "utm_campaign": "WOA_MOF_Sales",
                    "sessions": int(60000 * boost) - 33000,
                    "atc": int(2500 * boost) - 700,
                },
                {
                    "referrer_source": "search",
                    "referrer_name": "google",
                    "utm_source": "google",
                    "utm_medium": "cpc",
                    "utm_campaign": "24394676551",
                    "sessions": 2000,
                    "atc": 100,
                },
                {
                    "referrer_source": "search",
                    "referrer_name": "google",
                    "utm_source": "google",
                    "utm_medium": "cpc",
                    "utm_campaign": "29999999999",
                    "sessions": 1000,
                    "atc": 100,
                },
            ],
            "truncated": False,
        }
        data["landing"][d] = [
            {
                "landing_page": "/products/underarm-spray",
                "sessions": 40000,
                "atc": 2000,
            }
        ]
        meta[d] = [
            {
                "date": d,
                "account_id": "act_666565859450360",
                "account_name": "Asaya Sales",
                "campaign_id": "1",
                "campaign_name": "WOA_Awareness_TOF_Sales_UAS",
                "adset_name": "",
                "ad_id": "a",
                "ad_name": "",
                "spend": 50000.0 * boost,
                "impressions": 100,
                "clicks": 10,
                "purchases": 5,
                "purchase_value": 4000.0,
            },
            {
                "date": d,
                "account_id": "act_666565859450360",
                "account_name": "Asaya Sales",
                "campaign_id": "2",
                "campaign_name": "WOA_MOF_Sales",
                "adset_name": "",
                "ad_id": "b",
                "ad_name": "",
                "spend": 100000.0 * boost,
                "impressions": 100,
                "clicks": 10,
                "purchases": 50,
                "purchase_value": 300000.0,
            },
        ]
    if with_meta:
        data["meta"] = meta
    else:
        data["unavailable"][
            "meta"
        ] = "Meta system-user token not in Secret Manager yet (meta-system-user-token)"
    return data


@pytest.fixture(scope="module")
def built_without_meta():
    return build_all(
        _dataset(with_meta=False),
        CFG,
        [t["id"] for t in settings.enabled_tabs()],
    )


@pytest.fixture(scope="module")
def built_with_meta():
    return build_all(
        _dataset(with_meta=True),
        CFG,
        [t["id"] for t in settings.enabled_tabs()],
    )


def test_every_phase1_tab_builds_and_serialises(built_without_meta):
    pages, _ = built_without_meta
    assert set(pages) == {"overview", "daily", "marketing", "products", "d1"}
    for page in pages.values():
        json.dumps(page, default=str)


def test_missing_meta_is_unavailable_not_zero(built_without_meta):
    pages, ctx = built_without_meta
    f = ctx.facts[D1]
    assert f["meta_spend"] is None and f["spend"] is None and f["mer"] is None
    assert "token" in f["na"]["meta_spend"]
    tile = next(t for t in pages["overview"]["tiles"] if t["key"] == "mer")
    assert tile["value"] is None and tile["na"]
    assert f["google_spend"] == 25000.0  # Google is still there


def test_perf_sessions_drop_awareness_campaigns(built_with_meta):
    _, ctx = built_with_meta
    f = ctx.facts[D1]
    # Meta "awareness" campaign (30,000) + Google ID 24394676551 (2,000) are Awareness
    assert f["awareness_sessions"] == 32000
    assert f["perf_sessions"] == f["sessions"] - 32000
    assert f["perf_spend"] == 100000.0 + 20000.0
    assert f["mer"] == pytest.approx(f["gmv"] / (150000 + 25000))


def test_unknown_google_ids_are_flagged(built_with_meta):
    _, ctx = built_with_meta
    flagged = ctx.unclassified_google_rows()
    assert [u["campaign_id"] for u in flagged] == ["29999999999"]


def test_excluded_product_types_are_dropped(built_with_meta):
    pages, _ = built_with_meta
    p = pages["products"]
    assert [r["label"] for r in p["products"]] == ["Underarm Spray"]
    assert p["products"][0]["landed_discount"] == pytest.approx(1 - 799 / 899)
    excluded = {
        e["product_type"]: e
        for e in p["freebie_check"]["last_7_days"]["excluded"]
    }
    assert excluded["freebie"]["lines"] > 0
    assert {"freebie", "merch", "book", "gummies", "(blank)"} == set(excluded)
    flags = {
        r["product_type"]: r["excluded"] for r in p["product_types"]["rows"]
    }
    assert flags["freebie"] is True and flags["serum"] is False
    review = {
        r["product_type"]
        for r in p["product_types"]["rows"]
        if r["needs_review"]
    }
    assert review == {"gift"}


def test_d1_compares_bau_with_bau(built_with_meta):
    pages, _ = built_with_meta
    d1 = pages["d1"]
    assert d1["phase"] == "bau"
    assert d1["current"]["end"] == D1
    assert all(r["phase"] == "bau" for r in d1["prior"]["rows"])
    assert d1["prior"]["start"].startswith("2026-09")
    channels = {r["key"] for r in d1["drilldowns"]["channel"]}
    assert {"Meta Ads", "Google Ads"} <= channels
    assert d1["delta"]["orders"] == pytest.approx(0.0)


def test_a_google_sync_gap_is_unavailable_not_zero():
    data = _dataset(with_meta=True)
    data["google_ads"] = [
        r for r in data["google_ads"] if r["date"] != "2026-10-07"
    ]
    _, ctx = build_all(data, CFG, ["daily"])
    f = ctx.facts["2026-10-07"]
    assert f["google_spend"] is None and f["mer"] is None
    assert "sync gap" in f["na"]["google_spend"]
    assert ctx.facts["2026-10-08"]["google_spend"] == 25000.0


def test_a_sync_gap_gives_a_labelled_partial_google_total():
    data = _dataset(with_meta=True)
    data["google_ads"] = [
        r for r in data["google_ads"] if r["date"] != "2026-10-07"
    ]
    pages, _ = build_all(data, CFG, ["marketing"])
    periods = {p["label"]: p for p in pages["marketing"]["periods"]}
    mtd = periods["Month to date"]
    assert mtd["google_spend"] is None and mtd["mer"] is None
    part = mtd["google_partial"]
    assert part["excluded"] == ["2026-10-07"]
    assert part["spend"] == 25000.0 * part["days"]
    assert part["platform_roas"] == pytest.approx(60000 / 25000)
    # Complete periods carry no partial figure
    assert "google_partial" not in periods["D-1"]


def test_a_confirmed_zero_spend_day_is_zero_not_unavailable():
    data = _dataset(with_meta=True)
    data["google_ads"] = [
        r for r in data["google_ads"] if r["date"] != "2026-10-07"
    ]
    cfg = {
        **CFG,
        "google_ads": {
            **CFG["google_ads"],
            "zero_spend_dates": {"2026-10-07": "No budget that day"},
        },
    }
    pages, ctx = build_all(data, cfg, ["marketing"])
    f = ctx.facts["2026-10-07"]
    assert f["google_spend"] == 0.0 and "google_spend" not in f["na"]
    mtd = {p["label"]: p for p in pages["marketing"]["periods"]}[
        "Month to date"
    ]
    assert mtd["google_spend"] == 25000.0 * 27
    assert "google_partial" not in mtd
    assert pages["marketing"]["zero_spend_days"] == [
        {"date": "2026-10-07", "reason": "No budget that day"}
    ]


def test_an_empty_meta_day_is_unavailable_not_zero():
    data = _dataset(with_meta=True)
    data["meta"][D1] = []  # Meta answered with no rows for D-1
    _, ctx = build_all(data, CFG, ["daily"])
    f = ctx.facts[D1]
    assert f["meta_spend"] is None and f["mer"] is None
    assert "meta_spend" in f["na"]
    assert ctx.facts["2026-10-27"]["meta_spend"] == 150000.0
