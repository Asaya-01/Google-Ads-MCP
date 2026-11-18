"""Read-only clients for the SEO tab.

- Search Console (Search Analytics API, webmasters.readonly)
- GA4 (Analytics Data API and the Admin API's account list, analytics.readonly)
- Chrome UX Report (CrUX API and CrUX History API) and PageSpeed Insights,
  with an API key kept in Secret Manager
- Google Ads Keyword Planner (KeywordPlanIdeaService.GenerateKeywordHistoricalMetrics):
  a lookup only; it creates no keyword plan and changes nothing in the account
- Shopify (ShopifyQL sessions and the blog articles list)

Every call here is a read. Nothing in this module creates, changes or
deletes anything in any of these services.
"""

from __future__ import annotations

import os
import time

import requests

GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly"
GA4_SCOPE = "https://www.googleapis.com/auth/analytics.readonly"
GSC_API = "https://searchconsole.googleapis.com/webmasters/v3"
GA4_DATA = "https://analyticsdata.googleapis.com/v1beta"
GA4_ADMIN = "https://analyticsadmin.googleapis.com/v1beta"
CRUX_API = "https://chromeuxreport.googleapis.com/v1/records"
PSI_API = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed"


class SourceError(RuntimeError):
    pass


# ------------------------------------------------------------------ auth


def scoped_session(scopes: list[str]):
    """An HTTP session as the dashboard's service account with read-only
    scopes. On Cloud Run the service account asks for a short-lived token for
    itself with these scopes (the same binding the Sheets reader uses)."""
    import google.auth
    from google.auth.transport.requests import AuthorizedSession

    source, _ = google.auth.default()
    target = os.environ.get("RUNTIME_SA_EMAIL")
    if target:
        from google.auth import impersonated_credentials

        creds = impersonated_credentials.Credentials(
            source_credentials=source, target_principal=target, target_scopes=scopes, lifetime=3600
        )
    else:
        creds = google.auth.default(scopes=scopes)[0]
    return AuthorizedSession(creds)


def _json(resp, what: str) -> dict:
    try:
        body = resp.json()
    except ValueError:
        body = {}
    if resp.status_code != 200:
        msg = ((body.get("error") or {}).get("message") if isinstance(body.get("error"), dict) else body.get("error")) or ""
        raise SourceError(f"{what}: HTTP {resp.status_code}{': ' + str(msg)[:300] if msg else ''}")
    return body


# ------------------------------------------------------------ Search Console


def gsc_sites(sess) -> list[dict]:
    return _json(sess.get(f"{GSC_API}/sites", timeout=60), "Search Console sites").get("siteEntry") or []


def gsc_pick_site(sites: list[dict], domain: str, prefer: str | None = None) -> str | None:
    """The property to read: the one set in config, else the domain property,
    else the https URL-prefix property for the site (with or without www)."""
    have = {s.get("siteUrl"): s.get("permissionLevel") for s in sites if s.get("permissionLevel") != "siteUnverifiedUser"}
    if prefer:
        return prefer if prefer in have else None
    for cand in (f"sc-domain:{domain}", f"https://{domain}/", f"https://www.{domain}/", f"http://{domain}/", f"http://www.{domain}/"):
        if cand in have:
            return cand
    return None


def gsc_query(sess, site: str, body: dict, max_rows: int = 25000) -> list[dict]:
    """Search Analytics rows, paged 25,000 at a time up to max_rows."""
    from urllib.parse import quote

    url = f"{GSC_API}/sites/{quote(site, safe='')}/searchAnalytics/query"
    rows: list[dict] = []
    start = 0
    while start < max_rows:
        page = {**body, "rowLimit": min(25000, max_rows - start), "startRow": start}
        for attempt in range(4):
            resp = sess.post(url, json=page, timeout=120)
            if resp.status_code not in (429, 500, 503):
                break
            time.sleep(2 ** attempt * 2)
        got = _json(resp, "Search Console query").get("rows") or []
        rows.extend(got)
        if len(got) < page["rowLimit"]:
            break
        start += len(got)
    return rows


# ------------------------------------------------------------------- GA4


