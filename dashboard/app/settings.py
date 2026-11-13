"""Loads config.json and the handful of environment settings the service needs."""

import json
import os
import pathlib
from functools import lru_cache

ROOT = pathlib.Path(__file__).resolve().parent.parent
SQL_DIR = ROOT / "sql"
STATIC_DIR = ROOT / "static"


@lru_cache(maxsize=1)
def config() -> dict:
    path = os.environ.get("DASHBOARD_CONFIG", str(ROOT / "config.json"))
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def env(name: str, default: str | None = None) -> str | None:
    return os.environ.get(name, default)


def enabled_tabs() -> list[dict]:
    return [t for t in config()["tabs"] if t.get("enabled")]


def app_fragment() -> str:
    """static/app.html with the retention engine, UI and styles inlined (kept
    in their own files so the engine can be tested on its own in Node)."""
    html = (STATIC_DIR / "app.html").read_text(encoding="utf-8")
    for marker, name in (
        ("/*__RETENTION_CSS__*/", "retention.css"),
        ("/*__RETENTION_ENGINE__*/", "retention_engine.js"),
        ("/*__RETENTION_UI__*/", "retention_ui.js"),
        ("/*__RANGE_CSS__*/", "range.css"),
        ("/*__UI_CSS__*/", "ui.css"),
        ("/*__RANGE_ENGINE__*/", "range_engine.js"),
        ("/*__METRICS__*/", "metrics.js"),
        ("/*__RANGE_UI__*/", "range_ui.js"),
        ("/*__RANGE_FUNNEL__*/", "range_funnel.js"),
        ("/*__RANGE_TABS__*/", "range_tabs.js"),
        ("/*__RANGE_TREE__*/", "range_tree.js"),
        ("/*__META_VIEW__*/", "meta_view.js"),
        ("/*__GOOGLE_VIEW__*/", "google_view.js"),
        ("/*__RANGE_BASKET__*/", "range_basket.js"),
        ("/*__RANGE_D1__*/", "range_d1.js"),
        ("/*__RANGE_REGION__*/", "range_region.js"),
        ("/*__CRO__*/", "cro.js"),
        ("/*__ASK_CSS__*/", "ask.css"),
        ("/*__ASK__*/", "ask.js"),
    ):
        html = html.replace(
            marker, (STATIC_DIR / name).read_text(encoding="utf-8")
        )
    return html
