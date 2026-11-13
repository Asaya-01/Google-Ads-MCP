"""The Cooee sync job: python -m app.cooee.sync

Fixed MCP tool calls (no model), one file per store day in the private
bucket (cache/cooee/day/<date>.json), then the CRO tab's page
(pages/cro.json). Each run:

  - re-pulls the last `repull_days` days (late events and attribution move);
  - back-fills up to `backfill_days_per_run` older days, newest first, down
    to `data_start` (17 Jun 2026, where Cooee's reports begin);
  - takes today's experiment snapshot (lifetime stats per arm; the daily
    snapshots give the lift-over-time line), once a day;
  - logs every call (tool, arguments, rows, time, status) to
    cache/cooee/sync_log.json, which Data health reads.

A response whose shape is not the one this code knows fails the run loudly
(Data health turns red) instead of loading partial data.

  --days N        back-fill at most N days this run
  --only-page     rebuild pages/cro.json from what is cached, no calls
"""

from __future__ import annotations

import argparse
import datetime as dt
import html
import sys
import time

from .. import settings
from ..store import default_store
from . import build, config, mcp

IST = dt.timezone(dt.timedelta(hours=5, minutes=30))
SEG = ["sessionCount", "bouncedSessionCount", "sessionsWithAddToCart", "sessionsWithOrder", "revenue"]
FUNNEL = ["sessionCount", "visitorCount", "sessionsWithProductView", "sessionsWithAddToCart", "sessionsWithCartOpen",
          "sessionsWithCheckoutStarted", "paymentSubmittedCount", "sessionsWithOrder", "orderCount", "revenue", "bouncedSessionCount"]
INTENTS = ["NO", "LOW", "MEDIUM", "HIGH"]


class ShapeError(mcp.CooeeError):
    """A tool's answer is not shaped as this code expects."""


def _need(obj, *keys, where=""):
    for k in keys:
        if not isinstance(obj, dict) or k not in obj:
            raise ShapeError(f"{where}: '{k}' missing from Cooee's answer (the tool's shape changed?)")
    return obj


def _days(a: str, b: str) -> list[str]:
    s, e = dt.date.fromisoformat(a), dt.date.fromisoformat(b)
    return [(s + dt.timedelta(days=i)).isoformat() for i in range((e - s).days + 1)]


def _blocks(days: list[str]) -> list[tuple[str, str]]:
    """Contiguous runs of days, as (first, last)."""
    out: list[list[str]] = []
    for d in sorted(days):
        if out and (dt.date.fromisoformat(d) - dt.date.fromisoformat(out[-1][-1])).days == 1:
            out[-1].append(d)
        else:
            out.append([d])
    return [(b[0], b[-1]) for b in out]


def _chunks(a: str, b: str, n: int) -> list[tuple[str, str]]:
    ds = _days(a, b)
    return [(ds[i], ds[min(i + n, len(ds)) - 1]) for i in range(0, len(ds), n)]


def _seg(item: dict, metrics: list[str]) -> list:
    """[metrics..., HIGH sessions, HIGH sessions with order] of one row."""
    t = _need(item, "total", where="landing-page report row")["total"]
    hi = (item.get("intents") or {}).get("HIGH") or {}
    return [t.get(m) or 0 for m in metrics] + [hi.get("sessionCount") or 0, hi.get("sessionsWithOrder") or 0]


def _lp(c, store_slug: str, day: str, dims: list[str], keys: list[str], limit: int, **extra) -> dict:
    out = c.call("get_landing_page_report", {"storeSlug": store_slug, "fromDate": day, "toDate": day, "dimensions": dims,
                                             "metrics": extra.pop("metrics", SEG), "includeIntents": extra.pop("intents", True),
                                             "limit": limit, **extra})
    _need(out, "items", "summary", where=f"get_landing_page_report {dims}")
    rows = [[*(str(it.get(k) if it.get(k) is not None else "") for k in keys), *_seg(it, extra.get("_m", SEG))] for it in out["items"]]
    return {"rows": rows, "summary": out["summary"], "total": out.get("total"), "truncated": bool(out.get("truncated"))}


