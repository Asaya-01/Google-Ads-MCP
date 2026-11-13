"""The Awareness tab: geo outcomes, geo tests (GeoLift), testability and the
media that touches each geo. Sales come from Maplemonk's consolidated sales,
read only; nothing is written to BigQuery. Settings live in config.json
("awareness"); results live in the dashboard's bucket.

The repository is public, so business figures (each test's weekly spend, a
campaign's leakage share, the acceptance-check targets) are not in
config.json: they live in the bucket at private/awareness.json and are laid
over config.json when the job runs. Shape:

  {"tests": {"<test_id>": {"weekly_spend": 0}},
   "media_events": {"<event_id>": {"leak_share": 0.0}},
   "acceptance": {"website_orders": 0, "tn_weekly_sales": 0,
                  "chennai_daily_sales": 0, "coimbatore_daily_sales": 0}}
"""

from __future__ import annotations

import copy

from .. import settings

PRIVATE_PATH = "private/awareness.json"


def config(private: dict | None = None) -> dict:
    """config.json's awareness section with the private figures laid over it."""
    cfg = copy.deepcopy(settings.config()["awareness"])
    return overlay(cfg, private or {})


def overlay(cfg: dict, private: dict) -> dict:
    for t in cfg.get("tests") or []:
        t.update((private.get("tests") or {}).get(t["test_id"]) or {})
    for e in cfg.get("media_events") or []:
        e.update((private.get("media_events") or {}).get(e["event_id"]) or {})
    cfg["acceptance"] = {**(cfg.get("acceptance") or {}), **(private.get("acceptance") or {})}
    return cfg
