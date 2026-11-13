"""The Awareness numbers, from the rows of sql/awareness/geo_daily.sql.

Pure functions: no network, no clock. Every rule (eligibility, media status,
donors, the quick tracker, drift, verdicts) is fixed here, never decided by a
model. Location keys are lowercase everywhere GeoLift touches them.
"""

from __future__ import annotations

import datetime as dt
import math
import statistics

GROUPS = ["ALL", "D2C", "MARKETPLACE", "QUICK_COMMERCE"]
METRICS = ["sales", "orders", "units"]
CONTAMINATING = {"geo_targeted", "heavy_up", "leakage"}  # media that adds exposure


def _d(s: str) -> dt.date:
    return dt.date.fromisoformat(s)


def days_between(a: str, b: str) -> list[str]:
    s, e = _d(a), _d(b)
    return [(s + dt.timedelta(days=i)).isoformat() for i in range((e - s).days + 1)]


def monday(d: str) -> str:
    x = _d(d)
    return (x - dt.timedelta(days=x.weekday())).isoformat()


# ---------------------------------------------------------------- aggregation
def aggregate(rows: list[dict], cfg: dict) -> dict:
    """{level: {geo: {date: {group: [sales, orders, units], "newc": n}}}} plus
    national totals (every row, UNKNOWN included) and data-quality counts."""
    out = {"state": {}, "city": {}, "national": {}, "quality": {}, "state_of_city": {}}
    for r in rows:
        d, grp = str(r["order_date"])[:10], r["channel_group"]
        vals = [float(r["sales"] or 0), int(r["orders"] or 0), int(r["units"] or 0)]
        newc = int(r.get("d2c_new_customer_orders") or 0)
        state, city = (r["state"] or "UNKNOWN").lower(), (r["city_cluster"] or "UNKNOWN").lower()
        for level, key in (("state", state), ("city", city)):
            day = out[level].setdefault(key, {}).setdefault(d, {})
            for g in ("ALL", grp):
                a = day.setdefault(g, [0.0, 0, 0])
                for i in range(3):
                    a[i] += vals[i]
            day["newc"] = day.get("newc", 0) + newc
        nat = out["national"].setdefault(d, {})
        for g in ("ALL", grp):
            a = nat.setdefault(g, [0.0, 0, 0])
            for i in range(3):
                a[i] += vals[i]
        nat["newc"] = nat.get("newc", 0) + newc
        if city != "unknown" and state != "unknown":
            sc = out["state_of_city"].setdefault(city, {})
            sc[state] = sc.get(state, 0.0) + vals[0]
        q = out["quality"].setdefault(r["channel"], {"sales": 0.0, "unknown_state": 0.0, "unknown_city": 0.0})
        q["sales"] += vals[0]
        q["unknown_state"] += vals[0] if state == "unknown" else 0.0
        q["unknown_city"] += vals[0] if city == "unknown" else 0.0
    # a city's state: where most of its sales are
    out["state_of_city"] = {c: max(m, key=m.get) for c, m in out["state_of_city"].items()}
    return out


def daily_sales(geo_days: dict, dates: list[str], group: str = "ALL", idx: int = 0) -> list[float]:
    return [((geo_days.get(d) or {}).get(group) or [0.0, 0, 0])[idx] for d in dates]


# ---------------------------------------------------------------- phases and weeks
def week_list(dates: list[str]) -> list[str]:
    return sorted({monday(d) for d in dates})


def week_phase(week: str, phase_of: dict[str, str]) -> str:
    """Sale / BAU / Mixed from the offer calendar (the dashboard's sale
    calendar). A week with both kinds, or with a transition day, is Mixed."""
    kinds = {phase_of.get(d) for d in days_between(week, (_d(week) + dt.timedelta(days=6)).isoformat())} - {None}
    if kinds == {"sale"}:
        return "Sale"
    if kinds == {"bau"}:
        return "BAU"
    return "Mixed" if kinds else "Unknown"


