"""The SEO job: python -m app.seo.job   (daily, 08:20 IST)

Reads, each behind its own switch in config.json -> seo.sources:

  gsc              Search Console: daily clicks / impressions / position
                   (all, branded, non-branded), queries and pages for the last
                   28 days against the 28 before
  ga4              GA4: sessions and purchases by channel, AI assistants,
                   landing pages
  crux             Chrome UX Report: real-user p75 LCP, INP, CLS, FCP, TTFB for
                   worldofasaya.com and the competitors, and 40 weeks of history
  psi              PageSpeed Insights: lab tests of the key pages, mobile and desktop
  keyword_planner  Google Ads Keyword Planner: monthly searches for Asaya, the
                   competitors and category keywords (a lookup; needs Basic
                   API access)
  shopify          Shopify sessions from search engines and AI assistants, and
                   the blog articles published

and writes only to the dashboard's bucket:

  pages/seo.json             the tab
  cache/seo/<source>.json    the last good result of each source, so one
                             failing source never blanks the others
  cache/seo/psi_history.json one lab test per page, strategy and day
  cache/seo/run_log.json     every run

Nothing is written to BigQuery or to any of the sources.
"""

from __future__ import annotations

import datetime as dt
import sys
import time
import traceback

from ..store import default_store
from . import CACHE, PAGE_PATH, config, enabled, model
from . import sources as S

IST = dt.timezone(dt.timedelta(hours=5, minutes=30))


def _iso(d: dt.date) -> str:
    return d.isoformat()


# ------------------------------------------------------------------ sources


def pull_gsc(cfg: dict, today: dt.date, src=S) -> dict:
    g = cfg["gsc"]
    sess = src.scoped_session([S.GSC_SCOPE])
    sites = src.gsc_sites(sess)
    site = src.gsc_pick_site(sites, cfg["domain"], g.get("property"))
    if not site:
        seen = ", ".join(s.get("siteUrl", "") for s in sites) or "none"
        raise S.SourceError(f"the service account cannot read a Search Console property for {cfg['domain']} (it can read: {seen})")
    end = today - dt.timedelta(days=g.get("lag_days", 3))
    start = end - dt.timedelta(days=g.get("history_days", 480) - 1)
    base = {"type": "web", "dataState": "final"}
    rx = g["brand_regex"]
    flt = lambda op: [{"filters": [{"dimension": "query", "operator": op, "expression": rx}]}]  # noqa: E731
    day = {**base, "startDate": _iso(start), "endDate": _iso(end), "dimensions": ["date"]}
    total = src.gsc_query(sess, site, day)
    branded = src.gsc_query(sess, site, {**day, "dimensionFilterGroups": flt("includingRegex")})
    nonbranded = src.gsc_query(sess, site, {**day, "dimensionFilterGroups": flt("excludingRegex")})
    daily = model.gsc_daily(total, branded, nonbranded, _iso(start), _iso(end))
    kpis = model.gsc_kpis(daily, _iso(end))
    (cs, ce), (ps, pe) = kpis["window"]["cur"], kpis["window"]["prev"]
    lim = g.get("rows", 5000)
    q_cur = src.gsc_query(sess, site, {**base, "startDate": cs, "endDate": ce, "dimensions": ["query"]}, lim)
    q_prev = src.gsc_query(sess, site, {**base, "startDate": ps, "endDate": pe, "dimensions": ["query"]}, lim)
    p_cur = src.gsc_query(sess, site, {**base, "startDate": cs, "endDate": ce, "dimensions": ["page"]}, lim)
    p_prev = src.gsc_query(sess, site, {**base, "startDate": ps, "endDate": pe, "dimensions": ["page"]}, lim)
    queries = model.merge_periods(q_cur, q_prev, brand_rx=rx, limit=g.get("keep_queries", 600))
    pages = model.merge_periods(p_cur, p_prev, types=cfg["page_types"], limit=g.get("keep_pages", 400))
    q_rows = [{"clicks": int(r["clicks"]), "impressions": int(r["impressions"]), "position": float(r["position"])} for r in q_cur]
    return {
        "site": site, "start": _iso(start), "end": _iso(end), "daily": daily, "kpis": kpis,
        "queries": queries, "pages": pages,
        "buckets": model.position_buckets(q_rows),
        "page_types": model.by_type(model.merge_periods(p_cur, p_prev, types=cfg["page_types"], limit=10 ** 6)),
        "query_count": {"cur": len(q_cur), "prev": len(q_prev), "capped": len(q_cur) >= lim},
    }


