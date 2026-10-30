"""Shared context for every page: one row of facts per day, built once.

Every tab reads the same facts, so GMV, orders, sessions and spend have one
definition across the dashboard. A missing input is None plus a reason in
facts["na"]; it is never shown as zero.
"""

from __future__ import annotations

import datetime as dt
from collections import defaultdict

from .. import rules

COUNT_FIELDS = [
    "sessions",
    "perf_sessions",
    "awareness_sessions",
    "atc",
    "perf_atc",
    "ic",
    "gk_converted",
    "orders",
    "gmv",
    "new_orders",
    "repeat_orders",
    "new_gmv",
    "repeat_gmv",
    "meta_spend",
    "meta_perf_spend",
    "meta_platform_value",
    "google_spend",
    "google_perf_spend",
    "google_platform_value",
    "spend",
    "perf_spend",
]

NA = {
    "sessions": "Shopify sessions were not pulled for this day",
    "ic": "GoKwik funnel not loaded for this day (the mail CSV is still manual)",
    "orders": "Shopify orders not synced for this day",
    "google": "GOOGLEADS_CONSOLIDATED has no data for this day yet",
    "google_gap": "GOOGLEADS_CONSOLIDATED has no rows for this day (sync gap)",
    "meta": "Meta Ads not cached for this day",
}


def derive(f: dict) -> dict:
    """Rates recomputed from counts (never averaged across days)."""
    r = rules.ratio
    known = (f.get("new_orders") or 0) + (f.get("repeat_orders") or 0)
    f.update(
        aov=r(f.get("gmv"), f.get("orders")),
        cvr=r(f.get("orders"), f.get("sessions")),
        perf_cvr=r(f.get("orders"), f.get("perf_sessions")),
        atc_rate=r(f.get("atc"), f.get("sessions")),
        atc_to_ic=r(f.get("ic"), f.get("atc")),
        ic_to_order=r(f.get("orders"), f.get("ic")),
        mer=r(f.get("gmv"), f.get("spend")),
        perf_roas=r(f.get("gmv"), f.get("perf_spend")),
        new_share=(
            r(f.get("new_orders"), known)
            if f.get("new_orders") is not None
            else None
        ),
    )
    return f


