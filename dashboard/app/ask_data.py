"""The numbers behind "Ask Claude": exact sums over the page snapshots the
refresh job writes, computed the same way the browser computes them, so an
answer always matches what the dashboard shows.

- `Engine` is a line-for-line port of static/range_engine.js: the
  Performance / Awareness / All views, sums over a window (a count is missing,
  with its reason, when any day lacks it), rates recomputed from the sums and
  never averaged, and changes that compare per-day averages for counts and the
  rates directly. Sale days are only compared with sale days, BAU with BAU.
- The breakdowns rebuild the dashboard's tables (channel, UTM source,
  campaign, landing page, product, basket size, Meta and Google campaigns by
  stage and product) for any dates.

Nothing here calls a model; app/ask.py hands these functions to Claude as
tools. No customer names, emails or phone numbers exist in these pages.
"""

from __future__ import annotations

import datetime as dt
import time
from collections import defaultdict

# --------------------------------------------------------------------- dates


def _d(s: str) -> dt.date:
    return dt.date.fromisoformat(s)


def add_days(s: str, n: int) -> str:
    return (_d(s) + dt.timedelta(days=n)).isoformat()


def diff_days(a: str, b: str) -> int:
    return (_d(b) - _d(a)).days


def range_of(a: str, b: str) -> list[str]:
    if a > b:
        return []
    return [add_days(a, i) for i in range(diff_days(a, b) + 1)]


def shift_months(s: str, n: int) -> str:
    """Same day of the month, n months away, clamped to the month's length."""
    y, m, d = int(s[:4]), int(s[5:7]), int(s[8:10])
    t = y * 12 + (m - 1) + n
    ny, nm = t // 12, t % 12 + 1
    last = (dt.date(ny + (nm == 12), nm % 12 + 1, 1) - dt.timedelta(days=1)).day
    return f"{ny:04d}-{nm:02d}-{min(d, last):02d}"


def ratio(a, b):
    return None if a is None or b is None or b == 0 else a / b


def pct_change(c, p):
    return None if c is None or p is None or p == 0 else (c - p) / p


# --------------------------------------------------------------------- views

GK = ["ic", "gk_converted", "gk_address", "gk_payment"]
# The D-1 tab's logic for every view (static/range_engine.js MODES): the
# Performance and All views are the whole store with Shopify's own Orders and
# Total sales and the team's Perf sessions, differing only in spend;
# Awareness is awareness traffic and what is credited to it.
STORE = {
    "orders": "sh_orders",
    "gmv": "sh_sales",
    "store_gmv": "sh_sales",
    "perf_sessions": "report_perf_sessions",
}
MODES = {
    "all": {"alias": dict(STORE), "blank": set(), "why": ""},
    "perf": {
        "alias": {
            **STORE,
            "meta_spend": "meta_perf_spend",
            "google_spend": "google_perf_spend",
            "spend": "perf_spend",
            "all_spend": "perf_all_spend",
        },
        "blank": set(),
        "why": "",
    },
    "aw": {
        "alias": {
            "sessions": "awareness_sessions",
            "perf_sessions": "awareness_sessions",
            "atc": "awareness_atc",
            "perf_atc": "awareness_atc",
            "orders": "awareness_orders",
            "gmv": "awareness_gmv",
            "meta_spend": "meta_aw_spend",
            "google_spend": "google_aw_spend",
            "spend": "aw_spend",
            "perf_spend": "aw_spend",
            "all_spend": "aw_spend",
            "meta_perf_spend": "meta_aw_spend",
            "meta_perf_value": "meta_aw_value",
            "google_perf_spend": "google_aw_spend",
            "google_perf_value": "google_aw_value",
            **{k: "awareness_" + k for k in GK},
        },
        "blank": {
            "new_orders",
            "repeat_orders",
            "new_gmv",
            "repeat_gmv",
            "affiliate_spend",
            "affiliate_revenue",
            "crm_flow_spend",
            "crm_flow_revenue",
            "crm_broadcast_spend",
            "crm_broadcast_revenue",
            "crm_spend",
            "crm_revenue",
            "reddit_spend",
            "other_spend",
            "perf_all_spend",
            "sh_orders",
            "sh_sales",
            "report_perf_sessions",
        },
        "why": "not an awareness channel, or not split by campaign type",
    },
}

