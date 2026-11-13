"""Ask Claude: the dashboard's assistant.

A question from any tab goes to Claude (config.json "assistant": model and
effort) with tools that read the same page snapshots the dashboard draws from.
Claude never sees raw files and never guesses a number: every figure in an
answer comes from a tool, and the tools do the sums with the dashboard's own
rules (app/ask_data.py), so an answer matches the screen.

The reply streams to the browser as server-sent events:
  {"t": "status", "text": ...}   what the assistant is reading
  {"t": "step"}                  the text so far was a note before a tool call
  {"t": "delta", "text": ...}    answer text
  {"t": "done", ...}             finished (model, whether a fallback ran)
  {"t": "error", "text": ...}    stopped, with the reason
"""

from __future__ import annotations

import ast
import json
import operator
import time
from collections import defaultdict, deque

from . import secrets, settings
from .ask_data import (
    DRILL_DIMS,
    HEADLINE,
    MONEY_RATES,
    MULTIPLE_RATES,
    RATE_FIELDS,
    Breakdowns,
    Engine,
    Pages,
    add_days,
    diff_days,
    r2,
    range_of,
    rate_out,
    span_text,
    window_out,
)

MAX_QUESTION = 2000
MAX_HISTORY = 12  # earlier questions and answers kept for follow-ups
MAX_ROWS = 60
MAX_PER_DAY = 92

SYSTEM = """You are "Ask Claude", the analyst built into Asaya's internal D2C dashboard. Asaya (worldofasaya.com) is an Indian skincare brand selling on its own Shopify store; the dashboard is read by the founders, the Head of D2C and the marketing team.

# How you work
- Every number in your answer must come from a tool result in this conversation. Never estimate, recall or invent a figure, a date or a campaign name. If the tools cannot give it, say "Data unavailable: <reason>" and name what would answer it.
- Use the `calculate` tool for any arithmetic the tools did not already return (sums of rows, differences, shares, ratios). Do not do arithmetic in your head.
- Read before you answer: check the dates and view in the question (or the dashboard view the user is looking at), call the tools that cover them, then answer. Make independent tool calls in parallel.
- If the question is ambiguous about dates, use the dates the user is looking at (given with each question) and say so in one short line. Do not stop to ask unless the question cannot be answered at all.
- Answer the question asked, first, in one or two sentences with the key number; then the supporting detail. Be direct, like a sharp Head of D2C talking to the founder.

# The dashboard's rules (follow them; the tools already do)
- Two exclusions hold everywhere: ASAYASS and ASAYAINF orders are never counted, and free gifts, merch, books and gummies never count as items, units, quantities or products (the tools already leave them out; never add them back).
- Every tab follows the D-1 tab's logic, and so must you. Views: "perf" (Performance, the default) and "all" are the whole store as the team's D-1 sheet reads it: `orders` and `gmv` ARE Shopify's own Sales report (Orders and Total sales: cancelled orders still count as orders, Total sales nets off returns processed that day), sessions / atc / ic are the whole store's, and `perf_sessions` is the team's Perf. sessions rule. The two views differ only in spend: perf shows sales-campaign spend, all every campaign. "aw" (Awareness) is awareness traffic and the orders and GMV credited to it. Use the view the user is on unless the question names another.
- Questions about states, cities, or products in a place: use the `region` tool (Shopify's Sales report by shipping address, the same numbers as D-1). Items and basket size there leave out gifts and merch; rank AOV or basket size only among places with 20+ orders.
- Products: names are "CODE · name" (UAS, ITB, ASS, HOT, EEC...). A question about a shade, fragrance, size or pack (Aqua Rush, Sweet Vanilla, Honeydew, 50 g, pack of 2...) is a variant question: use dimension product_variant with name_contains set to that word (a single distinctive word, e.g. "aqua"), and add up all its rows (single and packs) unless one pack is asked for. A product code or product name: use product with name_contains (e.g. "UAS"). If a search finds nothing, list the product's variants (product_variant, name_contains the code) before saying it does not exist; never answer with a different product or variant instead.
- DRR (daily run rate) = units (and revenue) over the days asked ÷ the number of days in the tool's n_days; for "this month" use the 1st to the latest day with data, and say which days.
- Breakdowns (channel, source, campaign, product, basket size, new vs repeat) count orders as placed (cancelled orders left out, returns not subtracted), so they add up to slightly less or more than the headline; the difference is Shopify's cancellations and returns. Say so when a breakdown total is compared with the headline.
- Sale days are compared only with sale days, BAU with BAU. Transition days (a sale went live or ended that day) sit out of both sides. The sale/BAU label of each day comes from the team's media-plan calendar where it exists, else from hour-by-hour order detection. Never compare a sale period with a BAU period as if like for like; if the user asks to, show it but say plainly it is not like for like.
- When two periods differ in length, counts are compared on per-day averages; rates are compared directly. Rates are always recomputed from summed counts, never averaged across days.
- When a result has `estimated_spends`, those spends are estimates for days the team's sheets have not reached yet (affiliate from its share of sales, CRM from a typical day, Reddit from the media-plan's daily plan). Say so whenever you quote Spends, ROAS or CPS for those days.
- ROAS: the team reads ONE ROAS, field `roas` = Shopify's Total sales (the whole store, as on D-1) / performance spend on every channel (perf_all_spend: Meta, Google and Reddit sales campaigns, CRM, affiliates). It is the same in the Performance and All views and does not exist for Awareness. Awareness and Reach spend are never in ROAS. Quote `roas` (sh_roas is the same number) when asked for ROAS; mention platform-reported ROAS (meta_sales_roas, google_sales_roas) or MER only if the user asks for them by name. A missing day makes a total unavailable (with the reason); missing is never zero.
- Awareness: Meta campaigns named "awareness"; Google campaigns on the awareness list; Reddit "traffic" campaigns. Meta "Reach" and "Amazon" campaigns are in neither Performance nor Awareness: counted in total spend only.

# Metrics (field names the tools use)
Counts: sessions (Shopify sessions in the view), report_perf_sessions ("Perf. sessions" in the team's D-1 sheet: UTM source on the team's paid/affiliate/CRM list, with a UTM campaign, not awareness or social), awareness_sessions, atc (sessions that added to cart), ic (GoKwik checkouts started), gk_address / gk_payment / gk_converted (GoKwik address step, payment step, paid), orders and gmv (in the perf and all views: Shopify's own Sales report, Orders and Total sales, the D-1 numbers; ASAYAINF/ASAYASS orders left out), sh_orders and sh_sales (the same report, by name), new_orders / repeat_orders / new_gmv / repeat_gmv (whole store only), meta_spend, google_spend, spend (Meta + Google), meta_perf_spend / meta_perf_value and google_perf_spend / google_perf_value (sales campaigns' spend and platform-reported value), affiliate_spend / affiliate_revenue, crm_spend / crm_revenue (flow + broadcast), reddit_spend (Reddit performance spend from the media-plan sheet: up to 31 Oct 2026 every Reddit campaign including traffic, as the team counted it then; from 1 Nov sales campaigns only), other_spend (affiliate + CRM + Reddit), all_spend (spend + other_spend), perf_all_spend ("Spends" on D-1: every channel's sales-campaign spend, affiliate included in every month), aw_spend, meta_social_spend.
Rates: roas (Shopify Total sales / perf_all_spend: THE ROAS, = sh_roas), aov (gmv/orders), cvr (orders/sessions), atc_rate (atc/sessions), atc_to_ic (ic/atc), ic_to_order (orders/ic), perf_cvr (orders/report_perf_sessions), sh_aov, sh_cvr, sh_perf_cvr (sh_orders/report_perf_sessions: "CVR % on perf" in D-1), sh_ic_to_order, sh_roas (sh_sales/perf_all_spend: D-1 "RoAS"), cps (perf_all_spend/sessions: D-1 "CPS"), perf_roas (gmv/(Meta+Google sales spend)), perf_overall_roas (gmv/perf_all_spend), mer (gmv/spend), overall_roas (gmv/all_spend), meta_sales_roas and google_sales_roas (platform-reported), address_rate, payment_rate, paid_rate, new_share, affiliate_roas, crm_roas.
Breakdowns: traffic by channel, UTM source, UTM campaign and landing page (last-click UTM as Shopify records it; orders by the UTM GoKwik captured); products (units and item revenue, gifts/merch/books/gummies left out); product types; basket size (orders with 1, 2, 3, 4, 5+ items: single, buy 2, buy 3...); Meta by campaign, ad set, ad, account, funnel stage (TOF/MOF/BOF/Catalog; MOF_/BOF_ ads inside TOF offer campaigns count as MOF/BOF) and product (an ad naming two products counts half to each); Google by campaign, group (Brand Search, Brand PMax, Non-brand PMax, Demand Gen, YouTube), product (Non-brand PMax only), ad group and ad. Platform values (Meta/Google purchase value) are what the ad platforms claim, not Shopify revenue.

# Writing the answer
- Indian formats: Rs with Indian digit grouping (Rs 1,23,456; Rs 12.4 lakh; Rs 1.2 crore for large sums). Percentages to 2 decimals. ROAS as 2.41x. Changes as +4.20% or -1.35 pp for rates.
- Always say which dates and view the numbers cover (e.g. "1-3 Nov, Performance view, vs 1-3 Oct BAU").
- Markdown: short paragraphs, "- " bullets, **bold** for the key figure, and a compact table when comparing several rows. No headings above level 3. Keep it under about 250 words unless the user asks for depth.
- When asked "why", trace the movement down the funnel (sessions, ATC, IC, orders, AOV) and then to channel, source, campaign, landing page and product, using the breakdowns. Say what the data shows and what it cannot show (checkout changes need the Shopify Changes Tracker, which the dashboard does not read). End with one concrete action when it helps.
- The data never contains customer names, emails or phone numbers; do not ask for them."""


