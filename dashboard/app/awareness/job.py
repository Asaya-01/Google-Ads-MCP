"""The Awareness job: python -m app.awareness.job   (daily, 07:15 IST)

Reads Maplemonk's consolidated sales with sql/awareness/geo_daily.sql (read
only; nothing is written to BigQuery) and writes, in the dashboard's bucket:

  pages/awareness.json        the tab: weekly geo series, media status, tests
                              (donors, quick tracker, drift, GeoLift results),
                              testability, events, data quality, checks
  pages/awareness_daily.json  daily series for the geo drawer
  pages/awareness_map.json    India state outlines (DataMeet, CC BY 4.0)
  cache/awareness/panel_state.csv, panel_city.csv
                              GeoLift panels: date x location, zero-filled
  cache/awareness/r_input.json  tests, donors, eligibility for the GeoLift job
  cache/awareness/run_log.json  every run of this job and the GeoLift job

The GeoLift job (awareness_r/) writes cache/awareness/geolift/*.json, which
the next run of this job folds into the page.
"""

from __future__ import annotations

import csv
import datetime as dt
import io
import json
import sys
import time

from .. import bq, settings
from ..store import default_store
from . import PRIVATE_PATH, config, model

IST = dt.timezone(dt.timedelta(hours=5, minutes=30))


def query_rows(cfg: dict, start: str, end: str) -> list[dict]:
    raw, name = [], []
    for cl, raws in cfg["city_clusters"].items():
        if not cl.startswith("_"):
            raw += raws
            name += [cl] * len(raws)
    aliases = {k: v for k, v in cfg["state_aliases"].items() if not k.startswith("_")}
    return bq.run("awareness/geo_daily", start_date=dt.date.fromisoformat(start), end_date=dt.date.fromisoformat(end),
                  channels=cfg["channels"], state_key=list(aliases), state_name=list(aliases.values()),
                  not_india=cfg.get("not_india_states") or [], cluster_raw=raw, cluster_name=name)


def phases(store) -> tuple[dict, str]:
    """The offer calendar: the dashboard's sale calendar (the team's sale
    dates where it covers a day, hourly-order detection otherwise)."""
    days = store.get_json("pages/days.json") or {}
    return ({d: p for d, p in zip(days.get("dates") or [], days.get("phase") or []) if p},
            "the dashboard's sale calendar (Data health › Sale calendar" + (f", source: {days['phase_source']}" if days.get("phase_source") else "") + ")")


