"""Builds pages/profitability.json: the Website slice of finance's channel P&L,
month by month (pnl_monthly_d2c), with every subtotal recomputed from its
lines, the arithmetic checks, the reconciliation with Shopify and the cost
input checklist. Marketplace rows stay in the bucket and are never put on the
page.

python -m app.pnl.build   (also run after every upload)
"""

from __future__ import annotations

import datetime as dt
import sys

from ..store import default_store
from . import COST_TABLES, INDEX, PAGE, config, is_d2c

TOL = 1000.0  # ₹: at least this much difference before a recomputed subtotal is said not to match


def tolerance(vals: dict) -> float:
    """Rounding in the source: the investor pack is in ₹ lakh to 2 decimals and
    its extract in ₹ crore to 3, so a subtotal of several rounded lines can be
    off by a few thousand rupees. 0.1% of net revenue, at least ₹1,000."""
    return max(TOL, 0.001 * abs(vals.get("net_rev") or 0))


def _months_from(versions: list[dict], store) -> tuple[dict, dict]:
    """For each month, the newest actuals import that has it: {month: rows}, {month: version}."""
    by_month, src = {}, {}
    for v in versions:  # newest first
        if v["kind"] != "actuals":
            continue
        body = store.get_json(v["path"]) or {}
        for r in body.get("rows") or []:
            m = r["month"]
            if m in src and src[m] != v["version"]:
                continue
            src[m] = v["version"]
            by_month.setdefault(m, []).append(r)
    return by_month, src


def d2c_lines(rows: list[dict], cfg: dict) -> tuple[dict, str | None, list[str]]:
    """{line key: amount} for the Website channel of one month, the channel's
    name, and the labels of Website rows the line map does not know."""
    vals: dict[str, float] = {}
    name, unmapped = None, []
    for r in rows:
        if not is_d2c(r["channel"], cfg):
            continue
        name = name or r["channel"]
        k = r.get("line_item_key")
        if not k:
            unmapped.append(r["line_item"])
            continue
        vals[k] = vals.get(k, 0.0) + r["amount"]
    return vals, name, unmapped


def compute(vals: dict) -> tuple[dict, dict, list[dict]]:
    """Recompute the subtotals from their lines. Returns values, status per
    line ('closed' as stated, 'derived' worked out from stated figures,
    'incomplete' when an input is missing) and the arithmetic findings."""
    v = dict(vals)
    st = {k: "closed" for k in v}
    findings = []
    tol = tolerance(vals)

    def have(*ks):
        return all(v.get(k) is not None for k in ks)

    if have("gross", "net_rev"):
        v["gst"] = v["gross"] - v["net_rev"]
        st["gst"] = "derived"
    if "freight" not in vals and have("net_rev", "cogs", "gm"):
        gap = v["net_rev"] - v["cogs"] - v["gm"]
        if abs(gap) > tol:
            v["freight"], st["freight"] = gap, "derived"
            findings.append({"line": "gm", "stated": v["gm"], "recomputed": v["net_rev"] - v["cogs"],
                             "note": "Gross margin is below Net revenue − COGS: the difference is shown as Primary freight & damages (derived)"})
    calc = {
        "gross": (["gmv"], ["disc"]),
        "gm": (["net_rev"], ["cogs", "freight"]),
        "cm1": (["gm"], ["fees", "packaging", "storage", "logistics"]),
        "chan_spend": ([], ["ads", "promos", "samples"]),
        "cm2": (["cm1"], ["ads", "promos", "samples"]),
        "brand": ([], ["influencer", "agency"]),
        "cm3": (["cm2"], ["influencer", "agency"]),
    }
    for k, (plus, minus) in calc.items():
        need = plus + [m for m in minus if m != "freight" or "freight" in v]
        if not have(*need):
            stated = vals.get(k)
            st[k] = "incomplete"
            v[k] = stated  # shown as stated, labelled incomplete
            continue
        rec = sum(v[p] for p in plus) - sum(v[m] for m in minus if m in v) if plus else sum(v[m] for m in minus if m in v)
        stated = vals.get(k)
        if stated is None:
            v[k], st[k] = rec, "derived"  # the source has no subtotal: ours
        else:
            # finance's subtotal is shown as stated; the recomputation is the check
            v[k], st[k] = stated, "closed"
            if abs(rec - stated) > tol and not (k == "gm" and st.get("freight") == "derived"):
                findings.append({"line": k, "stated": stated, "recomputed": rec, "note": "recomputed from its lines differs from the stated subtotal"})
    return v, st, findings


