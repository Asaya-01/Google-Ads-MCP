"""Pure functions that turn what the sources returned into pages/seo.json.
No network here, so every rule is testable with made-up rows."""

from __future__ import annotations

import datetime as dt
import re

from . import ai_platform, page_type

CRUX_METRICS = {
    "lcp": "largest_contentful_paint",
    "inp": "interaction_to_next_paint",
    "cls": "cumulative_layout_shift",
    "fcp": "first_contentful_paint",
    "ttfb": "experimental_time_to_first_byte",
}
MONTHS = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"]


def _f(v, default=None):
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def days_between(start: str, end: str) -> list[str]:
    s, e = dt.date.fromisoformat(start), dt.date.fromisoformat(end)
    return [(s + dt.timedelta(days=i)).isoformat() for i in range((e - s).days + 1)]


# ------------------------------------------------------------ Search Console


def gsc_daily(total: list[dict], branded: list[dict], nonbranded: list[dict], start: str, end: str) -> dict:
    """Day by day clicks, impressions and impression-weighted position for
    all queries, branded queries and non-branded queries. Branded + non-branded
    is less than the total: Google hides rare (anonymised) queries from any
    query filter, and the gap is shown as such."""
    dates = days_between(start, end)
    out = {"dates": dates}
    for name, rows in (("total", total), ("branded", branded), ("nonbranded", nonbranded)):
        by = {r["keys"][0]: r for r in rows if r.get("keys")}
        out[name] = [[int(by[d]["clicks"]), int(by[d]["impressions"]), round(_f(by[d]["position"], 0), 2)] if d in by else None for d in dates]
    return out


def window_sum(series: list, dates: list[str], start: str, end: str) -> dict | None:
    c = i = pw = 0.0
    n = 0
    for d, v in zip(dates, series):
        if start <= d <= end and v:
            c += v[0]
            i += v[1]
            pw += v[1] * v[2]
            n += 1
    if not n:
        return None
    return {"clicks": int(c), "impressions": int(i), "ctr": (c / i) if i else None, "position": (pw / i) if i else None, "days": n}


def gsc_kpis(daily: dict, end: str, days: int = 28) -> dict:
    e = dt.date.fromisoformat(end)
    cur = ((e - dt.timedelta(days=days - 1)).isoformat(), end)
    prev = ((e - dt.timedelta(days=2 * days - 1)).isoformat(), (e - dt.timedelta(days=days)).isoformat())
    yoy = ((e - dt.timedelta(days=364 + days - 1)).isoformat(), (e - dt.timedelta(days=364)).isoformat())
    out = {"window": {"cur": cur, "prev": prev, "yoy": yoy}}
    for seg in ("total", "branded", "nonbranded"):
        out[seg] = {k: window_sum(daily[seg], daily["dates"], *w) for k, w in (("cur", cur), ("prev", prev), ("yoy", yoy))}
    return out


def merge_periods(cur: list[dict], prev: list[dict], brand_rx: str | None = None, types: list | None = None, limit: int = 500) -> list[dict]:
    """Query or page rows for the last 28 days next to the 28 days before."""
    p = {r["keys"][0]: r for r in prev if r.get("keys")}
    out = []
    seen = set()
    for r in cur:
        k = r["keys"][0]
        seen.add(k)
        q = p.get(k) or {}
        row = {"key": k, "clicks": int(r["clicks"]), "impressions": int(r["impressions"]), "position": round(_f(r["position"], 0), 1),
               "clicks_prev": int(q.get("clicks") or 0), "impressions_prev": int(q.get("impressions") or 0),
               "position_prev": round(_f(q.get("position"), 0), 1) if q else None}
        if brand_rx is not None:
            row["branded"] = bool(re.search(brand_rx, k, re.I))
        if types is not None:
            row["type"] = page_type(k, types)
        out.append(row)
    # pages / queries that had clicks before and none now are the biggest losers
    for k, q in p.items():
        if k in seen or not q.get("clicks"):
            continue
        row = {"key": k, "clicks": 0, "impressions": 0, "position": None, "clicks_prev": int(q["clicks"]),
               "impressions_prev": int(q["impressions"]), "position_prev": round(_f(q.get("position"), 0), 1)}
        if brand_rx is not None:
            row["branded"] = bool(re.search(brand_rx, k, re.I))
        if types is not None:
            row["type"] = page_type(k, types)
        out.append(row)
    out.sort(key=lambda r: (-(r["impressions"] + r["impressions_prev"]), r["key"]))
    keep = out[:limit]
    # never drop the biggest movers just because their impressions are small
    movers = sorted(out[limit:], key=lambda r: -abs(r["clicks"] - r["clicks_prev"]))[:100]
    return keep + [m for m in movers if m["clicks"] != m["clicks_prev"]]


