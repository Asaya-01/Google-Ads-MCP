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


def fetch_campaign_names(
    cfg: dict, creds: dict, ids: list[str]
) -> dict[str, str]:
    """Names for campaign IDs the BigQuery copy does not know, including
    removed campaigns. IDs Google does not return are simply absent."""
    ids = [i for i in ids if str(i).isdigit()]
    if not ids:
        return {}
    rows = _search_stream(
        cfg,
        creds,
        "SELECT campaign.id, campaign.name FROM campaign "
        f"WHERE campaign.id IN ({', '.join(ids)})",
    )
    return {
        str(r["campaign"]["id"]): r["campaign"].get("name") or "" for r in rows
    }


_TREE_METRICS = (
    "metrics.cost_micros, metrics.impressions, metrics.clicks, "
    "metrics.conversions, metrics.conversions_value"
)


def _tree_row(r: dict) -> dict:
    m = r.get("metrics") or {}
    return {
        "date": r["segments"]["date"],
        "campaign_id": str((r.get("campaign") or {}).get("id", "")),
        "spend": int(m.get("costMicros") or 0) / 1_000_000,
        "impressions": int(m.get("impressions") or 0),
        "clicks": int(m.get("clicks") or 0),
        "conversions": float(m.get("conversions") or 0),
        "conversion_value": float(m.get("conversionsValue") or 0),
    }


def fetch_tree(cfg: dict, creds: dict, since: str, until: str) -> list[dict]:
    """The levels under a campaign, one row per day:
      ad_group    ad groups (Search, Demand Gen, ...)
      asset_group Performance Max asset groups
      ad          ads inside ad groups
    Google reports no spend per asset in Performance Max, so an asset group
    has no ads below it."""
    where = (
        f"WHERE segments.date BETWEEN '{since}' AND '{until}' "
        "AND metrics.impressions > 0"
    )
    out: list[dict] = []
    for r in _search_stream(
        cfg,
        creds,
        "SELECT segments.date, campaign.id, ad_group.id, ad_group.name, "
        f"{_TREE_METRICS} FROM ad_group {where}",
    ):
        row = _tree_row(r)
        g = r.get("adGroup") or {}
        out.append(
            {
                **row,
                "level": "ad_group",
                "group_id": str(g.get("id", "")),
                "group_name": g.get("name") or "",
            }
        )
    for r in _search_stream(
        cfg,
        creds,
        "SELECT segments.date, campaign.id, asset_group.id, asset_group.name, "
        f"{_TREE_METRICS} FROM asset_group {where}",
    ):
        row = _tree_row(r)
        g = r.get("assetGroup") or {}
        out.append(
            {
                **row,
                "level": "asset_group",
                "group_id": str(g.get("id", "")),
                "group_name": g.get("name") or "",
            }
        )
    for r in _search_stream(
        cfg,
        creds,
        "SELECT segments.date, campaign.id, ad_group.id, "
        "ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.ad.type, "
        f"{_TREE_METRICS} FROM ad_group_ad {where}",
    ):
        row = _tree_row(r)
        ad = (r.get("adGroupAd") or {}).get("ad") or {}
        out.append(
            {
                **row,
                "level": "ad",
                "group_id": str((r.get("adGroup") or {}).get("id", "")),
                "ad_id": str(ad.get("id", "")),
                "ad_name": ad.get("name") or "",
                "ad_type": ad.get("type") or "",
            }
        )
    return out


# ---------------------------------------------------------------------------
# Google Ads view (Marketing › Google): the reports below are pipeline
# additions, each switched on in config google_ads.reports. All are reads
# (GAQL SELECT); nothing here writes to the account.

def _num(m: dict) -> dict:
    return {
        "cost": int(m.get("costMicros") or 0) / 1_000_000,
        "impr": int(m.get("impressions") or 0),
        "clicks": int(m.get("clicks") or 0),
        "conv": float(m.get("conversions") or 0),
        "value": float(m.get("conversionsValue") or 0),
    }