def pull_ga4(cfg: dict, today: dt.date, src=S) -> dict:
    g = cfg["ga4"]
    sess = src.scoped_session([S.GA4_SCOPE])
    props = [] if g.get("property") else src.ga4_properties(sess)
    prop = src.ga4_pick_property(props, g.get("property"), g.get("property_hint", "asaya"))
    if not prop:
        raise S.SourceError("the service account cannot see any GA4 property: add it as Viewer in GA4 (Admin › Property access management)")
    end = today - dt.timedelta(days=1)
    start = end - dt.timedelta(days=g.get("history_days", 120) - 1)
    rng = [{"startDate": _iso(start), "endDate": _iso(end)}]
    mets = [{"name": m} for m in ("sessions", "engagedSessions", "ecommercePurchases", "purchaseRevenue")]
    ai_rx = g["ai_source_regex"]
    ai_filter = {"filter": {"fieldName": "sessionSource", "stringFilter": {"matchType": "PARTIAL_REGEXP", "value": ai_rx, "caseSensitive": False}}}
    channels = src.ga4_report(sess, prop, {"dateRanges": rng, "dimensions": [{"name": "date"}, {"name": "sessionDefaultChannelGroup"}], "metrics": mets})
    ai = src.ga4_report(sess, prop, {"dateRanges": rng, "dimensions": [{"name": "date"}, {"name": "sessionSource"}], "metrics": mets, "dimensionFilter": ai_filter})
    l28 = [{"startDate": _iso(end - dt.timedelta(days=27)), "endDate": _iso(end)}]
    order = [{"metric": {"metricName": "sessions"}, "desc": True}]
    organic_lp = src.ga4_report(sess, prop, {"dateRanges": l28, "dimensions": [{"name": "landingPage"}], "metrics": mets, "orderBys": order, "limit": 50,
                                             "dimensionFilter": {"filter": {"fieldName": "sessionDefaultChannelGroup", "stringFilter": {"matchType": "EXACT", "value": "Organic Search"}}}})
    l90 = [{"startDate": _iso(end - dt.timedelta(days=89)), "endDate": _iso(end)}]
    ai_lp = src.ga4_report(sess, prop, {"dateRanges": l90, "dimensions": [{"name": "landingPage"}], "metrics": mets, "orderBys": order, "limit": 50, "dimensionFilter": ai_filter})
    lp = lambda rows: [{"path": r.get("landingPage"), "sessions": int(r.get("sessions") or 0), "engaged": int(r.get("engagedSessions") or 0),  # noqa: E731
                        "purchases": int(r.get("ecommercePurchases") or 0), "revenue": round(r.get("purchaseRevenue") or 0, 2)} for r in rows]
    return {"property": prop, "start": _iso(start), "end": _iso(end),
            "channels": model.ga4_channels(channels), "ai": model.ga4_ai(ai, cfg["ai_platforms"]),
            "organic_landing": lp(organic_lp), "ai_landing": lp(ai_lp)}


def _origin(key: str, domain: str, ff: str, src) -> tuple[str | None, dict | None]:
    for o in (f"https://{domain}", f"https://www.{domain}"):
        rec = src.crux(key, {"origin": o, "formFactor": ff})
        if rec:
            return o, rec
    return None, None