def _s(desc: str, **extra) -> dict:
    return {"type": "string", "description": desc, **extra}


VIEW = _s(
    "Campaign-type view: perf (Performance), aw (Awareness) or all (whole store).",
    enum=["perf", "aw", "all"],
)
PHASE = _s(
    "Which days of the range: any (every day), bau or sale.",
    enum=["any", "bau", "sale"],
)
DATE = "Date, YYYY-MM-DD (IST)."

BREAKDOWN_DIMS = [
    "channel",
    "utm_source",
    "utm_campaign",
    "landing_page",
    "product",
    "product_variant",
    "product_type",
    "basket_size",
    "meta_campaign",
    "meta_adset",
    "meta_ad",
    "meta_account",
    "meta_stage",
    "meta_product",
    "meta_stage_product",
    "google_campaign",
    "google_group",
    "google_product",
    "google_ad_group",
    "google_ad",
]


def _tool(name: str, desc: str, props: dict) -> dict:
    return {
        "name": name,
        "description": desc,
        "strict": True,
        "eager_input_streaming": True,
        "input_schema": {
            "type": "object",
            "properties": props,
            "required": list(props),
            "additionalProperties": False,
        },
    }


TOOLS = [
    _tool(
        "get_metrics",
        "Totals and rates for one date range, summed exactly as the dashboard does "
        "(a field is unavailable, with the reason, if any day lacks it). Optionally "
        "day by day. Also returns which days are sale, BAU or transition.",
        {
            "start": _s(DATE),
            "end": _s(DATE),
            "view": VIEW,
            "phase": PHASE,
            "fields": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Metric names (counts and rates). Empty for the headline set.",
            },
            "per_day": {
                "type": "boolean",
                "description": "Also return each day's values (up to 92 days).",
            },
        },
    ),
    _tool(
        "compare_periods",
        "The dashboard's period comparison: the range split into its BAU block and its "
        "sale block, each compared with the same kind of days in the comparison period. "
        "Counts change on per-day averages, rates directly. Use this for any 'vs' question.",
        {
            "start": _s(DATE),
            "end": _s(DATE),
            "compare": _s(
                "previous (the same number of days just before), month (same dates last "
                "month), year (same dates last year), match (the nearest earlier days of "
                "the same kind: the previous sale for a sale), custom (compare_start.."
                "compare_end), none.",
                enum=["previous", "month", "year", "match", "custom", "none"],
            ),
            "compare_start": _s("For custom: date, else empty string."),
            "compare_end": _s("For custom: date, else empty string."),
            "view": VIEW,
            "fields": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Metric names. Empty for the headline set.",
            },
        },
    ),
    _tool(
        "get_calendar",
        "Sale / BAU / transition label for each day in a range (with the reason), the "
        "sale events found, where the labels come from, and the dates the data covers. "
        "Use it to find sales, BAU stretches and the latest day with data.",
        {"start": _s(DATE + " Empty for the last 60 days."), "end": _s(DATE + " Empty for the latest day.")},
    ),
    _tool(
        "breakdown",
        "One of the dashboard's tables for any dates, optionally against a comparison "
        "window: traffic by channel / utm_source / utm_campaign / landing_page (sessions, "
        "perf sessions, ATC, IC, orders, GMV, GoKwik converted, rates); product (one row "
        "per product as 'CODE · name', e.g. 'UAS · Even Tone Underarm Mist', all its variants "
        "together), product_variant (one row per shade / fragrance and size / pack, e.g. "
        "'UAS · Even Tone Underarm Mist · Aqua Rush · 100ml x 2'; units as sold, pieces = "
        "bottles or tubes, skus) and product_type (units, item revenue; whole store); basket_size (orders, items, "
        "sales by items per order; whole store); Meta by campaign, adset, ad, account, "
        "stage, product or stage_product, and Google by campaign, group, product, "
        "ad_group or ad (spend, platform value, purchases, clicks, impressions, ROAS, "
        "CPC, CTR, CPA). Rows are sorted by sort_by, largest first, with a total row.",
        {
            "dimension": _s("The table.", enum=BREAKDOWN_DIMS),
            "start": _s(DATE),
            "end": _s(DATE),
            "phase": PHASE,
            "view": VIEW,
            "compare_start": _s("Comparison window start (same phase filter), or empty string for none."),
            "compare_end": _s("Comparison window end, or empty string."),
            "sort_by": _s(
                "Metric to sort by (e.g. sessions, orders, gmv, revenue, units, spend, "
                "value, roas_x). Empty for the table's main metric."
            ),
            "name_contains": _s("Keep only rows whose name contains this (any case), or empty."),
            "limit": {"type": "integer", "description": "Rows to return, 1 to 60."},
        },
    ),
    _tool(
        "d1_report",
        "The D-1 management report as the refresh job built it for yesterday: its "
        "windows (current run of same-phase days against the phase-matched prior "
        "window), totals, changes, drill-downs and the written commentary.",
        {},
    ),
    _tool(
        "today_live",
        "Today so far (the Today tab): Shopify orders, GMV, sessions, conversion and "
        "checkout against yesterday and a typical day at the same hour, and today's ad "
        "spend. Refreshed every few minutes; whole store.",
        {},
    ),
    _tool(
        "region",
        "The Region tab: Shopify's Sales report (the D-1 numbers) by the shipping address. "
        "level=state gives every state of India; level=city gives the cities of `state` (or "
        "of all India); level=product gives the products bought in `city`, else `state`, else "
        "all India. Each row: revenue (Total sales), orders, AOV, items and basket_size (items per "
        "order; gifts, merch, books and gummies are never counted, and gift products never appear), "
        "share of the place's revenue, and with a comparison window the change (counts on "
        "per-day averages). Also returns the place's own totals. Place names can be spelled "
        "loosely (Bangalore, Bengaluru, MH, Tamil Nadu).",
        {
            "level": _s("What the rows are.", enum=["state", "city", "product"]),
            "state": _s("A state or its code (Maharashtra, MH), or empty for all India."),
            "city": _s("A city (Mumbai, Bengaluru), or empty."),
            "start": _s(DATE),
            "end": _s(DATE),
            "phase": PHASE,
            "compare_start": _s("Comparison window start (same phase filter), or empty string for none."),
            "compare_end": _s("Comparison window end, or empty string."),
            "sort_by": _s("revenue, orders, aov_rs, items, basket_size or revenue_change_pct; empty for revenue."),
            "limit": {"type": "integer", "description": "Rows to return, 1 to 60."},
        },
    ),
    _tool(
        "calculate",
        "Exact arithmetic: + - * / ** ( ) and round(x, n), min, max, abs, sum([..]). "
        "Use for every figure you derive yourself.",
        {"expression": _s("e.g. (523110 - 498200) / 498200 * 100")},
    ),
]