_BASE = (
    "metrics.cost_micros, metrics.impressions, metrics.clicks, "
    "metrics.conversions, metrics.conversions_value"
)
# level -> (resource, id fields selected, how to read the ids back)
_LEVELS = {
    "campaign": ("campaign", "campaign.id", lambda r: str(r["campaign"]["id"])),
    "ad_group": ("ad_group", "campaign.id, ad_group.id", lambda r: str(r["adGroup"]["id"])),
    "asset_group": ("asset_group", "campaign.id, asset_group.id", lambda r: str(r["assetGroup"]["id"])),
    "ad": ("ad_group_ad", "campaign.id, ad_group.id, ad_group_ad.ad.id", lambda r: str(r["adGroupAd"]["ad"]["id"])),
    "keyword": ("keyword_view", "campaign.id, ad_group.id, ad_group_criterion.criterion_id",
                lambda r: f'{r["adGroup"]["id"]}~{r["adGroupCriterion"]["criterionId"]}'),
    "product": ("shopping_performance_view", "campaign.id, segments.product_item_id",
                lambda r: f'{r["campaign"]["id"]}|{r["segments"].get("productItemId") or ""}'),
}


def _where(since: str, until: str, extra: str = "") -> str:
    return f"WHERE segments.date BETWEEN '{since}' AND '{until}'" + (f" AND {extra}" if extra else "")


def fetch_conv_split(cfg: dict, creds: dict, since: str, until: str, levels: list[str]) -> list[dict]:
    """Conversions and value by conversion-action category, per level and
    day, so the view can count the purchase action only (an awareness
    campaign can bid on add-to-cart, which Google also counts in
    metrics.conversions). Rows: {level, id, date, cat, conv, value}."""
    out: list[dict] = []
    for lvl in levels:
        res, ids, key = _LEVELS[lvl]
        for r in _search_stream(
            cfg, creds,
            f"SELECT segments.date, {ids}, segments.conversion_action_category, "
            f"metrics.conversions, metrics.conversions_value FROM {res} "
            + _where(since, until, "metrics.conversions > 0"),
        ):
            m = r.get("metrics") or {}
            out.append({
                "level": lvl, "id": key(r), "date": r["segments"]["date"],
                "cat": r["segments"].get("conversionActionCategory") or "UNKNOWN",
                "conv": float(m.get("conversions") or 0),
                "value": float(m.get("conversionsValue") or 0),
            })
    return out


_IS = (
    "metrics.search_impression_share, metrics.search_absolute_top_impression_share, "
    "metrics.search_top_impression_share, metrics.search_rank_lost_impression_share"
)


def fetch_impression_share(cfg: dict, creds: dict, since: str, until: str) -> list[dict]:
    """Search impression-share fields per Search campaign and ad group per
    day. Lost IS (budget) is reported at campaign level only. Rows carry the
    impressions too, so the shares can be re-weighted over any period."""
    out: list[dict] = []
    for lvl, res, ids, extra in (
        ("campaign", "campaign", "campaign.id", ", metrics.search_budget_lost_impression_share"),
        ("ad_group", "ad_group", "campaign.id, ad_group.id", ""),
    ):
        key = _LEVELS[lvl][2]
        for r in _search_stream(
            cfg, creds,
            f"SELECT segments.date, {ids}, metrics.impressions, {_IS}{extra} FROM {res} "
            + _where(since, until, "campaign.advertising_channel_type = 'SEARCH' AND metrics.impressions > 0"),
        ):
            m = r.get("metrics") or {}
            f = lambda k: m.get(k)  # noqa: E731
            out.append({
                "level": lvl, "id": key(r), "date": r["segments"]["date"],
                "impr": int(m.get("impressions") or 0),
                "is": f("searchImpressionShare"), "abs_top": f("searchAbsoluteTopImpressionShare"),
                "top": f("searchTopImpressionShare"), "lost_rank": f("searchRankLostImpressionShare"),
                "lost_budget": f("searchBudgetLostImpressionShare"),
            })
    return out