RATE_FIELDS = [
    "roas",
    "aov",
    "cvr",
    "atc_rate",
    "atc_to_ic",
    "ic_to_order",
    "perf_cvr",
    "cps",
    "cps_all",
    "cps_ad",
    "sh_roas_all",
    "perf_overall_roas",
    "sh_aov",
    "sh_cvr",
    "sh_perf_cvr",
    "sh_ic_to_order",
    "sh_roas",
    "address_rate",
    "payment_rate",
    "paid_rate",
    "meta_sales_roas",
    "google_sales_roas",
    "mer",
    "perf_roas",
    "overall_roas",
    "affiliate_roas",
    "crm_roas",
    "crm_flow_roas",
    "crm_broadcast_roas",
    "new_share",
]
# rates that are money per unit (Rs) or a multiple (x), not a share; the rest
# are shares and are reported in percent
MONEY_RATES = {"aov", "sh_aov", "cps", "cps_all", "cps_ad"}
MULTIPLE_RATES = {
    "roas",
    "sh_roas_all",
    "perf_overall_roas",
    "sh_roas",
    "meta_sales_roas",
    "google_sales_roas",
    "mer",
    "perf_roas",
    "overall_roas",
    "affiliate_roas",
    "crm_roas",
    "crm_flow_roas",
    "crm_broadcast_roas",
}

HEADLINE = [
    "sessions",
    "report_perf_sessions",
    "atc",
    "ic",
    "orders",
    "gmv",
    "sh_orders",
    "sh_sales",
    "spend",
    "all_spend",
    "perf_all_spend",
    "aov",
    "cvr",
    "atc_rate",
    "atc_to_ic",
    "ic_to_order",
    "roas",
    "sh_roas",
]


def derive(w: dict) -> dict:
    """Rates from the summed counts, exactly as range_engine.js derive()."""
    g = w.get
    w["aov"] = ratio(g("gmv"), g("orders"))
    w["cvr"] = ratio(g("orders"), g("sessions"))
    w["atc_rate"] = ratio(g("atc"), g("sessions"))
    w["atc_to_ic"] = ratio(g("ic"), g("atc"))
    w["ic_to_order"] = ratio(g("orders"), g("ic"))
    w["perf_cvr"] = ratio(g("orders"), g("report_perf_sessions"))
    w["cps"] = ratio(g("perf_all_spend"), g("sessions"))
    w["cps_all"] = ratio(g("all_spend"), g("sessions"))
    w["cps_ad"] = ratio(g("spend"), g("sessions"))
    w["sh_roas_all"] = ratio(g("sh_sales"), g("all_spend"))
    w["sh_aov"] = ratio(g("sh_sales"), g("sh_orders"))
    w["sh_cvr"] = ratio(g("sh_orders"), g("sessions"))
    w["sh_perf_cvr"] = ratio(g("sh_orders"), g("report_perf_sessions"))
    w["sh_ic_to_order"] = ratio(g("sh_orders"), g("ic"))
    w["sh_roas"] = ratio(g("sh_sales"), g("perf_all_spend"))
    w["perf_overall_roas"] = ratio(g("gmv"), g("perf_all_spend"))
    # the team's one ROAS: store GMV / performance spend on every channel
    w["roas"] = ratio(g("store_gmv"), g("perf_all_spend"))
    w["address_rate"] = ratio(g("gk_address"), g("ic"))
    w["payment_rate"] = ratio(g("gk_payment"), g("gk_address"))
    w["paid_rate"] = ratio(g("gk_converted"), g("gk_payment"))
    w["meta_sales_roas"] = ratio(g("meta_perf_value"), g("meta_perf_spend"))
    w["google_sales_roas"] = ratio(
        g("google_perf_value"), g("google_perf_spend")
    )
    w["mer"] = ratio(g("gmv"), g("spend"))
    w["perf_roas"] = ratio(g("gmv"), g("perf_spend"))
    w["overall_roas"] = ratio(g("gmv"), g("all_spend"))
    w["affiliate_roas"] = ratio(g("affiliate_revenue"), g("affiliate_spend"))
    w["crm_roas"] = ratio(g("crm_revenue"), g("crm_spend"))
    w["crm_flow_roas"] = ratio(g("crm_flow_revenue"), g("crm_flow_spend"))
    w["crm_broadcast_roas"] = ratio(
        g("crm_broadcast_revenue"), g("crm_broadcast_spend")
    )
    known = (g("new_orders") or 0) + (g("repeat_orders") or 0)
    w["new_share"] = (
        None if g("new_orders") is None else ratio(g("new_orders"), known)
    )
    return w