# ------------------------------------------------------------------ calculate

_OPS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
    ast.Pow: operator.pow,
    ast.USub: operator.neg,
    ast.UAdd: operator.pos,
}
_FUNCS = {"round": round, "min": min, "max": max, "abs": abs, "sum": sum}


def calculate(expr: str):
    if len(expr) > 2000:
        raise ValueError("expression too long")

    def ev(n):
        if isinstance(n, ast.Expression):
            return ev(n.body)
        if isinstance(n, ast.Constant) and isinstance(n.value, (int, float)):
            return n.value
        if isinstance(n, ast.BinOp) and type(n.op) in _OPS:
            a, b = ev(n.left), ev(n.right)
            if isinstance(n.op, ast.Pow) and abs(b) > 100:
                raise ValueError("exponent too large")
            return _OPS[type(n.op)](a, b)
        if isinstance(n, ast.UnaryOp) and type(n.op) in _OPS:
            return _OPS[type(n.op)](ev(n.operand))
        if isinstance(n, (ast.List, ast.Tuple)):
            return [ev(x) for x in n.elts]
        if (
            isinstance(n, ast.Call)
            and isinstance(n.func, ast.Name)
            and n.func.id in _FUNCS
            and not n.keywords
        ):
            return _FUNCS[n.func.id](*[ev(a) for a in n.args])
        raise ValueError("only numbers, + - * / ** % ( ), round, min, max, abs, sum")

    v = ev(ast.parse(expr, mode="eval"))
    return round(v, 10) if isinstance(v, float) else v