def _sum_days(days: dict | None, field: str, month: str):
    if not days or field not in (days.get("values") or {}):
        return None
    tot, n, seen = 0.0, 0, False
    for d, x in zip(days["dates"], days["values"][field]):
        if d[:7] == month:
            seen = True
            if x is None:
                return None
            tot += x
            n += 1
    return tot if seen else None


def shopify_monthly(months: list[str]) -> dict:
    """Shopify's sales report by month (ShopifyQL, read only), rupees."""
    from ..seo.sources import shopify_client

    if not months:
        return {}
    shop = shopify_client()
    first = months[0] + "-01"
    y, m = map(int, months[-1].split("-"))
    last = (dt.date(y + (m == 12), m % 12 + 1, 1) - dt.timedelta(days=1)).isoformat()
    rows = shop.shopifyql(
        "FROM sales SHOW orders, gross_sales, discounts, returns, net_sales, taxes, shipping_charges, total_sales "
        f"TIMESERIES month SINCE {first} UNTIL {last}"
    )
    f = lambda r, k: float(r.get(k) or 0)  # noqa: E731
    return {str(r.get("month"))[:7]: {k: f(r, k) for k in ("orders", "gross_sales", "discounts", "returns", "net_sales", "taxes", "shipping_charges", "total_sales")}
            for r in rows if r.get("month")}