def position_buckets(rows: list[dict], key: str = "position") -> list[dict]:
    bands = [("1–3", 0, 3.5), ("4–10", 3.5, 10.5), ("11–20", 10.5, 20.5), ("21–50", 20.5, 50.5), ("51+", 50.5, 1e9)]
    out = []
    for label, lo, hi in bands:
        sel = [r for r in rows if r.get(key) is not None and lo < r[key] <= hi and r["impressions" if key == "position" else "impressions_prev"]]
        imp = "impressions" if key == "position" else "impressions_prev"
        clk = "clicks" if key == "position" else "clicks_prev"
        out.append({"band": label, "queries": len(sel), "clicks": sum(r[clk] for r in sel), "impressions": sum(r[imp] for r in sel)})
    return out


def by_type(pages: list[dict]) -> list[dict]:
    agg: dict[str, dict] = {}
    for r in pages:
        a = agg.setdefault(r.get("type") or "Other", {"type": r.get("type") or "Other", "pages": 0, "clicks": 0, "impressions": 0, "clicks_prev": 0, "impressions_prev": 0})
        a["pages"] += 1 if r["clicks"] or r["impressions"] else 0
        for k in ("clicks", "impressions", "clicks_prev", "impressions_prev"):
            a[k] += r[k]
    return sorted(agg.values(), key=lambda a: -a["clicks"])


# ------------------------------------------------------------ Shopify / GA4


def is_organic_search(r: dict) -> bool:
    """A search-engine visit that no ad or partner link tagged. Shopify files
    most Google Ads clicks (utm_medium=cpc) under referrer 'search' too."""
    if r.get("referrer_source") != "search":
        return False
    return r.get("utm_source", "") == "" or r.get("utm_medium", "") in ("organic", "product_sync")


def shopify_series(rows: list[dict], platforms: list[dict]) -> dict:
    """{"ai": [[date, platform, sessions, atc, checkout]], "organic": [[date, engine, ...]]}."""
    ai: dict[tuple, list] = {}
    org: dict[tuple, list] = {}
    for r in rows:
        p = ai_platform(r, platforms)
        if p:
            a = ai.setdefault((r["date"], p), [0, 0, 0])
        elif is_organic_search(r):
            a = org.setdefault((r["date"], r.get("referrer_name") or "other"), [0, 0, 0])
        else:
            continue
        a[0] += r["sessions"]
        a[1] += r["atc"]
        a[2] += r["checkout"]
    return {"ai": [[d, p, *v] for (d, p), v in sorted(ai.items())], "organic": [[d, e, *v] for (d, e), v in sorted(org.items())]}


def channel_orders(channel_days: dict | None, names: list[str]) -> list[list]:
    """[date, channel, orders, gmv] for these channels, from pages/channel_days.json
    (orders by the UTM GoKwik captured at checkout)."""
    if not channel_days:
        return []
    chans = channel_days.get("channels") or []
    agg: dict[tuple, list] = {}
    for d, ci, _k, _s, _a, orders, gmv in channel_days.get("rows") or []:
        name = chans[ci] if isinstance(ci, int) and ci < len(chans) else ci
        if name in names:
            a = agg.setdefault((d, name), [0, 0.0])
            a[0] += orders or 0
            a[1] += gmv or 0.0
    return [[d, c, v[0], round(v[1], 2)] for (d, c), v in sorted(agg.items())]


def ga4_ai(rows: list[dict], platforms: list[dict]) -> list[list]:
    """[date, platform, sessions, engaged, purchases, revenue] from GA4 rows by sessionSource."""
    agg: dict[tuple, list] = {}
    for r in rows:
        p = ai_platform({"ga4_source": r.get("sessionSource")}, platforms)
        if not p:
            continue
        d = r["date"]
        d = f"{d[:4]}-{d[4:6]}-{d[6:]}" if len(d) == 8 else d
        a = agg.setdefault((d, p), [0, 0, 0, 0.0])
        a[0] += int(r.get("sessions") or 0)
        a[1] += int(r.get("engagedSessions") or 0)
        a[2] += int(r.get("ecommercePurchases") or 0)
        a[3] += float(r.get("purchaseRevenue") or 0)
    return [[d, p, *v[:3], round(v[3], 2)] for (d, p), v in sorted(agg.items())]


def ga4_channels(rows: list[dict]) -> list[list]:
    out = []
    for r in rows:
        d = r["date"]
        out.append([f"{d[:4]}-{d[4:6]}-{d[6:]}", r.get("sessionDefaultChannelGroup") or "", int(r.get("sessions") or 0),
                    int(r.get("engagedSessions") or 0), int(r.get("ecommercePurchases") or 0), round(float(r.get("purchaseRevenue") or 0), 2)])
    return sorted(out)


# ------------------------------------------------------------ Keyword Planner


