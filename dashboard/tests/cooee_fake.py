"""A fake Cooee MCP server for the tests: answers JSON-RPC over "HTTP" in the
exact shapes the real server returned when it was audited (13 Nov 2026), with
made-up numbers. Also a fake OAuth server for the one-time sign-in."""

from __future__ import annotations

import datetime as dt
import json
import random


class Resp:
    def __init__(self, status=200, body=None, headers=None, text=None):
        self.status_code = status
        self._body = body
        self.headers = headers or {"Content-Type": "application/json"}
        self.text = text if text is not None else json.dumps(body)

    def json(self):
        return self._body if self._body is not None else json.loads(self.text)


def _days(a, b):
    s, e = dt.date.fromisoformat(a), dt.date.fromisoformat(b)
    return [(s + dt.timedelta(days=i)).isoformat() for i in range((e - s).days + 1)]


def _r(seed, lo, hi):
    return random.Random(seed).randint(lo, hi)


FUNNEL_SHARE = {"NO": (0.57, 0.0), "LOW": (0.02, 0.01), "MEDIUM": (0.36, 0.024), "HIGH": (0.05, 0.19)}
PAGES = [("/products/underarm-spray", "products"), ("/products/fade-forward-inner-thigh-and-bum-roll-on", "products"),
         ("/products/advanced-spot-targeting-serum-india", "products"), ("/collections/offers", "collections"), ("/", "home"),
         ("/products/itb-uas", "products"), ("/cart", "cart")]
UTMS = [("facebook", "WOA_TOF_Sales_Test_ITB", "Creative_A"), ("facebook", "WOA_BOF_Sales_Test_UAS", "Creative_B"),
        ("google", "12345678901", ""), ("instagram", "WOA_TOF_Sales_Test_ASS", "Creative_C"), ("", "", "")]
PRODUCTS = [("9813999190329", "Even Tone Underarm Mist - Aqua Rush / 100 ml", ["67732603175225", "67732603175226"]),
            ("10107079721273", "Fade Forward Inner Thigh &amp; Bum Roll-On - 70 ml", ["51745443283257"]),
            ("9512852291897", "Advanced Spot Targeting Serum - 30 ml", ["111"])]


def _metrics(seed, sessions, cvr, metrics):
    osess = int(sessions * cvr)
    full = {"sessionCount": sessions, "visitorCount": int(sessions * 0.95), "bouncedSessionCount": int(sessions * 0.9),
            "sessionsWithProductView": int(sessions * 0.85), "sessionsWithAddToCart": int(sessions * 0.09),
            "sessionsWithCartOpen": int(sessions * 0.02), "sessionsWithCheckoutStarted": int(sessions * 0.037),
            "contactSubmittedCount": 1, "addressSubmittedCount": 2, "paymentSubmittedCount": int(sessions * 0.037),
            "sessionsWithOrder": osess, "orderCount": osess, "revenue": round(osess * 760.0, 2)}
    return {m: full[m] for m in metrics}


