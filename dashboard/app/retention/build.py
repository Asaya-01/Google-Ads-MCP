"""Builds the retention census from counted order lines.

Rules (carried over from the retention artifact):
 - freebies, merch, minis, gifts and travel kits never count (catalog rules);
 - orders by one customer less than 24 hours apart are one order (payment
   retries and COD re-attempts), their baskets merged;
 - a customer is followed from their first ever order;
 - customers with one order are kept as daily counts, the rest as timelines;
 - basket size counts products, the Basket size tab's rule: each counted line
   is its quantity x the products in one unit of it (a combo counts the
   products inside it, a pack of N counts N, anything else 1).
"""

from __future__ import annotations

import datetime as dt
from collections import Counter, defaultdict

from .. import variants
from .catalog import Catalog, Line, label

IST = dt.timedelta(hours=5, minutes=30)


def build(
    rows,
    cat: Catalog,
    exclude_types: list[str],
    through: dt.date,
    variant_titles: dict[str, str] | None = None,
    dedupe_hours: int = 24,
    catalog: dict | None = None,
    combos: dict[str, int] | None = None,
) -> dict:
    """rows: (order, customer, time, title, sku, product type, revenue[,
    product id, quantity]). catalog: the Shopify catalog (variant titles per
    listing, for fragrance, shade and pack); combos: {product id: products
    inside} from config basket.combo_products."""
    variant_titles = variant_titles or {}
    combos = combos or {}
    packs = variants.pack_sizes(catalog)
    basket_units: dict[str, int] = defaultdict(int)
    customers: dict[str, dict[str, list]] = {}
    order_rev: dict[str, float] = defaultdict(float)
    excluded = defaultdict(lambda: [0, 0.0])
    counted = defaultdict(lambda: [0, 0.0])
    other_titles: Counter = Counter()
    lines_in = 0
    for row in rows:
        order_id, customer_id, ts, title, sku, ptype, revenue = row[:7]
        pid = str(row[7] or "") if len(row) > 7 else ""
        qty = int(row[8] or 1) if len(row) > 8 else 1
        lines_in += 1
        # an order's value is every line on it (so it ties back to GMV), even
        # the lines that do not count as a product
        order_rev[order_id] += revenue or 0.0
        s = (sku or "").strip()
        vt = (variants.find_title(pid, s, catalog) if pid else None) or variant_titles.get(s, "")
        pk = (packs.get(f"{pid}|{s}") if s else packs.get(f"{pid}|")) if pid else None
        pk = pk or (packs.get(f"*|{s}") if s else None)
        line, why = cat.classify(title, sku, revenue, ptype, exclude_types, vt, pk)
        if line is None:
            e = excluded[why]
            e[0] += 1
            e[1] += revenue or 0.0
            continue
        c = counted[line.code]
        c[0] += 1
        c[1] += revenue or 0.0
        if line.code == cat.other["code"]:
            other_titles[title] += revenue or 0.0
        order = customers.setdefault(customer_id, {}).setdefault(
            order_id, [ts, set(), [order_id]]
        )
        order[1].add(line)
        # products in the basket: a combo counts what is inside, a pack of N counts N
        n = combos.get(pid) or (cat.combo_of(title) if line.pack == 1 else None) or line.pack
        basket_units[order_id] += max(qty, 1) * min(n, 10)

    gap = dt.timedelta(hours=dedupe_hours)
    merged_pairs = orders_counted = orders_empty = 0
    timelines: dict[str, list[tuple[dt.date, set[Line], float, int]]] = {}
    revenue_total = 0.0
    for cid, orders in customers.items():
        seq: list[list] = []
        for ts, lines, oids in sorted(orders.values(), key=lambda o: o[0]):
            if seq and ts - seq[-1][0] < gap:
                seq[-1][1] |= lines
                seq[-1][2] = seq[-1][2] + oids
                merged_pairs += 1
            else:
                seq.append([ts, set(lines), list(oids)])
        orders_counted += len(seq)
        tl = []
        for ts, lines, oids in seq:
            rev = sum(order_rev[o] for o in oids)
            revenue_total += rev
            tl.append(((ts + IST).date(), lines, rev, sum(basket_units[o] for o in oids)))
        timelines[cid] = tl

    first = min(tl[0][0] for tl in timelines.values())
    ndays = (through - first).days

    present = {ln for tl in timelines.values() for _, ls, _, _ in tl for ln in ls}
    codes = [c for c in cat.order if any(ln.code == c for ln in present)]
    sku_idx = {c: i for i, c in enumerate(codes)}
    ordered = sorted(
        present,
        key=lambda ln: (sku_idx[ln.code], ln.sub != "—" and ln.sub, ln.pack),
    )
    var_idx = {ln: i for i, ln in enumerate(ordered)}

    multi: list[str] = []
    first_basket: list[int] = []  # products in each repeat customer's first order
    basket_mix: Counter = Counter()  # first orders by products, all customers
    new_cell = lambda: [0, 0.0]  # customers, revenue
    singles: dict[int, dict] = defaultdict(lambda: defaultdict(new_cell))
    singles_s: dict[int, dict] = defaultdict(lambda: defaultdict(new_cell))
    sbrand: dict = defaultdict(new_cell)
    n_multi = n_single = 0
    for tl in timelines.values():
        if len(tl) >= 2:
            n_multi += 1
            parts = []
            first_basket.append(tl[0][3])
            basket_mix[min(tl[0][3], 5)] += 1
            for d, lines, rev, _n in tl:
                vids = sorted({var_idx[ln] for ln in lines})
                parts.append(
                    f"{(d - first).days}:{','.join(map(str, vids))}~{round(rev)}"
                )
            multi.append("N" + "|".join(parts))
        else:
            n_single += 1
            d, lines, rev, units = tl[0]
            basket_mix[min(units, 5)] += 1
            day = (d - first).days
            for v in {var_idx[ln] for ln in lines}:
                cell = singles[v][day]
                cell[0] += 1
                cell[1] += rev
            skus = {sku_idx[ln.code] for ln in lines}
            for sk in skus:
                cell = singles_s[sk][day]
                cell[0] += 1
                cell[1] += rev
            # basket size in products (Basket size tab rule), 1, 2 or 3+
            cell = sbrand[(day, min(max(units, 1), 3))]
            cell[0] += 1
            cell[1] += rev

    def pack_singles(src):
        # [day, new to brand, already known, revenue]
        return {
            str(k): sorted([d, c[0], 0, round(c[1])] for d, c in v.items())
            for k, v in src.items()
        }

    return {
        "epoch": first.isoformat(),
        "ndays": ndays,
        "skus": [[c, cat.names[c]] for c in codes],
        "vars": [
            {
                "s": sku_idx[ln.code],
                "sub": ln.sub,
                "pack": ln.pack,
                "label": label(ln.sub, ln.pack),
            }
            for ln in ordered
        ],
        "multi": multi,
        # products in each repeat customer's first order, in the order of multi
        "fbs": first_basket,
        "singles": pack_singles(singles),
        "singles_s": pack_singles(singles_s),
        "sbrand": sorted(
            [d, z, c[0], 0, round(c[1])] for (d, z), c in sbrand.items()
        ),
        "has_revenue": True,
        "stats": {
            "through": through.isoformat(),
            "lines_in": lines_in,
            "customers": len(timelines),
            "customers_multi": n_multi,
            "customers_single": n_single,
            "orders_with_lines": orders_counted + merged_pairs,
            "orders_counted": orders_counted,
            "revenue_total": round(revenue_total),
            "merged_pairs": merged_pairs,
            "first_order_products": {str(k): v for k, v in sorted(basket_mix.items())},
            "excluded": {
                k: {"lines": v[0], "revenue": round(v[1])}
                for k, v in sorted(excluded.items(), key=lambda kv: -kv[1][1])
            },
            "counted": {
                k: {"lines": v[0], "revenue": round(v[1])}
                for k, v in sorted(counted.items(), key=lambda kv: -kv[1][1])
            },
            "other_top": [
                {"title": t, "revenue": round(r)}
                for t, r in other_titles.most_common(25)
            ],
        },
    }
