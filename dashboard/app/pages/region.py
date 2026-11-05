"""The Region tab: Shopify's own Sales report (the D-1 numbers) by state and
city of the shipping address, and by product within them.

Pages written:
- "region": the tab itself, with the map of India (static/india_map.json).
- "region_days": per day and city, Orders, Total sales and Quantity ordered,
  plus paid items (gifts, merch, books and gummies left out, as on the
  Products tab) where the product detail exists; and per day, state and
  product the same three numbers.
- "region_sku/<state>": per day, city and product, loaded when a state is
  opened, so the tab itself stays light.

Names are cleaned so one place is one row: states map to the map's shapes
(Ladakh shares Jammu & Kashmir's outline; Dadra & Nagar Haveli and Daman & Diu
are one territory with two shapes) and city spellings are merged
("BANGALORE", "Bengaluru" and "BENGALURU" are Bengaluru).
"""

from __future__ import annotations

import json
import re

from .. import settings
from .common import Context

# key, name, map shapes
STATES = [
    ("an", "Andaman & Nicobar Islands", ["an"]),
    ("ap", "Andhra Pradesh", ["ap"]),
    ("ar", "Arunachal Pradesh", ["ar"]),
    ("as", "Assam", ["as"]),
    ("br", "Bihar", ["br"]),
    ("ch", "Chandigarh", ["ch"]),
    ("ct", "Chhattisgarh", ["ct"]),
    ("dnhdd", "Dadra & Nagar Haveli and Daman & Diu", ["dn", "dd"]),
    ("dl", "Delhi", ["dl"]),
    ("ga", "Goa", ["ga"]),
    ("gj", "Gujarat", ["gj"]),
    ("hr", "Haryana", ["hr"]),
    ("hp", "Himachal Pradesh", ["hp"]),
    ("jk", "Jammu & Kashmir and Ladakh", ["jk"]),
    ("jh", "Jharkhand", ["jh"]),
    ("ka", "Karnataka", ["ka"]),
    ("kl", "Kerala", ["kl"]),
    ("ld", "Lakshadweep", ["ld"]),
    ("mp", "Madhya Pradesh", ["mp"]),
    ("mh", "Maharashtra", ["mh"]),
    ("mn", "Manipur", ["mn"]),
    ("ml", "Meghalaya", ["ml"]),
    ("mz", "Mizoram", ["mz"]),
    ("nl", "Nagaland", ["nl"]),
    ("or", "Odisha", ["or"]),
    ("py", "Puducherry", ["py"]),
    ("pb", "Punjab", ["pb"]),
    ("rj", "Rajasthan", ["rj"]),
    ("sk", "Sikkim", ["sk"]),
    ("tn", "Tamil Nadu", ["tn"]),
    ("tg", "Telangana", ["tg"]),
    ("tr", "Tripura", ["tr"]),
    ("up", "Uttar Pradesh", ["up"]),
    ("ut", "Uttarakhand", ["ut"]),
    ("wb", "West Bengal", ["wb"]),
    ("xx", "No state on the address", []),
]


def _norm(s: str) -> str:
    return re.sub(r"[^a-z]", "", (s or "").lower().replace("&", "and"))


STATE_ALIASES = {_norm(n): k for k, n, _ in STATES} | {
    "jammuandkashmir": "jk",
    "ladakh": "jk",
    "dadraandnagarhaveli": "dnhdd",
    "damananddiu": "dnhdd",
    "dadraandnagarhavelianddamananddiu": "dnhdd",
    "thedadraandnagarhavelianddamananddiu": "dnhdd",
    "orissa": "or",
    "pondicherry": "py",
    "uttaranchal": "ut",
    "chattisgarh": "ct",
    "telengana": "tg",
    "newdelhi": "dl",
    "nctofdelhi": "dl",
    "nationalcapitalterritoryofdelhi": "dl",
    "andamanandnicobar": "an",
    "andamanandnicobarislands": "an",
}
STATE_INDEX = {k: i for i, (k, _, _) in enumerate(STATES)}

# spellings of one city -> the one key; then how the key is shown
CITY_SAME = {
    "BENGALURU": "BANGALORE",
    "BANGALURU": "BANGALORE",
    "BENGALURU URBAN": "BANGALORE",
    "BANGALORE URBAN": "BANGALORE",
    "GURUGRAM": "GURGAON",
    "BOMBAY": "MUMBAI",
    "CALCUTTA": "KOLKATA",
    "MADRAS": "CHENNAI",
    "POONA": "PUNE",
    "BARODA": "VADODARA",
    "TRIVANDRUM": "THIRUVANANTHAPURAM",
    "COCHIN": "KOCHI",
    "MYSURU": "MYSORE",
    "MANGALURU": "MANGALORE",
    "BELAGAVI": "BELGAUM",
    "VIZAG": "VISAKHAPATNAM",
    "ALLAHABAD": "PRAYAGRAJ",
    "GAUHATI": "GUWAHATI",
}
CITY_SHOW = {
    "BANGALORE": "Bengaluru",
    "GURGAON": "Gurugram",
    "MYSORE": "Mysuru",
    "MANGALORE": "Mangaluru",
    "BELGAUM": "Belagavi",
}


def state_key(name: str) -> str:
    return STATE_ALIASES.get(_norm(name), "xx")


def city_key(name: str) -> str:
    c = re.sub(r"\s+", " ", (name or "").upper()).strip(" .,-")
    return CITY_SAME.get(c, c)


