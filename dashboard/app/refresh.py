"""Daily refresh job (Cloud Run job, triggered by Cloud Scheduler).

Schedule: every 30 minutes from 07:00 IST. Each run:
  1. checks that D-1 is present in every source (BigQuery is expected by 06:30)
  2. pulls BigQuery, Shopify sessions and MRP, and the Meta Marketing API
  3. rebuilds every enabled page and writes the snapshots
  4. marks the day complete once every required source has D-1, so later
     runs that day exit straight away
Pages are always rebuilt with whatever is present, showing "Data unavailable"
for the rest. From 10:00 IST a still-missing source raises one alert per day,
and the 30-minute retries continue. A Google campaign ID seen in sessions but
missing from GOOGLEADS_CONSOLIDATED raises one alert per day too.

Usage:
  python -m app.refresh                        # normal scheduled run
  python -m app.refresh --force                # rebuild even if complete
  python -m app.refresh --date 2026-10-28      # build for a specific D-1
  python -m app.refresh --meta-backfill-days 100   # one-off campaign-level Meta history
  python -m app.refresh --dump-inputs DIR          # also save the inputs, for app.preview
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import pathlib
import time
import sys
from zoneinfo import ZoneInfo

from . import alerts, bq, commentary, meta, secrets, settings
from .pages import build_all
from .shopify import Shopify
from .store import default_store

IST = ZoneInfo("Asia/Kolkata")
FUNNEL_HISTORY_START = (
    "2026-04-30"  # GoKwik funnel history before May is dropped
)


def _hhmm(value: str) -> dt.time:
    h, m = value.split(":")
    return dt.time(int(h), int(m))


def collect(
    cfg: dict, store, d1: str, meta_backfill_days: int = 0
) -> tuple[dict, dict]:
    """Everything the page builders need, plus {source: reason} for every
    required source that does not have D-1 yet."""
    d1_date = dt.date.fromisoformat(d1)
    start = d1_date - dt.timedelta(days=cfg["refresh"]["history_days"])
    required = set(cfg["refresh"]["required_sources"])
    missing: dict[str, str] = {}
    data: dict = {
        "d1": d1,
        "history_start": start.isoformat(),
        "funnel_start": FUNNEL_HISTORY_START,
        "unavailable": {},
    }

    # BigQuery
    checks = bq.run("refresh_check", d1=d1_date)
    data["checks"] = checks
    for c in checks:
        if c["source"] in required and not c["d1_rows"]:
            missing[c["source"]] = (
                f"no rows for {d1} yet (latest {c['latest_date']})"
            )
    window = {"start_date": start, "end_date": d1_date}
    orders = {
        **window,
        "exclude_name_regex": cfg["orders"]["exclude_name_regex"],
    }
    fb = cfg["freebies"]
    data["orders_daily"] = bq.run("orders_daily", **orders)
    data["order_attribution"] = bq.run("order_attribution", **orders)
    data["products"] = bq.run(
        "product_daily",
        **orders,
        exclude_product_types=fb["exclude_product_types"],
    )
    data["funnel"] = bq.run("funnel_daily", **window)
    data["google_ads"] = bq.run("google_ads_daily", **window)
    data["google_campaigns"] = bq.run("google_campaigns")

    # Shopify: sessions per day (cached, recent days re-pulled) and MRP
    scfg = cfg["shopify"]
    try:
        client_id = secrets.get_secret(scfg["client_id_secret"])
        client_secret = secrets.get_secret(scfg["client_secret_secret"])
        if not (client_id and client_secret):
            raise RuntimeError(
                "Shopify client ID / secret not in Secret Manager"
            )
        shop = Shopify(
            scfg["store"], scfg["api_version"], client_id, client_secret
        )
        refetch_from = d1_date - dt.timedelta(
            days=cfg["refresh"]["refetch_recent_days"] - 1
        )
        sessions, landing = {}, {}
        for day in _days(start, d1_date):
            s_path, l_path = (
                f"cache/sessions/{day}.json",
                f"cache/landing/{day}.json",
            )
            fresh = dt.date.fromisoformat(day) >= refetch_from
            s = None if fresh else store.get_json(s_path)
            if s is None:
                s = shop.sessions_day(day, cfg["sessions"]["breakdown_limit"])
                store.put_json(s_path, s)
            l = None if fresh else store.get_json(l_path)
            if l is None:
                l = shop.landing_day(day, cfg["sessions"]["landing_page_limit"])
                store.put_json(l_path, l)
            sessions[day], landing[day] = s, l
        data["sessions"], data["landing"] = sessions, landing
        if not sessions.get(d1, {}).get("totals", {}).get("sessions"):
            missing["shopify_sessions"] = (
                f"Shopify reports no sessions for {d1} yet"
            )
        try:
            data["catalog"] = shop.catalog()
            store.put_json("cache/catalog.json", data["catalog"])
        except (
            Exception
        ) as exc:  # MRP is not worth failing the run for; reuse the last pull
            data["catalog"] = store.get_json("cache/catalog.json")
            data["unavailable"][
                "catalog"
            ] = f"Shopify products pull failed: {exc}"
    except Exception as exc:
        reason = f"Shopify API: {exc}"
        data["unavailable"]["shopify_sessions"] = reason
        missing["shopify_sessions"] = reason
        data["sessions"], data["landing"] = {}, {}
        data["catalog"] = store.get_json("cache/catalog.json")

    # Meta Marketing API: last 7 days at ad level, cached per day
    mcfg = cfg["meta"]
    token = secrets.get_secret(mcfg["token_secret"])
    if not token:
        data["unavailable"][
            "meta"
        ] = f"Meta system-user token not in Secret Manager yet ({mcfg['token_secret']})"
    else:
        try:
            if meta_backfill_days:
                _meta_backfill(token, mcfg, store, d1_date, meta_backfill_days)
            since = d1_date - dt.timedelta(days=mcfg["lookback_days"] - 1)
            rows = _fetch_meta(token, mcfg, since.isoformat(), d1)
            by_day: dict[str, list] = {}
            for r in rows:
                by_day.setdefault(r["date"], []).append(r)
            # An empty result is not a zero day: never cache it, so a good
            # earlier pull is kept and the day reads as unavailable.
            for day, day_rows in by_day.items():
                store.put_json(f"cache/meta/{day}.json", day_rows)
            if not by_day.get(d1):
                missing["meta_ads"] = f"Meta returned no rows for {d1}"
        except Exception as exc:
            data["unavailable"]["meta"] = f"Meta API: {exc}"
            missing["meta_ads"] = data["unavailable"]["meta"]
        cached = {}
        for day in _days(start, d1_date):
            rows = store.get_json(f"cache/meta/{day}.json")
            if rows is not None:
                cached[day] = rows
        data["meta"] = cached
    return data, missing


def _fetch_meta(
    token: str,
    mcfg: dict,
    since: str,
    d1: str,
    pauses: tuple[int, ...] = (30, 60),
) -> list[dict]:
    """Meta sometimes answers with no rows for yesterday and fills them in
    minutes later; ask again a couple of times before giving up."""
    for attempt in range(len(pauses) + 1):
        rows = meta.fetch_all(token, mcfg, since, d1)
        if any(r["date"] == d1 for r in rows) or attempt == len(pauses):
            return rows
        time.sleep(pauses[attempt])
    return rows


def _meta_backfill(
    token: str, mcfg: dict, store, d1_date: dt.date, days: int
) -> None:
    """One-off campaign-level history (for MTD spend and sale detection).
    Days that already have an ad-level cache are left alone."""
    end = d1_date
    first = d1_date - dt.timedelta(days=days - 1)
    while end >= first:
        chunk_start = max(first, end - dt.timedelta(days=6))
        rows = meta.fetch_all(
            token,
            mcfg,
            chunk_start.isoformat(),
            end.isoformat(),
            level="campaign",
        )
        by_day: dict[str, list] = {}
        for r in rows:
            by_day.setdefault(r["date"], []).append(r)
        for day in _days(chunk_start, end):
            if (
                by_day.get(day)
                and store.get_json(f"cache/meta/{day}.json") is None
            ):
                store.put_json(f"cache/meta/{day}.json", by_day[day])
        end = chunk_start - dt.timedelta(days=1)


def _days(start: dt.date, end: dt.date) -> list[str]:
    return [
        (start + dt.timedelta(days=i)).isoformat()
        for i in range((end - start).days + 1)
    ]


def run(
    d1: str | None = None,
    force: bool = False,
    meta_backfill_days: int = 0,
    dump_inputs: str | None = None,
) -> int:
    cfg = settings.config()
    store = default_store()
    now = dt.datetime.now(IST)
    d1 = d1 or (now.date() - dt.timedelta(days=1)).isoformat()
    status_path = f"status/{d1}.json"
    status = store.get_json(status_path) or {"d1": d1, "attempts": 0}
    if status.get("complete") and not force:
        alerts.log("D-1 already complete; nothing to do", d1=d1)
        return 0

    data, missing = collect(cfg, store, d1, meta_backfill_days)
    if dump_inputs:
        out = pathlib.Path(dump_inputs)
        out.mkdir(parents=True, exist_ok=True)
        for key, value in data.items():
            if isinstance(value, (list, dict)):
                (out / f"{key}.json").write_text(
                    json.dumps(value, default=str), encoding="utf-8"
                )
    enabled = [t["id"] for t in settings.enabled_tabs()]
    pages, ctx = build_all(data, cfg, enabled)

    if "d1" in pages:
        previous = store.get_json("pages/d1.json") or {}
        prev_comment = previous.get("commentary") or {}
        if prev_comment.get("text") and prev_comment.get(
            "fingerprint"
        ) == commentary.fingerprint(pages["d1"]):
            pages["d1"]["commentary"] = prev_comment
        else:
            pages["d1"]["commentary"] = commentary.generate(
                pages["d1"], cfg["commentary"]
            )

    generated_at = now.isoformat(timespec="seconds")
    for tab, page in pages.items():
        page["generated_at"] = generated_at
        store.put_json(f"pages/{tab}.json", page)

    unclassified = ctx.unclassified_google_rows()
    status.update(
        attempts=status["attempts"] + 1,
        last_attempt=generated_at,
        complete=not missing,
        missing=missing,
        unavailable=data["unavailable"],
        checks=data["checks"],
        unclassified_google_ids=unclassified,
    )
    if (
        missing
        and now.time() >= _hhmm(cfg["refresh"]["alert_from"])
        and not status.get("alerted_missing")
    ):
        alerts.send(
            f"Asaya dashboard: data for {d1} still missing at {now:%H:%M} IST",
            [f"{k}: {v}" for k, v in missing.items()]
            + ["The job retries every 30 minutes."],
        )
        status["alerted_missing"] = generated_at
    # Alert on IDs seen on D-1 only; older strays stay in the check table.
    fresh_unclassified = [u for u in unclassified if d1 in u["dates"]]
    if fresh_unclassified and not status.get("alerted_unclassified"):
        alerts.send(
            f"Asaya dashboard: Google campaign IDs in sessions are missing from GOOGLEADS_CONSOLIDATED ({d1})",
            [
                f"{u['campaign_id']}: {u['sessions']} sessions in the history window"
                for u in fresh_unclassified[:20]
            ]
            + [
                "They count as Perf until the campaign syncs; the dashboard recomputes on every run."
            ],
        )
        status["alerted_unclassified"] = generated_at
    store.put_json(status_path, status)
    store.put_json("status/latest.json", status)
    alerts.log(
        "Refresh finished",
        d1=d1,
        complete=status["complete"],
        missing=list(missing),
        reasons=missing,
    )
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--date", help="D-1 to build (YYYY-MM-DD); defaults to yesterday in IST"
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="rebuild even if the day is already complete",
    )
    parser.add_argument("--meta-backfill-days", type=int, default=0)
    parser.add_argument(
        "--dump-inputs",
        help="also write the collected inputs to this directory (real data: keep it private)",
    )
    args = parser.parse_args(argv)
    return run(args.date, args.force, args.meta_backfill_days, args.dump_inputs)


if __name__ == "__main__":
    sys.exit(main())