def fetch_objects(cfg: dict, creds: dict) -> dict:
    """Status, budget, bidding and strength of every campaign, ad group,
    asset group and ad (current values, not history)."""
    camps = {}
    for r in _search_stream(
        cfg, creds,
        "SELECT campaign.id, campaign.name, campaign.status, campaign.serving_status, "
        "campaign.primary_status, campaign.primary_status_reasons, campaign.bidding_strategy_type, "
        "campaign.advertising_channel_type, campaign.advertising_channel_sub_type, "
        "campaign.start_date_time, campaign.end_date_time, campaign_budget.amount_micros, "
        "campaign_budget.total_amount_micros, campaign_budget.period, "
        "campaign.maximize_conversion_value.target_roas, campaign.target_roas.target_roas "
        "FROM campaign WHERE campaign.status != 'REMOVED'",
    ):
        c, b = r.get("campaign") or {}, r.get("campaignBudget") or {}
        troas = (c.get("maximizeConversionValue") or {}).get("targetRoas") or (c.get("targetRoas") or {}).get("targetRoas")
        camps[str(c["id"])] = {
            "name": c.get("name"), "status": c.get("status"), "serving": c.get("servingStatus"),
            "primary": c.get("primaryStatus"), "reasons": c.get("primaryStatusReasons") or [],
            "bidding": c.get("biddingStrategyType"),
            "channel": c.get("advertisingChannelType"), "sub_channel": c.get("advertisingChannelSubType"),
            "start": (c.get("startDateTime") or "")[:10] or None, "end": (c.get("endDateTime") or "")[:10] or None,
            "budget_day": int(b.get("amountMicros") or 0) / 1e6 or None,
            "budget_total": int(b.get("totalAmountMicros") or 0) / 1e6 or None,
            "budget_period": b.get("period"), "target_roas": troas or None,
        }
    groups = {}
    for r in _search_stream(
        cfg, creds,
        "SELECT campaign.id, ad_group.id, ad_group.name, ad_group.status, ad_group.type, "
        "ad_group.primary_status FROM ad_group WHERE ad_group.status != 'REMOVED'",
    ):
        g = r["adGroup"]
        groups[str(g["id"])] = {"campaign_id": str(r["campaign"]["id"]), "name": g.get("name"),
                                "status": g.get("status"), "type": g.get("type"), "primary": g.get("primaryStatus")}
    asset_groups = {}
    for r in _search_stream(
        cfg, creds,
        "SELECT campaign.id, asset_group.id, asset_group.name, asset_group.status, "
        "asset_group.ad_strength, asset_group.primary_status FROM asset_group "
        "WHERE asset_group.status != 'REMOVED'",
    ):
        g = r["assetGroup"]
        asset_groups[str(g["id"])] = {"campaign_id": str(r["campaign"]["id"]), "name": g.get("name"),
                                      "status": g.get("status"), "strength": g.get("adStrength"),
                                      "primary": g.get("primaryStatus")}
    ads = {}
    for r in _search_stream(
        cfg, creds,
        "SELECT ad_group.id, ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.ad.type, "
        "ad_group_ad.status, ad_group_ad.ad_strength, ad_group_ad.primary_status, "
        "ad_group_ad.ad.final_urls FROM ad_group_ad WHERE ad_group_ad.status != 'REMOVED'",
    ):
        a = r["adGroupAd"]
        ads[str(a["ad"]["id"])] = {"group_id": str(r["adGroup"]["id"]), "name": a["ad"].get("name"),
                                   "type": a["ad"].get("type"), "status": a.get("status"),
                                   "strength": a.get("adStrength"), "primary": a.get("primaryStatus"),
                                   "url": (a["ad"].get("finalUrls") or [None])[0]}
    return {"campaigns": camps, "ad_groups": groups, "asset_groups": asset_groups, "ads": ads}


def fetch_keywords(cfg: dict, creds: dict, since: str, until: str) -> list[dict]:
    """Keywords per day with their impression share; Quality Score and its
    three parts are today's values (Google keeps no history of them)."""
    out = []
    for r in _search_stream(
        cfg, creds,
        "SELECT segments.date, campaign.id, ad_group.id, ad_group_criterion.criterion_id, "
        "ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, "
        "ad_group_criterion.status, ad_group_criterion.negative, "
        "ad_group_criterion.quality_info.quality_score, "
        "ad_group_criterion.quality_info.creative_quality_score, "
        "ad_group_criterion.quality_info.post_click_quality_score, "
        "ad_group_criterion.quality_info.search_predicted_ctr, "
        f"{_BASE}, {_IS} FROM keyword_view " + _where(since, until, "metrics.impressions > 0"),
    ):
        c, m = r["adGroupCriterion"], r.get("metrics") or {}
        q = c.get("qualityInfo") or {}
        out.append({
            "date": r["segments"]["date"], "campaign_id": str(r["campaign"]["id"]),
            "group_id": str(r["adGroup"]["id"]), "id": f'{r["adGroup"]["id"]}~{c["criterionId"]}',
            "text": (c.get("keyword") or {}).get("text"), "match": (c.get("keyword") or {}).get("matchType"),
            "status": c.get("status"), "qs": q.get("qualityScore"), "qs_rel": q.get("creativeQualityScore"),
            "qs_lp": q.get("postClickQualityScore"), "qs_ctr": q.get("searchPredictedCtr"),
            "is": m.get("searchImpressionShare"), "abs_top": m.get("searchAbsoluteTopImpressionShare"),
            "lost_rank": m.get("searchRankLostImpressionShare"), **_num(m),
        })
    return out