def pull_crux(cfg: dict, key: str, src=S) -> dict:
    th = cfg["speed"]["thresholds"]
    hist_n = cfg["speed"].get("history_weeks", 40)
    own, origin, history, comp, urls = None, {}, {}, [], []
    for b in cfg["brands"]:
        if not b.get("domain"):
            continue
        o, rec = _origin(key, b["domain"], "PHONE", src)
        row = {"brand": b["name"], "own": bool(b.get("own")), "origin": o, "phone": model.crux_current(rec, th)}
        if o:
            hrec = src.crux(key, {"origin": o, "formFactor": "PHONE", "collectionPeriodCount": hist_n}, history=True)
            row["history"] = model.crux_history(hrec)
        if b.get("own") and o:
            own = o
            origin["phone"] = row["phone"]
            origin["desktop"] = model.crux_current(src.crux(key, {"origin": o, "formFactor": "DESKTOP"}), th)
            history = row.get("history") or {}
            dh = model.crux_history(src.crux(key, {"origin": o, "formFactor": "DESKTOP", "collectionPeriodCount": hist_n}, history=True))
            history = {"phone": history, "desktop": dh}
        comp.append(row)
        getattr(src, "pause", time.sleep)(0.5)  # CrUX allows 150 queries a minute
    if own:
        for p in cfg["speed"]["pages"]:
            rec = src.crux(key, {"url": own + p["path"], "formFactor": "PHONE"})
            urls.append({"path": p["path"], "name": p["name"], "phone": model.crux_current(rec, th)})
    return {"origin_url": own, "origin": origin, "history": history, "brands": comp, "urls": urls}


def pull_psi(cfg: dict, key: str, store, today: dt.date, src=S) -> dict:
    site = f"https://{cfg['domain']}"
    hist = (store.get_json(f"{CACHE}/psi_history.json") or {}).get("tests") or []
    done = {(t["path"], t["strategy"]) for t in hist if t["date"] == _iso(today)}
    errors = []
    latest = []
    for p in cfg["speed"]["pages"]:
        for strategy in ("mobile", "desktop"):
            if (p["path"], strategy) in done:
                continue
            try:
                res = src.psi(key, site + p["path"], strategy)
                t = model.psi_summary(res, p["path"], strategy, _iso(today))
                t["name"] = p["name"]
                hist.append(t)
            except Exception as exc:  # one page failing never stops the others
                errors.append(f"{p['path']} ({strategy}): {exc}")
    keep = cfg["speed"].get("psi_history_days", 120)
    cutoff = _iso(today - dt.timedelta(days=keep))
    hist = [t for t in hist if t["date"] >= cutoff]
    store.put_json(f"{CACHE}/psi_history.json", {"tests": hist})
    for p in cfg["speed"]["pages"]:
        for strategy in ("mobile", "desktop"):
            mine = [t for t in hist if t["path"] == p["path"] and t["strategy"] == strategy]
            if mine:
                latest.append(mine[-1])
    trend = [{"date": t["date"], "path": t["path"], "strategy": t["strategy"], "score": t["score"], "lcp": t["lab"]["lcp"], "tbt": t["lab"]["tbt"], "cls": t["lab"]["cls"]} for t in hist]
    if errors and not latest:
        raise S.SourceError("; ".join(errors[:3]))
    return {"latest": latest, "trend": trend, "errors": errors}


def pull_keywords(cfg: dict, src=S) -> dict:
    from .. import secrets, settings

    k = cfg["keyword_planner"]
    gcfg = settings.config()["google_ads"]
    names = ("client_id", "client_secret", "refresh_token")
    # Keyword Planner can use its own OAuth client from a separate Cloud
    # project that holds Basic access, so the dashboard's own project (its
    # sign-in screen and the daily Google Ads pull) never has to change.
    creds = {n: secrets.get_secret(k[f"{n}_secret"]) for n in names} if k.get("client_id_secret") else {}
    if not all(creds.values()):
        creds = {n: secrets.get_secret(gcfg[f"{n}_secret"]) for n in names}
    if not all(creds.values()):
        raise S.SourceError("Google Ads API credentials are not in Secret Manager")
    uniq = _keywords(cfg)
    try:
        res = src.keyword_history(gcfg, creds, uniq, k["geo"], k.get("language"), k.get("network", "GOOGLE_SEARCH"))
    except S.SourceError as exc:
        msg = str(exc)
        if any(t in msg.upper() for t in ("PERMISSION", "NOT_ALLOWED", "ACCESS", "EXPLORER", "403", "UNIMPLEMENTED", "404")):
            msg += (" — Keyword Planner needs Basic API access; the project has Explorer access. Apply for Basic on the "
                    "Google Ads API page in Cloud Console (project asaya-data-room-487110); this section fills in on the next run after it is granted.")
        raise S.SourceError(msg)
    return model.keyword_table(res, cfg["brands"], cfg.get("category_keywords") or [])