# ----------------------------------------------------------------- tool impl


class ToolError(Exception):
    pass


def _date(s: str, name: str) -> str:
    try:
        return add_days(s, 0)
    except (TypeError, ValueError):
        raise ToolError(f"{name} must be a date like 2026-11-01, got {s!r}")


def _fields(fields) -> list[str]:
    return list(fields) if fields else list(HEADLINE)


class Tools:
    def __init__(self, pages: Pages):
        self.pages = pages
        self.bd = Breakdowns(pages)
        self._eng: dict[str, Engine] = {}

    def engine(self, view: str) -> Engine:
        if view not in ("perf", "aw", "all"):
            raise ToolError("view must be perf, aw or all")
        days = self.pages.get("days")
        if not days or not days.get("dates"):
            raise ToolError("Data unavailable: the days page has not been built yet")
        key = f"{view}:{id(days)}"
        if key not in self._eng:
            self._eng[key] = Engine(days, view)
        return self._eng[key]

    def _check_fields(self, eng: Engine, fields: list[str]) -> None:
        bad = [f for f in fields if f not in eng.fields and f not in RATE_FIELDS]
        if bad:
            raise ToolError(
                f"unknown field(s) {bad}. Counts: {eng.fields}. Rates: {RATE_FIELDS}"
            )

    def _span(self, eng: Engine, start: str, end: str):
        a, b = _date(start, "start"), _date(end, "end")
        if a > b:
            a, b = b, a
        if diff_days(a, b) > 800:
            raise ToolError("range longer than 800 days")
        return a, b

    def _phase_days(self, eng: Engine, a: str, b: str, phase: str) -> list[str]:
        days = eng.in_data(range_of(a, b))
        if phase == "any":
            return days
        if phase not in ("bau", "sale"):
            raise ToolError("phase must be any, bau or sale")
        return [d for d in days if eng.phase_of(d) == phase]

    def _coverage(self, eng: Engine, a: str, b: str) -> dict:
        days = range_of(a, b)
        inside = eng.in_data(days)
        by = defaultdict(list)
        for d in inside:
            by[eng.phase_of(d)].append(d)
        out = {
            "data_covers": f"{eng.first}..{eng.last}",
            "bau_days": span_text(by.get("bau")),
            "sale_days": span_text(by.get("sale")),
            "transition_days": span_text(by.get("mixed")),
        }
        missing = [d for d in days if d not in eng.at]
        if missing:
            out["days_without_data"] = span_text(missing)
        return out

    # --- tools

    def get_metrics(self, start, end, view, phase, fields, per_day):
        eng = self.engine(view)
        fields = _fields(fields)
        self._check_fields(eng, fields)
        a, b = self._span(eng, start, end)
        days = self._phase_days(eng, a, b, phase)
        out = {
            "range": f"{a}..{b}",
            "view": view,
            "phase_filter": phase,
            "days_used": span_text(days),
            "n_days": len(days),
            **self._coverage(eng, a, b),
            "total": window_out(eng.window(days), fields),
        }
        if per_day:
            if len(days) > MAX_PER_DAY:
                raise ToolError(
                    f"per_day is limited to {MAX_PER_DAY} days; ask for a shorter range"
                )
            out["per_day"] = [
                {
                    "date": d,
                    "phase": eng.phase_of(d),
                    **{
                        k: v
                        for k, v in window_out(eng.window([d]), fields).items()
                        if k != "days"
                    },
                }
                for d in days
            ]
        return out

    def compare_periods(self, start, end, compare, compare_start, compare_end, view, fields):
        eng = self.engine(view)
        fields = _fields(fields)
        self._check_fields(eng, fields)
        a, b = self._span(eng, start, end)
        cmp = {"mode": compare}
        if compare == "custom":
            ca, cb = _date(compare_start, "compare_start"), _date(compare_end, "compare_end")
            cmp.update({"from": min(ca, cb), "to": max(ca, cb)})
        c = eng.compare(a, b, cmp)
        groups = []
        for g in c["groups"]:
            w, pw = g["w"], g["pw"]
            row = {
                "phase": g["phase"],
                "current_days": span_text(g["cur"]),
                "current_n_days": len(g["cur"]),
                "comparison_days": span_text(g["prev"]) if g["prev"] else None,
                "comparison_n_days": len(g["prev"]) if g["prev"] else 0,
                "note": g["note"],
                "current": window_out(w, fields),
                "comparison": window_out(pw, fields) if pw else None,
                "change": {},
            }
            for k in fields:
                ch = Engine.change(w, pw, k)
                if ch is None:
                    row["change"][k] = None
                elif k in RATE_FIELDS:
                    row["change"][k] = {"relative_pct": round(ch * 100, 4)}
                    if k in MULTIPLE_RATES:
                        row["change"][k]["diff_x"] = round(w[k] - pw[k], 4)
                    elif k in MONEY_RATES:
                        row["change"][k]["diff_rs"] = round(w[k] - pw[k], 2)
                    else:
                        row["change"][k]["diff_pp"] = round((w[k] - pw[k]) * 100, 4)
                else:
                    basis = "per-day average" if pw and pw["days"] != w["days"] else "total"
                    row["change"][k] = {"pct": round(ch * 100, 4), "basis": basis}
                    if pw and pw["days"] != w["days"] and w.get(k) is not None and pw.get(k) is not None:
                        row["change"][k]["current_per_day"] = r2(w[k] / max(w["days"], 1))
                        row["change"][k]["comparison_per_day"] = r2(pw[k] / max(pw["days"], 1))
            groups.append(row)
        return {
            "range": f"{a}..{b}",
            "view": view,
            "compare": cmp,
            "transition_days_left_out": span_text(c["mixed"]) or None,
            "days_outside_data": c["outside"],
            "groups": groups,
        }

    def get_calendar(self, start, end):
        eng = self.engine("all")
        b = _date(end, "end") if end else eng.last
        a = _date(start, "start") if start else add_days(b, -59)
        a, b = self._span(eng, a, b)
        days = [
            {"date": d, "phase": eng.phase_of(d), "why": eng.note_of(d)}
            for d in range_of(a, b)
            if d in eng.at
        ]
        events = [
            {"start": e["start"], "end": e["end"], "uplift_x": e.get("uplift"), "source": e.get("source", "detected")}
            for e in eng.events
        ]
        return {
            "data_covers": f"{eng.first}..{eng.last}",
            "latest_day": eng.last,
            "labels_from": eng.phase_source,
            "sale_events_all_history": events,
            "days": days,
        }

    def breakdown(self, dimension, start, end, phase, view, compare_start, compare_end, sort_by, name_contains, limit):
        eng = self.engine("all")
        if view not in ("perf", "aw", "all"):
            raise ToolError("view must be perf, aw or all")
        a, b = self._span(eng, start, end)
        cur = self._phase_days(eng, a, b, phase)
        prev = None
        if compare_start or compare_end:
            ca, cb = self._span(eng, compare_start or compare_end, compare_end or compare_start)
            prev = self._phase_days(eng, ca, cb, phase)
        limit = max(1, min(int(limit or 25), MAX_ROWS))

        def run(days):
            s = set(days)
            if dimension in DRILL_DIMS:
                return self.bd.drill(DRILL_DIMS[dimension], s, view), "sessions"
            if dimension == "product":
                return self.bd.products(s), "revenue"
            if dimension == "product_variant":
                return self.bd.product_variants(s), "revenue"
            if dimension == "product_type":
                return self.bd.product_types(s), "revenue"
            if dimension == "basket_size":
                return self.bd.basket(s), "orders"
            if dimension.startswith("meta_"):
                return self.bd.meta(dimension[5:], s, view), "spend"
            if dimension.startswith("google_"):
                return self.bd.google(dimension[7:], s, view), "spend"
            raise ToolError(f"unknown dimension {dimension!r}")

        (rows, note), main = run(cur)
        if rows is None:
            raise ToolError(f"Data unavailable: {note}")
        prows, pnote = ({}, None)
        if prev is not None:
            (prows, pnote), _ = run(prev)
            prows = prows or {}
        key = sort_by or main
        sample = next(iter(rows.values()), {})
        if rows and key not in sample:
            raise ToolError(f"sort_by must be one of {sorted(sample)}")
        names = list(rows)
        if name_contains:
            needle = name_contains.lower()
            names = [n for n in names if needle in n.lower()]
            prow_names = [n for n in prows if needle in n.lower()]
        else:
            prow_names = list(prows)
        names.sort(key=lambda n: -(rows[n].get(key) or 0))
        counts = [k for k, v in sample.items() if isinstance(v, (int, float)) and not k.endswith(("_pct", "_rs", "_x"))]

        def tot(src, keys):
            t = {}
            for k in counts:
                t[k] = r2(sum((src[n].get(k) or 0) for n in keys))
            return t

        nc, np_ = len(cur), len(prev or [])
        out_rows = []
        for n in names[:limit]:
            row = {"name": n, **{k: (r2(v) if isinstance(v, float) else v) for k, v in rows[n].items()}}
            if prev is not None:
                p = prows.get(n)
                row["comparison"] = (
                    {k: (r2(v) if isinstance(v, float) else v) for k, v in p.items()} if p else None
                )
                ch = {}
                for k in counts:
                    c_v, p_v = rows[n].get(k) or 0, (p or {}).get(k) or 0
                    if p_v and nc and np_:
                        ch[k] = round(((c_v / nc) / (p_v / np_) - 1) * 100, 4)
                    else:
                        ch[k] = None
                row["change_pct_per_day"] = ch
            out_rows.append(row)
        result = {
            "dimension": dimension,
            "view": view if dimension not in ("product", "product_variant", "product_type", "basket_size") else "whole store",
            "days": span_text(cur),
            "n_days": nc,
            "rows_total": len(names),
            "rows_shown": len(out_rows),
            "sorted_by": key,
            "total_all_rows": tot(rows, names),
            "rows": out_rows,
        }
        if prev is not None:
            result["comparison_days"] = span_text(prev)
            result["comparison_n_days"] = np_
            result["comparison_total_all_rows"] = tot(prows, prow_names) if prows else None
            result["change_basis"] = "per-day averages" if nc != np_ else "totals (same number of days)"
        notes = [x for x in (note, pnote and f"comparison: {pnote}") if x]
        if phase == "any":
            mixed = [
                label
                for label, ds in (("this period", cur), ("the comparison", prev or []))
                if len({eng.phase_of(d) for d in ds} - {"mixed"}) > 1
            ]
            if mixed:
                notes.append(
                    f"{' and '.join(mixed)} mixes sale and BAU days; use phase "
                    "bau or sale to compare like with like"
                )
        if dimension == "landing_page":
            notes.append("orders and GMV are not known per landing page")
        if dimension.startswith(("meta_", "google_")):
            notes.append("value and purchases are what the ad platform reports, not Shopify revenue")
        if notes:
            result["notes"] = notes
        if not cur:
            result["notes"] = result.get("notes", []) + [
                f"no {phase if phase != 'any' else ''} days in {a}..{b}".replace("  ", " ")
            ]
        return result

    def d1_report(self):
        p = self.pages.get("d1")
        if not p:
            raise ToolError("Data unavailable: the D-1 report has not been built yet")
        from . import commentary

        try:
            out = commentary._summary(p)
        except (KeyError, TypeError):
            out = {k: p.get(k) for k in ("as_of", "phase", "basis", "window_note", "prior", "current", "delta")}
        c = p.get("commentary") or {}
        out["commentary"] = c.get("text") or f"Data unavailable: {c.get('na') or 'no commentary'}"
        out["notes"] = p.get("notes")
        return out

    def today_live(self):
        p = self.pages.get("live")
        if not p:
            raise ToolError("Data unavailable: the live page has not been built yet")
        drop = {"curves", "series", "hours"}

        def strip(x, depth=0):
            if isinstance(x, dict):
                return {k: strip(v, depth + 1) for k, v in x.items() if k not in drop}
            if isinstance(x, list):
                return [strip(v, depth + 1) for v in x[:80]]
            if isinstance(x, float):
                return round(x, 4)
            return x

        return strip(p)

    def region(self, level, state, city, start, end, phase, compare_start, compare_end, sort_by, limit):
        from .ask_data import REGION_MIN_ORDERS, RegionData

        rd = RegionData(self.pages)
        P = rd.page()
        if P is None:
            raise ToolError("Data unavailable: the Region data has not been pulled from Shopify yet")
        if level not in ("state", "city", "product"):
            raise ToolError("level must be state, city or product")
        eng = self.engine("all")
        a, b = self._span(eng, start, end)
        in_r = lambda ds: [d for d in ds if P["from"] <= d <= P["to"]]
        cur = in_r(self._phase_days(eng, a, b, phase))
        prev = None
        if compare_start or compare_end:
            ca, cb = self._span(eng, compare_start or compare_end, compare_end or compare_start)
            prev = in_r(self._phase_days(eng, ca, cb, phase))
        if not cur:
            raise ToolError(f"Data unavailable: Region data covers {P['from']}..{P['to']}, and none of those days are in {a}..{b} ({phase})")
        state_i = rd.find_state(state) if state else None
        if state and state_i is None:
            raise ToolError(f"no state matches {state!r}; use a state's name or code, e.g. " + ", ".join(s["name"] for s in P["states"][:6]))
        cities = None
        if city:
            hits = rd.find_city(city, state_i)
            names = sorted({P["cities"][i]["name"] + " (" + P["states"][P["cities"][i]["s"]]["name"] + ")" for i in hits})
            if not hits:
                raise ToolError(f"no city matches {city!r}" + (f" in {P['states'][state_i]['name']}" if state_i is not None else ""))
            if len(names) > 1:
                raise ToolError(f"{city!r} matches several places: {', '.join(names[:8])}; name the state too")
            cities = set(hits)
            state_i = P["cities"][hits[0]]["s"]
        sku = set(P.get("sku_days") or [])
        need = lambda ds: len(ds) if set(ds) <= sku else -1  # items and basket only with product detail for every day
        scope = (P["cities"][next(iter(cities))]["name"] if cities else P["states"][state_i]["name"] if state_i is not None else "India")

        def total(ds):
            m = rd.places(set(ds), "state", state_i, cities)
            t = {"orders": 0, "sales": 0.0, "qty": 0, "paid": 0, "paid_days": set()}
            for x in m.values():
                for k in ("orders", "sales", "qty", "paid"):
                    t[k] += x[k]
                t["paid_days"] |= x["paid_days"]
            return rd.metrics(t, need(ds))

        def rows(ds):
            if level == "product":
                return {k: {**rd.metrics({**v, "paid_days": set()}, None),
                            "items": v["qty"], "basket_size": round(v["qty"] / v["orders"], 4) if v["orders"] else None}
                        for k, v in rd.products(set(ds), state_i, cities).items()}
            if level == "state":
                m = rd.places(set(ds), "state")
                if state_i is not None:  # one state asked for: just that row
                    m = {k: v for k, v in m.items() if k == P["states"][state_i]["name"]}
            else:
                m = rd.places(set(ds), "city", state_i, cities)
            return {k: rd.metrics(v, need(ds)) for k, v in m.items()}

        nc, np_ = len(cur), len(prev or [])
        R, PR = rows(cur), rows(prev) if prev else {}
        T, PT = total(cur), total(prev) if prev else None
        tot_rev = sum(r["revenue"] for r in R.values()) or None

        def change(x, y, k):
            if x is None or y in (None, 0):
                return None
            if k in ("aov_rs", "basket_size"):
                return round((x / y - 1) * 100, 2)
            return round(((x / nc) / (y / np_) - 1) * 100, 2) if nc and np_ else None

        out_rows = []
        for name, r in R.items():
            row = {"name": name, **r, "share_of_revenue_pct": round(r["revenue"] / tot_rev * 100, 2) if tot_rev else None}
            if prev is not None:
                pr = PR.get(name)
                row["comparison"] = pr
                row["revenue_change_pct"] = change(r["revenue"], pr and pr["revenue"], "revenue")
                row["orders_change_pct"] = change(r["orders"], pr and pr["orders"], "orders")
                row["aov_change_pct"] = change(r["aov_rs"], pr and pr["aov_rs"], "aov_rs")
            if r["orders"] < REGION_MIN_ORDERS:
                row["few_orders"] = True
            out_rows.append(row)
        key = sort_by or "revenue"
        if out_rows and key not in out_rows[0]:
            raise ToolError("sort_by must be one of revenue, orders, aov_rs, items, basket_size, revenue_change_pct")
        out_rows.sort(key=lambda r: -(r.get(key) if r.get(key) is not None else float("-inf")))
        limit = max(1, min(int(limit or 25), 60))
        notes = []
        miss = [d for d in cur if d not in sku]
        if miss:
            notes.append(f"product detail is missing for {span_text(miss)} (it backfills over the next refreshes): items, basket size and the product rows leave those days out")
        if level != "product":
            notes.append(f"rows marked few_orders have under {REGION_MIN_ORDERS} orders: do not rank them on AOV or basket size")
        if level == "product":
            notes.append("for a product, aov_rs is its revenue per order that had it, items its units and basket_size its units per such order")
        out = {
            "place": scope,
            "level": level,
            "days": span_text(cur),
            "n_days": nc,
            "place_total": T,
            "rows_total": len(out_rows),
            "rows": out_rows[:limit],
            "sorted_by": key,
            "notes": notes,
        }
        if prev is not None:
            out.update(
                comparison_days=span_text(prev),
                comparison_n_days=np_,
                place_total_comparison=PT,
                place_change_pct={k: change(T[k], PT[k] if PT else None, k) for k in ("revenue", "orders", "aov_rs")},
                change_basis="per-day averages for revenue and orders" if nc != np_ else "totals",
            )
        return out

    def calculate(self, expression):
        try:
            return {"expression": expression, "result": calculate(expression)}
        except (SyntaxError, ValueError, TypeError, ZeroDivisionError, OverflowError) as exc:
            raise ToolError(f"cannot calculate: {exc}")

    def run(self, name: str, args: dict):
        fn = {
            "get_metrics": self.get_metrics,
            "compare_periods": self.compare_periods,
            "get_calendar": self.get_calendar,
            "breakdown": self.breakdown,
            "d1_report": self.d1_report,
            "today_live": self.today_live,
            "region": self.region,
            "calculate": self.calculate,
        }.get(name)
        if fn is None:
            raise ToolError(f"no tool {name!r}")
        if not isinstance(args, dict):
            raise ToolError("tool input must be an object")
        spec = next(t for t in TOOLS if t["name"] == name)["input_schema"]
        missing = [k for k in spec["required"] if k not in args]
        extra = [k for k in args if k not in spec["properties"]]
        if missing or extra:
            raise ToolError(f"bad input: missing {missing}, unexpected {extra}")
        return fn(**args)