def city_show(key: str) -> str:
    if not key:
        return "(no city)"
    return CITY_SHOW.get(key) or " ".join(w.capitalize() for w in key.split(" "))


def build_tab(ctx: Context) -> dict:
    """The tab page: the map and the notes."""
    with open(settings.STATIC_DIR / "india_map.json", encoding="utf-8") as f:
        india = json.load(f)
    region = ctx.data.get("region") or {}
    notes = [
        "Orders, Revenue (Total sales) and Quantity ordered are Shopify's own Sales report, the same numbers as "
        "the D-1 tab, by the shipping address. Cancelled orders still count as orders and returns come off Total "
        "sales on the day they are processed, exactly as on D-1.",
        "Items, quantities and basket size (items per order) count what was bought: free gifts, merch, books and "
        "gummies are always left out, as on every tab. ASAYASS and ASAYAINF orders are never counted.",
        "For a product, AOV is its revenue per order that had it, and basket size is its units per such order.",
        "Ladakh is shown with Jammu & Kashmir (one outline on the map); Dadra & Nagar Haveli and Daman & Diu is one "
        "territory with two shapes. City spellings are merged (Bangalore, Bengaluru: Bengaluru).",
        india.get("attribution", ""),
    ]
    notes += list((ctx.data.get("region_notes") or {}).values())
    return {
        "title": "Region",
        "as_of": ctx.d1,
        "map": india,
        "available": bool(region.get("city")),
        "na": None if region.get("city") else (ctx.unavailable.get("region") or "region data has not been pulled yet"),
        "notes": notes,
    }


def build_data(ctx: Context) -> dict[str, dict]:
    """region_days and one region_sku/<state> page per state with data."""
    region = ctx.data.get("region") or {}
    gift_types = {
        t.lower() for t in ctx.cfg.get("freebies", {}).get("exclude_product_types", [])
    }
    cities: list[dict] = []
    c_index: dict[tuple, int] = {}

    def city_i(region_name: str, city_name: str) -> int:
        s = state_key(region_name)
        k = (s, city_key(city_name))
        if k not in c_index:
            c_index[k] = len(cities)
            cities.append({"name": city_show(k[1]), "s": STATE_INDEX[s]})
        return c_index[k]

    products: list[dict] = []
    p_index: dict[str, int] = {}

    def prod_i(name: str, ptype: str) -> int:
        if name not in p_index:
            p_index[name] = len(products)
            products.append(
                {"name": name, "type": ptype, "gift": (ptype or "").strip().lower() in gift_types}
            )
        return p_index[name]

    # city by day (orders, total sales, quantity ordered)
    agg: dict[tuple, list] = {}
    for d, rows in (region.get("city") or {}).items():
        for reg, city, o, sales, q in rows:
            a = agg.setdefault((d, city_i(reg, city)), [0, 0.0, 0, None])
            a[0] += o
            a[1] += sales
            a[2] += q
    # products: per state (national page) and per city (state pages)
    by_state: dict[tuple, list] = {}
    by_city: dict[str, dict[tuple, list]] = {}
    paid: dict[tuple, int] = {}
    for d, rows in (region.get("sku") or {}).items():
        for reg, city, prod, ptype, o, sales, q in rows:
            ci, pi = city_i(reg, city), prod_i(prod, ptype)
            s = cities[ci]["s"]
            a = by_state.setdefault((d, s, pi), [0, 0.0, 0])
            a[0] += o
            a[1] += sales
            a[2] += q
            b = by_city.setdefault(STATES[s][0], {}).setdefault((d, ci, pi), [0, 0.0, 0])
            b[0] += o
            b[1] += sales
            b[2] += q
            if not products[pi]["gift"]:
                paid[(d, ci)] = paid.get((d, ci), 0) + q
            else:
                paid.setdefault((d, ci), paid.get((d, ci), 0))
    sku_days = sorted((region.get("sku") or {}).keys())
    sku_set = set(sku_days)
    # days are written as their position in `dates`: the files stay small
    dates = sorted({d for d, _ in agg} | sku_set)
    di = {d: i for i, d in enumerate(dates)}
    rows = []
    for (d, ci), (o, sales, q, _) in sorted(agg.items()):
        rows.append([di[d], ci, o, round(sales, 2), q, paid.get((d, ci), 0) if d in sku_set else None])
    out = {
        "region_days": {
            "title": "Region days",
            "as_of": ctx.d1,
            "from": region.get("from"),
            "to": region.get("to"),
            "dates": dates,
            # rows: [day, city, orders, total sales, quantity ordered, paid items (null without product detail)]
            "states": [{"key": k, "name": n, "map": m} for k, n, m in STATES],
            "cities": cities,
            "rows": rows,
            "products": products,
            "sku_days": sku_days,
        },
        # products by state, all of India: [day, state, product, orders, total sales, quantity]
        "region_sku/all": {
            "title": "Region products · all states",
            "as_of": ctx.d1,
            "rows": [[di[d], s, p, a[0], round(a[1], 2), a[2]] for (d, s, p), a in sorted(by_state.items())],
        },
    }
    for key, m in by_city.items():
        out[f"region_sku/{key}"] = {
            "title": f"Region products · {key}",
            "as_of": ctx.d1,
            # rows: [day, city, product, orders, total sales, quantity]
            "rows": [[di[d], ci, p, a[0], round(a[1], 2), a[2]] for (d, ci, p), a in sorted(m.items())],
        }
    return out