def ga4_properties(sess) -> list[dict]:
    """[{property: "properties/123", name, account}] the service account can read."""
    out, token = [], None
    while True:
        url = f"{GA4_ADMIN}/accountSummaries?pageSize=200" + (f"&pageToken={token}" if token else "")
        body = _json(sess.get(url, timeout=60), "GA4 account list")
        for a in body.get("accountSummaries") or []:
            for p in a.get("propertySummaries") or []:
                out.append({"property": p.get("property"), "name": p.get("displayName"), "account": a.get("displayName")})
        token = body.get("nextPageToken")
        if not token:
            return out


def ga4_pick_property(props: list[dict], prefer: str | None, hint: str) -> str | None:
    if prefer:
        p = prefer if str(prefer).startswith("properties/") else f"properties/{prefer}"
        return p
    if len(props) == 1:
        return props[0]["property"]
    for p in props:
        if hint.lower() in f"{p.get('name')} {p.get('account')}".lower():
            return p["property"]
    return props[0]["property"] if props else None


def ga4_report(sess, prop: str, body: dict) -> list[dict]:
    """runReport rows as dicts {dimension or metric name: value}."""
    resp = sess.post(f"{GA4_DATA}/{prop}:runReport", json={"limit": 100000, **body}, timeout=120)
    data = _json(resp, "GA4 report")
    dims = [h["name"] for h in data.get("dimensionHeaders") or []]
    mets = [h["name"] for h in data.get("metricHeaders") or []]
    out = []
    for r in data.get("rows") or []:
        row = {d: v.get("value") for d, v in zip(dims, r.get("dimensionValues") or [])}
        for m, v in zip(mets, r.get("metricValues") or []):
            try:
                row[m] = float(v.get("value"))
            except (TypeError, ValueError):
                row[m] = None
        out.append(row)
    return out


# ------------------------------------------------------------ CrUX and PSI


def _get_key(name: str) -> str | None:
    from .. import secrets

    return secrets.get_secret(name)


def crux(key: str, body: dict, history: bool = False) -> dict | None:
    """One CrUX record (or its history). None when Chrome has too little
    traffic for that origin / page (HTTP 404)."""
    url = f"{CRUX_API}:{'queryHistoryRecord' if history else 'queryRecord'}?key={key}"
    for attempt in range(4):
        resp = requests.post(url, json=body, timeout=60)
        if resp.status_code != 429:
            break
        time.sleep(5 * (attempt + 1))
    if resp.status_code == 404:
        return None
    return _json(resp, "Chrome UX Report").get("record")


def psi(key: str, url: str, strategy: str) -> dict:
    params = {"url": url, "strategy": strategy, "category": "performance"}
    if key:
        params["key"] = key
    last = None
    for attempt in range(3):
        try:
            resp = requests.get(PSI_API, params=params, timeout=180)
        except requests.RequestException as exc:
            last = exc
            time.sleep(10)
            continue
        if resp.status_code in (429, 500, 503):
            time.sleep(15 * (attempt + 1))
            last = SourceError(f"PageSpeed Insights: HTTP {resp.status_code}")
            continue
        return _json(resp, "PageSpeed Insights")
    raise SourceError(str(last))


# -------------------------------------------------------- Keyword Planner


def keyword_history(gcfg: dict, creds: dict, keywords: list[str], geo: str, language: str | None, network: str) -> list[dict]:
    """Keyword Planner's monthly searches for each keyword (last 12 months).
    A lookup: no keyword plan is created in the account. Needs Basic or
    Standard API access on the Cloud project (Explorer access cannot call
    Keyword Planner). Like the rest of the dashboard, no developer token is
    sent: access levels belong to the Cloud project since Sep 2026."""
    from .. import google_ads

    token = google_ads.access_token(creds["client_id"], creds["client_secret"], creds["refresh_token"])
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    if gcfg.get("login_customer_id"):
        headers["login-customer-id"] = str(gcfg["login_customer_id"])
    url = f"https://googleads.googleapis.com/{gcfg['api_version']}/customers/{gcfg['account_id']}:generateKeywordHistoricalMetrics"
    out: list[dict] = []
    for i in range(0, len(keywords), 1000):
        body = {"keywords": keywords[i:i + 1000], "geoTargetConstants": [geo], "keywordPlanNetwork": network}
        if language:
            body["language"] = language
        for attempt in range(4):
            resp = requests.post(url, headers=headers, json=body, timeout=120)
            if resp.status_code not in (429, 500, 503):
                break
            time.sleep(2 ** attempt * 3)
        try:
            data = resp.json()
        except ValueError:
            data = {}
        if resp.status_code != 200:
            err = data.get("error") or {}
            detail = ""
            for d in err.get("details") or []:
                for e in d.get("errors") or []:
                    detail = e.get("message") or detail
            raise SourceError(f"Keyword Planner: HTTP {resp.status_code}: {detail or err.get('message') or 'error'}")
        out.extend(data.get("results") or [])
    return out


