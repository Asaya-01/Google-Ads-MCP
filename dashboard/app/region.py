"""Region data for the Region tab: Shopify's own Sales report (the D-1
numbers: Orders, Total sales, Quantity ordered) by state and city of the
shipping address, and by product within each city.

Shopify's report books a return or cancellation on the day it is processed,
so a past day's figures settle once that day is over; only the last few days
are pulled again on each refresh.
- City by day: cheap, so the whole window is pulled every run (a few queries).
- City by product: one query a day (about a thousand rows each), cached per
  month in cache/region/sku/<YYYY-MM>.json. Missing days are backfilled newest
  first, `sku_backfill_per_run` at a time, so the first runs stay short.
"""

from __future__ import annotations

import datetime as dt


def _days(a: dt.date, b: dt.date) -> list[str]:
    return [(a + dt.timedelta(days=i)).isoformat() for i in range((b - a).days + 1)]


def collect(cfg: dict, store, shop, d1: str, notes: dict) -> dict:
    rcfg = cfg.get("region", {})
    names = [n for n in cfg["orders"]["exclude_name_regex"].split("|") if n]
    end = dt.date.fromisoformat(d1)
    start = end - dt.timedelta(days=rcfg.get("history_days", 400) - 1)
    wanted = _days(start, end)

    # city by day: the whole window, in 31-day pieces
    city: dict[str, list] = {}
    a = start
    while a <= end:
        b = min(end, a + dt.timedelta(days=30))
        for r in shop.sales_by_city(a.isoformat(), b.isoformat(), names):
            city.setdefault(r["date"], []).append(
                [r["region"], r["city"], r["orders"], round(r["sales"], 2), r["qty"]]
            )
        a = b + dt.timedelta(days=1)
    store.put_json("cache/region/city.json", city)

    # city by product: cached per month
    months: dict[str, dict] = {}

    def month(d: str) -> dict:
        m = d[:7]
        if m not in months:
            months[m] = store.get_json(f"cache/region/sku/{m}.json") or {}
        return months[m]

    recent = set(wanted[-rcfg.get("refresh_days", 3):])
    todo = [d for d in reversed(wanted) if d in recent or d not in month(d)]
    budget = rcfg.get("sku_backfill_per_run", 45)
    pulled, failed, dirty = 0, [], set()
    for d in todo:
        if d not in recent and pulled >= budget:
            break
        try:
            rows = shop.sales_by_city_product(d, names)
        except Exception as exc:  # keep what is cached, say what is missing
            failed.append(f"{d}: {exc}")
            continue
        dirty.add(d[:7])
        month(d)[d] = [
            [r["region"], r["city"], r["product"], r["type"], r["orders"], round(r["sales"], 2), r["qty"]]
            for r in rows
        ]
        if d not in recent:  # the recent days are re-read every run, outside the backfill budget
            pulled += 1
    for m in dirty:
        store.put_json(f"cache/region/sku/{m}.json", months[m])
    sku = {d: month(d)[d] for d in wanted if d in month(d)}
    missing = [d for d in wanted if d not in sku]
    if missing:
        notes["region_sku"] = (
            f"Product detail by city covers {len(sku)} of {len(wanted)} days so far; "
            f"older days fill in over the next refreshes ({rcfg.get('sku_backfill_per_run', 45)} a run)."
        )
    if failed:
        notes["region_sku_failed"] = "Some days could not be read: " + "; ".join(failed[:3])
    return {"city": city, "sku": sku, "from": wanted[0], "to": wanted[-1]}