def pull_day(c, slug: str, day: str, lim: dict) -> dict:
    """Every per-day breakdown for one store day."""
    d: dict = {"date": day}
    d["landing"] = _lp(c, slug, day, ["landingPage", "pageType"], ["landingPath", "page"], lim["landing"])
    ex = c.call("get_landing_page_report", {"storeSlug": slug, "fromDate": day, "toDate": day, "dimensions": ["exitPage"],
                                            "filters": {"ordered": "no"}, "metrics": ["sessionCount"], "includeIntents": True,
                                            "sort": "segments.HIGH.sessionCount", "limit": lim["exit"]})
    _need(ex, "items", "summary", where="get_landing_page_report exitPage")
    d["exits"] = {"rows": [[it.get("exitPath") or "", (it.get("total") or {}).get("sessionCount") or 0,
                            ((it.get("intents") or {}).get("HIGH") or {}).get("sessionCount") or 0] for it in ex["items"]],
                  "summary": ex["summary"], "total": ex.get("total"), "truncated": bool(ex.get("truncated"))}
    d["utm"] = _lp(c, slug, day, ["utmSource", "utmCampaign", "utmContent"], ["utmSource", "utmCampaign", "utmContent"], lim["utm"])
    d["channel"] = _lp(c, slug, day, ["referringChannel", "referringMedium"], ["acquisitionChannel", "referringMedium"], lim["channel"])
    d["device"] = _lp(c, slug, day, ["deviceType", "visitorType"], ["deviceType", "sessionType"], 20)
    for key, by_variant in (("products", False), ("variants", True)):
        pr = c.call("get_product_report", {"storeSlug": slug, "fromDate": day, "toDate": day, "limit": lim["products"],
                                           "byVariant": by_variant, "sort": "views"})
        _need(pr, "products", "totals", where="get_product_report")
        d[key] = {"rows": [[str(p.get("productId") or ""), str(p.get("variantId") or ""), html.unescape(str(p.get("name") or "")).strip(),
                            p.get("views") or 0, p.get("addToCarts") or 0, p.get("removesFromCart") or 0, p.get("purchases") or 0,
                            p.get("unitsSold") or 0, float(p.get("revenue") or 0)] for p in pr["products"]],
                  "totals": pr["totals"], "maybe_truncated": len(pr["products"]) >= lim["products"]}
    imp = c.call("get_impact_report", {"storeSlug": slug, "fromDate": day, "toDate": day})
    d["impact"] = imp
    return d


def pull_ranges(c, slug: str, a: str, b: str) -> dict[str, dict]:
    """Range calls split back into days: funnel × intent, hour grid, store
    daily stats and campaigns by day."""
    by: dict[str, dict] = {d: {} for d in _days(a, b)}
    f = c.call("get_landing_page_report", {"storeSlug": slug, "fromDate": a, "toDate": b, "dimensions": ["date"],
                                           "metrics": FUNNEL, "includeIntents": True, "limit": 500})
    _need(f, "items", where="funnel by date")
    for it in f["items"]:
        d = str(it.get("date"))[:10]
        if d in by:
            by[d]["funnel"] = {"ALL": [(it.get("total") or {}).get(m) or 0 for m in FUNNEL],
                               **{k: [((it.get("intents") or {}).get(k) or {}).get(m) or 0 for m in FUNNEL] for k in INTENTS}}
    for x, y in _chunks(a, b, 20):
        h = c.call("get_landing_page_report", {"storeSlug": slug, "fromDate": x, "toDate": y, "dimensions": ["date", "hour"],
                                               "metrics": ["sessionCount", "sessionsWithAddToCart", "sessionsWithOrder", "revenue"],
                                               "limit": 500})
        _need(h, "items", where="hour grid")
        for it in h["items"]:
            d = str(it.get("date"))[:10]
            t = it.get("total") or {}
            if d in by:
                by[d].setdefault("hour", []).append([int(it.get("hour") or 0), t.get("sessionCount") or 0, t.get("sessionsWithAddToCart") or 0,
                                                     t.get("sessionsWithOrder") or 0, float(t.get("revenue") or 0)])
    s = c.call("get_store_daily_stats", {"storeSlug": slug, "fromDate": a, "toDate": b})
    _need(s, "processedDays", where="get_store_daily_stats")
    for r in s["processedDays"]:
        if r.get("date") in by:
            by[r["date"]]["store"] = {k: r.get(k) for k in ("totalRevenue", "netRevenue", "totalOrders", "cooeeRevenue", "cooeeOrders")}
    for x, y in _chunks(a, b, 14):
        for d in _days(x, y):
            by[d]["campaigns"] = []
        _campaigns(c, slug, x, y, by)
    return by


