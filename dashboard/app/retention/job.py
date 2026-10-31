"""Builds the retention census once a day and stores it for the Retention tab.

  python -m app.retention.job                      # through yesterday (IST)
  python -m app.retention.job --through 2026-10-30
  python -m app.retention.job --out census.json    # write a file, not the store

Orders and lines come from the BigQuery copy of Shopify (valid orders, same
rule as the rest of the dashboard). The Shopify API supplies variant titles
(fragrance, shade, pack) and an independent all-time order count that the
census is checked against.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
from zoneinfo import ZoneInfo

from .. import alerts, bq, secrets, settings
from ..shopify import Shopify
from ..store import default_store
from .build import build
from .catalog import Catalog

IST = ZoneInfo("Asia/Kolkata")


def _shopify(cfg: dict):
    scfg = cfg["shopify"]
    cid = secrets.get_secret(scfg["client_id_secret"])
    secret = secrets.get_secret(scfg["client_secret_secret"])
    if not (cid and secret):
        return None
    return Shopify(scfg["store"], scfg["api_version"], cid, secret)


def _rows(stream):
    for r in stream:
        yield (
            r["order_id"],
            r["customer_id"],
            r["ts"],
            r["title"],
            r["sku"],
            r["product_type"],
            r["revenue"] or 0.0,
        )


def _check(label, ours, theirs, tolerance, note_ok, note_bad):
    if ours is None or theirs is None:
        return {
            "label": label,
            "ours": ours,
            "theirs": theirs,
            "ok": None,
            "note": "Not checked: the figure was not available",
        }
    ok = abs(ours - theirs) <= max(5, tolerance * theirs)
    return {
        "label": label,
        "ours": ours,
        "theirs": theirs,
        "ok": ok,
        "note": note_ok if ok else note_bad,
    }


def checks(census: dict, shop, through: dt.date, cfg: dict) -> list[dict]:
    stats = census["stats"]
    rx = cfg["orders"]["exclude_name_regex"]
    sql = bq.run("retention_check", through=through, exclude_name_regex=rx)[0]
    shopify_all = None
    try:
        if shop:
            shopify_all = shop.orders_count_through(through.isoformat())
    except Exception as exc:  # a failed check must not fail the build
        stats["shopify_check_error"] = str(exc)[:200]
    first = census["epoch"]
    return [
        _check(
            "Real orders: BigQuery copy vs Shopify",
            sql["orders_all"],
            shopify_all,
            0.002,
            f"BigQuery holds every Shopify order from {first}; Shopify's own first orders are a few days earlier",
            "BigQuery is missing orders that Shopify has",
        ),
        {
            "label": "Valid orders (not cancelled, no sample or influencer orders)",
            "ours": sql["orders_valid"],
            "theirs": None,
            "ok": None,
            "note": "Starting point of the census",
        },
        _check(
            "Customers: census vs BigQuery",
            stats["customers"],
            sql["customers_valid"],
            0.03,
            "Customers who only ever bought free gifts, merch or minis are left out by design",
            "More customers are missing than free-gift-only buyers explain",
        ),
    ]


def run(through: dt.date | None = None, out: str | None = None) -> int:
    cfg = settings.config()
    now = dt.datetime.now(IST)
    through = through or (now.date() - dt.timedelta(days=1))
    cat = Catalog()
    shop = _shopify(cfg)
    titles: dict[str, str] = {}
    store = None if out else default_store()
    try:
        if shop:
            titles = shop.catalog().get("variant_titles", {})
    except Exception as exc:
        print(
            json.dumps(
                {"severity": "WARNING", "message": f"variant titles: {exc}"}
            )
        )
    if not titles and store:
        titles = (store.get_json("cache/catalog.json") or {}).get(
            "variant_titles", {}
        )

    stream = bq.stream(
        "retention_lines",
        through=through,
        exclude_name_regex=cfg["orders"]["exclude_name_regex"],
    )
    census = build(
        _rows(stream),
        cat,
        cfg["freebies"]["exclude_product_types"],
        through,
        titles,
        cfg["retention"]["dedupe_hours"],
    )
    census["built_at"] = now.isoformat(timespec="seconds")
    census["stats"]["variant_titles_known"] = len(titles)
    census["checks"] = checks(census, shop, through, cfg)
    if out:
        with open(out, "w", encoding="utf-8") as f:
            json.dump(census, f, separators=(",", ":"))
    else:
        store.put_json("retention/census.json", census)
        store.put_json(
            "pages/retention.json",
            {
                "title": "Retention",
                "as_of": through.isoformat(),
                "generated_at": census["built_at"],
                "checks": census["checks"],
                "stats": census["stats"],
            },
        )
    alerts.log(
        "Retention census built",
        through=through.isoformat(),
        customers=census["stats"]["customers"],
        orders=census["stats"]["orders_counted"],
    )
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--through", help="last day to include (YYYY-MM-DD)")
    parser.add_argument("--out", help="write the census to this file")
    args = parser.parse_args(argv)
    through = dt.date.fromisoformat(args.through) if args.through else None
    try:
        return run(through, args.out)
    except Exception as exc:
        alerts.send(
            "Asaya dashboard: the retention census build failed",
            [f"{type(exc).__name__}: {str(exc)[:400]}"],
        )
        raise


if __name__ == "__main__":
    sys.exit(main())