def fetch_search_terms(cfg: dict, creds: dict, since: str, until: str) -> list[dict]:
    """What people typed, per ad group and day, with the keyword that
    matched it. Google withholds low-volume terms, so these never add up to
    the keyword totals; the view shows the gap."""
    out = []
    for r in _search_stream(
        cfg, creds,
        "SELECT segments.date, campaign.id, ad_group.id, search_term_view.search_term, "
        "search_term_view.status, segments.search_term_match_type, "
        "segments.keyword.ad_group_criterion, segments.keyword.info.text, "
        f"segments.keyword.info.match_type, {_BASE} FROM search_term_view "
        + _where(since, until, "metrics.impressions > 0"),
    ):
        s, seg = r.get("searchTermView") or {}, r["segments"]
        kw = seg.get("keyword") or {}
        crit = (kw.get("adGroupCriterion") or "").rsplit("/", 1)[-1] or None
        out.append({
            "date": seg["date"], "campaign_id": str(r["campaign"]["id"]), "group_id": str(r["adGroup"]["id"]),
            "term": s.get("searchTerm") or "", "status": s.get("status"),
            "match": seg.get("searchTermMatchType"), "kw_id": crit,
            "kw_text": (kw.get("info") or {}).get("text"), **_num(r.get("metrics") or {}),
        })
    return out


def fetch_products(cfg: dict, creds: dict, since: str, until: str) -> list[dict]:
    """Shopping products (Performance Max, Demand Gen) per campaign and day.
    The item ID is shopify_zz_<product id>_<variant id>. Product impressions
    are not additive (one product can fill many slots)."""
    out = []
    for r in _search_stream(
        cfg, creds,
        "SELECT segments.date, campaign.id, segments.product_item_id, segments.product_title, "
        f"{_BASE} FROM shopping_performance_view " + _where(since, until, "metrics.impressions > 0"),
    ):
        seg = r["segments"]
        out.append({"date": seg["date"], "campaign_id": str(r["campaign"]["id"]),
                    "item": seg.get("productItemId") or "", "title": seg.get("productTitle") or "",
                    **_num(r.get("metrics") or {})})
    return out


def fetch_assets(cfg: dict, creds: dict, since: str, until: str) -> list[dict]:
    """Asset rows per day: Performance Max asset groups (asset_group_asset)
    and the assets of ads in ad groups (ad_group_ad_asset_view). An asset's
    numbers are the impressions of the combinations it served in, so they
    overlap and never add up to the parent."""
    out = []
    for r in _search_stream(
        cfg, creds,
        "SELECT segments.date, campaign.id, asset_group.id, asset.id, asset.type, asset.name, "
        "asset.text_asset.text, asset.youtube_video_asset.youtube_video_title, "
        "asset_group_asset.field_type, metrics.cost_micros, metrics.impressions, metrics.clicks, "
        "metrics.conversions, metrics.conversions_value FROM asset_group_asset "
        + _where(since, until, "metrics.impressions > 0"),
    ):
        a = r.get("asset") or {}
        out.append({"date": r["segments"]["date"], "campaign_id": str(r["campaign"]["id"]),
                    "parent": "asg:" + str(r["assetGroup"]["id"]), "asset_id": str(a.get("id")),
                    "type": a.get("type"), "field": (r.get("assetGroupAsset") or {}).get("fieldType"),
                    "label": None,
                    "text": (a.get("textAsset") or {}).get("text") or (a.get("youtubeVideoAsset") or {}).get("youtubeVideoTitle") or a.get("name") or "",
                    **_num(r.get("metrics") or {})})
    for r in _search_stream(
        cfg, creds,
        "SELECT segments.date, campaign.id, ad_group_ad.ad.id, asset.id, asset.type, asset.name, "
        "asset.text_asset.text, asset.youtube_video_asset.youtube_video_title, "
        "ad_group_ad_asset_view.field_type, ad_group_ad_asset_view.performance_label, "
        "metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.conversions, "
        "metrics.conversions_value FROM ad_group_ad_asset_view "
        + _where(since, until, "metrics.impressions > 0"),
    ):
        a, v = r.get("asset") or {}, r.get("adGroupAdAssetView") or {}
        label = v.get("performanceLabel")
        out.append({"date": r["segments"]["date"], "campaign_id": str(r["campaign"]["id"]),
                    "parent": "ad:" + str(r["adGroupAd"]["ad"]["id"]), "asset_id": str(a.get("id")),
                    "type": a.get("type"), "field": v.get("fieldType"),
                    "label": None if label in (None, "NOT_APPLICABLE", "UNSPECIFIED", "UNKNOWN") else label,
                    "text": (a.get("textAsset") or {}).get("text") or (a.get("youtubeVideoAsset") or {}).get("youtubeVideoTitle") or a.get("name") or "",
                    **_num(r.get("metrics") or {})})
    return out


