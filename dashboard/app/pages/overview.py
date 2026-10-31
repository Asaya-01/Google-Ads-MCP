"""Overview: month-to-date KPIs, a sale-vs-sale / BAU-vs-BAU panel and trends."""

from __future__ import annotations

import datetime as dt
import statistics

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
        "pulse": _pulse(ctx),
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


# (key, label, counts toward the verdict). Cart to checkout is shown for
# context only: add-to-carts from awareness traffic dilute it, so it can move
# with the traffic mix while checkout itself is fine.
CHECKOUT_STEPS = [
    ("atc_to_ic", "Cart to checkout", False),
    ("address_rate", "Checkout to address", True),
    ("payment_rate", "Address to payment", True),
    ("paid_rate", "Payment to paid", True),
]
RANK = {"ok": 0, "watch": 1, "problem": 2}


def _history(ctx: Context, key: str, phase, pcfg: dict) -> list[float]:
    """The same-phase days before D-1 (BAU with BAU, sale with sale)."""
    d1 = rules.to_date(ctx.d1)
    days = rules.date_range(
        d1 - dt.timedelta(days=pcfg["baseline_days"]),
        d1 - dt.timedelta(days=1),
    )
    vals = [
        ctx.facts[d][key]
        for d in days
        if d in ctx.facts
        and ctx.facts[d].get("phase") == phase
        and ctx.facts[d].get(key) is not None
    ]
    return vals if len(vals) >= pcfg["min_baseline_days"] else []


def _baseline(ctx: Context, key: str, phase, pcfg: dict):
    vals = _history(ctx, key, phase, pcfg)
    return statistics.median(vals) if vals else None


def _status(ctx: Context, key: str, value, phase, pcfg: dict) -> str:
    """A step is off when it is both many normal day-to-day spreads below its
    typical value and a meaningful share lower, so ordinary wobble stays ok."""
    vals = _history(ctx, key, phase, pcfg)
    if value is None or not vals:
        return "unknown"
    med = statistics.median(vals)
    spread = max(
        statistics.median(abs(v - med) for v in vals) * 1.4826,
        0.01 * abs(med),
    )
    if not spread:  # a flat zero history: nothing to fall below
        return "ok"
    z = (value - med) / spread
    drop = (med - value) / med if med else 0
    if z <= -pcfg["problem_z"] and drop >= pcfg["problem_drop"]:
        return "problem"
    if z <= -pcfg["watch_z"] and drop >= pcfg["watch_drop"]:
        return "watch"
    return "ok"


def _pulse(ctx: Context) -> dict:
    """The ten-second view: is checkout healthy, and what are Meta, Google and
    Shopify returning? Everything is read against a typical day of the same
    kind, so a sale day is never judged against a BAU day."""
    pcfg = ctx.cfg["pulse"]
    f = ctx.facts[ctx.d1]
    phase = f.get("phase")
    d1 = rules.to_date(ctx.d1)
    last7 = rules.date_range(d1 - dt.timedelta(days=6), d1)
    mtd, _ = month_to_date(ctx.d1)
    w7, wm = ctx.window(last7), ctx.window(mtd)
    spark_days = [
        d
        for d in rules.date_range(d1 - dt.timedelta(days=13), d1)
        if d in ctx.facts
    ]

    steps = []
    for key, label, counts in CHECKOUT_STEPS:
        value = f.get(key)
        base = _baseline(ctx, key, phase, pcfg)
        delta = (
            rules.pct_change(value, base)
            if value is not None and base
            else None
        )
        steps.append(
            {
                "key": key,
                "label": label,
                "counts": counts,
                "value": value,
                "baseline": base,
                "delta": delta,
                "status": _status(ctx, key, value, phase, pcfg),
            }
        )
    known = [s for s in steps if s["counts"] and s["status"] != "unknown"]
    worst = (
        max(known, key=lambda s: (RANK[s["status"]], -(s["delta"] or 0)))
        if known
        else None
    )
    kind = "sale" if phase == "sale" else "BAU"
    if worst is None:
        overall = "unknown"
        reason = f["na"].get("ic") or "No checkout funnel for this day yet"
    elif worst["status"] == "ok":
        overall = "ok"
        reason = (
            f"The three checkout steps are in line with a typical {kind} day."
        )
    else:
        overall = worst["status"]
        reason = (
            f"{worst['label']} is {abs(worst['delta']):.0%} below a typical "
            f"{kind} day ({worst['value']:.1%} against {worst['baseline']:.1%})."
        )

    def card(key, label, sub, spend_key, na_keys):
        value = f.get(key)
        base = _baseline(ctx, key, phase, pcfg)
        return {
            "key": key,
            "label": label,
            "sub": sub,
            "value": value,
            "baseline": base,
            "delta": (
                rules.pct_change(value, base)
                if value is not None and base
                else None
            ),
            "spend": f.get(spend_key),
            "last7": w7.get(key),
            "mtd": wm.get(key),
            "spark": [
                {
                    "date": d,
                    "v": ctx.facts[d].get(key),
                    "phase": ctx.facts[d].get("phase"),
                }
                for d in spark_days
            ],
            "na": (
                None
                if value is not None
                else next((f["na"][k] for k in na_keys if k in f["na"]), None)
            ),
        }

    cards = [
        card(
            "meta_sales_roas",
            "Meta ROAS",
            "Sales campaigns, Meta's own attribution",
            "meta_perf_spend",
            ["meta_perf_value", "meta_perf_spend", "meta_spend"],
        ),
        card(
            "google_sales_roas",
            "Google Ads ROAS",
            "Sales campaigns, Google's own attribution",
            "google_perf_spend",
            ["google_perf_value", "google_perf_spend", "google_spend"],
        ),
        card(
            "perf_roas",
            "Shopify ROAS",
            "Shopify sales / sales-campaign spend",
            "perf_spend",
            ["perf_spend", "spend"],
        ),
    ]
    cards[2]["mer"] = f.get("mer")
    return {
        "phase": phase,
        "kind": kind,
        "baseline_note": (
            f"Compared with a typical {kind} day: the median of the last "
            f"{pcfg['baseline_days']} {kind} days."
        ),
        "checkout": {
            "status": overall,
            "reason": reason,
            "steps": steps,
            "ic_to_order": f.get("ic_to_order"),
        },
        "cards": cards,
    }