def _keywords(cfg: dict) -> list[str]:
    words = []
    for b in cfg["brands"]:
        words += b.get("keywords") or []
    words += cfg.get("category_keywords") or []
    seen, uniq = set(), []
    for w in words:
        if w.lower() not in seen:
            seen.add(w.lower())
            uniq.append(w)
    return uniq


def pull_dataforseo(cfg: dict, src=S) -> dict:
    from .. import secrets

    d = cfg["dataforseo"]
    login, password = secrets.get_secret(d["login_secret"]), secrets.get_secret(d["password_secret"])
    if not (login and password):
        raise S.SourceError(f"DataForSEO API login / password are not in Secret Manager ({d['login_secret']}, {d['password_secret']})")
    res = src.dataforseo_volume(login, password, _keywords(cfg), d["location_code"], d.get("language_code"))
    return model.keyword_table(res, cfg["brands"], cfg.get("category_keywords") or [])


def pull_shopify(cfg: dict, today: dt.date, src=S) -> dict:
    sh = cfg["shopify"]
    shop = src.shopify_client()
    end = today - dt.timedelta(days=1)
    start = end - dt.timedelta(days=sh.get("history_days", 120) - 1)
    refs = [r for p in cfg["ai_platforms"] for r in p.get("referrer_names") or []]
    utms = [u for p in cfg["ai_platforms"] for u in p.get("utm_sources") or []]
    rows = src.shopify_search_ai_sessions(shop, _iso(start), _iso(end), refs, utms)
    out = {"start": _iso(start), "end": _iso(end), **model.shopify_series(rows, cfg["ai_platforms"])}
    out["ai_landing"] = src.shopify_ai_landing(shop, _iso(end - dt.timedelta(days=89)), _iso(end), refs, utms)
    try:
        out["content"] = model.content_months(src.shopify_articles(shop))
    except Exception as exc:  # the app may not have read_content; the rest stands
        out["content_error"] = f"{type(exc).__name__}: {exc}"
    return out


# ------------------------------------------------------------------ run


def _source(store, name: str, cfg: dict, fn, status: dict, max_age_days: int | None = None, now: dt.datetime | None = None):
    """Run one source; on failure fall back to its last good result."""
    path = f"{CACHE}/{name}.json"
    if not enabled(cfg, name):
        status[name] = {"status": "off", "detail": "switched off in config.json (seo.sources)"}
        return None
    cached = store.get_json(path)
    if max_age_days and cached and now:
        age = (now - dt.datetime.fromisoformat(cached["at"])).total_seconds() / 86400
        if age < max_age_days:
            status[name] = {"status": "ok", "at": cached["at"], "detail": f"kept from {cached['at'][:10]} (refreshed every {max_age_days} days)"}
            return cached["data"]
    t0 = time.time()
    try:
        data = fn()
        at = (now or dt.datetime.now(dt.timezone.utc)).isoformat()
        store.put_json(path, {"at": at, "data": data})
        status[name] = {"status": "ok", "at": at, "seconds": round(time.time() - t0, 1)}
        return data
    except Exception as exc:
        err = f"{type(exc).__name__}: {exc}"
        print(f"seo {name} failed: {err}\n{traceback.format_exc()}", file=sys.stderr)
        status[name] = {"status": "error", "error": err[:600], "stale_from": (cached or {}).get("at")}
        return (cached or {}).get("data")


