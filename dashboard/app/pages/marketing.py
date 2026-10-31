"""Marketing: Meta (Marketing API) and Google (GOOGLEADS_CONSOLIDATED) spend,
blended MER and Performance ROAS, campaign tables and the Google
campaign-ID classification check."""

from __future__ import annotations

import datetime as dt
from collections import defaultdict

from .. import rules
from .common import Context, month_to_date

PERIOD_FIELDS = [
    "gmv",
    "meta_spend",
    "google_spend",
    "spend",
    "perf_spend",
    "mer",
    "perf_roas",
    "meta_platform_value",
    "google_platform_value",
]


def build(ctx: Context) -> dict:
    d1 = rules.to_date(ctx.d1)
    last7 = rules.date_range(d1 - dt.timedelta(days=6), d1)
    mtd, _ = month_to_date(ctx.d1)
    periods = []
    for label, dates in (
        ("D-1", [ctx.d1]),
        ("Last 7 days", last7),
        ("Month to date", mtd),
    ):
        w = ctx.window(dates)
        row = {"label": label, "start": dates[0], "end": dates[-1]}
        for k in PERIOD_FIELDS:
            row[k] = w.get(k)
        row["meta_platform_roas"] = rules.ratio(
            w.get("meta_platform_value"), w.get("meta_spend")
        )
        row["google_platform_roas"] = rules.ratio(
            w.get("google_platform_value"), w.get("google_spend")
        )
        row["na"] = {k: v for k, v in w["na"].items() if k in PERIOD_FIELDS}
        if row["google_spend"] is None:
            row["google_partial"] = _google_partial(ctx, dates)
        periods.append(row)

    spend_trend = [
        {
            k: ctx.facts[d].get(k)
            for k in (
                "date",
                "phase",
                "meta_spend",
                "google_spend",
                "gmv",
                "mer",
            )
        }
        for d in rules.date_range(d1 - dt.timedelta(days=29), d1)
        if d in ctx.facts
    ]
    return {
        "title": "Marketing",
        "as_of": ctx.d1,
        "periods": periods,
        "spend_trend": spend_trend,
        "meta_campaigns": _meta_campaigns(ctx, last7),
        "google_campaigns": _google_campaigns(ctx, last7),
        "classification_check": {
            "google_awareness_ids": len(ctx.aware_ids),
            "google_known_ids": len(ctx.known_ids),
            "unclassified_google_ids": ctx.unclassified_google_rows(),
            "google_match": _google_match(ctx, last7),
        },
        "notes": [
            _google_source_note(ctx),
            "Meta is pulled from the Marketing API for Asaya Sales (act_666565859450360) and Asaya Top Funnel "
            "(act_1040064540569018) only. Google comes from GOOGLEADS_CONSOLIDATED.",
            "MER = GMV / total ad spend. Performance ROAS = GMV / spend on non-awareness campaigns. "
            "Platform ROAS is each platform's own attributed purchase value / its spend.",
        ],
        "zero_spend_days": [
            {"date": d, "reason": why}
            for d, why in sorted(
                ctx.cfg["google_ads"].get("zero_spend_dates", {}).items()
            )
            if d in ctx.facts
        ],
        "unavailable": {
            k: v for k, v in ctx.unavailable.items() if k == "meta"
        },
    }


def _google_source_note(ctx: Context) -> str:
    src = ctx.data.get("google_source") or {}
    if src.get("mode") == "api":
        return "Google spend and results come straight from the Google Ads API (the whole history window is re-read every run, so late conversions are picked up)."
    why = f" ({src['note']})" if src.get("note") else ""
    return f"Google spend and results come from the GOOGLEADS_CONSOLIDATED copy in BigQuery, which lands around midday{why}."


