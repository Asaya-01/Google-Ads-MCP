"""Shopify Admin API: client-credentials token, ShopifyQL sessions and MRP.

The token comes from the d1-dashboard-reader app with a client-credentials
grant at the start of each run (it lasts 24 hours). No customer names,
emails or phone numbers are requested anywhere in this module.
"""

from __future__ import annotations

import datetime as dt
import time
from zoneinfo import ZoneInfo

import requests

IST = ZoneInfo("Asia/Kolkata")
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

    def sales_daily(
        self, since: str, until: str, exclude_names: list[str]
    ) -> dict[str, dict]:
        """Shopify's own "Orders" and "Total sales" per IST day, as its Sales
        report shows them: cancelled orders still count as orders and Total
        sales nets off returns. Only the named order types (influencer and
        sample orders) are left out. {date: {"orders", "sales"}}."""
        cond = " AND ".join(
            f"order_name NOT CONTAINS '{n}'" for n in exclude_names
        )
        rows = self.shopifyql(
            "FROM sales SHOW orders, total_sales TIMESERIES day "
            + (f"WHERE {cond} " if cond else "")
            + f"SINCE {since} UNTIL {until}"
        )
        out = {}
        for r in rows:
            day = str(r.get("day") or "")[:10]
            if day:
                out[day] = {
                    "orders": _int(r.get("orders")),
                    "sales": float(r.get("total_sales") or 0),
                }
        return out

    def sales_hourly(
        self, since: str, until: str, exclude_names: list[str]
    ) -> dict[str, dict]:
        """Shopify's Sales report (Orders and Total sales, as on D-1) for each
        IST hour of the days since..until: {date: {"orders": [24], "gmv": [24]}}."""
        cond = " AND ".join(
            f"order_name NOT CONTAINS '{n}'" for n in exclude_names
        )
        rows = self.shopifyql(
            "FROM sales SHOW orders, total_sales TIMESERIES hour "
            + (f"WHERE {cond} " if cond else "")
            + f"SINCE {since} UNTIL {until}"
        )
        out: dict[str, dict] = {}
        for r in rows:
            at = dt.datetime.fromisoformat(
                str(r["hour"]).replace("Z", "+00:00")
            ).astimezone(IST)
            d = out.setdefault(
                at.date().isoformat(), {"orders": [0] * 24, "gmv": [0.0] * 24}
            )
            d["orders"][at.hour] = _int(r.get("orders"))
            d["gmv"][at.hour] = float(r.get("total_sales") or 0)
        return {k: v for k, v in out.items() if since <= k <= until}

    # ------------------------------------------------------------ region
    REGION_LIMIT = 10000

    def _where(self, exclude_names: list[str]) -> str:
        cond = " AND ".join(f"order_name NOT CONTAINS '{n}'" for n in exclude_names)
        return f"WHERE {cond} " if cond else ""

    def sales_by_city(
        self, since: str, until: str, exclude_names: list[str]
    ) -> list[dict]:
        """Shopify's Sales report (Orders, Total sales, Quantity ordered, as on
        D-1) per IST day, state and city of the shipping address. A range that
        hits the row limit is split, so nothing is cut off."""
        rows = self.shopifyql(
            "FROM sales SHOW orders, total_sales, quantity_ordered "
            "GROUP BY shipping_region, shipping_city TIMESERIES day "
            + self._where(exclude_names)
            + f"SINCE {since} UNTIL {until} LIMIT {self.REGION_LIMIT}"
        )
        if len(rows) >= self.REGION_LIMIT and since < until:
            a, b = dt.date.fromisoformat(since), dt.date.fromisoformat(until)
            mid = a + (b - a) // 2
            return self.sales_by_city(since, mid.isoformat(), exclude_names) + self.sales_by_city(
                (mid + dt.timedelta(days=1)).isoformat(), until, exclude_names
            )
        out = []
        for r in rows:
            o, sales, q = _int(r.get("orders")), float(r.get("total_sales") or 0), _int(r.get("quantity_ordered"))
            if not (o or sales or q):
                continue
            out.append(
                {
                    "date": str(r.get("day") or "")[:10],
                    "region": r.get("shipping_region") or "",
                    "city": r.get("shipping_city") or "",
                    "orders": o,
                    "sales": sales,
                    "qty": q,
                }
            )
        return out

    def sales_by_city_product(
        self, day: str, exclude_names: list[str]
    ) -> list[dict]:
        """The same report for one day by state, city and product (with its
        product type, so gifts and merch can be told apart)."""
        rows = self.shopifyql(
            "FROM sales SHOW orders, total_sales, quantity_ordered "
            "GROUP BY shipping_region, shipping_city, product_title, product_type "
            + self._where(exclude_names)
            + f"SINCE {day} UNTIL {day} LIMIT {self.REGION_LIMIT}"
        )
        if len(rows) >= self.REGION_LIMIT:
            raise ShopifyError(f"more than {self.REGION_LIMIT} city-product rows on {day}")
        out = []
        for r in rows:
            o, sales, q = _int(r.get("orders")), float(r.get("total_sales") or 0), _int(r.get("quantity_ordered"))
            if not r.get("product_title") or not (o or sales or q):
                continue
            out.append(
                {
                    "region": r.get("shipping_region") or "",
                    "city": r.get("shipping_city") or "",
                    "product": r.get("product_title"),
                    "type": r.get("product_type") or "",
                    "orders": o,
                    "sales": sales,
                    "qty": q,
                }
            )
        return out

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

    def orders_between(self, start: str, end: str) -> list[dict]:
        """Orders created from `start` up to (not including) `end`, as ISO
        timestamps with offset. Only the name, time, flags and total are
        requested: no customer details."""
        query = """
        query($q: String!, $after: String) {
          orders(first: 250, after: $after, query: $q, sortKey: CREATED_AT) {
            pageInfo { hasNextPage endCursor }
            nodes { name createdAt cancelledAt test
                    totalPriceSet { shopMoney { amount } } }
          }
        }"""
        q = f"created_at:>='{start}' AND created_at:<'{end}'"
        out: list[dict] = []
        after = None
        while True:
            page = self.graphql(query, {"q": q, "after": after})["orders"]
            for n in page["nodes"]:
                out.append(
                    {
                        "name": n["name"],
                        "created_at": n["createdAt"],
                        "cancelled": n.get("cancelledAt") is not None,
                        "test": bool(n.get("test")),
                        "total": float(
                            (
                                (n.get("totalPriceSet") or {}).get("shopMoney")
                                or {}
                            ).get("amount")
                            or 0
                        ),
                    }
                )
            if not page["pageInfo"]["hasNextPage"]:
                return out
            after = page["pageInfo"]["endCursor"]

    def sessions_hourly(self, day: str) -> list[list[int]]:
        """Sessions, sessions with add-to-cart and sessions that reached
        Shopify checkout for each IST hour of one day: three lists of 24."""
        rows = self.shopifyql(
            "FROM sessions SHOW sessions, sessions_with_cart_additions, "
            "sessions_that_reached_checkout TIMESERIES hour "
            f"SINCE {day} UNTIL {day}"
        )
        out = [[0] * 24 for _ in range(3)]
        for r in rows:
            at = dt.datetime.fromisoformat(
                str(r["hour"]).replace("Z", "+00:00")
            ).astimezone(IST)
            if at.date().isoformat() != day:
                continue
            out[0][at.hour] = _int(r.get("sessions"))
            out[1][at.hour] = _int(r.get("sessions_with_cart_additions"))
            out[2][at.hour] = _int(r.get("sessions_that_reached_checkout"))
        return out

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
        variants: dict[str, list] = {}
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
                variants.setdefault(pid, []).append(
                    [(v.get("sku") or "").strip(), v.get("title") or ""]
                )
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
            # Every listing's variants as [sku, title]: an order line names
            # only its product and SKU, so this tells which variant (pack,
            # size, shade) it was; a variant with no SKU is found as the
            # listing's only SKU-less one.
            "variants_by_product": variants,
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