def run(store, now: dt.datetime, src=S, api_key_fn=None) -> dict:
    cfg = config()
    today = now.astimezone(IST).date()
    status: dict = {}
    t0 = time.time()
    key = None
    if enabled(cfg, "crux") or enabled(cfg, "psi"):
        try:
            key = (api_key_fn or S._get_key)(cfg["api_key_secret"])
        except Exception as exc:
            key, key_err = None, str(exc)
        else:
            key_err = None if key else f"secret {cfg['api_key_secret']} is empty or missing"

    def need_key(fn):
        def go():
            if not key:
                raise S.SourceError(f"no API key for PageSpeed / CrUX: {key_err}")
            return fn()
        return go

    gsc = _source(store, "gsc", cfg, lambda: pull_gsc(cfg, today, src), status, now=now)
    ga4 = _source(store, "ga4", cfg, lambda: pull_ga4(cfg, today, src), status, now=now)
    crux = _source(store, "crux", cfg, need_key(lambda: pull_crux(cfg, key, src)), status, now=now)
    # PageSpeed Insights also answers without a key (on a small shared quota),
    # so the lab tests run while the key is not set up yet
    psi = _source(store, "psi", cfg, lambda: pull_psi(cfg, key, store, today, src), status, now=now)
    if not key and status.get("psi", {}).get("status") == "ok":
        status["psi"]["detail"] = "run without an API key (shared quota): run tools/make_api_key.sh for a dedicated one"
    # monthly searches: DataForSEO (Keyword Planner's numbers, no Basic access
    # needed) when it is on, else Keyword Planner straight from Google Ads
    dfs = _source(store, "dataforseo", cfg, lambda: pull_dataforseo(cfg, src), status,
                  max_age_days=cfg["dataforseo"].get("refresh_days", 7), now=now)
    kp = _source(store, "keyword_planner", cfg, lambda: pull_keywords(cfg, src), status,
                 max_age_days=cfg["keyword_planner"].get("refresh_days", 7), now=now)
    demand = dfs or kp
    shop = _source(store, "shopify", cfg, lambda: pull_shopify(cfg, today, src), status, now=now)
    orders = model.channel_orders(store.get_json("pages/channel_days.json"), cfg.get("order_channels") or [])

    page = {
        "title": "SEO / AEO / GEO",
        "built_at": now.isoformat(),
        "as_of": _iso(today - dt.timedelta(days=1)),
        "sources": status,
        "settings": {
            "domain": cfg["domain"], "brands": [{"name": b["name"], "own": bool(b.get("own")), "domain": b.get("domain")} for b in cfg["brands"]],
            "thresholds": cfg["speed"]["thresholds"], "speed_pages": cfg["speed"]["pages"],
            "ai_platforms": [p["name"] for p in cfg["ai_platforms"]], "brand_regex": cfg["gsc"]["brand_regex"],
            "category_keywords": cfg.get("category_keywords") or [], "order_channels": cfg.get("order_channels") or [],
        },
        "gsc": gsc, "ga4": ga4, "demand": demand, "shopify": shop, "orders": orders,
        "speed": {"origin": (crux or {}).get("origin"), "history": (crux or {}).get("history"), "brands": (crux or {}).get("brands"),
                  "urls": (crux or {}).get("urls"), "origin_url": (crux or {}).get("origin_url"), "psi": psi},
    }
    page["alerts"] = model.alerts({**page, "speed": {**page["speed"], "history": ((crux or {}).get("history") or {}).get("phone")}}, cfg)
    log = {"job": "seo", "run_time": now.isoformat(), "duration_s": round(time.time() - t0, 1),
           "status": "ok" if all(s["status"] != "error" for s in status.values()) else "partial",
           "errors": {k: v["error"] for k, v in status.items() if v["status"] == "error"}}
    runs = ((store.get_json(f"{CACHE}/run_log.json") or {}).get("runs") or [])
    runs = ([log] + runs)[:200]
    store.put_json(f"{CACHE}/run_log.json", {"runs": runs})
    page["run_log"] = runs[:30]
    store.put_json(PAGE_PATH, page)
    return log


def main() -> int:
    store = default_store()
    try:
        log = run(store, dt.datetime.now(dt.timezone.utc))
    except Exception as exc:
        print(f"seo failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1
    print(f"seo: {log['status']} in {log['duration_s']}s" + (f" — errors: {log['errors']}" if log["errors"] else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