class Engine:
    """range_engine.js createRangeEngine(D, mode), in Python."""

    def __init__(self, days_page: dict, mode: str = "all"):
        D = days_page
        if "store_gmv" not in D["fields"]:
            # the whole store's GMV, never re-pointed by a view (for ROAS)
            D = {
                **D,
                "fields": D["fields"] + ["store_gmv"],
                "values": {**D["values"], "store_gmv": D["values"].get("gmv") or [None] * len(D["dates"])},
                "na": {**D["na"], "store_gmv": D["na"].get("gmv") or {}},
            }
        self.dates: list[str] = D["dates"]
        self.fields: list[str] = D["fields"]
        self.at = {d: i for i, d in enumerate(self.dates)}
        self.phase = D.get("phase") or [None] * len(self.dates)
        self.phase_note = D.get("phase_note") or [None] * len(self.dates)
        self.events = D.get("events") or []
        self.phase_source = D.get("phase_source")
        self.reasons = list(D.get("reasons") or [])
        self.mode = mode
        m = MODES.get(mode) or MODES["all"]
        if m["why"]:
            self.reasons.append(m["why"])
        why = len(self.reasons) - 1
        n = len(self.dates)
        self.values, self.na = {}, {}
        for k in self.fields:
            if k in m["blank"]:
                self.values[k] = [None] * n
                self.na[k] = {"*": why}
                continue
            # a field the data does not have (an older page) keeps its own values
            alias = m["alias"].get(k)
            src = alias if alias and D["values"].get(alias) is not None else k
            self.values[k] = D["values"].get(src) or [None] * n
            self.na[k] = D["na"].get(src) or {}

    @property
    def first(self) -> str:
        return self.dates[0]

    @property
    def last(self) -> str:
        return self.dates[-1]

    def phase_of(self, d: str):
        i = self.at.get(d)
        return None if i is None else (self.phase[i] or "bau")

    def note_of(self, d: str):
        i = self.at.get(d)
        return None if i is None else self.phase_note[i]

    def in_data(self, days: list[str]) -> list[str]:
        return [d for d in days if d in self.at]

    def window(self, days: list[str]) -> dict:
        w: dict = {"days": len(days), "na": {}}
        for k in self.fields:
            total, miss = 0, None
            for d in days:
                i = self.at.get(d)
                v = None if i is None else self.values[k][i]
                if v is None:
                    if miss is None:
                        nk = self.na.get(k) or {}
                        idx = None
                        if i is not None:
                            idx = nk.get(d, nk.get("*"))
                        if idx is None:
                            miss = (
                                f"no data for {d}"
                                if i is None
                                else f"not available for {d}"
                            )
                        else:
                            miss = f"{self.reasons[idx]} ({d})"
                else:
                    total += v
            if days and miss is None:
                w[k] = total
            else:
                w[k] = None
                w["na"][k] = miss if days else "no days in this window"
        return derive(w)

    @staticmethod
    def change(cur: dict, prev: dict | None, key: str):
        if not prev:
            return None
        c, p = cur.get(key), prev.get(key)
        if c is None or p is None:
            return None
        if key not in RATE_FIELDS:
            c /= max(cur["days"], 1)
            p /= max(prev["days"], 1)
        return pct_change(c, p)

    def compare_days(self, a: str, b: str, cmp: dict, phase: str):
        mode = cmp.get("mode")
        length = diff_days(a, b) + 1
        if mode == "none":
            return None
        if mode == "match":
            mine = len([d for d in range_of(a, b) if self.phase_of(d) == phase])
            pool = [d for d in self.dates if d < a and self.phase_of(d) == phase]
            out: list[str] = []
            for d in reversed(pool):
                if len(out) >= mine:
                    break
                # a sale is one event: stop at a gap, so two sales never blend
                if phase == "sale" and out and diff_days(d, out[0]) > 7:
                    break
                out.insert(0, d)
            return out
        if mode == "previous":
            ca, cb = add_days(a, -length), add_days(a, -1)
        elif mode == "month":
            ca, cb = shift_months(a, -1), shift_months(b, -1)
        elif mode == "year":
            ca, cb = shift_months(a, -12), shift_months(b, -12)
        else:
            ca, cb = cmp.get("from"), cmp.get("to")
        if not ca or not cb or ca > cb:
            return None
        return [d for d in range_of(ca, cb) if self.phase_of(d) == phase]

    def events_for(self, days: list[str]) -> list[dict]:
        if not days:
            return []
        out = []
        for e in self.events:
            a, b = e["start"][:10], e["end"][:10]
            if any(a <= d <= b for d in days):
                out.append(e)
        return out

    def compare(self, a: str, b: str, cmp: dict) -> dict:
        all_days = self.in_data(range_of(a, b))
        groups = []
        for phase in ("bau", "sale"):
            cur = [d for d in all_days if self.phase_of(d) == phase]
            if not cur:
                continue
            prev = self.compare_days(a, b, cmp, phase)
            w = self.window(cur)
            pw = self.window(prev) if prev else None
            note = None
            if cmp.get("mode") != "none" and not pw:
                note = (
                    "There are no sale days in the comparison period, so there "
                    "is nothing fair to compare these with."
                    if phase == "sale"
                    else "There are no BAU days in the comparison period."
                )
            elif (
                pw
                and cmp.get("mode") != "match"
                and pw["days"] < max(1, round(w["days"] / 2))
            ):
                note = (
                    f"Only {pw['days']} {phase.upper()} day(s) in the comparison "
                    f"period against {w['days']}; changes use per-day averages."
                )
            if phase == "sale" and pw and not note:
                mine = {e["start"] for e in self.events_for(cur)}
                theirs = self.events_for(prev)
                if mine and theirs and all(e["start"] in mine for e in theirs):
                    note = (
                        "Both periods are inside the same sale, so this compares "
                        "later days of that sale with earlier days of it."
                    )
            groups.append(
                {
                    "phase": phase,
                    "cur": cur,
                    "prev": prev,
                    "w": w,
                    "pw": pw,
                    "note": note,
                }
            )
        mixed = [d for d in all_days if self.phase_of(d) == "mixed"]
        return {
            "groups": groups,
            "all": all_days,
            "outside": len(range_of(a, b)) - len(all_days),
            "mixed": mixed,
        }


