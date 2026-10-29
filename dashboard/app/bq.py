"""Runs the files in sql/ with named query parameters."""

from __future__ import annotations

import datetime as dt
import decimal

from . import settings


def _param(name: str, value):
    from google.cloud import bigquery

    # (type, value) for typed NULLs, e.g. ("FLOAT64", None)
    if isinstance(value, tuple):
        return bigquery.ScalarQueryParameter(name, value[0], value[1])
    if isinstance(value, list):
        return bigquery.ArrayQueryParameter(name, "STRING", value)
    if isinstance(value, dt.date):
        return bigquery.ScalarQueryParameter(name, "DATE", value)
    if isinstance(value, bool):
        return bigquery.ScalarQueryParameter(name, "BOOL", value)
    if isinstance(value, int):
        return bigquery.ScalarQueryParameter(name, "INT64", value)
    if isinstance(value, float):
        return bigquery.ScalarQueryParameter(name, "FLOAT64", value)
    return bigquery.ScalarQueryParameter(name, "STRING", value)


def _plain(value):
    if isinstance(value, (dt.date, dt.datetime)):
        return value.isoformat()
    if isinstance(value, decimal.Decimal):
        return float(value)
    return value


def render(sql_name: str) -> str:
    sql = (settings.SQL_DIR / f"{sql_name}.sql").read_text(encoding="utf-8")
    return sql.replace("{{dataset}}", settings.config()["gcp"]["dataset"])


def run(sql_name: str, **params) -> list[dict]:
    from google.cloud import bigquery

    cfg = settings.config()["gcp"]
    client = bigquery.Client(
        project=cfg["project"], location=cfg["bq_location"]
    )
    job = client.query(
        render(sql_name),
        job_config=bigquery.QueryJobConfig(
            query_parameters=[_param(k, v) for k, v in params.items()],
            labels={
                "app": "asaya-d2c-dashboard",
                "query": sql_name.replace("_", "-"),
            },
        ),
    )
    return [{k: _plain(v) for k, v in row.items()} for row in job.result()]