def status_text(name: str, args: dict) -> str:
    """A short line for the browser while a tool runs."""
    view = {"perf": "Performance", "aw": "Awareness", "all": "all campaigns"}.get(args.get("view"), "")
    span = ""
    if args.get("start"):
        span = args["start"] if args.get("start") == args.get("end") else f"{args.get('start')} to {args.get('end')}"
    if name == "get_metrics":
        return f"Reading totals for {span} ({view})"
    if name == "compare_periods":
        return f"Comparing {span} with the {args.get('compare')} period ({view})"
    if name == "get_calendar":
        return "Checking the sale and BAU calendar"
    if name == "breakdown":
        return f"Breaking down by {str(args.get('dimension', '')).replace('_', ' ')} for {span}"
    if name == "d1_report":
        return "Reading the D-1 report"
    if name == "today_live":
        return "Reading today's live numbers"
    if name == "calculate":
        return "Calculating"
    if name == "region":
        where = args.get("city") or args.get("state") or "India"
        return f"Reading {args.get('level', 'state')}s in {where} for {span}"
    return name


# -------------------------------------------------------------- rate limiting

_hits: dict[str, deque] = defaultdict(deque)


def allow(user: str, per_hour: int) -> bool:
    now = time.time()
    q = _hits[user]
    while q and now - q[0] > 3600:
        q.popleft()
    if len(q) >= per_hour:
        return False
    q.append(now)
    return True