# ---------------------------------------------------------------- formatting


def r2(x):
    return None if x is None else round(x, 2)


def rate_out(key: str, v):
    """A rate as people read it: Rs for AOV and cost per session, a multiple
    for ROAS and MER, a percentage for everything else."""
    if v is None:
        return None
    if key in MONEY_RATES:
        return {"rs": round(v, 2)}
    if key in MULTIPLE_RATES:
        return {"x": round(v, 4)}
    return {"pct": round(v * 100, 4)}


def window_out(w: dict, fields: list[str]) -> dict:
    out: dict = {"days": w["days"]}
    for k in fields:
        if k in RATE_FIELDS:
            out[k] = rate_out(k, w.get(k))
        else:
            out[k] = r2(w.get(k))
        if w.get(k) is None:
            # a rate is missing when one of its counts is; give that reason
            reason = w["na"].get(k)
            if reason is None:
                reason = next(iter(w["na"].values()), "a count it needs is missing")
            out[k] = {"unavailable": reason}
    return out


def span_text(days: list[str] | None) -> str:
    """'2026-10-01..2026-10-05, 2026-10-07' for a list of dates."""
    if not days:
        return ""
    runs: list[list[str]] = []
    for d in days:
        if runs and diff_days(runs[-1][1], d) == 1:
            runs[-1][1] = d
        else:
            runs.append([d, d])
    return ", ".join(a if a == b else f"{a}..{b}" for a, b in runs)


# --------------------------------------------------------------- page cache


class Pages:
    """Page snapshots from the store, kept in memory for a few minutes."""

    TTL = 600

    def __init__(self, store, ttl: int | None = None):
        self.store = store
        self.ttl = self.TTL if ttl is None else ttl
        self._cache: dict[str, tuple[float, object]] = {}

    def get(self, name: str):
        now = time.time()
        hit = self._cache.get(name)
        if hit and now - hit[0] < self.ttl:
            return hit[1]
        val = self.store.get_json(f"pages/{name}.json")
        self._cache[name] = (now, val)
        return val


# --------------------------------------------------------------- breakdowns