def _google_partial(ctx: Context, dates: list[str]) -> dict | None:
    """Google spend and platform ROAS over the days that have data, when only
    some days in the period are missing. Shown labelled with the excluded
    days; blended figures (MER, totals) stay unavailable."""
    have = [
        d for d in dates if ctx.facts.get(d, {}).get("google_spend") is not None
    ]
    missing = [d for d in dates if d not in have]
    if not have or not missing:
        return None
    spend = sum(ctx.facts[d]["google_spend"] for d in have)
    values = [ctx.facts[d].get("google_platform_value") for d in have]
    value = sum(values) if None not in values else None
    return {
        "spend": spend,
        "platform_roas": rules.ratio(value, spend),
        "days": len(have),
        "excluded": missing,
    }


def _meta_campaigns(ctx: Context, dates: list[str]) -> list[dict]:
    meta = ctx.data.get("meta") or {}
    agg: dict[tuple, dict] = {}
    for d in dates:
        for r in meta.get(d, []):
            key = (r["account_name"], r["campaign_id"])
            name = r.get("campaign_name")
            a = agg.setdefault(
                key,
                {
                    "account": r["account_name"],
                    "campaign_id": r["campaign_id"],
                    "campaign": (
                        name
                        if name is not None
                        else "All campaigns (account total)"
                    ),
                    "type": (
                        "Unknown"
                        if name is None
                        else (
                            "Awareness"
                            if rules.is_awareness_name(
                                name, ctx.cfg["sessions"]
                            )
                            else "Performance"
                        )
                    ),
                    "spend": 0.0,
                    "impressions": 0,
                    "clicks": 0,
                    "purchases": 0.0,
                    "purchase_value": 0.0,
                },
            )
            for k in (
                "spend",
                "impressions",
                "clicks",
                "purchases",
                "purchase_value",
            ):
                a[k] += r[k]
    rows = sorted(agg.values(), key=lambda r: -r["spend"])
    for r in rows:
        r["ctr"] = rules.ratio(r["clicks"], r["impressions"])
        r["roas"] = rules.ratio(r["purchase_value"], r["spend"])
    return rows


def _google_campaigns(ctx: Context, dates: list[str]) -> list[dict]:
    agg: dict[str, dict] = {}
    days = set(dates)
    for r in ctx.data.get("google_ads", []):
        if r["date"] not in days:
            continue
        a = agg.setdefault(
            r["campaign_id"],
            {
                "campaign_id": r["campaign_id"],
                "campaign": r["campaign_name"],
                "type": (
                    "Awareness"
                    if r["campaign_id"] in ctx.aware_ids
                    else "Performance"
                ),
                "spend": 0.0,
                "impressions": 0.0,
                "clicks": 0.0,
                "conversions": 0.0,
                "conversion_value": 0.0,
            },
        )
        for k in (
            "spend",
            "impressions",
            "clicks",
            "conversions",
            "conversion_value",
        ):
            a[k] += r.get(k) or 0
    rows = sorted(
        (r for r in agg.values() if r["spend"] > 0), key=lambda r: -r["spend"]
    )
    for r in rows:
        r["ctr"] = rules.ratio(r["clicks"], r["impressions"])
        r["roas"] = rules.ratio(r["conversion_value"], r["spend"])
    return rows


def _google_match(ctx: Context, dates: list[str]) -> dict:
    """How many Google-sourced sessions carry a campaign ID, and how many of
    those IDs GOOGLEADS_CONSOLIDATED knows."""
    google_sources = set(ctx.cfg["sessions"]["google_sources"])
    total = with_id = matched = awareness = 0
    for d in dates:
        for r in ctx.session_rows.get(d, []):
            if r["utm_source"].strip().lower() not in google_sources:
                continue
            total += r["sessions"]
            cid = r["utm_campaign"].strip()
            if cid.isdigit():
                with_id += r["sessions"]
                if cid in ctx.known_ids:
                    matched += r["sessions"]
                if cid in ctx.aware_ids:
                    awareness += r["sessions"]
    return {
        "start": dates[0],
        "end": dates[-1],
        "google_sessions": total,
        "with_campaign_id": with_id,
        "matched": matched,
        "awareness": awareness,
        "match_rate": rules.ratio(matched, with_id),
        "no_id_share": rules.ratio(total - with_id, total),
    }