def keyword_table(results: list[dict], brands: list[dict], category: list[str]) -> dict:
    """Monthly searches per brand (its keywords summed, close variants merged
    by Google), the months covered and share of search."""
    owner = {}
    for b in brands:
        for k in b.get("keywords") or []:
            owner[k.lower()] = b["name"]
    rows, months = [], set()
    for r in results:
        m = r.get("keywordMetrics") or {}
        series = {}
        for v in m.get("monthlySearchVolumes") or []:
            if v.get("month") in MONTHS:
                key = f"{int(v['year']):04d}-{MONTHS.index(v['month']) + 1:02d}"
                series[key] = int(v.get("monthlySearches") or 0)
                months.add(key)
        text = (r.get("text") or "").lower()
        variants = [t.lower() for t in r.get("closeVariants") or []]
        brand = owner.get(text) or next((owner[v] for v in variants if v in owner), None)
        rows.append({"keyword": r.get("text"), "brand": brand, "category": brand is None and text in {c.lower() for c in category},
                     "avg": int(m.get("avgMonthlySearches") or 0), "monthly": series, "competition": m.get("competition"),
                     "variants": r.get("closeVariants") or []})
    months = sorted(months)
    brand_rows = []
    for b in brands:
        mine = [r for r in rows if r["brand"] == b["name"]]
        row = {"brand": b["name"], "own": bool(b.get("own")), "in_share": bool(b.get("in_share"))}
        if not mine:
            brand_rows.append({**row, "monthly": [None] * len(months), "avg": None, "keywords": []})
            continue
        brand_rows.append({**row, "monthly": [sum(r["monthly"].get(mo, 0) for r in mine) for mo in months],
                           "avg": sum(r["avg"] for r in mine), "keywords": [r["keyword"] for r in mine]})
    # share of search: within the brands marked in_share (the team's sheet set)
    totals = [sum((b["monthly"][i] or 0) for b in brand_rows if b["in_share"]) for i in range(len(months))]
    for b in brand_rows:
        b["share"] = [(v / t) if b["in_share"] and v is not None and t else None for v, t in zip(b["monthly"], totals)]
    return {"months": months, "brands": brand_rows, "keywords": rows, "category": [r for r in rows if r["category"]]}


# ------------------------------------------------------------ speed


def rate(metric: str, v: float | None, thresholds: dict) -> str | None:
    if v is None:
        return None
    good, poor = thresholds[metric]
    return "good" if v <= good else "poor" if v > poor else "ni"


def crux_current(record: dict | None, thresholds: dict) -> dict | None:
    if not record:
        return None
    out = {"period": (record.get("collectionPeriod") or {}).get("lastDate")}
    for k, name in CRUX_METRICS.items():
        m = (record.get("metrics") or {}).get(name)
        p75 = _f(((m or {}).get("percentiles") or {}).get("p75"))
        good = None
        if m and m.get("histogram"):
            good = _f(m["histogram"][0].get("density"))
        out[k] = {"p75": p75, "good_share": good, "rating": rate(k, p75, thresholds)}
    core = [out[k]["rating"] for k in ("lcp", "inp", "cls")]
    out["passes"] = None if None in core else all(c == "good" for c in core)
    if isinstance(out["period"], dict):
        p = out["period"]
        out["period"] = f"{p['year']:04d}-{p['month']:02d}-{p['day']:02d}"
    return out


def crux_history(record: dict | None) -> dict | None:
    if not record:
        return None
    ends = []
    for p in record.get("collectionPeriods") or []:
        e = p.get("lastDate") or {}
        ends.append(f"{e.get('year', 0):04d}-{e.get('month', 0):02d}-{e.get('day', 0):02d}")
    out = {"dates": ends}
    for k, name in CRUX_METRICS.items():
        m = (record.get("metrics") or {}).get(name) or {}
        out[k] = [_f(v) for v in ((m.get("percentilesTimeseries") or {}).get("p75s") or [])]
    return out


