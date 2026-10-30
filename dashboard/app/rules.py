"""Metric rules from the kickoff brief, as pure functions.

Nothing here touches the network, so every rule is unit-tested in isolation:
channel mapping, the Perf vs Awareness session split, sale vs BAU phase
detection and the phase-matched D-1 comparison windows.
"""

from __future__ import annotations

import datetime as dt
import re
import statistics
from functools import lru_cache

# ---------------------------------------------------------------- helpers


def ratio(numerator, denominator):
    """numerator / denominator, or None when either side is missing or zero."""
    if numerator is None or denominator in (None, 0):
        return None
    return numerator / denominator


def pct_change(current, prior):
    if current is None or prior in (None, 0):
        return None
    return (current - prior) / prior


def to_date(value) -> dt.date:
    return (
        value
        if isinstance(value, dt.date)
        else dt.date.fromisoformat(str(value)[:10])
    )


def date_range(start, end) -> list[str]:
    start, end = to_date(start), to_date(end)
    return [
        (start + dt.timedelta(days=i)).isoformat()
        for i in range((end - start).days + 1)
    ]


@lru_cache(maxsize=256)
def _rx(pattern: str) -> re.Pattern:
    return re.compile(pattern, re.IGNORECASE)


# ---------------------------------------------------------------- channels


def classify_channel(fields: dict, rules: list[dict]) -> str:
    """First rule whose every field regex matches wins. Fields are compared
    lower-cased and trimmed; a missing field reads as ""."""
    norm = {k: (str(v or "")).strip().lower() for k, v in fields.items()}
    for rule in rules:
        if all(
            _rx(rx).search(norm.get(field, ""))
            for field, rx in rule["match"].items()
        ):
            return rule["channel"]
    return "Other"


# ---------------------------------------------------------------- sessions

_NUMERIC_ID = re.compile(r"^\d{6,}$")


def session_kind(
    utm_source: str,
    utm_campaign: str,
    google_awareness_ids: set[str],
    known_google_ids: set[str],
    cfg: dict,
) -> tuple[str, str | None]:
    """Classify a session as "awareness" or "perf".

    Awareness: the UTM campaign name contains "awareness" (any case, any
    source), or a Google campaign ID whose campaign name contains it.
    Returns (kind, unclassified_google_id). The second value is set when a
    Google session carries a campaign ID that GOOGLEADS_CONSOLIDATED does not
    know yet; it counts as Perf until the campaign syncs.
    """
    source = (utm_source or "").strip().lower()
    campaign = (utm_campaign or "").strip()
    if is_awareness_name(campaign, cfg):
        return "awareness", None
    if source in cfg["google_sources"] and _NUMERIC_ID.match(campaign):
        if campaign in google_awareness_ids:
            return "awareness", None
        if campaign not in known_google_ids:
            return "perf", campaign
    return "perf", None


def google_awareness_ids(
    campaigns: list[dict], name_regex: str
) -> tuple[set[str], set[str]]:
    """(awareness IDs, all known IDs) from the google_campaigns query."""
    known = {str(c["campaign_id"]) for c in campaigns}
    aware = {
        str(c["campaign_id"])
        for c in campaigns
        if _rx(name_regex).search(c.get("campaign_name") or "")
    }
    return aware, known


def is_awareness_name(campaign_name: str, cfg: dict) -> bool:
    """True when a campaign name marks it as Awareness (Meta or Google)."""
    return bool(_rx(cfg["awareness_name_regex"]).search(campaign_name or ""))


# ---------------------------------------------------------------- phases