def _campaigns(c, slug: str, x: str, y: str, by: dict) -> None:
    r = c.call("get_campaign_report", {"storeSlug": slug, "fromDate": x, "toDate": y, "daily": True, "limit": 200})
    _need(r, "rows", where="get_campaign_report")
    if (r.get("total") or 0) > len(r["rows"]) and x != y:  # over the 200-row cap: split
        days = _days(x, y)
        mid = days[len(days) // 2 - 1]
        for d in days:
            by[d]["campaigns"] = []
        _campaigns(c, slug, x, mid, by)
        _campaigns(c, slug, (dt.date.fromisoformat(mid) + dt.timedelta(days=1)).isoformat(), y, by)
        return
    for row in r["rows"]:
        d = str(row.get("date"))[:10]
        if d in by:
            by[d]["campaigns"].append([str(row.get("sequenceNumber")), (row.get("name") or "").strip(), row.get("status"), row.get("objective"),
                                       row.get("deliveryType"), *(row.get(k) or 0 for k in ("impressions", "clicks", "dismissals", "holdouts",
                                                                                         "sessions", "visitors", "addToCarts", "orders")),
                                       float(row.get("revenue") or 0)])


def snapshot(c, slug: str, today: str) -> dict:
    """Experiments (each with its lifetime stats) and campaign attributes."""
    ex = c.call("list_experiments", {"storeSlug": slug, "status": "all"})
    _need(ex, "experiments", where="list_experiments")
    out = {"date": today, "experiments": [], "campaigns": []}
    for e in ex["experiments"]:
        full = e
        if e.get("status") != "DRAFT":
            full = c.call("get_experiment", {"storeSlug": slug, "experimentSequenceNumber": str(e["sequenceNumber"])})
            _need(full, "variations", where="get_experiment")
        out["experiments"].append(full)
    seen = set()
    for st in ("active", "paused", "draft", "stopped"):
        cl = c.call("list_campaigns", {"storeSlug": slug, "status": st})
        _need(cl, "campaigns", where="list_campaigns")
        for cp in cl["campaigns"]:
            if cp["sequenceNumber"] not in seen:
                seen.add(cp["sequenceNumber"])
                out["campaigns"].append({k: (cp.get(k) or "").strip() if isinstance(cp.get(k), str) else cp.get(k)
                                         for k in ("sequenceNumber", "name", "status", "objective", "deliveryType", "createdAt", "publishedAt", "updatedAt")})
        if (cl.get("total") or 0) > len(cl["campaigns"]):
            out.setdefault("notes", []).append(f"list_campaigns {st}: {cl['total']} campaigns, {len(cl['campaigns'])} listed (Cooee's 100 cap)")
    return out


def run(store, client_factory, now: dt.datetime, max_backfill: int | None = None) -> dict:
    cc = config()
    slug, lim = cc["store_slug"], cc["limits"]
    today = now.astimezone(IST).date()
    d1 = (today - dt.timedelta(days=1)).isoformat()
    state = store.get_json("cache/cooee/state.json") or {}
    have = set(state.get("days") or [])
    recent = _days((today - dt.timedelta(days=cc["repull_days"])).isoformat(), d1)
    recent = [d for d in recent if d >= cc["data_start"]]
    need_recent = state.get("repulled_on") != today.isoformat()
    older = [d for d in reversed(_days(cc["data_start"], d1)) if d not in have and d not in recent]
    todo = (recent if need_recent else []) + older[: (cc["backfill_days_per_run"] if max_backfill is None else max_backfill)]
    log = {"started": now.isoformat(), "days": sorted(todo), "status": "ok", "error": None}
    c = client_factory()
    try:
        for a, b in _blocks(todo):
            ranges = pull_ranges(c, slug, a, b)
            for d in _days(a, b):
                day = {**ranges.get(d, {}), **pull_day(c, slug, d, lim), "pulled_at": time.time()}
                store.put_json(f"cache/cooee/day/{d}.json", day)
                have.add(d)
                state["days"] = sorted(have)
                store.put_json("cache/cooee/state.json", state)
        if need_recent:
            state["repulled_on"] = today.isoformat()
        if state.get("snapshot_on") != today.isoformat():
            snap = snapshot(c, slug, today.isoformat())
            store.put_json(f"cache/cooee/snap/{today.isoformat()}.json", snap)
            state["snapshot_on"] = today.isoformat()
            state.setdefault("snaps", [])
            state["snaps"] = sorted(set(state["snaps"]) | {today.isoformat()})
        store.put_json("cache/cooee/state.json", state)
    except Exception as exc:  # recorded for Data health, then re-raised
        log.update(status="error", error=f"{type(exc).__name__}: {exc}")
        raise
    finally:
        log["calls"] = c.log[-400:]
        log["finished"] = dt.datetime.now(dt.timezone.utc).isoformat()
        log["backfill_left"] = len([d for d in _days(cc["data_start"], d1) if d not in have])
        hist = (store.get_json("cache/cooee/sync_log.json") or {}).get("runs") or []
        store.put_json("cache/cooee/sync_log.json", {"runs": ([{k: v for k, v in log.items() if k != "calls"}] + hist)[:60], "last": log})
    return log


def _client(store):
    cc = config()
    return mcp.Client(cc["mcp_url"], lambda force: mcp.access_token(store, force=force)).open()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=None)
    ap.add_argument("--only-page", action="store_true")
    args = ap.parse_args(argv)
    store = default_store()
    now = dt.datetime.now(dt.timezone.utc)
    rc = 0
    if not args.only_page:
        try:
            log = run(store, lambda: _client(store), now, args.days)
            print(f"cooee sync: {len(log['days'])} days pulled, {log['backfill_left']} left to back-fill")
        except mcp.NotConnected as exc:
            print(f"cooee sync skipped: {exc}", file=sys.stderr)
            rc = 0  # not a failure of the job: the page says "Connect Cooee"
        except Exception as exc:
            print(f"cooee sync failed: {type(exc).__name__}: {exc}", file=sys.stderr)
            rc = 1
    days_page = store.get_json("pages/days.json") or {}
    page = build.page(store, settings.config(), now, days_page)
    store.put_json("pages/cro.json", page)
    print("pages/cro.json written:", len(page.get("days") or []), "days")
    return rc


if __name__ == "__main__":
    sys.exit(main())
