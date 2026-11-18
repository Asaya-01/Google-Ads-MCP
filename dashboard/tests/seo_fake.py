"""Made-up stand-ins for the SEO sources: every number here is invented and
the shapes follow each API's documented response. No network."""

from __future__ import annotations

import datetime as dt

from app.seo import sources as S


class Fake:
    SourceError = S.SourceError
    GSC_SCOPE, GA4_SCOPE = S.GSC_SCOPE, S.GA4_SCOPE
    gsc_pick_site = staticmethod(S.gsc_pick_site)
    ga4_pick_property = staticmethod(S.ga4_pick_property)

    def __init__(self, fail: set | None = None, sites=None):
        self.fail = fail or set()
        self.calls: list[tuple] = []
        self.sites = sites if sites is not None else [{"siteUrl": "sc-domain:worldofasaya.com", "permissionLevel": "siteRestrictedUser"}]

    def pause(self, seconds):
        pass

    def _maybe(self, name):
        if name in self.fail:
            raise S.SourceError(f"{name} is down (made up)")

    # auth
    def scoped_session(self, scopes):
        self.calls.append(("session", tuple(scopes)))
        return object()

    # Search Console
    def gsc_sites(self, sess):
        self._maybe("gsc")
        return self.sites

    def gsc_query(self, sess, site, body, max_rows=25000):
        self.calls.append(("gsc", body["dimensions"][0], (body.get("dimensionFilterGroups") or [{}])[0].get("filters", [{}])[0].get("operator")))
        dim = body["dimensions"][0]
        if dim == "date":
            s, e = dt.date.fromisoformat(body["startDate"]), dt.date.fromisoformat(body["endDate"])
            op = (body.get("dimensionFilterGroups") or [{}])[0].get("filters", [{}])[0].get("operator")
            share = {"includingRegex": 0.6, "excludingRegex": 0.3}.get(op, 1.0)
            out = []
            for i in range((e - s).days + 1):
                d = s + dt.timedelta(days=i)
                clicks = (1000 + i) * share
                out.append({"keys": [d.isoformat()], "clicks": round(clicks), "impressions": round(clicks * 20), "ctr": 0.05, "position": 8.0})
            return out
        recent = body["endDate"] >= "2026-11-01"
        if dim == "query":
            return [
                {"keys": ["asaya underarm spray"], "clicks": 500 if recent else 400, "impressions": 3000, "position": 1.4},
                {"keys": ["dark underarms cream"], "clicks": 40 if recent else 90, "impressions": 9000, "position": 12.2 if recent else 9.0},
                {"keys": ["pigmentation serum"], "clicks": 30, "impressions": 6000, "position": 9.1},
            ] + ([{"keys": ["lost query"], "clicks": 50, "impressions": 500, "position": 5.0}] if not recent else [])
        return [
            {"keys": ["https://worldofasaya.com/"], "clicks": 700, "impressions": 5000, "position": 2.0},
            {"keys": ["https://worldofasaya.com/products/underarm-spray"], "clicks": 300 if recent else 200, "impressions": 8000, "position": 6.0},
            {"keys": ["https://worldofasaya.com/blogs/hyperpigmentation/what-is-melasma"], "clicks": 20, "impressions": 4000, "position": 14.0},
        ]

    # GA4
    def ga4_properties(self, sess):
        self._maybe("ga4")
        return [{"property": "properties/111", "name": "World of Asaya", "account": "Asaya"}]

    def ga4_report(self, sess, prop, body):
        dims = [d["name"] for d in body["dimensions"]]
        if dims == ["date", "sessionDefaultChannelGroup"]:
            return [{"date": "20261110", "sessionDefaultChannelGroup": "Organic Search", "sessions": 900.0, "engagedSessions": 500.0, "ecommercePurchases": 9.0, "purchaseRevenue": 9000.0}]
        if dims == ["date", "sessionSource"]:
            return [{"date": "20261110", "sessionSource": "chatgpt.com", "sessions": 40.0, "engagedSessions": 30.0, "ecommercePurchases": 1.0, "purchaseRevenue": 999.0},
                    {"date": "20261110", "sessionSource": "perplexity.ai", "sessions": 5.0, "engagedSessions": 4.0, "ecommercePurchases": 0.0, "purchaseRevenue": 0.0}]
        return [{"landingPage": "/products/underarm-spray", "sessions": 300.0, "engagedSessions": 200.0, "ecommercePurchases": 3.0, "purchaseRevenue": 3000.0}]

    # CrUX / PSI
    def crux(self, key, body, history=False):
        self._maybe("crux")
        target = body.get("origin") or body.get("url")
        if "www." in target or "nodata" in target:
            return None
        if body.get("url") and "blogs" in body["url"]:
            return None
        if history:
            n = body.get("collectionPeriodCount", 25)
            return {"collectionPeriods": [{"firstDate": {"year": 2026, "month": 1, "day": 1}, "lastDate": {"year": 2026, "month": 1, "day": 1 + i % 28}} for i in range(n)],
                    "metrics": {"largest_contentful_paint": {"percentilesTimeseries": {"p75s": [2400 + 10 * i for i in range(n)]}},
                                "interaction_to_next_paint": {"percentilesTimeseries": {"p75s": [180] * n}},
                                "cumulative_layout_shift": {"percentilesTimeseries": {"p75s": ["0.05"] * n}}}}
        slow = "dotandkey" in target
        return {"collectionPeriod": {"lastDate": {"year": 2026, "month": 11, "day": 15}},
                "metrics": {"largest_contentful_paint": {"histogram": [{"start": 0, "end": 2500, "density": 0.8}], "percentiles": {"p75": 4200 if slow else 2300}},
                            "interaction_to_next_paint": {"histogram": [{"density": 0.9}], "percentiles": {"p75": 150}},
                            "cumulative_layout_shift": {"histogram": [{"density": 0.95}], "percentiles": {"p75": "0.04"}},
                            "first_contentful_paint": {"percentiles": {"p75": 1500}},
                            "experimental_time_to_first_byte": {"percentiles": {"p75": 900}}}}

    def psi(self, key, url, strategy):
        self._maybe("psi")
        if "offers" in url:
            raise S.SourceError("PageSpeed Insights: HTTP 500 (made up)")
        return {"lighthouseResult": {"categories": {"performance": {"score": 0.42 if strategy == "mobile" else 0.81}},
                                     "audits": {"largest-contentful-paint": {"numericValue": 5200.0}, "first-contentful-paint": {"numericValue": 1900.0},
                                                "cumulative-layout-shift": {"numericValue": 0.02}, "total-blocking-time": {"numericValue": 640.0},
                                                "speed-index": {"numericValue": 4100.0}, "server-response-time": {"numericValue": 300.0},
                                                "total-byte-weight": {"numericValue": 3200000.0},
                                                "unused-javascript": {"title": "Reduce unused JavaScript", "score": 0.2, "details": {"type": "opportunity", "overallSavingsMs": 1200, "overallSavingsBytes": 400000}},
                                                "third-party-summary": {"details": {"items": [{"entity": "Made-up Reviews App", "transferSize": 300000, "blockingTime": 250}]}}}},
                "loadingExperience": {"metrics": {"LARGEST_CONTENTFUL_PAINT_MS": {"percentile": 2600}, "CUMULATIVE_LAYOUT_SHIFT_SCORE": {"percentile": 5}}, "overall_category": "AVERAGE"}}

    # Keyword Planner
    def keyword_history(self, gcfg, creds, keywords, geo, language, network):
        self._maybe("keyword_planner")
        if "explorer" in self.fail:
            raise S.SourceError("Keyword Planner: HTTP 403: The caller does not have permission")
        out = []
        for n, k in enumerate(keywords):
            base = 1000 * (n + 1)
            vols = [{"year": 2025 + (m >= 2), "month": ["NOVEMBER", "DECEMBER", "JANUARY"][m], "monthlySearches": str(base + m * 100)} for m in range(3)]
            out.append({"text": k, "closeVariants": [k + "s"], "keywordMetrics": {"avgMonthlySearches": str(base), "competition": "LOW", "monthlySearchVolumes": vols}})
        return out

    # Shopify
    def shopify_client(self):
        self._maybe("shopify")
        return object()

    def shopify_search_ai_sessions(self, shop, since, until, refs, utms):
        return [
            {"date": "2026-11-10", "referrer_source": "search", "referrer_name": "google", "utm_source": "google", "utm_medium": "cpc", "sessions": 4000, "atc": 1000, "checkout": 1},
            {"date": "2026-11-10", "referrer_source": "search", "referrer_name": "google", "utm_source": "", "utm_medium": "", "sessions": 300, "atc": 50, "checkout": 0},
            {"date": "2026-11-10", "referrer_source": "search", "referrer_name": "google", "utm_source": "cashkaro", "utm_medium": "affiliate", "sessions": 20, "atc": 5, "checkout": 0},
            {"date": "2026-11-10", "referrer_source": "direct", "referrer_name": "", "utm_source": "chatgpt.com", "utm_medium": "", "sessions": 35, "atc": 8, "checkout": 0},
            {"date": "2026-11-10", "referrer_source": "unknown", "referrer_name": "perplexity", "utm_source": "", "utm_medium": "", "sessions": 3, "atc": 1, "checkout": 0},
            {"date": "2026-11-10", "referrer_source": "unknown", "referrer_name": "claude", "utm_source": "sangria_blogs", "utm_medium": "sangria", "sessions": 2, "atc": 0, "checkout": 0},
        ]

    def shopify_ai_landing(self, shop, since, until, refs, utms):
        return [{"path": "/products/underarm-spray", "sessions": 120, "atc": 30}]

    def shopify_articles(self, shop):
        return [{"handle": "a", "blog": "acne", "blog_title": "Acne", "published": "2026-11-18"},
                {"handle": "b", "blog": "hyperpigmentation", "blog_title": "Hyperpigmentation", "published": "2026-11-02"},
                {"handle": "c", "blog": "acne", "blog_title": "Acne", "published": "2026-10-20"}]
