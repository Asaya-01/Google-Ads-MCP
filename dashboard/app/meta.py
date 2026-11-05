"""Meta Marketing API pull for the two allowlisted ad accounts only.

The allowlist lives in config.json (meta.accounts); any other account ID is
refused here, so Offers, marketplace, partner and agency accounts can never be
pulled by accident. Results are cached per day in the snapshot store and
never written to BigQuery.
"""

from __future__ import annotations

import json
import time

import requests

FIELDS = (
    "date_start,account_id,campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,"
    "spend,impressions,clicks,reach,frequency,actions,action_values"
)

# Funnel actions kept from the `actions` array we already receive. Each list
# is in priority order and only the first type present is used: Meta reports
# the same number under several names (landing_page_view and
# omni_landing_page_view; add_to_cart, the pixel's and omni_add_to_cart), so
# adding them up would double count.
ACTION_TYPES = {
    "link_clicks": ["link_click"],
    "lpv": ["landing_page_view", "omni_landing_page_view"],
    "atc": ["omni_add_to_cart", "add_to_cart", "offsite_conversion.fb_pixel_add_to_cart"],
    "video_3s": ["video_view"],
}


class MetaError(RuntimeError):
    pass


def _first_action(entries: list[dict] | None, action_types: list[str]) -> float:
    """Value of the highest-priority purchase action type present. Only one
    type is used, because omni_purchase already includes the pixel purchase."""
    by_type = {e.get("action_type"): e.get("value") for e in entries or []}
    for t in action_types:
        if t in by_type:
            return float(by_type[t])
    return 0.0


def fetch_insights(
    token: str,
    cfg: dict,
    account_id: str,
    since: str,
    until: str,
    level: str = "ad",
) -> list[dict]:
    if account_id not in cfg["accounts"]:
        raise MetaError(f"{account_id} is not on the Meta account allowlist")
    url = f"https://graph.facebook.com/{cfg['graph_api_version']}/{account_id}/insights"
    params = {
        "level": level,
        "time_increment": 1,
        "time_range": json.dumps({"since": since, "until": until}),
        "fields": (
            FIELDS
            if level == "ad"
            else FIELDS.replace("adset_id,adset_name,ad_id,ad_name,", "")
        ),
        "limit": 500,
        "access_token": token,
    }
    rows: list[dict] = []
    while url:
        for attempt in range(5):
            resp = requests.get(url, params=params, timeout=120)
            if resp.status_code < 500 and resp.status_code != 429:
                break
            time.sleep(2**attempt)
        body = resp.json()
        if "error" in body:
            raise MetaError(body["error"].get("message", "Meta API error"))
        for r in body.get("data", []):
            rows.append(
                {
                    "date": r["date_start"],
                    "account_id": account_id,
                    "account_name": cfg["accounts"][account_id],
                    "campaign_id": r.get("campaign_id"),
                    "campaign_name": r.get("campaign_name") or "",
                    "adset_id": r.get("adset_id"),
                    "adset_name": r.get("adset_name") or "",
                    "ad_id": r.get("ad_id"),
                    "ad_name": r.get("ad_name") or "",
                    "spend": float(r.get("spend") or 0),
                    "impressions": int(r.get("impressions") or 0),
                    "clicks": int(r.get("clicks") or 0),
                    "purchases": _first_action(
                        r.get("actions"), cfg["purchase_action_types"]
                    ),
                    "purchase_value": _first_action(
                        r.get("action_values"), cfg["purchase_action_types"]
                    ),
                    **{
                        k: _first_action(r.get("actions"), types)
                        for k, types in ACTION_TYPES.items()
                    },
                    # reach does not add up across days or rows: kept per
                    # row for that row only
                    "reach": int(r.get("reach") or 0),
                }
            )
        url = (body.get("paging") or {}).get("next")
        params = None  # the "next" URL already carries every parameter
    return rows


def fetch_all(
    token: str, cfg: dict, since: str, until: str, level: str = "ad"
) -> list[dict]:
    rows: list[dict] = []
    for account_id in cfg["accounts"]:
        rows.extend(fetch_insights(token, cfg, account_id, since, until, level))
    return rows