# ---------------------------------------------------------------- Shopify


def shopify_client():
    from .. import secrets, settings
    from ..shopify import Shopify

    scfg = settings.config()["shopify"]
    cid, sec = secrets.get_secret(scfg["client_id_secret"]), secrets.get_secret(scfg["client_secret_secret"])
    if not (cid and sec):
        raise SourceError("Shopify client ID / secret not in Secret Manager")
    return Shopify(scfg["store"], scfg["api_version"], cid, sec)


def _q(values: list[str]) -> str:
    return ", ".join("'" + v.replace("'", "") + "'" for v in values)


def shopify_search_ai_sessions(shop, since: str, until: str, ai_referrers: list[str], ai_utm: list[str]) -> list[dict]:
    """Daily sessions from search engines and AI assistants (ShopifyQL, read only)."""
    rows = shop.shopifyql(
        "FROM sessions SHOW sessions, sessions_with_cart_additions, sessions_that_completed_checkout "
        "GROUP BY referrer_source, referrer_name, utm_source, utm_medium "
        f"WHERE referrer_source = 'search' OR referrer_name IN ({_q(ai_referrers)}) OR utm_source IN ({_q(ai_utm)}) "
        f"TIMESERIES day SINCE {since} UNTIL {until} ORDER BY sessions DESC LIMIT 20000"
    )
    return [
        {
            "date": str(r.get("day") or "")[:10],
            "referrer_source": (r.get("referrer_source") or "").lower(),
            "referrer_name": (r.get("referrer_name") or "").lower(),
            "utm_source": (r.get("utm_source") or "").lower(),
            "utm_medium": (r.get("utm_medium") or "").lower(),
            "sessions": int(float(r.get("sessions") or 0)),
            "atc": int(float(r.get("sessions_with_cart_additions") or 0)),
            "checkout": int(float(r.get("sessions_that_completed_checkout") or 0)),
        }
        for r in rows
        if r.get("day")
    ]


def shopify_ai_landing(shop, since: str, until: str, ai_referrers: list[str], ai_utm: list[str]) -> list[dict]:
    rows = shop.shopifyql(
        "FROM sessions SHOW sessions, sessions_with_cart_additions GROUP BY landing_page_path "
        f"WHERE referrer_name IN ({_q(ai_referrers)}) OR utm_source IN ({_q(ai_utm)}) "
        f"SINCE {since} UNTIL {until} ORDER BY sessions DESC LIMIT 50"
    )
    return [{"path": r.get("landing_page_path") or "", "sessions": int(float(r.get("sessions") or 0)),
             "atc": int(float(r.get("sessions_with_cart_additions") or 0))} for r in rows]


def shopify_articles(shop, limit: int = 5000) -> list[dict]:
    """Published blog articles: handle, blog and publish date only."""
    out, after = [], None
    q = ("query($after: String) { articles(first: 100, after: $after, sortKey: PUBLISHED_AT, reverse: true) "
         "{ nodes { handle publishedAt isPublished blog { handle title } } pageInfo { hasNextPage endCursor } } }")
    while len(out) < limit:
        data = shop.graphql(q, {"after": after})["articles"]
        for n in data.get("nodes") or []:
            if n.get("publishedAt") and n.get("isPublished", True):
                out.append({"handle": n.get("handle"), "blog": (n.get("blog") or {}).get("handle"),
                            "blog_title": (n.get("blog") or {}).get("title"), "published": n["publishedAt"][:10]})
        if not (data.get("pageInfo") or {}).get("hasNextPage"):
            break
        after = data["pageInfo"]["endCursor"]
    return out