# ---------------------------------------------------------------- eligibility
def eligibility(agg: dict, end: str, cfg: dict, tests: list[dict]) -> dict:
    """{level: {geo: {"avg_daily", "eligible", "why"}}}: states >= Rs 2,000 a
    day and city clusters >= Rs 4,000 a day over the trailing window; a test's
    treatment geo is always in; 'unknown' never is."""
    e = cfg["eligibility"]
    start = (_d(end) - dt.timedelta(days=e["window_days"] - 1)).isoformat()
    window = days_between(start, end)
    forced = {(t["geo_level"], loc) for t in tests for loc in t["treatment_locations"]}
    out = {}
    for level, floor in (("state", e["state_min_daily"]), ("city", e["city_min_daily"])):
        out[level] = {}
        for geo, days in agg[level].items():
            avg = sum(daily_sales(days, window)) / len(window)
            if geo == "unknown":
                ok, why = False, "location unknown"
            elif (level, geo) in forced:
                ok, why = True, "treatment geo in a test"
            else:
                ok, why = avg >= floor, ("" if avg >= floor else f"under Rs {floor:,.0f} a day")
            out[level][geo] = {"avg_daily": round(avg, 2), "eligible": ok, "why": why}
    return out


# ---------------------------------------------------------------- media status
def _event_geos(ev: dict, level: str, all_geos: set[str], state_of: dict[str, str]) -> set[str]:
    locs = [x.lower() for x in (ev["locations"] if level == "state" else ev.get("city_locations") or [])]
    if len(ev["locations"]) == 1 and ev["locations"][0].startswith("*except:"):
        keep = {x.strip().lower() for x in ev["locations"][0].split(":", 1)[1].split(",")}
        if level == "state":
            return {g for g in all_geos if g not in keep}
        return {g for g in all_geos if state_of.get(g) not in keep}
    return set(locs) & all_geos if locs else set()


def event_active(ev: dict, a: str, b: str) -> bool:
    end = ev.get("end_date") or "9999-12-31"
    return ev["start_date"] <= b and end >= a


def media_status(level: str, geos: set[str], weeks: list[str], events: list[dict], tests: list[dict],
                 state_of: dict[str, str]) -> dict[str, list[str]]:
    """Per geo and week: Treatment (the geo is a live test's treatment and its
    linked event is on), Contaminated (another approved event adds media),
    Dark (an approved go-dark covers it) or None. Pending events never count."""
    approved = [e for e in events if e.get("review_status") == "approved"]
    treat = {}
    for t in tests:
        if t["geo_level"] == level and t["status"] in ("active", "done"):
            for loc in t["treatment_locations"]:
                treat.setdefault(loc, []).append(t)
    if level == "city":  # a state test's treatment covers its cities
        for t in tests:
            if t["geo_level"] == "state" and t["status"] in ("active", "done"):
                for g in geos:
                    if state_of.get(g) in t["treatment_locations"]:
                        treat.setdefault(g, []).append(t)
    out = {g: [] for g in geos}
    covers = {e["event_id"]: _event_geos(e, level, geos, state_of) for e in approved}
    for w in weeks:
        we = (_d(w) + dt.timedelta(days=6)).isoformat()
        live = [e for e in approved if event_active(e, w, we)]
        for g in geos:
            st = "None"
            if any(t["test_start"] <= we and t["test_end"] >= w and any(e["event_id"] == t.get("linked_event_id") for e in live)
                   for t in treat.get(g, [])):
                st = "Treatment"
            elif any(g in covers[e["event_id"]] and e["event_type"] in CONTAMINATING for e in live):
                st = "Contaminated"
            elif any(g in covers[e["event_id"]] and e["event_type"] == "go_dark" for e in live):
                st = "Dark"
            out[g].append(st)
    return out


