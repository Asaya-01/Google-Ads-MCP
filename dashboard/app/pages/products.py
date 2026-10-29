"""Products: units, revenue, MRP and landed discount after the freebie filter,
plus the freebie, product-type and MRP checks."""

from __future__ import annotations

import datetime as dt
from collections import defaultdict

from .. import rules
from .common import Context, month_to_date


def build(ctx: Context) -> dict:
    d1 = rules.to_date(ctx.d1)
    last7 = rules.date_range(d1 - dt.timedelta(days=6), d1)
    prev7 = rules.date_range(
        d1 - dt.timedelta(days=13), d1 - dt.timedelta(days=7)
    )
    mtd, _ = month_to_date(ctx.d1)
    lines = ctx.data.get("products", [])
    catalog = ctx.data.get("catalog")
    mrp_na = (
        None
        if catalog
        else ctx.unavailable.get(
            "catalog", "Shopify product MRPs were not pulled"
        )
    )

    by_date = defaultdict(list)
    for r in lines:
        by_date[r["date"]].append(r)

    def kept(dates):
        return [
            r
            for d in dates
            for r in by_date.get(d, [])
            if r["drop_reason"] is None
        ]

    cur, prev = _aggregate(kept(last7), "product_id", catalog), _aggregate(
        kept(prev7), "product_id", catalog
    )
    products = _compare(cur, prev)
    cat_cur, cat_prev = _aggregate(
        kept(last7), "product_type", catalog
    ), _aggregate(kept(prev7), "product_type", catalog)
    categories = _compare(cat_cur, cat_prev)
    total_rev = sum(r["revenue"] for r in cur.values()) or None
    for r in categories:
        r["share"] = rules.ratio(r["revenue"], total_rev)

    units_with_mrp = sum(r["units_with_mrp"] for r in cur.values())
    units_total = sum(r["units"] for r in cur.values())
    missing_mrp = sorted(
        (
            {
                "product": r["label"],
                "units_without_mrp": r["units"] - r["units_with_mrp"],
            }
            for r in cur.values()
            if r["units"] > r["units_with_mrp"]
        ),
        key=lambda r: -r["units_without_mrp"],
    )[:15]

    return {
        "title": "Products",
        "as_of": ctx.d1,
        "period": {
            "current": [last7[0], last7[-1]],
            "prior": [prev7[0], prev7[-1]],
        },
        "products": products,
        "categories": categories,
        "freebie_check": {
            "last_7_days": _freebies(by_date, last7),
            "month_to_date": _freebies(by_date, mtd),
        },
        "product_types": _types(
            by_date, mtd, catalog, ctx.cfg["freebies"]["known_types"]
        ),
        "mrp_check": {
            "units": units_total,
            "units_with_mrp": units_with_mrp,
            "coverage": rules.ratio(units_with_mrp, units_total),
            "missing": missing_mrp,
            "na": mrp_na,
        },
        "notes": [
            'Freebie lines are dropped: product type merch or freebie; title or SKU containing "minis" '
            "when the line is priced at Rs 1 or less; charms, mesh bags and tote bags as a safety net.",
            "Revenue = line total sales (sums to GMV). MRP = Shopify compare-at price today, applied to all "
            "past dates. Landed discount = 1 - revenue / (units x MRP), on units that have an MRP.",
            "Bundles (combo) use the bundle's own compare-at price.",
        ],
    }


def _mrp(row: dict, catalog: dict | None) -> float | None:
    if not catalog:
        return None
    return catalog["mrp_by_sku"].get(row["sku"].strip()) or catalog[
        "mrp_by_product"
    ].get(str(row["product_id"]))


