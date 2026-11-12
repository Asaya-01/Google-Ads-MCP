"""BigQuery for Dashboard Plus: reads sql/plus/*.sql against Maplemonk
(read-only) and writes only into the dashboard_plus dataset. A copy of the
pattern in app/bq.py, which is left untouched."""

from __future__ import annotations

import datetime as dt
import decimal

from .. import settings
from . import config

SQL_DIR = settings.SQL_DIR / "plus"


def _client():
    from google.cloud import bigquery

    g = settings.config()["gcp"]
    return bigquery.Client(project=g["project"], location=g["bq_location"])


def plus_dataset() -> str:
    return f"{settings.config()['gcp']['project']}.{config()['bq']['write_dataset']}"


def render(name: str, **subs: str) -> str:
    sql = (SQL_DIR / f"{name}.sql").read_text(encoding="utf-8")
    sql = sql.replace("{{dataset}}", config()["bq"]["read_dataset"]).replace("{{plus}}", plus_dataset())
    for k, v in subs.items():
        sql = sql.replace("{{" + k + "}}", v)
    return sql


def _param(name, value):
    from google.cloud import bigquery

    if isinstance(value, list):
        return bigquery.ArrayQueryParameter(name, "STRING", value)
    if isinstance(value, dt.date):
        return bigquery.ScalarQueryParameter(name, "DATE", value)
    if isinstance(value, int):
        return bigquery.ScalarQueryParameter(name, "INT64", value)
    return bigquery.ScalarQueryParameter(name, "STRING", value)


def _plain(v):
    if isinstance(v, (dt.date, dt.datetime)):
        return v.isoformat()
    if isinstance(v, decimal.Decimal):
        return float(v)
    return v


def _config(params: dict, **kw):
    from google.cloud import bigquery

    return bigquery.QueryJobConfig(
        query_parameters=[_param(k, v) for k, v in params.items()],
        labels={"app": "asaya-d2c-dashboard-plus"},
        **kw,
    )


def run(name: str, params: dict | None = None, **subs: str) -> list[dict]:
    """A read query; rows as plain dicts."""
    job = _client().query(render(name, **subs), job_config=_config(params or {}))
    return [{k: _plain(v) for k, v in dict(r).items()} for r in job.result()]


def table_exists(table: str) -> bool:
    from google.api_core.exceptions import NotFound

    try:
        _client().get_table(f"{plus_dataset()}.{table}")
        return True
    except NotFound:
        return False


def _check_target(table: str) -> str:
    """Only dashboard_plus is ever written."""
    if "." in table:
        raise ValueError("write targets are table names inside dashboard_plus only")
    return f"{plus_dataset()}.{table}"


def append_query(name: str, table: str, **subs: str) -> int:
    """Run a query and append its rows to dashboard_plus.<table> (created on
    first use). Returns the rows written."""
    from google.cloud import bigquery

    dest = _check_target(table)
    job = _client().query(
        render(name, **subs),
        job_config=_config(
            {},
            destination=dest,
            write_disposition=bigquery.WriteDisposition.WRITE_APPEND,
            create_disposition=bigquery.CreateDisposition.CREATE_IF_NEEDED,
        ),
    )
    job.result()
    return int(job.num_dml_affected_rows or 0) or int(getattr(job, "total_rows", 0) or 0)


def append_rows(table: str, rows: list[dict], schema: list[tuple[str, str]]) -> int:
    """Load rows into dashboard_plus.<table> (append; created on first use)."""
    from google.cloud import bigquery

    dest = _check_target(table)
    if not rows:
        return 0
    job = _client().load_table_from_json(
        rows,
        dest,
        job_config=bigquery.LoadJobConfig(
            schema=[bigquery.SchemaField(n, t) for n, t in schema],
            write_disposition=bigquery.WriteDisposition.WRITE_APPEND,
            create_disposition=bigquery.CreateDisposition.CREATE_IF_NEEDED,
        ),
    )
    job.result()
    return len(rows)


def has_date(table: str, day: str) -> bool:
    if not table_exists(table):
        return False
    rows = _client().query(
        f"SELECT COUNT(*) AS n FROM `{_check_target(table)}` WHERE snapshot_date = @d",
        job_config=_config({"d": dt.date.fromisoformat(day)}),
    ).result()
    return next(iter(rows))["n"] > 0