def detect_phases(days: list[dict], cfg: dict) -> dict[str, dict]:
    """Infer sale vs BAU per day.

    days: [{"date", "gmv", "meta_spend" (None when unknown)}], any order.
    A day is a sale when GMV is at least sale_ratio x the median of the
    previous baseline_days BAU days. Between grey_ratio and sale_ratio it is a
    sale only when Meta spend is also at least spend_ratio x its BAU median,
    or when it sits within shoulder_days of a sale day (a sale's opening or
    tail, when the offer is live but spend has not scaled or has tapered).
    Overrides in cfg["overrides"] ({date: "sale" | "bau"}) win.
    """
    ordered = sorted(
        (d for d in days if d.get("gmv") is not None), key=lambda d: d["date"]
    )
    window = cfg["baseline_days"]
    overrides = cfg.get("overrides") or {}
    out: dict[str, dict] = {}
    warmup = [d["gmv"] for d in ordered[:window]]
    for i, day in enumerate(ordered):
        recent = ordered[max(0, i - window) : i]
        bau = [d for d in recent if out[d["date"]]["phase"] == "bau"]
        if len(bau) >= 7:
            gmv_base = statistics.median(d["gmv"] for d in bau)
        elif warmup:
            gmv_base = statistics.median(warmup)
        else:
            gmv_base = None
        spend_hist = [d["meta_spend"] for d in bau if d.get("meta_spend")]
        spend_base = (
            statistics.median(spend_hist) if len(spend_hist) >= 3 else None
        )

        g_ratio = ratio(day["gmv"], gmv_base)
        s_ratio = ratio(day.get("meta_spend"), spend_base)
        if g_ratio is None:
            phase, basis = "bau", "no baseline yet"
        elif g_ratio >= cfg["sale_ratio"]:
            phase, basis = "sale", "revenue spike"
        elif g_ratio >= cfg["grey_ratio"]:
            if s_ratio is None:
                phase, basis = (
                    "bau",
                    "grey zone; Meta spend unknown, treated as BAU",
                )
            elif s_ratio >= cfg["spend_ratio"]:
                phase, basis = "sale", "grey zone; Meta spend scaled up"
            else:
                phase, basis = "bau", "grey zone; Meta spend at BAU level"
        else:
            phase, basis = "bau", "revenue at BAU level"
        if day["date"] in overrides:
            # Applied here too, so later days' BAU baseline uses the real
            # labels, not what detection guessed for a known sale.
            phase, basis = overrides[day["date"]], "manual override"
        out[day["date"]] = {
            "phase": phase,
            "basis": basis,
            "gmv_ratio": g_ratio,
            "spend_ratio": s_ratio,
        }

    # Sale shoulders: offers often open a day early or run on after Meta
    # spend has tapered. A grey-zone day within shoulder_days of a sale day,
    # reached only through other grey-zone days, is part of that sale.
    reach = cfg.get("shoulder_days", 0)
    dates = [d["date"] for d in ordered]
    anchors = [i for i, d in enumerate(dates) if out[d]["phase"] == "sale"]
    for i in anchors:
        for step in (-1, 1):
            for k in range(1, reach + 1):
                j = i + step * k
                if (
                    not 0 <= j < len(dates)
                    or (to_date(dates[j]) - to_date(dates[i])).days != step * k
                ):
                    break
                p = out[dates[j]]
                if p["phase"] == "sale":
                    continue
                if not p["basis"].startswith("grey zone"):
                    break
                p["phase"], p["basis"] = (
                    "sale",
                    "grey zone next to a sale day (sale shoulder)",
                )

    for d in dates:
        if d in overrides:
            out[d]["phase"], out[d]["basis"] = overrides[d], "manual override"
    return out


def _runs(
    dates: list[str], phases: dict[str, dict], phase: str
) -> list[list[str]]:
    """Maximal runs of consecutive calendar days in the given phase."""
    runs: list[list[str]] = []
    for d in sorted(dates):
        if phases.get(d, {}).get("phase") != phase:
            continue
        if runs and (to_date(d) - to_date(runs[-1][-1])).days == 1:
            runs[-1].append(d)
        else:
            runs.append([d])
    return runs


def d1_windows(d1: str, phases: dict[str, dict], cfg: dict) -> dict:
    """Current window = the run of same-phase days ending at D-1 (capped at
    max_window_days). Prior window = the phase-matched period a month earlier:
      BAU  -> consecutive BAU days of the previous month whose start day of
              month is closest to the current start
      sale -> the first days of the most recent earlier sale that started at
              least min_days_between_sales before the current one
    """
    overrides = cfg.get("window_overrides")
    if overrides:
        return {
            "phase": overrides.get(
                "phase", phases.get(d1, {}).get("phase", "bau")
            ),
            "current": date_range(*overrides["current"]),
            "prior": date_range(*overrides["prior"]),
            "note": "Windows set manually in config.json (d1.window_overrides).",
        }

    phase = phases.get(d1, {}).get("phase", "bau")
    current = [d1]
    cursor = to_date(d1)
    while len(current) < cfg["max_window_days"]:
        cursor -= dt.timedelta(days=1)
        if phases.get(cursor.isoformat(), {}).get("phase") != phase:
            break
        current.insert(0, cursor.isoformat())
    n = len(current)
    start = to_date(current[0])
    all_dates = sorted(phases)
    prior: list[str] = []

    if phase == "bau":
        prev_month_end = start.replace(day=1) - dt.timedelta(days=1)
        prev_month = [
            d
            for d in all_dates
            if to_date(d).replace(day=1) == prev_month_end.replace(day=1)
        ]
        candidates = []
        for run in _runs(prev_month, phases, "bau"):
            for i in range(0, max(1, len(run) - n + 1)):
                chunk = run[i : i + n]
                candidates.append(
                    (
                        len(chunk) < n,
                        abs(to_date(chunk[0]).day - start.day),
                        chunk[0],
                        chunk,
                    )
                )
        if candidates:
            prior = min(candidates)[3]
    else:
        gap = cfg["min_days_between_sales"]
        earlier = [
            run
            for run in _runs(all_dates, phases, "sale")
            if (start - to_date(run[0])).days >= gap
        ]
        if earlier:
            prior = earlier[-1][:n]

    notes = []
    if not prior:
        notes.append(
            f"No matching {phase.upper()} period found in the history window."
        )
    elif len(prior) != n:
        notes.append(
            f"Windows differ in length ({n} vs {len(prior)} days): compare rates and per-day averages, not totals."
        )
    return {
        "phase": phase,
        "current": current,
        "prior": prior,
        "note": " ".join(notes) or None,
    }