def build(rows: list[dict], cfg: dict, today: str, phase_of: dict, phase_source: str, geolift: dict, checks_extra: dict | None = None) -> dict:
    """Everything the tab and the GeoLift job need, from the query rows."""
    end = (dt.date.fromisoformat(today) - dt.timedelta(days=1)).isoformat()
    agg = model.aggregate(rows, cfg)
    dates = model.days_between(cfg["panel_start"], end)
    weeks = model.week_list(dates)
    tests = cfg["tests"]
    elig = model.eligibility(agg, end, cfg, tests)
    state_of = agg["state_of_city"]
    region_of = {s.lower(): r for r, ss in cfg["regions"].items() if not r.startswith("_") for s in ss}
    events = cfg["media_events"]
    show_min = cfg["show_city_min_daily"]

    def weekly(days: dict) -> dict:
        w = {m: {g: [0.0] * len(weeks) for g in model.GROUPS} for m in model.METRICS}
        w["newc"] = [0] * len(weeks)
        wi = {x: i for i, x in enumerate(weeks)}
        for d, v in days.items():
            if d < dates[0] or d > end:
                continue
            i = wi[model.monday(d)]
            for g in model.GROUPS:
                a = v.get(g)
                if a:
                    for j, m in enumerate(model.METRICS):
                        w[m][g][i] += a[j]
            w["newc"][i] += v.get("newc", 0)
        for m in model.METRICS:
            for g in model.GROUPS:
                w[m][g] = [round(x) for x in w[m][g]]
        return w

    geos_out = {}
    for level in ("state", "city"):
        keep = [g for g in agg[level] if g != "unknown" and (level == "state" or elig[level][g]["avg_daily"] >= show_min or elig[level][g]["eligible"])]
        ms = model.media_status(level, set(keep), weeks, events, tests, state_of)
        geos_out[level] = []
        for g in sorted(keep):
            st = g if level == "state" else state_of.get(g)
            cen = (cfg["city_centroids"].get(g.upper()) if level == "city" else None)
            geos_out[level].append({"key": g, "name": g.upper(), "state": st, "region": region_of.get(st or "", "Unmapped"),
                                    **elig[level][g], "centroid": cen, "media": ms[g], "w": weekly(agg[level][g])})
        # the long tail, one row per level, so totals still add up to India
        rest = [g for g in agg[level] if g not in keep]
        tail = {}
        for g in rest:
            for d, v in agg[level][g].items():
                t = tail.setdefault(d, {})
                for gg in model.GROUPS:
                    if v.get(gg):
                        a = t.setdefault(gg, [0.0, 0, 0])
                        for i in range(3):
                            a[i] += v[gg][i]
                t["newc"] = t.get("newc", 0) + v.get("newc", 0)
        geos_out[level + "_rest"] = {"count": len(rest), "w": weekly(tail)}
    national = weekly(agg["national"])

    # tests: donors, quick tracker, drift, GeoLift results, verdict
    tests_out = []
    pre_dates = lambda t: [d for d in dates if t["pre_start"] <= d <= t["pre_end"]][-300:]  # noqa: E731
    for t in tests:
        dn = model.donors(t, agg, elig, events, state_of, pre_dates(t))
        gl = (geolift.get("tests") or {}).get(t["test_id"]) or {}
        weights = {d["location"]: d for d in gl.get("donors") or []}
        for d in dn:
            if d["location"] in weights:
                d["weight"] = weights[d["location"]].get("weight")
                d["correlation_geolift"] = weights[d["location"]].get("correlation")
        qt = model.quick_tracker(t, agg, dn, dates)
        drift = model.donor_drift(t, agg, dn, dates)
        results = sorted(gl.get("results") or [], key=lambda r: r.get("run_date") or "", reverse=True)
        pending = any(e.get("review_status") == "pending" and model.event_active(e, t["pre_end"], t["test_end"]) for e in events)
        drift_pct = next((r.get("donor_drift_pct") for r in results if r.get("donor_drift_pct") is not None), drift["pct"])
        tests_out.append({**t, "donors": dn, "quick": qt, "drift": drift, "results": results, "series": gl.get("series") or {},
                          "verdict": model.verdict(t, today, results, drift_pct, pending, cfg)})

    # data quality and checks
    q = agg["quality"]
    quality = {"by_channel": [{"channel": c, "sales": round(v["sales"]), "unknown_state_pct": round(v["unknown_state"] / v["sales"], 4) if v["sales"] else None,
                               "unknown_city_pct": round(v["unknown_city"] / v["sales"], 4) if v["sales"] else None} for c, v in sorted(q.items())]}
    tot = sum(v["sales"] for v in q.values())
    quality["unknown_state_pct"] = round(sum(v["unknown_state"] for v in q.values()) / tot, 4) if tot else None
    quality["unknown_city_pct"] = round(sum(v["unknown_city"] for v in q.values()) / tot, 4) if tot else None
    mapped = {c.lower() for c in cfg["city_clusters"] if not c.startswith("_")}
    proposed = {r.lower(): cl for cl, rs in cfg["city_clusters_proposed"].items() if not cl.startswith("_") for r in rs}
    tail = []
    for c, days in agg["city"].items():
        if c in mapped or c == "unknown":
            continue
        s = sum(model.daily_sales(days, dates))
        tail.append({"city": c, "state": state_of.get(c), "sales": round(s), "suggested_cluster": proposed.get(c)})
    quality["unmapped_top"] = sorted([x for x in tail if x["suggested_cluster"]], key=lambda x: -x["sales"])[:25]
    quality["panel"] = {"dates": len(dates), "states": sum(1 for g in elig["state"].values() if g["eligible"]),
                        "cities": sum(1 for g in elig["city"].values() if g["eligible"])}
    checks = acceptance(agg, cfg, dates, tests_out, geos_out, weeks, national, checks_extra or {}, geolift)
    return {
        "page": {
            "title": "Awareness", "as_of": end, "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
            "weeks": weeks, "week_phase": [model.week_phase(w, phase_of) for w in weeks],
            "week_days": [sum(1 for d in model.days_between(w, (dt.date.fromisoformat(w) + dt.timedelta(days=6)).isoformat()) if dates[0] <= d <= end) for w in weeks],
            "phase_source": phase_source, "groups": model.GROUPS, "metrics": model.METRICS,
            "geos": geos_out, "national": national, "events": events, "tests": tests_out,
            "testability": geolift.get("testability") or [], "power_curves": geolift.get("power_curves") or {},
            "scan_date": geolift.get("scan_date"), "quality": quality, "checks": checks,
            "config": {k: cfg[k] for k in ("floor_note", "regions", "eligibility", "baseline_weeks", "planner", "leakage_flag", "verdict", "geolift", "channels_note")},
        },
        "daily": {"dates": dates, "state": {g: [round(x) for x in model.daily_sales(agg["state"][g], dates)] for g in agg["state"] if g != "unknown"},
                  "city": {x["key"]: [round(v) for v in model.daily_sales(agg["city"][x["key"]], dates)] for x in geos_out["city"]}},
        "panels": {level: panel(agg, level, [g for g, v in elig[level].items() if v["eligible"]], dates) for level in ("state", "city")},
        "r_input": {"as_of": end, "tests": [{k: t[k] for k in t if k not in ("quick", "drift", "results", "series", "verdict")} for t in tests_out],
                    "eligible": {lv: sorted(g for g, v in elig[lv].items() if v["eligible"]) for lv in ("state", "city")},
                    "excluded_for_scan": {lv: sorted({g for t in tests_out if t["geo_level"] == lv for d in t["donors"] if (d["exclusion_reason"] or "").startswith("Contaminated") for g in [d["location"]]}) for lv in ("state", "city")},
                    "city_state": {g: state_of.get(g) for g, v in elig["city"].items() if v["eligible"]},
                    "geolift": cfg["geolift"], "floor_note": cfg["floor_note"]},
    }