DRILL_DIMS = {
    "channel": "channel",
    "utm_source": "source",
    "utm_campaign": "campaign",
    "landing_page": "landing_page",
}
DRILL_FIELDS = [
    "sessions",
    "perf_sessions",
    "atc",
    "ic",
    "orders",
    "gmv",
    "converted",
]
AD_FIELDS = ["spend", "value", "purchases", "clicks", "impressions"]
STAGE_ORDER = ["TOF", "MOF", "BOF", "Catalog"]


def _keep_kind(view: str, kind) -> bool:
    """The campaign-type switch, as rgKeep() in range_tabs.js."""
    if isinstance(kind, bool) or kind is None:
        kind = "awareness" if kind else "perf"
    if view == "all":
        return True
    return kind == ("awareness" if view == "aw" else "perf")


def _keep_drill(view: str, k: int) -> bool:
    """d1Collect() in range_d1.js: kind 3 (not split) stays in every view."""
    return view == "all" or k == 3 or k == (1 if view == "aw" else 0)


def _ad_rates(a: dict) -> dict:
    return {
        "roas_x": None if not a["spend"] else round(a["value"] / a["spend"], 4),
        "cpc_rs": None if not a["clicks"] else round(a["spend"] / a["clicks"], 2),
        "ctr_pct": (
            None
            if not a["impressions"]
            else round(a["clicks"] / a["impressions"] * 100, 4)
        ),
        "cpa_rs": (
            None if not a["purchases"] else round(a["spend"] / a["purchases"], 2)
        ),
    }


def _drill_rates(a: dict) -> dict:
    return {
        "atc_rate_pct": (
            None if not a["sessions"] else round(a["atc"] / a["sessions"] * 100, 4)
        ),
        "cvr_pct": (
            None
            # orders above sessions mean the UTM was lost between visit and
            # order (organic search): no honest rate
            if not a["sessions"] or a["orders"] > a["sessions"]
            else round(a["orders"] / a["sessions"] * 100, 4)
        ),
        "aov_rs": None if not a["orders"] else round(a["gmv"] / a["orders"], 2),
        "atc_to_ic_pct": (
            None if not a["atc"] else round(a["ic"] / a["atc"] * 100, 4)
        ),
    }


