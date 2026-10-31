"""Google Ads API (REST): campaign-level daily spend and results, straight from
Google, so yesterday is there from the early morning instead of waiting for
the BigQuery sync. The rows have the same shape as sql/google_ads_daily.sql, so
every page builder works unchanged. BigQuery stays as the fallback."""

from __future__ import annotations

import time

import requests

TOKEN_URL = "https://oauth2.googleapis.com/token"


class GoogleAdsError(RuntimeError):
    pass


def access_token(client_id: str, client_secret: str, refresh_token: str) -> str:
    resp = requests.post(
        TOKEN_URL,
        data={
            "grant_type": "refresh_token",
            "client_id": client_id,
            "client_secret": client_secret,
            "refresh_token": refresh_token,
        },
        timeout=30,
    )
    body = resp.json()
    if "access_token" not in body:
        raise GoogleAdsError(
            "OAuth refresh failed: "
            + str(body.get("error_description") or body.get("error") or body)
        )
    return body["access_token"]


def _search_stream(cfg: dict, creds: dict, query: str) -> list[dict]:
    token = access_token(
        creds["client_id"], creds["client_secret"], creds["refresh_token"]
    )
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    if cfg.get("login_customer_id"):
        headers["login-customer-id"] = str(cfg["login_customer_id"])
    url = (
        f"https://googleads.googleapis.com/{cfg['api_version']}"
        f"/customers/{cfg['account_id']}/googleAds:searchStream"
    )
    for attempt in range(4):
        resp = requests.post(
            url, headers=headers, json={"query": query}, timeout=120
        )
        if resp.status_code < 500 and resp.status_code != 429:
            break
        time.sleep(2**attempt)
    try:
        body = resp.json()
    except ValueError:
        raise GoogleAdsError(f"HTTP {resp.status_code} with no JSON body")
    batches = body if isinstance(body, list) else [body]
    rows: list[dict] = []
    for batch in batches:
        if "error" in batch:
            err = batch["error"]
            detail = ""
            for d in err.get("details") or []:
                for e in d.get("errors") or []:
                    detail = e.get("message") or detail
            raise GoogleAdsError(
                f"{err.get('status', resp.status_code)}: "
                f"{detail or err.get('message', 'Google Ads API error')}"
            )
        rows.extend(batch.get("results") or [])
    return rows


def fetch_daily(cfg: dict, creds: dict, since: str, until: str) -> list[dict]:
    """One row per campaign per day, like sql/google_ads_daily.sql."""
    query = (
        "SELECT segments.date, campaign.id, campaign.name, "
        "metrics.cost_micros, metrics.impressions, metrics.clicks, "
        "metrics.conversions, metrics.conversions_value "
        "FROM campaign "
        f"WHERE segments.date BETWEEN '{since}' AND '{until}'"
    )
    out = []
    for r in _search_stream(cfg, creds, query):
        m = r.get("metrics") or {}
        out.append(
            {
                "date": r["segments"]["date"],
                "campaign_id": str(r["campaign"]["id"]),
                "campaign_name": r["campaign"].get("name") or "",
                "spend": int(m.get("costMicros") or 0) / 1_000_000,
                "impressions": int(m.get("impressions") or 0),
                "clicks": int(m.get("clicks") or 0),
                "conversions": float(m.get("conversions") or 0),
                "conversion_value": float(m.get("conversionsValue") or 0),
            }
        )
    return out


def fetch_campaigns(cfg: dict, creds: dict) -> list[dict]:
    """Every campaign with its current name, paused ones included, so the
    Awareness set is built from names and never hard-coded."""
    rows = _search_stream(
        cfg, creds, "SELECT campaign.id, campaign.name FROM campaign"
    )
    return [
        {
            "campaign_id": str(r["campaign"]["id"]),
            "campaign_name": r["campaign"].get("name") or "",
        }
        for r in rows
    ]


def fetch_day_total(cfg: dict, creds: dict, day: str) -> float:
    """Spend for one day from the account's own total, to check the
    campaign-level rows add up."""
    rows = _search_stream(
        cfg,
        creds,
        "SELECT metrics.cost_micros FROM customer "
        f"WHERE segments.date = '{day}'",
    )
    return (
        sum(int((r.get("metrics") or {}).get("costMicros") or 0) for r in rows)
        / 1_000_000
    )