# ----------------------------------------------------------------- the loop


def _context_text(view: dict | None) -> str:
    """What the user is looking at, given with every question."""
    if not view:
        return "The user's dashboard view is not known."
    keep = {
        k: view.get(k)
        for k in (
            "tab",
            "tab_label",
            "from",
            "to",
            "range_label",
            "view",
            "compare",
            "compare_from",
            "compare_to",
            "groups",
            "latest_day",
            "region",
        )
        if view.get(k) not in (None, "", [])
    }
    return "What the user is looking at on the dashboard:\n" + json.dumps(keep, default=str)


VOICE_NOTE = (
    "The user spoke this question and speech-to-text wrote it down, so some "
    "words may be misheard (e.g. 'revise' or 'revenues' for revenue, 'solo' for "
    "'so low', 'roast' or 'rose' for ROAS, 'pee max' for PMax, 'go quick' for "
    "GoKwik, 'a OV' for AOV). Read it as an Asaya D2C manager most likely meant "
    "it, using the dashboard's vocabulary. If you reinterpret a word, say so in "
    "one short line at the start (e.g. \"Reading 'revise' as revenue.\"). Only "
    "ask what they meant if no sensible reading exists.\n\n"
)


def _clean_history(history) -> list[dict]:
    out = []
    for h in (history or [])[-MAX_HISTORY:]:
        if not isinstance(h, dict):
            continue
        role, text = h.get("role"), h.get("text")
        if role in ("user", "assistant") and isinstance(text, str) and text.strip():
            out.append({"role": role, "content": text[:8000]})
    # the conversation must alternate and start with the user
    fixed: list[dict] = []
    for m in out:
        if fixed and fixed[-1]["role"] == m["role"]:
            fixed[-1] = m
        elif fixed or m["role"] == "user":
            fixed.append(m)
    if fixed and fixed[-1]["role"] == "user":
        fixed.pop()
    return fixed


