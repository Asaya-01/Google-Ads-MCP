"""Dashboard Plus: the Build Spec v1 modules, added beside the existing
dashboard without changing it. Everything here reads the existing data
(BigQuery Maplemonk and the dashboard's stored pages) read-only and writes
only to its own pages (pages/plus_*.json) and BigQuery dataset
(dashboard_plus). It runs as its own Cloud Run job (python -m app.plus.job).
"""

import json
from functools import lru_cache
from pathlib import Path

HERE = Path(__file__).resolve().parent


@lru_cache(maxsize=1)
def config() -> dict:
    return json.loads((HERE / "config_plus.json").read_text(encoding="utf-8"))