def day_total(token: str, cfg: dict, day: str) -> float:
    """Spend for one day straight from each account's own total (no campaign
    or ad breakdown), to check the row-level pull did not drop anything."""
    total = 0.0
    for account_id in cfg["accounts"]:
        url = (
            f"https://graph.facebook.com/{cfg['graph_api_version']}"
            f"/{account_id}/insights"
        )
        params = {
            "level": "account",
            "time_increment": 1,
            "time_range": json.dumps({"since": day, "until": day}),
            "fields": "date_start,spend",
            "access_token": token,
        }
        for attempt in range(4):
            resp = requests.get(url, params=params, timeout=120)
            if resp.status_code < 500 and resp.status_code != 429:
                break
            time.sleep(2**attempt)
        body = resp.json()
        if "error" in body:
            raise MetaError(body["error"].get("message", "Meta API error"))
        total += sum(float(r.get("spend") or 0) for r in body.get("data", []))
    return total


OBJECT_FIELDS = {
    "campaigns": "id,name,objective,effective_status,daily_budget,lifetime_budget,created_time",
    "adsets": "id,name,campaign_id,effective_status,daily_budget,lifetime_budget,created_time",
    "ads": "id,name,adset_id,campaign_id,effective_status,created_time",
}


def fetch_objects(token: str, cfg: dict) -> dict:
    """Status, budget and launch date of every campaign, ad set and ad in the
    allowlisted accounts (object reads, not Insights). Budgets come back in
    the account currency's minor unit (paise) and as 0 when not set; a
    campaign budget sits on the campaign, otherwise on its ad sets."""
    out: dict[str, dict] = {"campaigns": {}, "adsets": {}, "ads": {}}
    for account_id in cfg["accounts"]:
        for kind, fields in OBJECT_FIELDS.items():
            url = f"https://graph.facebook.com/{cfg['graph_api_version']}/{account_id}/{kind}"
            params = {"fields": fields, "limit": 500, "access_token": token}
            while url:
                for attempt in range(5):
                    resp = requests.get(url, params=params, timeout=120)
                    if resp.status_code < 500 and resp.status_code != 429:
                        break
                    time.sleep(2**attempt)
                body = resp.json()
                if "error" in body:
                    raise MetaError(body["error"].get("message", "Meta API error"))
                for o in body.get("data", []):
                    rec = {
                        "account_id": account_id,
                        "status": o.get("effective_status"),
                        "created": (o.get("created_time") or "")[:10] or None,
                    }
                    for k in ("name", "objective", "campaign_id", "adset_id"):
                        if o.get(k):
                            rec[k] = o[k]
                    for k in ("daily_budget", "lifetime_budget"):
                        v = int(o.get(k) or 0)
                        if v:
                            rec[k] = v / 100
                    out[kind][o["id"]] = rec
                url = (body.get("paging") or {}).get("next")
                params = None
    return out


def reach_for(
    token: str, cfg: dict, since: str, until: str, ad_ids: list[str] | None = None
) -> dict:
    """Unique reach and frequency over a whole period, for all ads or a set of
    ads (reach cannot be added up from days or rows, so every rollup asks
    Meta). Summed over the allowlisted accounts, which share no people-level
    de-duplication: across both accounts it is an upper bound."""
    reach = impressions = 0
    for account_id in cfg["accounts"]:
        params = {
            "level": "account",
            "time_range": json.dumps({"since": since, "until": until}),
            "fields": "reach,impressions",
            "access_token": token,
        }
        if ad_ids:
            params["filtering"] = json.dumps(
                [{"field": "ad.id", "operator": "IN", "value": ad_ids}]
            )
        url = f"https://graph.facebook.com/{cfg['graph_api_version']}/{account_id}/insights"
        resp = requests.get(url, params=params, timeout=120)
        body = resp.json()
        if "error" in body:
            raise MetaError(body["error"].get("message", "Meta API error"))
        for r in body.get("data", []):
            reach += int(r.get("reach") or 0)
            impressions += int(r.get("impressions") or 0)
    return {"reach": reach, "impressions": impressions, "frequency": impressions / reach if reach else None}