def build(store, now: dt.datetime | None = None, shopify=shopify_monthly) -> dict:
    cfg = config()
    now = now or dt.datetime.now(dt.timezone.utc)
    idx = store.get_json(INDEX) or {"versions": []}
    versions = idx["versions"]
    by_month, src = _months_from(versions, store)
    months, per, status, findings, unmapped, channel = [], {}, {}, [], {}, None
    for m in sorted(by_month):
        vals, name, um = d2c_lines(by_month[m], cfg)
        if not vals:
            continue
        channel = channel or name
        v, st, f = compute(vals)
        months.append(m)
        per[m], status[m] = v, st
        findings += [{"month": m, **x} for x in f]
        for lab in um:
            unmapped.setdefault(lab, []).append(m)

    days = store.get_json("pages/days.json")
    orders = [_sum_days(days, "orders", m) for m in months]
    new_orders = [_sum_days(days, "new_orders", m) for m in months]
    total_sales = [_sum_days(days, "sh_sales", m) for m in months]
    perf_spend = [_sum_days(days, "perf_all_spend", m) for m in months]

    recon, recon_error = [], None
    try:
        sh = shopify(months)
        for m in months:
            s = sh.get(m)
            if not s:
                continue
            nr = per[m].get("net_rev")
            recon.append({"month": m, "shopify": s, "pnl_net_rev": nr, "pnl_gross_sales": per[m].get("gross"),
                          "gap": (nr - s["net_sales"]) if nr is not None else None,
                          "gap_pct": (nr / s["net_sales"] - 1) if nr and s["net_sales"] else None})
    except Exception as exc:  # the tab still builds; Data health says why
        recon_error = f"{type(exc).__name__}: {exc}"

    # SKU margins from MIS uploads (the newest per month)
    skus = {}
    for v in versions:
        if v["kind"] != "mis" or not v.get("months"):
            continue
        m = v["months"][0]
        if m in skus:
            continue
        body = store.get_json(v["path"]) or {}
        rows = body.get("d2c_skus") or []
        if not rows:
            continue
        p = per.get(m) or {}
        var = sum(p.get(k) or 0 for k in ("freight", "fees", "packaging", "storage", "logistics"))
        var_pct = (var / p["net_rev"]) if p.get("net_rev") else None
        tot = sum(r["net_revenue"] for r in rows)
        skus[m] = {"version": v["version"], "var_pct": var_pct, "total_net_revenue": tot, "pnl_net_rev": p.get("net_rev"),
                   "rows": [{**r, "gm_pct": (1 - r["cogs"] / r["net_revenue"]) if r["net_revenue"] else None,
                             "cm1_pct": ((1 - r["cogs"] / r["net_revenue"]) - var_pct) if r["net_revenue"] and var_pct is not None else None,
                             "discount": (1 - r["net_revenue"] * (1 + cfg["gst_rate"]) / r["mrp_sales"]) if r.get("mrp_sales") else None}
                            for r in rows]}

    # Phase 2 cost tables: created empty, never filled with stand-in values
    tables = {}
    for t in COST_TABLES:
        path = f"private/pnl/costs/{t}.json"
        body = store.get_json(path)
        if body is None:
            body = {"table": t, "columns": cfg["cost_tables"][t], "rows": []}
            store.put_json(path, body)
        tables[t] = len(body.get("rows") or [])
    cogs_months = sorted({v["months"][0] for v in versions if v["kind"] == "mis" and v.get("months")
                          and (store.get_json(v["path"]) or {}).get("cogs_master")})
    inputs = [
        {"key": "cogs_sku", "name": "COGS by SKU", "state": "provided" if cogs_months or tables["cogs_sku"] else "missing",
         "detail": (f"COGS Master from the MIS ({', '.join(cogs_months)})" if cogs_months else "upload the month's MIS (COGS Master sheet)")},
        {"key": "logistics", "name": "Logistics rate card", "state": "provided" if tables["logistics"] else "missing",
         "detail": "closed months use finance's Logistics (outward) line"},
        {"key": "payment", "name": "Payment gateway & checkout fees", "state": "provided" if tables["payment"] else "estimated",
         "detail": "monthly totals sit in finance's DPC / payment gateway line; no per-method rates yet"},
        {"key": "cod", "name": "COD fee", "state": "missing", "detail": "inside finance's lines; no rate given"},
        {"key": "rto", "name": "RTO cost", "state": "missing", "detail": "finance's revenue is net of RTO; RTO freight sits in logistics"},
        {"key": "other_variable", "name": "Other variable (freebies, inserts)", "state": "provided" if tables["other_variable"] else "missing", "detail": ""},
        {"key": "allocation_rules", "name": "Allocation rules", "state": "provided",
         "detail": "finance's: brand building and primary freight are split to channels by share; performance ads are the Website's own"},
    ]

    lines = []
    for ln in cfg["lines"]:
        k = ln["key"]
        vals = [per[m].get(k) for m in months]
        if all(x is None for x in vals) and not ln.get("always"):
            continue
        lines.append({**{x: ln.get(x) for x in ("key", "name", "group", "kind", "direction", "definition")},
                      "values": [round(x, 2) if x is not None else None for x in vals],
                      "status": [status[m].get(k) for m in months]})
    page = {
        "title": "Profitability",
        "built_at": now.isoformat(timespec="seconds"),
        "channel": channel,
        "months": months,
        "month_status": {m: "closed" for m in months},
        "month_source": {m: src.get(m) for m in months},
        "groups": cfg["groups"],
        "lines": lines,
        "orders": orders, "new_orders": new_orders, "total_sales": total_sales, "perf_spend": perf_spend,
        "skus": skus,
        "cost_inputs": inputs,
        "checks": {"arithmetic": findings, "unmapped": [{"line_item": k, "months": v} for k, v in unmapped.items()],
                   "recon": recon, "recon_error": recon_error},
        # import history without channel names: marketplaces never reach this page
        "versions": [{k: x for k, x in v.items() if k != "channels"} for v in versions[:30]],
        "notes": cfg["notes"],
    }
    store.put_json(PAGE, page)
    return page


def main() -> int:
    try:
        p = build(default_store())
    except Exception as exc:
        print(f"profitability failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1
    print(f"profitability: {len(p['months'])} months, {len(p['checks']['arithmetic'])} arithmetic findings")
    return 0


if __name__ == "__main__":
    sys.exit(main())