# ---------------------------------------------------------------- donors
def donors(test: dict, agg: dict, elig: dict, events: list[dict], state_of: dict[str, str], pre_dates: list[str]) -> list[dict]:
    """Every geo of the test's level, in or out, with the reason (TASK 2 rule):
    out are the treatment, manual exclusions, low volume, any geo touched by
    an approved event that adds media in [pre_end - 28 days, test_end] (the
    test's own event aside), and, for a city test, the other cities of a
    treatment city's state (spillover). Going dark is not an exclusion: it is
    the design (see donor drift). Correlation: daily sales in the pre-period
    against the treatment total."""
    level = test["geo_level"]
    geos = set(agg[level])
    lookback = (_d(test["pre_end"]) - dt.timedelta(days=28)).isoformat()
    treat = set(test["treatment_locations"])
    t_states = {state_of.get(c) for c in treat} if level == "city" else set()
    contam: dict[str, str] = {}
    for e in events:
        if e.get("review_status") != "approved" or e["event_id"] == test.get("linked_event_id") or e["event_type"] not in CONTAMINATING:
            continue
        if not event_active(e, lookback, test["test_end"]):
            continue
        for g in _event_geos(e, level, geos, state_of):
            contam.setdefault(g, e["event_id"])
    tser = [sum(x) for x in zip(*[daily_sales(agg[level].get(g, {}), pre_dates) for g in treat])] if treat else []
    out = []
    for g in sorted(geos):
        info = elig[level].get(g, {})
        reason = None
        if g in treat:
            reason = "Treatment"
        elif g in (test.get("manual_exclusions") or []):
            reason = "Manual"
        elif g == "unknown" or not info.get("eligible"):
            reason = "Low volume"
        elif g in contam:
            reason = f"Contaminated: {contam[g]}"
        elif level == "city" and state_of.get(g) in t_states:
            reason = "Same-state spillover"
        corr = None
        if reason in (None, "Same-state spillover") and tser:
            corr = pearson(daily_sales(agg[level][g], pre_dates), tser)
        out.append({"location": g, "included": reason is None, "exclusion_reason": reason,
                    "avg_daily": info.get("avg_daily"), "correlation": None if corr is None else round(corr, 4), "weight": None})
    return out


def pearson(x: list[float], y: list[float]) -> float | None:
    n = len(x)
    if n < 3:
        return None
    mx, my = sum(x) / n, sum(y) / n
    sx = math.sqrt(sum((a - mx) ** 2 for a in x))
    sy = math.sqrt(sum((b - my) ** 2 for b in y))
    if not sx or not sy:
        return None
    return sum((a - mx) * (b - my) for a, b in zip(x, y)) / (sx * sy)


# ---------------------------------------------------------------- quick tracker and drift
def _weekly(series: list[float], dates: list[str]) -> dict[str, float]:
    out: dict[str, float] = {}
    for d, v in zip(dates, series):
        out[monday(d)] = out.get(monday(d), 0.0) + v
    return out


def quick_tracker(test: dict, agg: dict, donor_rows: list[dict], dates: list[str], kpi_idx: int = 0, baseline_weeks: int = 12) -> dict:
    """The simple ratio tracker (not GeoLift): each test week, the treatment's
    actual against its pre-period weekly mean scaled by how the donors moved
    against theirs. Pre-period means use the last `baseline_weeks` full weeks."""
    level = test["geo_level"]
    pool = [r["location"] for r in donor_rows if r["included"]]
    pick = lambda geos: [sum(x) for x in zip(*[daily_sales(agg[level].get(g, {}), dates, "ALL", kpi_idx) for g in geos])] if geos else [0.0] * len(dates)  # noqa: E731
    tw, dw = _weekly(pick(test["treatment_locations"]), dates), _weekly(pick(pool), dates)
    pre_weeks = [w for w in sorted(tw) if (_d(w) + dt.timedelta(days=6)).isoformat() <= test["pre_end"]][-baseline_weeks:]
    if not pre_weeks or not pool:
        return {"weeks": [], "note": "no pre-period or no donors"}
    tm, dm = statistics.mean(tw[w] for w in pre_weeks), statistics.mean(dw[w] for w in pre_weeks)
    rows = []
    last = dates[-1]
    for w in sorted(tw):
        we = (_d(w) + dt.timedelta(days=6)).isoformat()
        if w < test["test_start"] or w > test["test_end"]:  # whole test weeks only (a test may start mid-week)
            continue
        full = we <= last
        expected = tm * (dw[w] / dm) if dm else None
        rows.append({"week": w, "complete": full, "actual": round(tw[w], 2), "expected": None if expected is None else round(expected, 2),
                     "lift_pct": None if not expected else round(tw[w] / expected - 1, 4)})
    return {"weeks": rows, "pre_weeks": [pre_weeks[0], pre_weeks[-1]], "donors": len(pool),
            "note": "Simple ratio tracker, not the GeoLift result: treatment weekly mean x (donors this week / donors' weekly mean), last 12 pre-period weeks."}