def fetch_video(cfg: dict, creds: dict, since: str, until: str) -> list[dict]:
    """TrueView views and the 25/50/75/100% watch counts (rate × impressions,
    so they can be summed) per campaign, ad group and ad per day."""
    out = []
    q = ("metrics.impressions, metrics.video_trueview_views, metrics.video_quartile_p25_rate, "
         "metrics.video_quartile_p50_rate, metrics.video_quartile_p75_rate, metrics.video_quartile_p100_rate")
    for lvl in ("campaign", "ad_group", "ad"):
        res, ids, key = _LEVELS[lvl]
        for r in _search_stream(
            cfg, creds,
            f"SELECT segments.date, {ids}, {q} FROM {res} "
            + _where(since, until, "metrics.video_trueview_views > 0"),
        ):
            m = r.get("metrics") or {}
            imp = int(m.get("impressions") or 0)
            out.append({"level": lvl, "id": key(r), "date": r["segments"]["date"],
                        "views": int(m.get("videoTrueviewViews") or 0),
                        **{f"q{p}": round(float(m.get(f"videoQuartileP{p}Rate") or 0) * imp, 1) for p in (25, 50, 75, 100)}})
    return out


def fetch_insights(cfg: dict, creds: dict, campaign_ids: list[str], since: str, until: str) -> dict:
    """Search query categories of Performance Max campaigns over a period
    (Google gives them only as a period total per campaign, with no cost).
    {campaign id: [[label, impressions, clicks, conversions, value], ...]}"""
    out: dict[str, list] = {}
    for cid in campaign_ids:
        rows = _search_stream(
            cfg, creds,
            "SELECT campaign_search_term_insight.category_label, metrics.impressions, "
            "metrics.clicks, metrics.conversions, metrics.conversions_value "
            "FROM campaign_search_term_insight "
            f"WHERE segments.date BETWEEN '{since}' AND '{until}' "
            f"AND campaign_search_term_insight.campaign_id = '{int(cid)}'",
        )
        out[str(cid)] = [
            [(r.get("campaignSearchTermInsight") or {}).get("categoryLabel") or "",
             int((r.get("metrics") or {}).get("impressions") or 0), int((r.get("metrics") or {}).get("clicks") or 0),
             float((r.get("metrics") or {}).get("conversions") or 0), float((r.get("metrics") or {}).get("conversionsValue") or 0)]
            for r in rows
        ]
    return out


def fetch_reach(cfg: dict, creds: dict, campaign_ids: list[str], since: str, until: str) -> dict:
    """Unique users and impressions per campaign over a period. Unique users
    cannot be added across campaigns: the sum is an upper bound."""
    ids = ", ".join(str(int(c)) for c in campaign_ids)
    rows = _search_stream(
        cfg, creds,
        "SELECT campaign.id, metrics.unique_users, metrics.impressions FROM campaign "
        f"WHERE segments.date BETWEEN '{since}' AND '{until}' AND campaign.id IN ({ids})",
    )
    users = sum(int((r.get("metrics") or {}).get("uniqueUsers") or 0) for r in rows)
    impr = sum(int((r.get("metrics") or {}).get("impressions") or 0) for r in rows)
    return {"reach": users or None, "frequency": (impr / users) if users else None, "campaigns": len(rows)}
