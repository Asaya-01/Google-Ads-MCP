"""Shopify Admin API: client-credentials token, ShopifyQL sessions and MRP.

The token comes from the d1-dashboard-reader app with a client-credentials
grant at the start of each run (it lasts 24 hours). No customer names,
emails or phone numbers are requested anywhere in this module.
"""

from __future__ import annotations

import datetime as dt
import time

import requests

SESSION_DIMENSIONS = (
    "referrer_source, referrer_name, utm_source, utm_medium, utm_campaign"
)


class ShopifyError(RuntimeError):
    pass


class Shopify:
    def __init__(
        self, store: str, api_version: str, client_id: str, client_secret: str
    ):
        self.store = store
        self.api_version = api_version
        self._client_id = client_id
        self._client_secret = client_secret
        self._token: str | None = None
        self.http = requests.Session()

    def token(self) -> str:
        if self._token is None:
            resp = self.http.post(
                f"https://{self.store}/admin/oauth/access_token",
                data={
                    "client_id": self._client_id,
                    "client_secret": self._client_secret,
                    "grant_type": "client_credentials",
                },
                timeout=30,
            )
            if resp.status_code != 200:
                raise ShopifyError(
                    f"Token request failed with HTTP {resp.status_code}"
                )
            self._token = resp.json()["access_token"]
        return self._token

    def graphql(self, query: str, variables: dict | None = None) -> dict:
        url = f"https://{self.store}/admin/api/{self.api_version}/graphql.json"
        for attempt in range(6):
            resp = self.http.post(
                url,
                json={"query": query, "variables": variables or {}},
                headers={"X-Shopify-Access-Token": self.token()},
                timeout=120,
            )
            if resp.status_code in (429, 502, 503):
                time.sleep(2**attempt)
                continue
            resp.raise_for_status()
            body = resp.json()
            errors = body.get("errors") or []
            if any(
                (e.get("extensions") or {}).get("code") == "THROTTLED"
                for e in errors
            ):
                time.sleep(2**attempt)
                continue
            if errors:
                raise ShopifyError(
                    "; ".join(e.get("message", str(e)) for e in errors)
                )
            return body["data"]
        raise ShopifyError("Shopify kept throttling after 6 attempts")

    def shopifyql(self, query: str) -> list[dict]:
        data = self.graphql(
            "query($q: String!) { shopifyqlQuery(query: $q) { parseErrors tableData { columns { name } rows } } }",
            {"q": query},
        )["shopifyqlQuery"]
        if data["parseErrors"]:
            raise ShopifyError("ShopifyQL: " + "; ".join(data["parseErrors"]))
        return (data.get("tableData") or {}).get("rows") or []

    def orders_count(self, day: str) -> int:
        """Shopify's own count of orders created on one IST day (test orders
        excluded), used to check the BigQuery copy is complete."""
        nxt = (dt.date.fromisoformat(day) + dt.timedelta(days=1)).isoformat()
        query = (
            f"created_at:>='{day}T00:00:00+05:30' AND "
            f"created_at:<'{nxt}T00:00:00+05:30' AND test:false"
        )
        data = self.graphql(
            "query($q: String!) { ordersCount(query: $q) { count precision } }",
            {"q": query},
        )["ordersCount"]
        if data.get("precision") != "EXACT":
            raise ShopifyError("Shopify returned an approximate order count")
        return int(data["count"])

    def sessions_day(self, day: str, limit: int) -> dict:
        """Sessions, add-to-cart and reached-checkout sessions for one IST day:
        the day total, plus a breakdown by referrer and UTM. "truncated" means
        the breakdown hit the row limit, so it sums to less than the total."""
        metrics = "sessions, sessions_with_cart_additions, sessions_that_reached_checkout"
        totals = self.shopifyql(
            f"FROM sessions SHOW {metrics} SINCE {day} UNTIL {day}"
        )
        rows = self.shopifyql(
            f"FROM sessions SHOW {metrics} GROUP BY {SESSION_DIMENSIONS} "
            f"SINCE {day} UNTIL {day} ORDER BY sessions DESC LIMIT {limit}"
        )
        t = totals[0] if totals else {}
        return {
            "totals": {
                "sessions": _int(t.get("sessions")),
                "atc": _int(t.get("sessions_with_cart_additions")),
                "reached_checkout": _int(
                    t.get("sessions_that_reached_checkout")
                ),
            },
            "rows": [
                {
                    "referrer_source": r.get("referrer_source") or "",
                    "referrer_name": r.get("referrer_name") or "",
                    "utm_source": r.get("utm_source") or "",
                    "utm_medium": r.get("utm_medium") or "",
                    "utm_campaign": r.get("utm_campaign") or "",
                    "sessions": _int(r.get("sessions")),
                    "atc": _int(r.get("sessions_with_cart_additions")),
                }
                for r in rows
            ],
            "truncated": len(rows) >= limit,
        }

    def landing_day(self, day: str, limit: int) -> list[dict]:
        rows = self.shopifyql(
            "FROM sessions SHOW sessions, sessions_with_cart_additions GROUP BY landing_page_path "
            f"SINCE {day} UNTIL {day} ORDER BY sessions DESC LIMIT {limit}"
        )
        return [
            {
                "landing_page": r.get("landing_page_path") or "",
                "sessions": _int(r.get("sessions")),
                "atc": _int(r.get("sessions_with_cart_additions")),
            }
            for r in rows
        ]

    def catalog(self) -> dict:
        """MRP per variant (MRP = compareAtPrice, today's value) and the
        catalog's product types, for the freebie-type review."""
        query = """
        query($after: String) {
          productVariants(first: 250, after: $after) {
            pageInfo { hasNextPage endCursor }
            nodes { sku title compareAtPrice product { id productType } }
          }
        }"""
        by_sku: dict[str, float] = {}
        titles: dict[str, str] = {}
        by_product: dict[str, set] = {}
        types: dict[str, int] = {}
        products_seen: set[str] = set()
        after = None
        while True:
            page = self.graphql(query, {"after": after})["productVariants"]
            for v in page["nodes"]:
                pid = v["product"]["id"].rsplit("/", 1)[-1]
                mrp = (
                    float(v["compareAtPrice"])
                    if v.get("compareAtPrice")
                    else None
                )
                if v.get("sku") and mrp:
                    by_sku[v["sku"].strip()] = mrp
                if v.get("sku") and v.get("title"):
                    titles[v["sku"].strip()] = v["title"]
                by_product.setdefault(pid, set()).add(mrp)
                if pid not in products_seen:
                    products_seen.add(pid)
                    ptype = (
                        (v["product"].get("productType") or "").strip().lower()
                    )
                    types[ptype] = types.get(ptype, 0) + 1
            if not page["pageInfo"]["hasNextPage"]:
                break
            after = page["pageInfo"]["endCursor"]
        return {
            "mrp_by_sku": by_sku,
            # A product-level MRP only when every variant agrees on one value.
            "mrp_by_product": {
                pid: next(iter(m))
                for pid, m in by_product.items()
                if len(m) == 1 and None not in m
            },
            "product_types": types,
            # Variant title per SKU ("Berry Crush / 100 ml"), used by the
            # retention census to tell fragrances, shades and packs apart.
            "variant_titles": titles,
        }

    def orders_count_through(self, day: str) -> int:
        """Shopify's own all-time count of real (non-test) orders created up
        to and including one IST day."""
        nxt = (dt.date.fromisoformat(day) + dt.timedelta(days=1)).isoformat()
        data = self.graphql(
            "query($q: String!) { ordersCount(query: $q, limit: null) { count precision } }",
            {"q": f"created_at:<'{nxt}T00:00:00+05:30' AND test:false"},
        )["ordersCount"]
        if data.get("precision") != "EXACT":
            raise ShopifyError("Shopify returned an approximate order count")
        return int(data["count"])


def _int(value) -> int:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return 0