def psi_summary(res: dict, path: str, strategy: str, day: str) -> dict:
    lh = res.get("lighthouseResult") or {}
    au = lh.get("audits") or {}
    num = lambda a: _f((au.get(a) or {}).get("numericValue"))  # noqa: E731
    score = _f(((lh.get("categories") or {}).get("performance") or {}).get("score"))
    opps = []
    for k, a in au.items():
        d = a.get("details") or {}
        save = _f(d.get("overallSavingsMs")) or _f((a.get("metricSavings") or {}).get("LCP"))
        if (a.get("score") is not None and a.get("score") < 0.9) and save and save >= 100:
            opps.append({"id": k, "title": a.get("title"), "saving_ms": round(save), "saving_bytes": _f(d.get("overallSavingsBytes"))})
    opps.sort(key=lambda o: -o["saving_ms"])
    third = []
    for it in ((au.get("third-party-summary") or {}).get("details") or {}).get("items") or []:
        ent = it.get("entity")
        third.append({"entity": ent.get("text") if isinstance(ent, dict) else ent, "bytes": _f(it.get("transferSize")), "blocking_ms": _f(it.get("blockingTime"))})
    third.sort(key=lambda t: -((t["blocking_ms"] or 0) * 1e6 + (t["bytes"] or 0)))
    field = res.get("loadingExperience") or {}
    fm = field.get("metrics") or {}
    fld = lambda n: _f((fm.get(n) or {}).get("percentile"))  # noqa: E731
    return {
        "date": day, "path": path, "strategy": strategy,
        "score": round(score * 100) if score is not None else None,
        "lab": {"lcp": num("largest-contentful-paint"), "fcp": num("first-contentful-paint"), "cls": num("cumulative-layout-shift"),
                "tbt": num("total-blocking-time"), "si": num("speed-index"), "ttfb": num("server-response-time"),
                "bytes": num("total-byte-weight"), "requests": len(((au.get("network-requests") or {}).get("details") or {}).get("items") or []) or None},
        "field": None if not fm else {"lcp": fld("LARGEST_CONTENTFUL_PAINT_MS"), "inp": fld("INTERACTION_TO_NEXT_PAINT"),
                                      "cls": (fld("CUMULATIVE_LAYOUT_SHIFT_SCORE") / 100) if fld("CUMULATIVE_LAYOUT_SHIFT_SCORE") is not None else None,
                                      "fcp": fld("FIRST_CONTENTFUL_PAINT_MS"), "ttfb": fld("EXPERIMENTAL_TIME_TO_FIRST_BYTE"),
                                      "category": field.get("overall_category"), "origin_fallback": bool(field.get("origin_fallback"))},
        "opportunities": opps[:6],
        "third_party": third[:8],
        "error": (lh.get("runtimeError") or {}).get("message"),
    }


# ------------------------------------------------------------ content


def content_months(articles: list[dict]) -> dict:
    by: dict[str, dict] = {}
    for a in articles:
        m = a["published"][:7]
        b = a.get("blog_title") or a.get("blog") or "Blog"
        by.setdefault(m, {}).setdefault(b, 0)
        by[m][b] += 1
    months = sorted(by)
    blogs = sorted({b for v in by.values() for b in v})
    return {"months": months, "blogs": blogs, "counts": [[by[m].get(b, 0) for b in blogs] for m in months],
            "recent": sorted(articles, key=lambda a: a["published"], reverse=True)[:30]}


# ------------------------------------------------------------ alerts


def alerts(page: dict, cfg: dict) -> list[dict]:
    """Rule-based flags: no model, no judgement calls."""
    out = []
    a = cfg.get("alerts") or {}
    k = (page.get("gsc") or {}).get("kpis") or {}
    for seg, label in (("branded", "Branded"), ("nonbranded", "Non-branded")):
        cur, prev = (k.get(seg) or {}).get("cur"), (k.get(seg) or {}).get("prev")
        if cur and prev and prev["clicks"]:
            ch = cur["clicks"] / prev["clicks"] - 1
            if ch <= -a.get("clicks_drop", 0.2):
                out.append({"level": "warn", "area": "Organic search", "text": f"{label} clicks down {abs(ch):.0%} (last 28 days against the 28 before)"})
    sp = (page.get("speed") or {}).get("origin") or {}
    for ff, label in (("phone", "Mobile"), ("desktop", "Desktop")):
        cur = sp.get(ff)
        if cur and cur.get("passes") is False:
            bad = [m.upper() for m in ("lcp", "inp", "cls") if (cur.get(m) or {}).get("rating") != "good"]
            out.append({"level": "warn", "area": "Website speed", "text": f"{label} fails Core Web Vitals on real users: {', '.join(bad)} not good at p75"})
    hist = (page.get("speed") or {}).get("history") or {}
    for m in ("lcp", "inp"):
        s = [v for v in (hist.get(m) or []) if v is not None]
        if len(s) >= 5 and s[-5] and s[-1] / s[-5] - 1 >= a.get("speed_worse", 0.15):
            out.append({"level": "warn", "area": "Website speed", "text": f"Mobile {m.upper()} p75 is {s[-1] / s[-5] - 1:.0%} worse than four weeks earlier"})
    d = page.get("demand") or {}
    own = next((b for b in d.get("brands") or [] if b.get("own")), None)
    if own and len([s for s in own.get("share") or [] if s is not None]) >= 2:
        s = [x for x in own["share"] if x is not None]
        if s[-1] - s[-2] <= -a.get("share_drop_pp", 0.02):
            out.append({"level": "warn", "area": "Search demand", "text": f"Share of search fell {abs(s[-1] - s[-2]) * 100:.1f} pp month on month"})
    return out
