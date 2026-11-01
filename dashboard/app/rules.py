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


def _quantile(values: list[float], q: float) -> float:
    vals = sorted(values)
    if not vals:
        return 0.0
    pos = q * (len(vals) - 1)
    lo = int(pos)
    hi = min(lo + 1, len(vals) - 1)
    return vals[lo] + (vals[hi] - vals[lo]) * (pos - lo)


def detect_sales_hourly(rows: list[dict], cfg: dict) -> dict:
    """Find sales from the hour-by-hour order counts, the way a person would
    read them: a sale goes live at some hour (often 6 to 8 pm) and orders jump
    to several times their normal level for that hour, then fall back when it
    ends.

    rows: [{"date", "hour", "orders"}] for complete days, any order.

    Normal = the usual shape of a day (a low quantile of each hour across all
    days) scaled to the BAU level around that date. The level is found in two
    passes: first from a low quantile of the surrounding weeks, which spots the
    sales; then again from the days that are NOT in a sale, so a long sale
    cannot lift its own yardstick and its quiet days before and after set the
    bar. A sale starts when the 3-hour average passes `on_ratio` times normal
    and ends when it stays under `off_ratio`; bumps shorter than `min_hours`
    (a one-day push) are not sales.

    Returns {"phases": {date: {...}}, "events": [{"start", "end", ...}]}.
    A day is "sale" when at least `full_day_share` of its orders came while a
    sale was live, "bau" when at most `bau_max_share`, and "mixed" (a
    transition day: the sale went live or ended that day) in between.
    """
    h = cfg["hourly"]
    grid: dict[str, list[float]] = {}
    for r in rows:
        grid.setdefault(str(r["date"])[:10], [0.0] * 24)[int(r["hour"])] += (
            r.get("orders") or 0
        )
    if not grid:
        return {"phases": {}, "events": []}
    dates = date_range(to_date(min(grid)), to_date(max(grid)))
    for d in dates:
        grid.setdefault(d, [0.0] * 24)
    totals = [sum(grid[d]) for d in dates]
    n = len(dates) * 24
    flat = [grid[d][k] for d in dates for k in range(24)]

    shape = [
        max(_quantile([grid[d][k] for d in dates], h["shape_quantile"]), 0.05)
        for k in range(24)
    ]
    shape_sum = sum(shape)
    shape = [x / shape_sum for x in shape]
    half = h["level_window_days"]

    def find(level: list[float]):
        ratio = [
            flat[i * 24 + k] / max(level[i] * shape[k], 0.5)
            for i in range(len(dates))
            for k in range(24)
        ]
        smooth = [
            sum(ratio[max(0, t - 1) : t + 2])
            / len(ratio[max(0, t - 1) : t + 2])
            for t in range(n)
        ]
        runs: list[list[int]] = []
        t = 0
        while t < n:
            if smooth[t] >= h["on_ratio"] and ratio[t] >= h["on_ratio"] * 0.8:
                a, last, under, u = t, t, 0, t
                while u < n:
                    if smooth[u] >= h["off_ratio"]:
                        last, under = u, 0
                    else:
                        under += 1
                        if under >= 3:
                            break
                    u += 1
                last += (
                    1  # exclusive end, then trim hours already back to normal
                )
                while last - 1 > a and ratio[last - 1] < h["off_ratio"]:
                    last -= 1
                last -= 1
                back = 0  # the ramp: step back over hours already climbing
                while a > 0 and back < 3 and ratio[a - 1] >= h["off_ratio"]:
                    a -= 1
                    back += 1
                runs.append([a, last + 1])
                t = last + 1
            else:
                t += 1
        merged: list[list[int]] = []
        for a, b in runs:
            if merged and a - merged[-1][1] < h["merge_gap_hours"]:
                merged[-1][1] = b
            else:
                merged.append([a, b])
        keep = [
            [a, b]
            for a, b in merged
            if b - a >= h["min_hours"]
            and sum(ratio[a:b]) / (b - a) >= h["min_mean_ratio"]
        ]
        return keep, ratio

    # pass 1: the level from a low quantile of the surrounding weeks
    level = [
        max(
            _quantile(
                totals[max(0, i - half) : i + half + 1], h["level_quantile"]
            ),
            1.0,
        )
        for i in range(len(dates))
    ]
    events1, _ = find(level)
    # pass 2: the level from the days outside any sale
    in_sale = [False] * len(dates)
    for a, b in events1:
        for t in range(a, b):
            in_sale[t // 24] = True
    level2 = []
    for i in range(len(dates)):
        calm = [
            totals[j]
            for j in range(max(0, i - half), min(len(dates), i + half + 1))
            if not in_sale[j]
        ]
        level2.append(
            max(_quantile(calm, h["level_quantile"]), 1.0)
            if len(calm) >= 7
            else level[i]
        )
    spans, ratio = find(level2)
    level = level2

    live = [False] * n
    events = []
    for a, b in spans:
        for t in range(a, b):
            live[t] = True
        end_day, end_hour = dates[(b - 1) // 24], (b - 1) % 24 + 1
        events.append(
            {
                "start": f"{dates[a // 24]}T{a % 24:02d}:00",
                "end": f"{end_day}T{end_hour:02d}:00",
                "hours": b - a,
                "uplift": round(sum(ratio[a:b]) / (b - a), 2),
            }
        )

    overrides = cfg.get("overrides") or {}
    phases: dict[str, dict] = {}
    for i, d in enumerate(dates):
        hrs = live[i * 24 : i * 24 + 24]
        sale_hours = sum(hrs)
        total = totals[i]
        share = (
            sum(grid[d][k] for k in range(24) if hrs[k]) / total
            if total
            else 0.0
        )
        day_ratio = total / level[i]
        out = {
            "sale_hours": sale_hours,
            "sale_share": round(share, 3),
            "gmv_ratio": day_ratio,
            "spend_ratio": None,
            "start_hour": None,
            "end_hour": None,
        }
        if share >= h["full_day_share"]:
            out.update(
                phase="sale",
                basis=f"sale live, orders {day_ratio:.1f}x a normal day",
            )
        elif share <= h["bau_max_share"]:
            out.update(
                phase="bau",
                basis=f"no sale, orders {day_ratio:.1f}x a normal day",
            )
        else:
            first = hrs.index(True)
            lastk = 23 - hrs[::-1].index(True)
            starts = first > 0 and not (i > 0 and live[i * 24 - 1])
            ends = lastk < 23 and not (
                i + 1 < len(dates) and live[(i + 1) * 24]
            )
            if starts and not ends:
                out.update(
                    start_hour=first,
                    basis=f"sale went live at {_clock(first)}",
                )
            elif ends and not starts:
                out.update(
                    end_hour=lastk + 1,
                    basis=f"sale ended at {_clock(lastk + 1)}",
                )
            else:
                out.update(
                    start_hour=first,
                    end_hour=lastk + 1,
                    basis=f"sale live {_clock(first)} to {_clock(lastk + 1)}",
                )
            out["phase"] = "mixed"
        out["phase_eff"] = (
            "sale" if out["phase"] == "sale" or share >= 0.5 else "bau"
        )
        if d in overrides:
            out.update(
                phase=overrides[d],
                phase_eff=overrides[d],
                basis="manual override",
            )
        phases[d] = out
    return {"phases": phases, "events": events}


def _clock(hour: int) -> str:
    hour = hour % 24
    return f"{hour % 12 or 12} {'am' if hour < 12 else 'pm'}"


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
