"""D-1: the management funnel report as a tab.

Two blocks (phase-matched prior-month period | current period), each with
Sessions, Perf sessions, ATC, IC, Orders, Revenue, AOV, Sessions→ATC %,
ATC→IC % and CVR %, a total row and a Δ row; then drill-downs by channel,
source, campaign, landing page and product; then the Claude commentary.
"""

from __future__ import annotations

from collections import defaultdict

from .. import rules
from .common import Context, delta_block

BLOCK_FIELDS = [
    "sessions",
    "perf_sessions",
    "atc",
    "ic",
    "orders",
    "gmv",
    "aov",
    "atc_rate",
    "atc_to_ic",
    "cvr",
]
DRILL_COUNTS = ["sessions", "perf_sessions", "atc", "ic", "orders", "gmv"]


def build(ctx: Context, commentary: dict | None = None) -> dict:
    win = rules.d1_windows(ctx.d1, ctx.phases, ctx.cfg["d1"])
    cur_dates, prior_dates = win["current"], win["prior"]
    per_day = len(cur_dates) != len(prior_dates)
    cur_total, prior_total = ctx.window(cur_dates), ctx.window(prior_dates)
    n = ctx.cfg["d1"]["drilldown_rows"]

    def block(dates, total):
        return {
            "start": dates[0] if dates else None,
            "end": dates[-1] if dates else None,
            "rows": [
                {
                    "date": d,
                    "phase": ctx.facts[d].get("phase"),
                    **{k: ctx.facts[d].get(k) for k in BLOCK_FIELDS},
                }
                for d in dates
            ],
            "total": {k: total.get(k) for k in BLOCK_FIELDS},
            "na": total["na"],
        }

    drill = {
        "channel": _drill(
            ctx, cur_dates, prior_dates, lambda r: r["channel"], per_day, n
        ),
        "source": _drill(
            ctx,
            cur_dates,
            prior_dates,
            lambda r: (r.get("utm_source") or "").strip().lower() or "(no UTM)",
            per_day,
            n,
        ),
        "campaign": _drill(
            ctx,
            cur_dates,
            prior_dates,
            lambda r: _campaign_label(ctx, r),
            per_day,
            n,
        ),
        "landing_page": _landing(ctx, cur_dates, prior_dates, per_day, n),
        "product": _products(ctx, cur_dates, prior_dates, per_day, n),
    }
    return {
        "title": "D-1",
        "as_of": ctx.d1,
        "phase": win["phase"],
        "window_note": win["note"],
        "basis": "per_day" if per_day else "total",
        "prior": block(prior_dates, prior_total),
        "current": block(cur_dates, cur_total),
        "delta": delta_block(cur_total, prior_total, BLOCK_FIELDS, per_day),
        "drilldowns": drill,
        "commentary": commentary,
        "notes": [
            "Current = the run of same-phase days ending yesterday (up to 7). Prior = the phase-matched period "
            "of the previous month: BAU vs BAU, sale vs sale.",
            "Sessions and ATC: Shopify. IC: GoKwik checkouts started. Orders and revenue: valid Shopify orders, "
            "attributed to source and campaign through the UTM GoKwik recorded at checkout.",
            "Landing page orders are not available per order; the landing-page drill shows GoKwik IC and "
            "conversions by the landing page GoKwik recorded.",
        ],
    }


def _campaign_label(ctx: Context, r: dict) -> str:
    camp = (r.get("utm_campaign") or "").strip()
    if not camp:
        return "(no campaign)"
    return ctx.google_names.get(camp, camp) if camp.isdigit() else camp


def _collect(ctx: Context, dates: list[str], keyfn) -> dict[str, dict]:
    out: dict[str, dict] = defaultdict(
        lambda: {k: 0 for k in DRILL_COUNTS} | {"kind": None}
    )
    days = set(dates)
    for d in dates:
        for r in ctx.session_rows.get(d, []):
            a = out[keyfn(r)]
            a["sessions"] += r["sessions"]
            a["atc"] += r["atc"]
            if r["kind"] == "perf":
                a["perf_sessions"] += r["sessions"]
            a["kind"] = a["kind"] or r["kind"]
    for r in ctx.funnel_rows:
        if r["date"] in days:
            out[keyfn(r)]["ic"] += r.get("checkout_started") or 0
    for r in ctx.order_rows:
        if r["date"] in days:
            a = out[keyfn(r)]
            a["orders"] += r["orders"]
            a["gmv"] += r["gmv"] or 0
    return out


def _finish(
    cur: dict,
    prior: dict,
    n_cur: int,
    n_prior: int,
    per_day: bool,
    n: int,
    sort_key: str,
) -> list[dict]:
    rows = []
    for k in set(cur) | set(prior):
        c = dict(cur.get(k) or {})
        p = dict(prior.get(k) or {})
        if per_day:
            for x in DRILL_COUNTS + ["units", "revenue", "converted"]:
                if x in c:
                    c[x] = c[x] / max(n_cur, 1)
                if x in p:
                    p[x] = p[x] / max(n_prior, 1)
        row = {
            "key": k,
            "kind": c.get("kind") or p.get("kind"),
            "current": c,
            "prior": p,
        }
        for side in (c, p):
            side["atc_rate"] = rules.ratio(
                side.get("atc"), side.get("sessions")
            )
            side["cvr"] = rules.ratio(side.get("orders"), side.get("sessions"))
        row["change"] = (c.get(sort_key) or 0) - (p.get(sort_key) or 0)
        row["delta"] = {
            x: rules.pct_change(c.get(x), p.get(x))
            for x in set(c) | set(p)
            if x != "kind"
        }
        rows.append(row)
    rows.sort(
        key=lambda r: -max(
            r["current"].get(sort_key) or 0, r["prior"].get(sort_key) or 0
        )
    )
    return rows[:n]


def _drill(ctx, cur_dates, prior_dates, keyfn, per_day, n):
    return _finish(
        _collect(ctx, cur_dates, keyfn),
        _collect(ctx, prior_dates, keyfn),
        len(cur_dates),
        len(prior_dates),
        per_day,
        n,
        "sessions",
    )


def _landing(ctx: Context, cur_dates, prior_dates, per_day, n):
    def collect(dates):
        out = defaultdict(
            lambda: {"sessions": 0, "atc": 0, "ic": 0, "converted": 0}
        )
        days = set(dates)
        for d in dates:
            for r in (ctx.data.get("landing") or {}).get(d, []):
                out[r["landing_page"]]["sessions"] += r["sessions"]
                out[r["landing_page"]]["atc"] += r["atc"]
        for r in ctx.funnel_rows:
            if r["date"] in days:
                out[r.get("landing_page") or "(unknown)"]["ic"] += (
                    r.get("checkout_started") or 0
                )
                out[r.get("landing_page") or "(unknown)"]["converted"] += (
                    r.get("converted") or 0
                )
        return out

    return _finish(
        collect(cur_dates),
        collect(prior_dates),
        len(cur_dates),
        len(prior_dates),
        per_day,
        n,
        "sessions",
    )


def _products(ctx: Context, cur_dates, prior_dates, per_day, n):
    def collect(dates):
        out = defaultdict(lambda: {"units": 0, "revenue": 0.0})
        days = set(dates)
        for r in ctx.data.get("products", []):
            if r["date"] in days and r["drop_reason"] is None:
                out[r["product_title"]]["units"] += r["units"]
                out[r["product_title"]]["revenue"] += r["revenue"]
        return out

    return _finish(
        collect(cur_dates),
        collect(prior_dates),
        len(cur_dates),
        len(prior_dates),
        per_day,
        n,
        "revenue",
    )
