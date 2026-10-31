"""Builds a self-contained HTML preview from saved inputs, with no cloud access.

The inputs directory holds one JSON file per key that refresh.collect()
returns (orders_daily.json, sessions.json, meta.json, ...). Write one with
`python -m app.refresh --dump-inputs DIR`, then:

  python -m app.preview --inputs DIR --d1 2026-10-28 --out preview.html

The preview embeds the page snapshots, so it opens straight from disk. It
contains real business numbers: keep it out of the repository.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import pathlib

from . import settings
from .pages import build_all

KEYS = [
    "orders_daily",
    "order_attribution",
    "products",
    "funnel",
    "google_ads",
    "google_campaigns",
    "checks",
    "sessions",
    "landing",
    "meta",
    "catalog",
    "unavailable",
]


def load_inputs(directory: str, d1: str, history_days: int) -> dict:
    root = pathlib.Path(directory)
    data = {"d1": d1, "funnel_start": "2026-04-30", "unavailable": {}}
    for key in KEYS:
        path = root / f"{key}.json"
        if path.exists():
            data[key] = json.loads(path.read_text(encoding="utf-8"))
    data["history_start"] = (
        dt.date.fromisoformat(d1) - dt.timedelta(days=history_days)
    ).isoformat()
    return data


def render(
    pages: dict, status: dict, out: str, census: dict | None = None
) -> None:
    fragment = settings.app_fragment()
    payload = {
        "config": {
            "brand": settings.config()["brand"],
            "tabs": [
                {"id": t["id"], "label": t["label"]}
                for t in settings.enabled_tabs()
            ],
        },
        "status": status,
        "pages": pages,
    }
    if census is not None:
        payload["census"] = census
    blob = json.dumps(payload, separators=(",", ":"), default=str).replace(
        "</", "<\\/"
    )
    script = f"<script>window.__DASH__ = {blob};</script>\n"
    # The data must exist before the dashboard script runs.
    marker = '<script src="https://cdnjs.cloudflare.com'
    pathlib.Path(out).write_text(
        fragment.replace(marker, script + marker, 1), encoding="utf-8"
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--inputs", required=True)
    parser.add_argument("--d1", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument(
        "--census", help="a retention census JSON file to embed"
    )
    parser.add_argument(
        "--days", help="a days page JSON file to use instead of the built one"
    )
    parser.add_argument(
        "--live", help="a live page JSON file (app.live output) to embed"
    )
    args = parser.parse_args(argv)
    cfg = settings.config()
    data = load_inputs(args.inputs, args.d1, cfg["refresh"]["history_days"])
    pages, ctx = build_all(
        data, cfg, [t["id"] for t in settings.enabled_tabs()]
    )
    if "d1" in pages:
        pages["d1"]["commentary"] = data.get("commentary") or {
            "text": None,
            "na": "Commentary is written by Claude during the scheduled refresh",
        }
    now = dt.datetime.now(
        dt.timezone(dt.timedelta(hours=5, minutes=30))
    ).isoformat(timespec="seconds")
    for page in pages.values():
        page["generated_at"] = now
    status = {
        "d1": args.d1,
        "checks": data.get("checks", []),
        "missing": {},
        "unavailable": data.get("unavailable", {}),
        "complete": True,
        "unclassified_google_ids": ctx.unclassified_google_rows(),
    }
    if args.days:
        pages["days"] = json.loads(
            pathlib.Path(args.days).read_text(encoding="utf-8")
        )
    if args.live:
        pages["live"] = json.loads(
            pathlib.Path(args.live).read_text(encoding="utf-8")
        )
    census = None
    if args.census:
        census = json.loads(
            pathlib.Path(args.census).read_text(encoding="utf-8")
        )
        pages["retention"] = {
            "title": "Retention",
            "as_of": args.d1,
            "generated_at": now,
            "checks": census.get("checks", []),
            "stats": census.get("stats", {}),
        }
    render(pages, status, args.out, census)
    print(f"Wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