class FakeCooee:
    """Implements post()/get() like requests for both the MCP endpoint and
    the OAuth server."""

    MCP = "https://cooee.test/mcp"

    def __init__(self, shape_break: str | None = None, registration: bool = True):
        self.calls: list[tuple[str, dict]] = []
        self.shape_break = shape_break
        self.registration = registration
        self.tokens_issued = 0

    # ------------------------------------------------------------ OAuth
    def get(self, url, timeout=None):
        if url == "https://cooee.test/.well-known/oauth-protected-resource/mcp":
            return Resp(body={"resource": self.MCP, "authorization_servers": ["https://auth.cooee.test"], "scopes_supported": ["read"]})
        if url == "https://auth.cooee.test/.well-known/oauth-authorization-server":
            body = {"issuer": "https://auth.cooee.test", "authorization_endpoint": "https://auth.cooee.test/authorize",
                    "token_endpoint": "https://auth.cooee.test/token"}
            if self.registration:
                body["registration_endpoint"] = "https://auth.cooee.test/register"
            return Resp(body=body)
        return Resp(404, {"error": "not found"})

    def post(self, url, json=None, data=None, headers=None, timeout=None, auth=None):
        if url == "https://auth.cooee.test/register":
            return Resp(201, {"client_id": "dash-client", "redirect_uris": json["redirect_uris"]})
        if url == "https://auth.cooee.test/token":
            self.tokens_issued += 1
            if data["grant_type"] == "authorization_code" and data["code"] != "good-code":
                return Resp(400, {"error": "invalid_grant"})
            if data["grant_type"] == "refresh_token" and data["refresh_token"] == "revoked":
                return Resp(400, {"error": "invalid_grant"})
            return Resp(200, {"access_token": f"at-{self.tokens_issued}", "refresh_token": f"rt-{self.tokens_issued}", "expires_in": 3600})
        if url == self.MCP:
            return self._rpc(json, headers or {})
        return Resp(404, {"error": "not found"})

    # ------------------------------------------------------------ MCP
    def _rpc(self, msg, headers):
        if not str(headers.get("Authorization", "")).startswith("Bearer at-"):
            return Resp(401, {"error": "unauthorized"})
        if "id" not in msg:
            return Resp(202, None, text="")
        if msg["method"] == "initialize":
            return Resp(body={"jsonrpc": "2.0", "id": msg["id"], "result": {"protocolVersion": "2025-06-18", "capabilities": {"tools": {}}}},
                        headers={"Content-Type": "application/json", "Mcp-Session-Id": "s-1"})
        if msg["method"] == "tools/list":
            return Resp(body={"jsonrpc": "2.0", "id": msg["id"], "result": {"tools": [{"name": "get_store"}]}})
        name, args = msg["params"]["name"], msg["params"]["arguments"]
        self.calls.append((name, args))
        out = getattr(self, "t_" + name)(**args)
        if self.shape_break == name:
            out = {"unexpected": True}
        payload = {"jsonrpc": "2.0", "id": msg["id"], "result": {"content": [{"type": "text", "text": json.dumps(out)}], "isError": False}}
        # the real server streams: answer as SSE to exercise that path
        return Resp(body=None, headers={"Content-Type": "text/event-stream"}, text="event: message\ndata: " + json.dumps(payload) + "\n\n")

    def t_get_store_daily_stats(self, storeSlug, fromDate, toDate):
        return {"store": storeSlug, "currency": "INR", "processedDays": [
            {"date": d, "totalRevenue": 500000.0 + _r(d, 0, 90000), "netRevenue": 440000.0, "totalOrders": 640 + _r(d, 0, 90), "cooeeRevenue": 0, "cooeeOrders": 0}
            for d in _days(fromDate, toDate)]}

    def t_get_landing_page_report(self, storeSlug, fromDate, toDate, dimensions, metrics=None, includeIntents=False, limit=50, filters=None, sort=None, order="desc"):
        metrics = metrics or ["sessionCount"]
        base = lambda seed: 30000 + _r(seed, 0, 9000)  # noqa: E731
        items = []
        if dimensions == ["date"]:
            for d in _days(fromDate, toDate):
                s = base(d)
                it = {"total": _metrics(d, s, 0.019, metrics), "date": d}
                if includeIntents:
                    it["intents"] = {k: _metrics(d + k, int(s * sh), c, metrics) for k, (sh, c) in FUNNEL_SHARE.items()}
                items.append(it)
        elif dimensions == ["date", "hour"]:
            for d in _days(fromDate, toDate):
                for h in range(24):
                    items.append({"total": _metrics(d + str(h), 300 + _r(d + str(h), 0, 2000), 0.02, metrics), "hour": h, "date": d})
        elif dimensions == ["ordered"]:
            n = len(_days(fromDate, toDate))
            s = 33000 * n
            return {"store": storeSlug, "dimensions": dimensions, "total": 2, "returned": 2, "truncated": False,
                    "summary": _metrics("live", s, 0.019, metrics), "items": []}
        else:
            keyset = {("landingPage", "pageType"): [{"landingPath": p, "page": t} for p, t in PAGES],
                      ("exitPage",): [{"exitPath": p} for p, _ in PAGES],
                      ("utmSource", "utmCampaign", "utmContent"): [{"utmSource": a, "utmCampaign": b, "utmContent": c} for a, b, c in UTMS],
                      ("referringChannel", "referringMedium"): [{"acquisitionChannel": a, "referringMedium": b} for a, b in
                                                                 [("instagram", "SOCIAL"), ("google", "SEARCH"), ("youtube", "SOCIAL"), ("direct", "NONE")]],
                      ("deviceType", "visitorType"): [{"deviceType": a, "sessionType": b} for a in ("mobile", "desktop") for b in ("New", "Returning")]}[tuple(dimensions)]
            for i, k in enumerate(keyset):
                s = max(50, int(base(fromDate + str(i)) / (i + 2)))
                cvr = 0.0 if (filters or {}).get("ordered") == "no" else (0.002 if k.get("utmSource") == "google" else 0.02)
                it = {"total": _metrics(fromDate + str(i), s, cvr, metrics), **k}
                if includeIntents:
                    it["intents"] = {kk: _metrics(fromDate + kk + str(i), int(s * sh), c * (cvr > 0), metrics) for kk, (sh, c) in FUNNEL_SHARE.items()}
                items.append(it)
        tot = {m: sum((it["total"].get(m) or 0) for it in items) for m in metrics}
        return {"store": storeSlug, "period": {"from": fromDate, "to": toDate}, "dimensions": dimensions,
                "units": {"money": "INR", "rates": "percent", "durations": "milliseconds"},
                "total": len(items), "returned": min(len(items), limit), "truncated": len(items) > limit,
                "summary": {**tot, "sessionCount": tot.get("sessionCount", 0) + 500}, "items": items[:limit]}

    def t_get_product_report(self, storeSlug, fromDate, toDate, limit=25, byVariant=False, sort="views", order="desc", minViews=None, search=None):
        rows = []
        for i, (pid, name, vids) in enumerate(PRODUCTS):
            for j, vid in enumerate(vids if byVariant else [None]):
                v = 12000 // (i + 1) // (j + 1) + _r(fromDate + pid + str(j), 0, 500)
                a = int(v * (0.1 + 0.05 * i))
                row = {"productId": pid, "name": name, "views": v, "addToCarts": a, "viewToCartRate": round(a / v * 100, 2),
                       "removesFromCart": a // 3, "purchases": a // 6, "unitsSold": a // 6, "revenue": float(a // 6 * 450)}
                if byVariant:
                    row["variantId"] = vid
                rows.append(row)
        return {"store": storeSlug, "period": {"from": fromDate, "to": toDate}, "currency": "INR", "returned": len(rows),
                "totals": {"views": 45000, "addToCarts": 12000, "viewToCartRate": 26.7, "removesFromCart": 5000, "purchases": 1600, "unitsSold": 1700, "revenue": 520000.0},
                "products": rows[:limit]}

    def t_get_impact_report(self, storeSlug, fromDate, toDate):
        return {"store": storeSlug, "period": {"from": fromDate, "to": toDate}, "currency": "INR",
                "note": "A comparison needs visitors in both groups of a Cooee impact test in this period; found 0 exposed and 0 controlled"}

    def t_get_campaign_report(self, storeSlug, fromDate, toDate, daily=False, limit=25, **kw):
        rows = []
        for d in _days(fromDate, toDate):
            for seq, name, obj, dl, dis in (("253", " V7 Nector Point UI", "ANNOUNCEMENT", "ANNOUNCEMENT_BAR", 0), ("51", "V2 STICKY ATC ", "STICKY_ATC", "PAGE_EMBED", 9000)):
                rows.append({"sequenceNumber": seq, "name": name, "status": "PUBLISHED", "objective": obj, "deliveryType": dl, "date": d,
                             "impressions": 20000 if seq == "51" else 400, "holdouts": 0, "clicks": 1600 if seq == "51" else 3, "ctr": 8.0,
                             "dismissals": dis, "sessions": 300, "visitors": 280, "addToCarts": 12, "orders": 0 if seq == "253" else 380, "revenue": 0.0 if seq == "253" else 260000.0})
        return {"store": storeSlug, "period": {"from": fromDate, "to": toDate}, "currency": "INR", "total": len(rows), "returned": min(limit, len(rows)), "rows": rows[:limit]}

    def t_list_campaigns(self, storeSlug, status=None, objective=None):
        c = [{"sequenceNumber": "253", "name": " V7 Nector Point UI", "status": "PUBLISHED", "objective": "ANNOUNCEMENT", "deliveryType": "ANNOUNCEMENT_BAR",
              "createdAt": "2026-10-28T13:16:00.766Z", "updatedAt": "2026-11-13T06:41:43.322Z", "publishedAt": "2026-10-28T13:17:09.769Z"}]
        return {"total": 1, "returned": 1, "campaigns": c if status in ("active", None, "all") else []}

    EXPS = {
        "152": {"type": "AB_TEST", "status": "PUBLISHED", "publishedAt": "2026-08-28T08:09:25.216Z", "arms": [("a", "Variation", False, 59500, 15700), ("b", "Control", True, 40500, 10900)]},
        "245": {"type": "NATIVE_AB", "status": "PUBLISHED", "publishedAt": "2026-10-29T05:45:46.858Z", "arms": [("a", "Original", True, 25000, 435), ("b", "Variant", False, 25000, 425)]},
        "266": {"type": "AB_TEST", "status": "PUBLISHED", "publishedAt": "2026-11-06T08:31:50.209Z", "arms": [("a", "Variation", False, 110000, 2650), ("b", "Control", True, 110500, 2710)]},
        "252": {"type": "NATIVE_AB", "status": "DRAFT", "publishedAt": None, "arms": []},
    }

    def t_list_experiments(self, storeSlug, status=None):
        return {"total": len(self.EXPS), "returned": len(self.EXPS), "experiments": [
            {"sequenceNumber": k, "name": "New Experiment" if v["status"] == "DRAFT" else f"Test {k}", "status": v["status"], "type": v["type"],
             "createdAt": "2026-09-01T00:00:00.000Z", "updatedAt": "2026-11-13T06:00:00.000Z", **({"publishedAt": v["publishedAt"]} if v["publishedAt"] else {})}
            for k, v in self.EXPS.items()]}

    def t_get_experiment(self, storeSlug, experimentSequenceNumber):
        v = self.EXPS[experimentSequenceNumber]
        vars_ = []
        for key, name, ctrl, vis, orders in v["arms"]:
            if v["type"] == "NATIVE_AB":
                st = {"visitors": vis, "sessions": int(vis * 1.07), "orders": orders, "revenue": orders * 830.0, "conversionRate": round(orders / vis * 100, 2),
                      "revenuePerVisitor": round(orders * 830.0 / vis, 2), "addToCartRate": 10.9, "checkoutRate": 4.0, "bounceRate": 88.1}
                arm = {"key": key, "name": name, "isControl": ctrl, "split": 50, "stats": st}
                if not ctrl:
                    arm["liftVsControl"] = {"conversionRate": -2.3, "revenuePerVisitor": 3.9, "conversionRatePValue": 0.7913}
            else:
                st = {"impressions": 2300 if experimentSequenceNumber == "266" else vis * 2, "interactions": 300, "dismissals": 0, "uniqueVisitors": vis,
                      "cartAdditions": vis, "influencedOrders": orders, "influencedRevenue": orders * 790.0, "directOrders": orders}
                arm = {"key": key, "name": name, "isControl": ctrl, "split": 50, "stats": st}
            vars_.append(arm)
        return {"sequenceNumber": experimentSequenceNumber, "name": f"Test {experimentSequenceNumber}", "status": v["status"], "type": v["type"],
                "createdAt": "2026-09-01T00:00:00.000Z", "updatedAt": "2026-11-13T06:00:00.000Z", "publishedAt": v["publishedAt"],
                "variations": vars_, "currency": "INR", "dashboardUrl": f"https://dashboard.letscooee.com/store/{storeSlug}/experiments/detail/{experimentSequenceNumber}",
                "config": {"pageType": "SITEWIDE"}}