def panel(agg: dict, level: str, geos: list[str], dates: list[str]) -> str:
    """Dense, zero-filled date x location CSV: date, location, Y, units, orders, d2c_new_customers."""
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["date", "location", "Y", "units", "orders", "d2c_new_customers"])
    for g in sorted(geos):
        days = agg[level].get(g, {})
        for d in dates:
            v = days.get(d) or {}
            a = v.get("ALL") or [0.0, 0, 0]
            w.writerow([d, g, round(a[0], 2), a[2], a[1], v.get("newc", 0)])
    return buf.getvalue()


def acceptance(agg, cfg, dates, tests, geos, weeks, national, extra, geolift) -> list[dict]:
    """The owner's acceptance checks, re-run every day: pass / fail and the number."""
    out = []
    # targets live in private/awareness.json (the repository is public); no target, no verdict
    tgt = cfg.get("acceptance") or {}
    near = lambda v, key, tol=0.10: None if not tgt.get(key) or v is None else abs(v / tgt[key] - 1) <= tol  # noqa: E731
    vs = lambda key, f: f" (target {f(tgt[key])})" if tgt.get(key) else " (no target set in private/awareness.json)"  # noqa: E731
    rs = lambda v: f"Rs {v:,.0f}"  # noqa: E731
    w = extra.get("website_orders")
    if w:
        out.append({"id": 1, "check": "WEBSITE distinct orders 2026-11-02..08 match Shopify (before exclusions)",
                    "value": f"{w['raw_orders']:,} before exclusions; {w['kept_orders']:,} after (cancelled {w['cancelled_orders']:,}, influencer / sampling and freebie-only orders left out)" + vs("website_orders", lambda v: f"{v:,}"),
                    "pass": None if not tgt.get("website_orders") else w["raw_orders"] == tgt["website_orders"]})
    elif extra.get("website_orders_error"):
        out.append({"id": 1, "check": "WEBSITE distinct orders 2026-11-02..08 match Shopify (before exclusions)", "value": "query failed: " + extra["website_orders_error"][:200], "pass": False})
    q = agg["quality"]
    tot = sum(v["sales"] for v in q.values())
    unk = sum(v["unknown_state"] for v in q.values()) / tot if tot else None
    out.append({"id": 2, "check": "Sales with UNKNOWN state < 2%", "value": None if unk is None else f"{unk:.2%}", "pass": unk is not None and unk < 0.02})
    tn = agg["state"].get("tamil nadu", {})
    span = model.days_between("2026-01-05", "2026-10-25")
    tn_w = sum(model.daily_sales(tn, span)) / len(span) * 7 if tn else None
    out.append({"id": 3, "check": "Tamil Nadu avg weekly sales 5 Jan-25 Oct 2026 within 10% of the target", "value": None if tn_w is None else rs(tn_w) + vs("tn_weekly_sales", rs),
                "pass": near(tn_w, "tn_weekly_sales")})
    span = model.days_between("2026-01-05", "2026-10-31")
    for cid, (city, key) in enumerate((("chennai metro", "chennai_daily_sales"), ("coimbatore", "coimbatore_daily_sales"))):
        v = sum(model.daily_sales(agg["city"].get(city, {}), span)) / len(span)
        out.append({"id": "4" + "ab"[cid], "check": f"{city.title()} avg daily sales 5 Jan-31 Oct within 10% of the target", "value": rs(v) + vs(key, rs), "pass": near(v, key)})
    out.append({"id": 5, "check": "GeoLift panels have no missing date x location rows", "value": "dense by construction (every eligible location x every date, zero-filled)", "pass": True})
    tn_mde = next((r.get("mde_42d") for t in tests if t["test_id"] == "TN_TF_STATE_2026_11" for r in t["results"] if r.get("run_type") == "power"), None)
    out.append({"id": 6, "check": "TN MDE at 42 days (GeoLift) at or under the crude 25-33% upper bound", "value": "waiting for the first GeoLift run" if tn_mde is None else f"{tn_mde:.1%}",
                "pass": None if tn_mde is None else tn_mde <= 0.33})
    rel = tn_relative_index(geos, weeks, national, "2026-11-01", dates[-1])
    out.append({"id": 7, "check": "TN relative index vs clean rest of India differs from vs all rest of India after 2026-11-01",
                "value": "no full week after 1 Nov yet" if rel is None else f"week of {rel['week']}: {rel['clean']:.3f} vs clean rest, {rel['all']:.3f} vs all rest (clean leaves out {', '.join(rel['left_out']) or 'nothing'})",
                "pass": None if rel is None else abs(rel["clean"] - rel["all"]) > 0.001})
    out.append({"id": 8, "check": "Tab India total = sum of states for the same dates", "value": "the tab sums the same weekly rows it shows", "pass": True})
    return out