def _echo(content: list) -> tuple[list, list]:
    """The assistant turn to send back, and the tool calls to run. After a
    fallback, thinking and tool calls from before the switch are left out (they
    belong to the model that declined)."""
    last_fb = max(
        (i for i, b in enumerate(content) if getattr(b, "type", None) == "fallback"),
        default=-1,
    )
    echo, calls = [], []
    for i, b in enumerate(content):
        t = getattr(b, "type", None)
        if i < last_fb and t in ("thinking", "redacted_thinking", "tool_use"):
            continue
        echo.append(b)
        if t == "tool_use":
            calls.append(b)
    return echo, calls


def answer(question: str, history, view: dict | None, cfg: dict, store, client=None, voice: bool = False):
    """Yields the events described at the top of this module."""
    question = (question or "").strip()
    if not question:
        yield {"t": "error", "text": "Type a question first."}
        return
    if len(question) > MAX_QUESTION:
        yield {"t": "error", "text": f"Questions are limited to {MAX_QUESTION} characters."}
        return
    if client is None:
        key = secrets.get_secret(cfg["api_key_secret"])
        if not key:
            yield {
                "t": "error",
                "text": f"Data unavailable: Anthropic API key not in Secret Manager ({cfg['api_key_secret']}).",
            }
            return
        import anthropic

        client = anthropic.Anthropic(api_key=key, timeout=600, max_retries=2)

    tools = Tools(Pages(store))
    messages = _clean_history(history) + [
        {"role": "user", "content": f"{_context_text(view)}\n\n{VOICE_NOTE if voice else ''}Question: {question}"}
    ]
    system = [{"type": "text", "text": SYSTEM, "cache_control": {"type": "ephemeral"}}]
    fallback = False
    model = cfg["model"]
    usage = {"input": 0, "output": 0, "cache_read": 0}
    import anthropic

    for turn in range(cfg.get("max_turns", 14)):
        try:
            with client.beta.messages.stream(
                model=cfg["model"],
                max_tokens=cfg.get("max_tokens", 32000),
                thinking={"type": "adaptive"},
                output_config={"effort": cfg["effort"]},
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
                system=system,
                tools=TOOLS,
                messages=messages,
            ) as stream:
                for ev in stream:
                    et = getattr(ev, "type", None)
                    if et == "content_block_delta" and getattr(ev.delta, "type", None) == "text_delta":
                        yield {"t": "delta", "text": ev.delta.text}
                    elif et == "content_block_start" and getattr(ev.content_block, "type", None) == "fallback":
                        fallback = True
                msg = stream.get_final_message()
        except anthropic.RateLimitError:
            yield {"t": "error", "text": "Claude is rate-limited right now. Try again in a minute."}
            return
        except anthropic.APIStatusError as exc:
            detail = str(getattr(exc, "message", "") or "")[:300]
            print(json.dumps({"ask": "api_error", "status": exc.status_code, "detail": detail}))
            yield {
                "t": "error",
                "text": f"Claude API error {exc.status_code}: {detail or 'no detail'}. "
                "Try again; if it repeats, check the API key and credits.",
            }
            return
        except anthropic.APIConnectionError:
            yield {"t": "error", "text": "Could not reach the Claude API. Try again."}
            return
        model = getattr(msg, "model", model) or model
        u = getattr(msg, "usage", None)
        if u is not None:
            usage["input"] += getattr(u, "input_tokens", 0) or 0
            usage["output"] += getattr(u, "output_tokens", 0) or 0
            usage["cache_read"] += getattr(u, "cache_read_input_tokens", 0) or 0
            for it in getattr(u, "iterations", None) or []:
                if getattr(it, "type", None) == "fallback_message":
                    fallback = True
        if msg.stop_reason == "refusal":
            yield {"t": "error", "text": "Claude declined to answer this question. Try rephrasing it."}
            return
        if msg.stop_reason == "pause_turn":
            messages.append({"role": "assistant", "content": msg.content})
            continue
        echo, calls = _echo(msg.content)
        # a reply cut off at the token limit may carry a half-written tool
        # call; never run it
        if msg.stop_reason == "max_tokens":
            yield {"t": "error", "text": "The answer ran too long and was cut off. Ask for a narrower question."}
            return
        if msg.stop_reason != "tool_use" or not calls:
            print(json.dumps({"ask": "done", "turns": turn + 1, "model": model, "fallback": fallback, **usage}))
            yield {"t": "done", "model": model, "fallback": fallback}
            return
        yield {"t": "step"}
        messages.append({"role": "assistant", "content": echo})
        results = []
        for call in calls:
            args = call.input if isinstance(call.input, dict) else {}
            yield {"t": "status", "text": status_text(call.name, args)}
            try:
                out = tools.run(call.name, args)
                results.append(
                    {"type": "tool_result", "tool_use_id": call.id, "content": json.dumps(out, default=str, separators=(",", ":"))}
                )
            except ToolError as exc:
                results.append({"type": "tool_result", "tool_use_id": call.id, "content": str(exc), "is_error": True})
            except Exception as exc:  # a bug in a tool must not end the answer
                results.append(
                    {"type": "tool_result", "tool_use_id": call.id, "content": f"tool failed: {type(exc).__name__}: {exc}", "is_error": True}
                )
        messages.append({"role": "user", "content": results})
    yield {"t": "error", "text": "This question needed more steps than allowed. Try splitting it into smaller questions."}


def config() -> dict:
    base = dict(settings.config().get("commentary", {}))
    base.update(settings.config().get("assistant", {}))
    return base
