"""Daily: one row per day for the last 45 days, newest first."""

from __future__ import annotations

import datetime as dt

from .. import rules
from .common import Context

COLUMNS = [
    ("date", "Date", "date"),
    ("phase", "Phase", "phase"),
    ("sessions", "Sessions", "int"),
    ("perf_sessions", "Perf sessions", "int"),
    ("atc", "ATC", "int"),
    ("ic", "IC", "int"),
    ("orders", "Orders", "int"),
    ("gmv", "GMV", "inr"),
    ("aov", "AOV", "inr"),
    ("atc_rate", "Sessions → ATC", "pct"),
    ("atc_to_ic", "ATC → IC", "pct"),
    ("cvr", "CVR", "pct"),
    ("meta_spend", "Meta spend", "inr"),
    ("google_spend", "Google spend", "inr"),
    ("perf_all_spend", "Spends", "inr"),
    ("roas", "ROAS", "x"),
    ("new_orders", "New orders", "int"),
    ("repeat_orders", "Repeat orders", "int"),
]


def build(ctx: Context, days: int = 45) -> dict:
    end = rules.to_date(ctx.d1)
    dates = [
        d
        for d in rules.date_range(end - dt.timedelta(days=days - 1), end)
        if d in ctx.facts
    ]
    rows = []
    for d in reversed(dates):
        f = ctx.facts[d]
        rows.append(
            {
                **{k: f.get(k) for k, _, _ in COLUMNS},
                "na": f["na"],
                "phase_basis": f.get("phase_basis"),
            }
        )
    return {
        "title": "Daily",
        "as_of": ctx.d1,
        "columns": [
            {"key": k, "label": label, "unit": unit}
            for k, label, unit in COLUMNS
        ],
        "rows": rows,
        "notes": [
            "Perf sessions follow the team's rule: sessions whose UTM source is one of the performance "
            "sources (paid, affiliate, CRM) and that carry a UTM campaign, awareness campaigns left out. "
            "Google sessions are matched to campaigns by campaign ID.",
            "Checkout started (IC) is GoKwik's checkouts started. CVR = Orders ÷ all Sessions; Orders are "
            "Shopify's Sales report. Performance spend is every channel's sales-campaign spend (Meta, Google "
            "and Reddit sales campaigns, CRM, affiliates); Blended ROAS = Total sales ÷ Performance spend.",
            "Sale and BAU days come from hourly order detection and the team's sale calendar, which wins on "
            "every day it covers; phases.overrides in config.json applies only to days the calendar does "
            "not cover.",
        ],
    }