def _aggregate(rows: list[dict], key: str, catalog: dict | None) -> dict:
    out: dict[str, dict] = {}
    for r in rows:
        k = r[key] or "(none)"
        a = out.setdefault(
            k,
            {
                "key": k,
                "label": (
                    r["product_title"]
                    if key == "product_id"
                    else (k or "(blank type)")
                ),
                "product_type": r["product_type"],
                "units": 0,
                "revenue": 0.0,
                "mrp_value": 0.0,
                "units_with_mrp": 0,
                "revenue_with_mrp": 0.0,
            },
        )
        a["units"] += r["units"]
        a["revenue"] += r["revenue"]
        mrp = _mrp(r, catalog)
        if mrp:
            a["mrp_value"] += mrp * r["units"]
            a["units_with_mrp"] += r["units"]
            a["revenue_with_mrp"] += r["revenue"]
    for a in out.values():
        a["landed_discount"] = (
            1 - a["revenue_with_mrp"] / a["mrp_value"]
            if a["mrp_value"]
            else None
        )
        a["mrp_per_unit"] = rules.ratio(a["mrp_value"], a["units_with_mrp"])
    return out


def _compare(cur: dict, prev: dict) -> list[dict]:
    rows = []
    for k in set(cur) | set(prev):
        c, p = cur.get(k), prev.get(k)
        base = c or p
        rows.append(
            {
                "key": k,
                "label": base["label"],
                "product_type": base["product_type"],
                "units": c["units"] if c else 0,
                "units_prior": p["units"] if p else 0,
                "revenue": c["revenue"] if c else 0.0,
                "revenue_prior": p["revenue"] if p else 0.0,
                "mrp_per_unit": c["mrp_per_unit"] if c else None,
                "landed_discount": c["landed_discount"] if c else None,
                "landed_discount_prior": p["landed_discount"] if p else None,
            }
        )
    for r in rows:
        r["units_delta"] = rules.pct_change(r["units"], r["units_prior"])
        r["revenue_delta"] = rules.pct_change(r["revenue"], r["revenue_prior"])
    return sorted(rows, key=lambda r: -r["revenue"])


def _freebies(by_date, dates) -> dict:
    out = {"kept": {"lines": 0, "units": 0, "revenue": 0.0}}
    paid_minis = defaultdict(lambda: {"lines": 0, "units": 0, "revenue": 0.0})
    for d in dates:
        for r in by_date.get(d, []):
            bucket = out.setdefault(
                r["drop_reason"] or "kept",
                {"lines": 0, "units": 0, "revenue": 0.0},
            )
            bucket["lines"] += r["line_count"]
            bucket["units"] += r["units"]
            bucket["revenue"] += r["revenue"]
            if r.get("paid_minis_kept"):
                pm = paid_minis[r["product_title"]]
                pm["lines"] += r["line_count"]
                pm["units"] += r["units"]
                pm["revenue"] += r["revenue"]
    out["paid_minis_kept"] = [
        {"product": k, **v}
        for k, v in sorted(paid_minis.items(), key=lambda kv: -kv[1]["revenue"])
    ]
    out.setdefault("safety_net", {"lines": 0, "units": 0, "revenue": 0.0})
    return out


def _types(by_date, dates, catalog, known: list[str]) -> dict:
    seen = defaultdict(lambda: {"lines": 0, "units": 0, "dropped_lines": 0})
    for d in dates:
        for r in by_date.get(d, []):
            s = seen[r["product_type"] or ""]
            s["lines"] += r["line_count"]
            s["units"] += r["units"]
            if r["drop_reason"]:
                s["dropped_lines"] += r["line_count"]
    catalog_types = (catalog or {}).get("product_types", {})
    all_types = set(seen) | set(catalog_types)
    rows = [
        {
            "product_type": t or "(blank)",
            "catalog_products": catalog_types.get(t),
            "lines_mtd": seen[t]["lines"] if t in seen else 0,
            "dropped_lines_mtd": seen[t]["dropped_lines"] if t in seen else 0,
            "needs_review": t not in known,
        }
        for t in all_types
    ]
    return {
        "rows": sorted(
            rows, key=lambda r: (not r["needs_review"], -r["lines_mtd"])
        ),
        "review_note": "Types marked for review are neither a known sellable type nor a freebie type. "
        "Confirm with the D2C lead whether each should be excluded (e.g. Gift, Sample) or kept.",
    }
