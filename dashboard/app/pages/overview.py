"""Overview: month-to-date KPIs, a sale-vs-sale / BAU-vs-BAU panel and trends."""

from __future__ import annotations

import datetime as dt

from .. import rules
from .common import Context, delta_block, month_to_date

KPIS = [
    ("gmv", "GMV", "inr"),
    ("orders", "Orders", "int"),
    ("aov", "AOV", "inr"),
    ("sessions", "Sessions", "int"),
    ("perf_sessions", "Perf sessions", "int"),
    ("cvr", "Conversion (orders / sessions)", "pct"),
    ("atc_rate", "ATC rate", "pct"),
    ("spend", "Ad spend (Meta + Google)", "inr"),
    ("mer", "MER (GMV / ad spend)", "x"),
    ("new_share", "New-customer orders", "pct"),
]

PHASE_FIELDS = ["gmv", "orders", "sessions", "aov", "cvr", "atc_rate", "mer"]


def build(ctx: Context) -> dict:
    cur_dates, prev_dates = month_to_date(ctx.d1)
    cur, prev = ctx.window(cur_dates), ctx.window(prev_dates)
    deltas = delta_block(cur, prev, [k for k, _, _ in KPIS], per_day=False)
    tiles = [
        {
            "key": k,
            "label": label,
            "unit": unit,
            "value": cur.get(k),
            "prior": prev.get(k),
            "delta": deltas[k],
            "na": cur["na"].get(k) or cur["na"].get(_na_source(k)),
        }
        for k, label, unit in KPIS
    ]

    # Sale vs sale and BAU vs BAU: per-day averages of counts, rates on totals.
    phase_rows = []
    for phase in ("bau", "sale"):
        c_days = [d for d in cur_dates if ctx.facts[d].get("phase") == phase]
        p_days = [
            d for d in prev_dates if ctx.facts.get(d, {}).get("phase") == phase
        ]
        c, p = ctx.window(c_days), ctx.window(p_days)
        phase_rows.append(
            {
                "phase": phase,
                "current": _per_day(c),
                "prior": _per_day(p),
                "delta": delta_block(c, p, PHASE_FIELDS, per_day=True),
            }
        )

    trend_dates = rules.date_range(
        rules.to_date(ctx.d1) - dt.timedelta(days=59), ctx.d1
    )
    trend = [
        {
            k: ctx.facts[d].get(k)
            for k in (
                "date",
                "phase",
                "gmv",
                "orders",
                "sessions",
                "cvr",
                "spend",
                "mer",
            )
        }
        for d in trend_dates
        if d in ctx.facts
    ]
    return {
        "title": "Overview",
        "as_of": ctx.d1,
        "period": {
            "current": [cur_dates[0], cur_dates[-1]],
            "prior": [prev_dates[0], prev_dates[-1]],
        },
        "tiles": tiles,
        "phase_panel": phase_rows,
        "trend": trend,
        "notes": [
            "GMV is Shopify Total sales at order level on valid orders (no tests, no cancellations, "
            "no ASAYASS sample or ASAYAINF influencer orders). Refunds and returns are not subtracted.",
            "Month-to-date compares with the same days of last month. The phase panel compares sale days "
            "with sale days and BAU days with BAU days, as per-day averages.",
        ],
    }


def _per_day(w: dict) -> dict:
    days = max(w["days"], 1)
    out = {"days": w["days"]}
    for k in PHASE_FIELDS:
        v = w.get(k)
        out[k] = (
            v / days
            if v is not None and k in ("gmv", "orders", "sessions")
            else v
        )
    return out


def _na_source(key: str) -> str:
    return {
        "aov": "gmv",
        "cvr": "sessions",
        "atc_rate": "sessions",
        "mer": "spend",
    }.get(key, key)