class Context:
    def __init__(self, data: dict, cfg: dict):
        self.cfg = cfg
        self.data = data
        self.d1 = data["d1"]
        self.checks = {c["source"]: c for c in data.get("checks", [])}
        self.unavailable = dict(data.get("unavailable") or {})
        self.aware_ids, self.known_ids = rules.google_awareness_ids(
            data.get("google_campaigns", []),
            cfg["sessions"]["awareness_name_regex"],
        )
        self.google_names = {
            c["campaign_id"]: c["campaign_name"]
            for c in data.get("google_campaigns", [])
        }
        self.unclassified_google: dict[str, dict] = {}
        self.session_rows = self._classify_sessions()
        self.funnel_rows = self._classify_utm_rows(data.get("funnel", []))
        self.order_rows = self._classify_utm_rows(
            data.get("order_attribution", [])
        )
        self.facts = self._build_facts()
        self.phases = rules.detect_phases(
            [
                {"date": d, "gmv": f["gmv"], "meta_spend": f["meta_spend"]}
                for d, f in self.facts.items()
            ],
            cfg["phases"],
        )
        for d, f in self.facts.items():
            p = self.phases.get(d)
            f["phase"] = p["phase"] if p else None
            f["phase_basis"] = p["basis"] if p else None

    # ------------------------------------------------------------ classify

    def channel(self, utm_source: str, utm_medium: str) -> str:
        return rules.classify_channel(
            {"utm_source": utm_source, "utm_medium": utm_medium},
            self.cfg["channels"],
        )

    def _classify_sessions(self) -> dict[str, list[dict]]:
        out = {}
        scfg = self.cfg["sessions"]
        for day, payload in (self.data.get("sessions") or {}).items():
            rows = []
            for r in payload["rows"]:
                kind, unknown = rules.session_kind(
                    r["utm_source"],
                    r["utm_campaign"],
                    self.aware_ids,
                    self.known_ids,
                    scfg,
                )
                if unknown:
                    u = self.unclassified_google.setdefault(
                        unknown,
                        {"campaign_id": unknown, "sessions": 0, "dates": set()},
                    )
                    u["sessions"] += r["sessions"]
                    u["dates"].add(day)
                rows.append(
                    {
                        **r,
                        "kind": kind,
                        "channel": self.channel(
                            r["utm_source"], r["utm_medium"]
                        ),
                    }
                )
            out[day] = rows
        return out

    def _classify_utm_rows(self, rows: list[dict]) -> list[dict]:
        scfg = self.cfg["sessions"]
        out = []
        for r in rows:
            kind, _ = rules.session_kind(
                r.get("utm_source"),
                r.get("utm_campaign"),
                self.aware_ids,
                self.known_ids,
                scfg,
            )
            channel = self.channel(r.get("utm_source"), r.get("utm_medium"))
            if r.get("in_gokwik") is False:
                channel = "Not in GoKwik"
            out.append({**r, "kind": kind, "channel": channel})
        return out

    # ------------------------------------------------------------ facts

    def _latest(self, source: str) -> str | None:
        c = self.checks.get(source)
        return c.get("latest_date") if c else None

    def _build_facts(self) -> dict[str, dict]:
        d = self.data
        start = d["history_start"]
        dates = rules.date_range(start, self.d1)

        orders = {r["date"]: r for r in d.get("orders_daily", [])}
        ic = defaultdict(lambda: [0, 0])
        for r in self.funnel_rows:
            ic[r["date"]][0] += r.get("checkout_started") or 0
            ic[r["date"]][1] += r.get("converted") or 0
        google = defaultdict(lambda: [0.0, 0.0, 0.0])
        for r in d.get("google_ads", []):
            g = google[r["date"]]
            g[0] += r["spend"] or 0
            g[2] += r.get("conversion_value") or 0
            if r["campaign_id"] not in self.aware_ids:
                g[1] += r["spend"] or 0
        google_latest = self._latest("google_ads")
        funnel_latest = self._latest("gokwik_funnel")
        meta_days = d.get("meta") or {}

        facts = {}
        for day in dates:
            f = {"date": day, "na": {}}
            s = (d.get("sessions") or {}).get(day)
            if s:
                aw_s = sum(
                    r["sessions"]
                    for r in self.session_rows[day]
                    if r["kind"] == "awareness"
                )
                aw_a = sum(
                    r["atc"]
                    for r in self.session_rows[day]
                    if r["kind"] == "awareness"
                )
                f.update(
                    sessions=s["totals"]["sessions"],
                    atc=s["totals"]["atc"],
                    awareness_sessions=aw_s,
                    perf_sessions=s["totals"]["sessions"] - aw_s,
                    perf_atc=s["totals"]["atc"] - aw_a,
                )
            else:
                for k in (
                    "sessions",
                    "atc",
                    "awareness_sessions",
                    "perf_sessions",
                    "perf_atc",
                ):
                    f[k] = None
                    f["na"][k] = self.unavailable.get(
                        "shopify_sessions", NA["sessions"]
                    )

            if day in ic or (
                funnel_latest
                and day <= funnel_latest
                and day >= d.get("funnel_start", day)
            ):
                f["ic"], f["gk_converted"] = ic[day] if day in ic else (0, 0)
            else:
                f["ic"] = f["gk_converted"] = None
                f["na"]["ic"] = f["na"]["gk_converted"] = NA["ic"]

            o = orders.get(day)
            for k in (
                "orders",
                "gmv",
                "new_orders",
                "repeat_orders",
                "new_gmv",
                "repeat_gmv",
            ):
                f[k] = o[k] if o else None
                if not o:
                    f["na"][k] = NA["orders"]

            if google_latest and day <= google_latest and day in google:
                (
                    f["google_spend"],
                    f["google_perf_spend"],
                    f["google_platform_value"],
                ) = google[day]
            elif (
                day in self.cfg["google_ads"].get("zero_spend_dates", {})
                and google_latest
                and day <= google_latest
            ):
                # Confirmed in config: the account had no budget, so no rows
                # is a real zero, not a sync gap.
                f["google_spend"] = f["google_perf_spend"] = f[
                    "google_platform_value"
                ] = 0.0
            else:
                # No rows at all inside the synced range is a sync gap, not zero spend.
                reason = (
                    NA["google"]
                    if not google_latest or day > google_latest
                    else NA["google_gap"]
                )
                f["google_spend"] = f["google_perf_spend"] = f[
                    "google_platform_value"
                ] = None
                for k in (
                    "google_spend",
                    "google_perf_spend",
                    "google_platform_value",
                ):
                    f["na"][k] = reason

            if day in meta_days:
                rows = meta_days[day]
                f["meta_spend"] = sum(r["spend"] for r in rows)
                f["meta_platform_value"] = sum(
                    r["purchase_value"] for r in rows
                )
                if any(r.get("campaign_name") is None for r in rows):
                    # Account-level rows: the Awareness split needs campaign names.
                    f["meta_perf_spend"] = None
                    f["na"][
                        "meta_perf_spend"
                    ] = "Meta campaign names not available for this day (account-level data)"
                else:
                    f["meta_perf_spend"] = sum(
                        r["spend"]
                        for r in rows
                        if not rules.is_awareness_name(
                            r["campaign_name"], self.cfg["sessions"]
                        )
                    )
            else:
                reason = self.unavailable.get("meta", NA["meta"])
                f["meta_spend"] = f["meta_perf_spend"] = f[
                    "meta_platform_value"
                ] = None
                for k in (
                    "meta_spend",
                    "meta_perf_spend",
                    "meta_platform_value",
                ):
                    f["na"][k] = reason

            for total, parts in (
                ("spend", ("meta_spend", "google_spend")),
                ("perf_spend", ("meta_perf_spend", "google_perf_spend")),
            ):
                vals = [f[p] for p in parts]
                f[total] = sum(vals) if None not in vals else None
                if f[total] is None:
                    f["na"][total] = "; ".join(
                        sorted({f["na"][p] for p in parts if p in f["na"]})
                    )
            facts[day] = derive(f)
        return facts

    # ------------------------------------------------------------ windows

    def window(self, dates: list[str]) -> dict:
        """Counts summed over dates and rates recomputed. A count is None when
        any day in the window is missing it."""
        out = {"days": len(dates), "na": {}}
        for k in COUNT_FIELDS:
            vals = [
                self.facts[d].get(k) if d in self.facts else None for d in dates
            ]
            if dates and None not in vals:
                out[k] = sum(vals)
            else:
                out[k] = None
                for d in dates:
                    reason = self.facts.get(d, {}).get("na", {}).get(k)
                    if reason:
                        out["na"][k] = f"{reason} ({d})"
                        break
                else:
                    out["na"][k] = "No days in window"
        return derive(out)

    def unclassified_google_rows(self) -> list[dict]:
        return sorted(
            (
                {**v, "dates": sorted(v["dates"])}
                for v in self.unclassified_google.values()
            ),
            key=lambda r: -r["sessions"],
        )


def month_to_date(d1: str) -> tuple[list[str], list[str]]:
    """(this month 1..D-1, the same day span of the previous month)."""
    end = rules.to_date(d1)
    start = end.replace(day=1)
    prev_end_of_month = start - dt.timedelta(days=1)
    prev_start = prev_end_of_month.replace(day=1)
    prev_end = prev_start.replace(day=min(end.day, prev_end_of_month.day))
    return rules.date_range(start, end), rules.date_range(prev_start, prev_end)


def delta_block(
    current: dict, prior: dict, fields: list[str], per_day: bool
) -> dict:
    """% change per field. With unequal windows, counts compare per-day
    averages; rates always compare directly."""
    out = {}
    for k in fields:
        c, p = current.get(k), prior.get(k)
        if per_day and k in COUNT_FIELDS and c is not None and p is not None:
            c, p = c / max(current["days"], 1), p / max(prior["days"], 1)
        out[k] = rules.pct_change(c, p)
    return out


def top_rows(rows: list[dict], key: str, n: int) -> list[dict]:
    return sorted(rows, key=lambda r: -(r.get(key) or 0))[:n]