class Breakdowns:
    """Rebuilds the dashboard's tables for any list of days."""

    def __init__(self, pages: Pages):
        self.pages = pages

    # each returns (rows keyed by name -> metrics dict, coverage note or None)

    def drill(self, dim: str, days: set[str], view: str):
        p = self.pages.get("drill_days")
        if not p or dim not in p:
            return None, "the drill-down data has not been built yet"
        src = p[dim]
        out: dict[str, dict] = {}
        for r in src["rows"]:
            if r[0] not in days or not _keep_drill(view, r[2]):
                continue
            name = src["names"][r[1]]["key"]
            a = out.setdefault(name, dict.fromkeys(DRILL_FIELDS, 0))
            for j, f in enumerate(DRILL_FIELDS):
                a[f] += r[3 + j] or 0
        note = None
        lo, hi = p.get("from"), p.get("to")
        outside = sorted(d for d in days if not lo or d < lo or d > hi)
        if outside:
            note = f"no drill-down data for {span_text(outside)}"
        if dim == "landing_page":
            have = set(p.get("landing_days") or [])
            gap = sorted(d for d in days if d not in have)
            if gap:
                note = (
                    (note + "; " if note else "")
                    + f"landing-page sessions are only stored for "
                    f"{span_text(sorted(have)) or 'no days'}; on other days only "
                    "GoKwik checkouts (IC) are known per landing page"
                )
        return out, note

    def products(self, days: set[str]):
        p = self.pages.get("product_days")
        if not p:
            return None, "the product data has not been built yet"
        out: dict[str, dict] = {}
        for d, i, units, rev, mrp_val, mrp_units, mrp_rev in p["rows"]:
            if d not in days:
                continue
            n = p["names"][i]
            key = n.get("label") or n["id"]
            a = out.setdefault(
                key,
                {
                    "type": n.get("type"),
                    "units": 0,
                    "revenue": 0.0,
                    "_mrp_val": 0.0,
                    "_mrp_rev": 0.0,
                },
            )
            a["units"] += units
            a["revenue"] += rev
            a["_mrp_val"] += mrp_val
            a["_mrp_rev"] += mrp_rev
        for a in out.values():
            a["landed_discount_pct"] = (
                round((1 - a["_mrp_rev"] / a["_mrp_val"]) * 100, 4)
                if a["_mrp_val"]
                else None
            )
            del a["_mrp_val"], a["_mrp_rev"]
        return out, None

    def product_types(self, days: set[str]):
        p = self.pages.get("product_days")
        if not p:
            return None, "the product data has not been built yet"
        out: dict[str, dict] = {}
        for d, ti, dropped, lines, units, rev in p.get("type_rows") or []:
            if d not in days:
                continue
            key = (p["types"][ti] or "(blank)") + (
                " (left out of product tables)" if dropped else ""
            )
            a = out.setdefault(key, {"lines": 0, "units": 0, "revenue": 0.0})
            a["lines"] += lines
            a["units"] += units
            a["revenue"] += rev
        return out, None

    def basket(self, days: set[str]):
        p = self.pages.get("slab_days")
        if not p or p.get("na"):
            return None, (p or {}).get("na") or "basket size has not been built yet"
        top = p.get("top", 5)
        have = set(p.get("days") or [])
        out: dict[str, dict] = {}
        for d, slab, orders, units, sales, *_ in p["rows"]:
            if d not in days:
                continue
            label = (
                "0 items (gifts or merch only)"
                if slab == 0
                else f"{top}+ items"
                if slab >= top
                else f"{slab} item{'s' if slab > 1 else ''}"
            )
            a = out.setdefault(label, {"orders": 0, "units": 0, "sales": 0.0})
            a["orders"] += orders
            a["units"] += units
            a["sales"] += sales
        tot_o = sum(a["orders"] for a in out.values())
        tot_s = sum(a["sales"] for a in out.values())
        for a in out.values():
            a["share_of_orders_pct"] = (
                round(a["orders"] / tot_o * 100, 4) if tot_o else None
            )
            a["share_of_sales_pct"] = (
                round(a["sales"] / tot_s * 100, 4) if tot_s else None
            )
            a["aov_rs"] = round(a["sales"] / a["orders"], 2) if a["orders"] else None
        miss = sorted(d for d in days if d not in have)
        return out, (f"no basket data for {span_text(miss)}" if miss else None)

    def meta(self, group_by: str, days: set[str], view: str):
        """Meta spend and platform-reported value. Days with ad-level rows use
        each ad's own stage and product (an ad naming two products counts half
        to each); other days use the campaign name, like the Marketing tab."""
        cd = self.pages.get("campaign_days")
        if not cd or not cd.get("meta"):
            return None, "the campaign data has not been built yet"
        mt = self.pages.get("meta_tree") or {}
        labels = cd.get("labels") or {}
        out: dict[str, dict] = {}

        def add(key, nums, share=1.0, extra=None):
            a = out.setdefault(key, {**dict.fromkeys(AD_FIELDS, 0.0), **(extra or {})})
            for j, f in enumerate(AD_FIELDS):
                a[f] += (nums[j] or 0) * share

        def keys_for(c, stage, prods, camp_label, adset=None, ad=None):
            kind = c.get("kind") or ("awareness" if c.get("awareness") else "perf")
            prods = prods or ["UNMAPPED"]
            if group_by == "campaign":
                return [(camp_label, 1.0)]
            if group_by == "adset":
                return [(f"{camp_label} › {adset}" if adset else f"{camp_label} › (no ad-level data)", 1.0)]
            if group_by == "ad":
                return [(f"{camp_label} › {adset} › {ad}" if ad else f"{camp_label} › (no ad-level data)", 1.0)]
            if group_by == "account":
                return [(c.get("account") or "?", 1.0)]
            if kind == "social":
                return [("Social (Reach)", 1.0)]
            if group_by == "stage":
                if kind == "awareness":
                    return [("Awareness · " + (c.get("goal") or "Other"), 1.0)]
                return [(stage or "TOF", 1.0)]
            if group_by == "product":
                return [(labels.get(p, p), 1.0 / len(prods)) for p in prods]
            if group_by == "stage_product":
                st = (
                    "Awareness · " + (c.get("goal") or "Other")
                    if kind == "awareness"
                    else stage or "TOF"
                )
                return [(f"{st} › {labels.get(p, p)}", 1.0 / len(prods)) for p in prods]
            raise ValueError(f"unknown group_by {group_by!r} for Meta")

        ad_by_day: dict[str, list] = defaultdict(list)
        for r in mt.get("rows") or []:
            if r[0] in days:
                ad_by_day[r[0]].append(r)
        ad_days = 0
        seen: dict[str, set] = defaultdict(set)  # day -> campaigns with ad rows
        for d in days:
            rows = ad_by_day.get(d) or []
            if rows:
                ad_days += 1
            for r in rows:
                ad = mt["ads"][r[1]]
                s = mt["adsets"][ad["s"]]
                c = mt["campaigns"][s["c"]]
                seen[d].add((c.get("account"), str(c.get("id"))))
                if not _keep_kind(view, c.get("kind") or c.get("awareness")):
                    continue
                prods = None if c.get("kind") == "social" else ad.get("prod")
                for key, share in keys_for(
                    c, ad.get("stage"), prods, c["name"], s.get("name"), ad.get("name")
                ):
                    add(key, r[2:7], share)
        # campaigns with no ad-level rows that day: the campaign name decides
        for r in cd["meta"]["rows"]:
            if r[0] not in days:
                continue
            c = cd["meta"]["names"][r[1]]
            if (c.get("account"), str(c.get("id"))) in seen[r[0]]:
                continue
            if not _keep_kind(view, c.get("kind") or c.get("awareness")):
                continue
            for key, share in keys_for(c, c.get("stage"), c.get("prod"), c["name"]):
                add(key, r[2:7], share)
        for a in out.values():
            a.update(_ad_rates(a))
        note = None
        if group_by in ("adset", "ad") and ad_days < len(days):
            note = (
                f"ad-level Meta data covers {ad_days} of the {len(days)} days; "
                "on the others only the campaign total is known"
            )
        return out, note

    def google(self, group_by: str, days: set[str], view: str):
        cd = self.pages.get("campaign_days")
        if not cd or not cd.get("google"):
            return None, "the campaign data has not been built yet"
        labels = cd.get("labels") or {}
        sku_groups = set(cd.get("google_sku_groups") or [])
        out: dict[str, dict] = {}
        if group_by in ("ad_group", "ad"):
            gt = self.pages.get("google_tree") or {}
            rows_key = "group_rows" if group_by == "ad_group" else "ad_rows"
            got_days = set()
            for r in gt.get(rows_key) or []:
                if r[0] not in days:
                    continue
                if group_by == "ad_group":
                    grp = gt["groups"][r[1]]
                    c = gt["campaigns"][grp["c"]]
                    key = f"{c['name']} › {grp['name']}"
                else:
                    ad = gt["ads"][r[1]]
                    grp = gt["groups"][ad["g"]]
                    c = gt["campaigns"][grp["c"]]
                    key = f"{c['name']} › {grp['name']} › {ad['name']}"
                if not _keep_kind(view, c.get("kind") or c.get("awareness")):
                    continue
                got_days.add(r[0])
                a = out.setdefault(key, dict.fromkeys(AD_FIELDS, 0.0))
                for j, f in enumerate(AD_FIELDS):
                    a[f] += r[2 + j] or 0
            for a in out.values():
                a.update(_ad_rates(a))
            note = None
            if len(got_days) < len(days):
                note = (
                    f"Google ad-group data covers {len(got_days)} of the "
                    f"{len(days)} days"
                )
            return out, note
        for r in cd["google"]["rows"]:
            if r[0] not in days:
                continue
            c = cd["google"]["names"][r[1]]
            if not _keep_kind(view, c.get("kind") or c.get("awareness")):
                continue
            kind = c.get("kind") or "perf"
            if group_by == "campaign":
                keys = [(c["name"], 1.0)]
            elif group_by == "group":
                keys = [
                    (
                        ("Awareness · " if kind == "awareness" else "")
                        + (c.get("group") or "Other"),
                        1.0,
                    )
                ]
            elif group_by == "product":
                if kind == "awareness" or c.get("group") not in sku_groups:
                    keys = [(f"{c.get('group') or 'Other'} (not split by product)", 1.0)]
                else:
                    prods = c.get("prod") or ["UNMAPPED"]
                    keys = [(labels.get(p, p), 1.0 / len(prods)) for p in prods]
            else:
                raise ValueError(f"unknown group_by {group_by!r} for Google")
            for key, share in keys:
                a = out.setdefault(key, dict.fromkeys(AD_FIELDS, 0.0))
                for j, f in enumerate(AD_FIELDS):
                    a[f] += (r[2 + j] or 0) * share
        for a in out.values():
            a.update(_ad_rates(a))
        return out, None