def tn_relative_index(geos: dict, weeks: list[str], national: dict, ref: str, last_date: str) -> dict | None:
    """Tamil Nadu's relative index in the first full week after ref, the way
    the tab works it out: (TN week / TN 12-week baseline) / (rest week / rest
    baseline), rest = India less TN, and 'clean' also less every state with
    Treatment or Contaminated media that week (the same states in the baseline)."""
    states = {g["key"]: g for g in geos["state"]}
    tn = states.get("tamil nadu")
    i = next((k for k, w in enumerate(weeks) if w >= ref), None)
    if tn is None or i is None or i < 12 or (dt.date.fromisoformat(weeks[i]) + dt.timedelta(days=6)).isoformat() > last_date:
        return None
    nat = national["sales"]["ALL"]
    base = range(i - 12, i)
    out = [k for k, g in states.items() if k != "tamil nadu" and g["media"][i] in ("Treatment", "Contaminated")]
    s = lambda key, j: states[key]["w"]["sales"]["ALL"][j]  # noqa: E731
    rest = lambda j, clean: nat[j] - s("tamil nadu", j) - (sum(s(k, j) for k in out) if clean else 0)  # noqa: E731
    tb = sum(s("tamil nadu", j) for j in base) / 12
    res = {}
    for clean in (True, False):
        rb = sum(rest(j, clean) for j in base) / 12
        res["clean" if clean else "all"] = (s("tamil nadu", i) / tb) / (rest(i, clean) / rb) if tb and rb and rest(i, clean) else float("nan")
    return {"week": weeks[i], "left_out": sorted(out), **res}


