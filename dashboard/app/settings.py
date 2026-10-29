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
