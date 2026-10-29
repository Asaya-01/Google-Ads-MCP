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
    ("mer", "MER", "x"),
    ("perf_roas", "Perf ROAS", "x"),
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
            "Perf sessions = all sessions minus Awareness sessions (Meta campaigns starting woa_awareness_, "
            'Google campaign IDs whose name contains "awareness").',
            "IC = GoKwik checkouts started. CVR = orders / all sessions. MER = GMV / (Meta + Google spend). "
            "Perf ROAS = GMV / spend on non-awareness campaigns.",
            "Phase (sale / BAU) is inferred from the GMV spike against the BAU median and Meta spend scale; "
            "override any day in config.json (phases.overrides).",
        ],
    }