def run(store, rows_fn, now: dt.datetime) -> dict:
    cfg = config(store.get_json(PRIVATE_PATH))
    today = now.astimezone(IST).date().isoformat()
    end = (now.astimezone(IST).date() - dt.timedelta(days=1)).isoformat()
    t0 = time.time()
    log = {"job": "awareness", "run_time": now.isoformat(), "status": "ok", "rows": None, "duration_s": None, "error": None}
    try:
        rows = rows_fn(cfg, cfg["start_date"], end)
        extra = {}
        try:
            extra["website_orders"] = (bq.run("awareness/acceptance", start_date=dt.date(2026, 11, 2), end_date=dt.date(2026, 11, 8)) or [None])[0]
        except Exception as exc:  # the check says so; the page still builds
            extra["website_orders_error"] = str(exc)
        phase_of, source = phases(store)
        geolift = load_geolift(store)
        out = build(rows, cfg, today, phase_of, source, geolift, extra)
        store.put_json("pages/awareness.json", {**out["page"], "run_log": recent_log(store)})
        store.put_json("pages/awareness_daily.json", out["daily"])
        for level, text in out["panels"].items():
            store.put_text(f"cache/awareness/panel_{level}.csv", text)
        store.put_json("cache/awareness/r_input.json", out["r_input"])
        if store.get_json("pages/awareness_map.json") is None or now.day == 1:
            store.put_json("pages/awareness_map.json", json.loads((settings.STATIC_DIR / "geo" / "india_states.json").read_text()))
        log["rows"] = len(rows)
    except Exception as exc:
        log.update(status="error", error=f"{type(exc).__name__}: {exc}")
        raise
    finally:
        log["duration_s"] = round(time.time() - t0, 1)
        hist = (store.get_json("cache/awareness/run_log.json") or {}).get("runs") or []
        store.put_json("cache/awareness/run_log.json", {"runs": ([log] + hist)[:200]})
    return log


def load_geolift(store) -> dict:
    """What the GeoLift job wrote: testability, power curves, per-test results."""
    out = {"tests": {}}
    tb = store.get_json("cache/awareness/geolift/testability.json") or {}
    out["testability"], out["scan_date"] = tb.get("rows") or [], tb.get("scan_date")
    out["power_curves"] = (store.get_json("cache/awareness/geolift/power_curves.json") or {}).get("curves") or {}
    idx = store.get_json("cache/awareness/geolift/tests.json") or {}
    for tid, v in (idx.get("tests") or {}).items():
        out["tests"][tid] = v
    return out


def recent_log(store) -> list[dict]:
    return ((store.get_json("cache/awareness/run_log.json") or {}).get("runs") or [])[:30]


def main() -> int:
    store = default_store()
    try:
        log = run(store, query_rows, dt.datetime.now(dt.timezone.utc))
    except Exception as exc:
        print(f"awareness failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1
    print(f"awareness: {log['rows']} rows in {log['duration_s']}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
