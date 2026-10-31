"""Builds the retention census from counted order lines.

Rules (carried over from the retention artifact):
 - freebies, merch, minis, gifts and travel kits never count (catalog rules);
 - orders by one customer less than 24 hours apart are one order (payment
   retries and COD re-attempts), their baskets merged;
 - a customer is followed from their first ever order;
 - customers with one order are kept as daily counts, the rest as timelines.
"""

from __future__ import annotations

import datetime as dt
from collections import Counter, defaultdict

from .catalog import Catalog, Line, label

IST = dt.timedelta(hours=5, minutes=30)


def build(
    rows,
    cat: Catalog,
    exclude_types: list[str],
    through: dt.date,
    variant_titles: dict[str, str] | None = None,
    dedupe_hours: int = 24,
) -> dict:
    variant_titles = variant_titles or {}
    customers: dict[str, dict[str, list]] = {}
    excluded = defaultdict(lambda: [0, 0.0])
    counted = defaultdict(lambda: [0, 0.0])
    other_titles: Counter = Counter()
    lines_in = 0
    for order_id, customer_id, ts, title, sku, ptype, revenue in rows:
        lines_in += 1
        line, why = cat.classify(
            title,
            sku,
            revenue,
            ptype,
            exclude_types,
            variant_titles.get((sku or "").strip(), ""),
        )
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
            order_id, [ts, set()]
        )
        order[1].add(line)

    gap = dt.timedelta(hours=dedupe_hours)
    merged_pairs = orders_counted = orders_empty = 0
    timelines: dict[str, list[tuple[dt.date, set[Line]]]] = {}
    for cid, orders in customers.items():
        seq: list[list] = []
        for ts, lines in sorted(orders.values(), key=lambda o: o[0]):
            if seq and ts - seq[-1][0] < gap:
                seq[-1][1] |= lines
                merged_pairs += 1
            else:
                seq.append([ts, set(lines)])
        orders_counted += len(seq)
        timelines[cid] = [((ts + IST).date(), lines) for ts, lines in seq]

    first = min(tl[0][0] for tl in timelines.values())
    ndays = (through - first).days

    present = {ln for tl in timelines.values() for _, ls in tl for ln in ls}
    codes = [c for c in cat.order if any(ln.code == c for ln in present)]
    sku_idx = {c: i for i, c in enumerate(codes)}
    ordered = sorted(
        present,
        key=lambda ln: (sku_idx[ln.code], ln.sub != "—" and ln.sub, ln.pack),
    )
    var_idx = {ln: i for i, ln in enumerate(ordered)}

    multi: list[str] = []
    singles: dict[int, Counter] = defaultdict(Counter)
    singles_s: dict[int, Counter] = defaultdict(Counter)
    sbrand: Counter = Counter()
    n_multi = n_single = 0
    for tl in timelines.values():
        if len(tl) >= 2:
            n_multi += 1
            parts = []
            for d, lines in tl:
                vids = sorted({var_idx[ln] for ln in lines})
                parts.append(f"{(d - first).days}:{','.join(map(str, vids))}")
            multi.append("N" + "|".join(parts))
        else:
            n_single += 1
            d, lines = tl[0]
            day = (d - first).days
            for v in {var_idx[ln] for ln in lines}:
                singles[v][day] += 1
            skus = {sku_idx[ln.code] for ln in lines}
            for s in skus:
                singles_s[s][day] += 1
            sbrand[(day, min(len(skus), 3))] += 1

    def pack_singles(src):
        return {
            str(k): sorted([d, n, 0] for d, n in v.items())
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
        "singles": pack_singles(singles),
        "singles_s": pack_singles(singles_s),
        "sbrand": sorted([d, z, n, 0] for (d, z), n in sbrand.items()),
        "stats": {
            "through": through.isoformat(),
            "lines_in": lines_in,
            "customers": len(timelines),
            "customers_multi": n_multi,
            "customers_single": n_single,
            "orders_with_lines": orders_counted + merged_pairs,
            "orders_counted": orders_counted,
            "merged_pairs": merged_pairs,
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
