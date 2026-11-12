"""The Dashboard Plus job: python -m app.plus.job

Builds the new tabs' page (pages/plus.json: one entry in the nav, "Plus",
with each module as a sub-tab) and takes today's stock
snapshots into BigQuery dashboard_plus. Runs on its own schedule, separate
from the existing refresh job, which it never touches; it only reads the
existing status and pages (status/latest.json, pages/channel_days.json).

  --no-snapshot   build the pages only
  --only NAME     build one page (traffic, profit, site, stock)
"""

from __future__ import annotations

import argparse
import datetime as dt
import sys

from .. import secrets, settings
from ..store import default_store
from . import bqx, build

PAGES = ("traffic", "profit", "site", "stock")


def _d1(store) -> str:
    days = store.get_json("pages/days.json") or {}
    if days.get("as_of"):
        return days["as_of"]
    ist = dt.datetime.now(dt.timezone(dt.timedelta(hours=5, minutes=30))).date()
    return (ist - dt.timedelta(days=1)).isoformat()


def _shop():
    from ..shopify import Shopify

    scfg = settings.config()["shopify"]
    cid, csec = secrets.get_secret(scfg["client_id_secret"]), secrets.get_secret(scfg["client_secret_secret"])
    if not (cid and csec):
        raise RuntimeError("Shopify client ID / secret not in Secret Manager")
    return Shopify(scfg["store"], scfg["api_version"], cid, csec)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-snapshot", action="store_true")
    ap.add_argument("--only", choices=PAGES)
    args = ap.parse_args(argv)
    store = default_store()
    d1 = _d1(store)
    today = dt.datetime.now(dt.timezone(dt.timedelta(hours=5, minutes=30))).date().isoformat()
    taken = {} if args.no_snapshot else build.take_snapshots(today, _shop, bqx)
    print("snapshots:", taken)
    makers = {
        "traffic": lambda: build.build_traffic(store, d1, bqx.run),
        "profit": lambda: build.build_profit(store, d1),
        "site": lambda: build.build_site(store, d1),
        "stock": lambda: build.build_stock(d1, bqx, taken),
    }
    # one page for the one nav entry ("Plus"); each module is a sub-tab of it
    page = (store.get_json("pages/plus.json") or {}) if args.only else {}
    page.update({"title": "Plus", "as_of": d1})
    failed = 0
    for name in PAGES:
        if args.only and name != args.only:
            continue
        try:
            page[name] = makers[name]()
        except Exception as exc:  # one module failing never stops the others
            failed += 1
            page[name] = {"na": f"Data unavailable: {type(exc).__name__}: {exc}"}
            print(f"plus {name} failed: {type(exc).__name__}: {exc}", file=sys.stderr)
    store.put_json("pages/plus.json", page)
    print("pages/plus.json written:", ", ".join(k for k in PAGES if k in page))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