def donor_drift(test: dict, agg: dict, donor_rows: list[dict], dates: list[str], baseline_weeks: int = 12) -> dict:
    """Donors' test-period actuals against their own pre-period linear trend
    (weekly, last `baseline_weeks` full pre weeks), weighted by donor size.
    Below -10% the donors are falling (they went dark), which inflates lift."""
    level = test["geo_level"]
    pool = [r["location"] for r in donor_rows if r["included"]]
    if not pool:
        return {"pct": None, "weeks": []}
    series = [sum(x) for x in zip(*[daily_sales(agg[level][g], dates) for g in pool])]
    wk = _weekly(series, dates)
    last = dates[-1]
    pre = [w for w in sorted(wk) if (_d(w) + dt.timedelta(days=6)).isoformat() <= test["pre_end"]][-baseline_weeks:]
    post = [w for w in sorted(wk) if w >= test["test_start"] and (_d(w) + dt.timedelta(days=6)).isoformat() <= min(last, test["test_end"])]
    if len(pre) < 4 or not post:
        return {"pct": None, "weeks": [], "note": "not enough complete weeks yet"}
    xs = list(range(len(pre)))
    ys = [wk[w] for w in pre]
    mx, my = statistics.mean(xs), statistics.mean(ys)
    slope = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sum((x - mx) ** 2 for x in xs)
    trend = lambda i: my + slope * (i - mx)  # noqa: E731
    base = sorted(wk).index(pre[0])
    rows, act, exp = [], 0.0, 0.0
    for w in post:
        i = sorted(wk).index(w) - base
        rows.append({"week": w, "actual": round(wk[w], 2), "trend": round(trend(i), 2)})
        act += wk[w]
        exp += trend(i)
    return {"pct": round(act / exp - 1, 4) if exp else None, "weeks": rows,
            "pre": [{"week": w, "actual": round(wk[w], 2), "trend": round(trend(i), 2)} for i, w in enumerate(pre)]}


# ---------------------------------------------------------------- verdicts
def verdict(test: dict, today: str, results: list[dict], drift_pct: float | None, pending_overlap: bool, cfg: dict) -> dict:
    """The test's chip, by fixed rules. Never "significant" before test_end."""
    v = cfg["verdict"]
    chips = []
    days_in = (_d(min(today, test["test_end"])) - _d(test["test_start"])).days + 1
    span = (_d(test["test_end"]) - _d(test["test_start"])).days + 1
    power = next((r for r in results if r.get("run_type") == "power"), None)
    latest = next((r for r in results if r.get("run_type") in ("interim", "final")), None)
    if power and power.get("plausible_lift") is not None and power.get("mde_42d") is not None and power["plausible_lift"] < power["mde_42d"]:
        chips.append("Underpowered")
    if (drift_pct is not None and drift_pct < cfg["geolift"]["drift_flag"]) or pending_overlap:
        chips.append("Check validity")
    if test["status"] == "planned":
        main = "Planned"
    elif test["status"] == "done" or today > test["test_end"]:
        if latest and latest.get("run_type") == "final":
            ok = (latest.get("p_value") is not None and latest["p_value"] < cfg["geolift"]["alpha"]
                  and latest.get("ci_low") is not None and (latest["ci_low"] > 0 or (latest.get("ci_high") or 0) < 0))
            main = "Final: lift detected" if ok else "Final: no detectable lift"
        else:
            main = "Final readout pending"
    elif days_in < v["too_early_days"]:
        main = "Too early"
    elif latest and latest.get("lift_pct") is not None:
        lp, band = latest["lift_pct"], v["interim_flat_band"]
        main = "Interim: trending up" if lp > band else "Interim: trending down" if lp < -band else "Interim: flat"
    else:
        main = "Interim: no GeoLift run yet"
    return {"main": main, "flags": chips, "days_in": max(0, days_in), "days_total": span}
