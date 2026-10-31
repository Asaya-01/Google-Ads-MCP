"""Compact per-day tables the browser aggregates for any date range.

Not tabs. Marketing needs per-day, per-campaign spend and value; Products
needs per-day, per-product units and revenue. Each is stored once for the
whole history window, as rows of numbers plus a list of names, and the
browser sums whatever days the picker selects.
"""

from __future__ import annotations

from .. import rules
from .common import Context
from .products import _mrp


def campaigns(ctx: Context) -> dict:
    scfg = ctx.cfg["sessions"]
    # Meta: campaign level per day, from the cache (ad-level days are summed)
    names: list[dict] = []
    index: dict[tuple, int] = {}
    rows: list[list] = []
    for day, day_rows in sorted((ctx.data.get("meta") or {}).items()):
        agg: dict[tuple, list] = {}
        for r in day_rows:
            name = r.get("campaign_name")
            if name is None:  # account-level rows carry no campaign
                continue
            key = (r["account_name"], str(r.get("campaign_id")))
            a = agg.setdefault(key, [name, 0.0, 0.0, 0.0, 0])
            a[0] = name
            a[1] += r.get("spend") or 0
            a[2] += r.get("purchase_value") or 0
            a[3] += r.get("purchases") or 0
            a[4] += r.get("clicks") or 0
        for key, a in agg.items():
            if key not in index:
                index[key] = len(names)
                names.append({"account": key[0]})
            names[index[key]].update(
                name=a[0],
                awareness=rules.is_awareness_name(a[0], scfg),
            )
            rows.append(
                [
                    day,
                    index[key],
                    round(a[1], 2),
                    round(a[2], 2),
                    round(a[3], 2),
                    a[4],
                ]
            )
    meta = {"names": names, "rows": rows}

    g_names: list[dict] = []
    g_index: dict[str, int] = {}
    g_rows: list[list] = []
    agg_g: dict[tuple, list] = {}
    for r in ctx.data.get("google_ads") or []:
        key = (r["date"], str(r["campaign_id"]))
        a = agg_g.setdefault(
            key, [r.get("campaign_name") or "", 0.0, 0.0, 0.0, 0]
        )
        a[0] = r.get("campaign_name") or a[0]
        a[1] += r.get("spend") or 0
        a[2] += r.get("conversion_value") or 0
        a[3] += r.get("conversions") or 0
        a[4] += r.get("clicks") or 0
    for (day, cid), a in sorted(agg_g.items()):
        if cid not in g_index:
            g_index[cid] = len(g_names)
            g_names.append({"id": cid})
        name = a[0] or ctx.google_names.get(cid) or cid
        g_names[g_index[cid]].update(
            name=name,
            awareness=(cid in ctx.aware_ids)
            or rules.is_awareness_name(name, scfg),
        )
        g_rows.append(
            [
                day,
                g_index[cid],
                round(a[1], 2),
                round(a[2], 2),
                round(a[3], 2),
                a[4],
            ]
        )
    return {
        "title": "Campaign days",
        "as_of": ctx.d1,
        "meta": meta,
        "google": {"names": g_names, "rows": g_rows},
    }


def products(ctx: Context) -> dict:
    catalog = ctx.data.get("catalog")
    names: list[dict] = []
    index: dict[str, int] = {}
    agg: dict[tuple, list] = {}
    types: list[str] = []
    type_index: dict[str, int] = {}
    type_rows: dict[tuple, list] = {}
    for r in ctx.data.get("products") or []:
        t = r["product_type"] or ""
        if t not in type_index:
            type_index[t] = len(types)
            types.append(t)
        dropped = 1 if r["drop_reason"] else 0
        tr = type_rows.setdefault(
            (r["date"], type_index[t], dropped), [0, 0, 0.0]
        )
        tr[0] += r["line_count"]
        tr[1] += r["units"]
        tr[2] += r["revenue"]
        if dropped:
            continue
        pid = str(r["product_id"] or "(none)")
        if pid not in index:
            index[pid] = len(names)
            names.append({"id": pid})
        names[index[pid]].update(
            label=r["product_title"], type=r["product_type"]
        )
        a = agg.setdefault((r["date"], index[pid]), [0, 0.0, 0.0, 0, 0.0])
        a[0] += r["units"]
        a[1] += r["revenue"]
        mrp = _mrp(r, catalog)
        if mrp:
            a[2] += mrp * r["units"]
            a[3] += r["units"]
            a[4] += r["revenue"]
    rows = [
        [d, i, a[0], round(a[1], 2), round(a[2], 2), a[3], round(a[4], 2)]
        for (d, i), a in sorted(agg.items())
    ]
    trows = [
        [d, ti, dropped, v[0], v[1], round(v[2], 2)]
        for (d, ti, dropped), v in sorted(type_rows.items())
    ]
    return {
        "title": "Product days",
        "as_of": ctx.d1,
        "names": names,
        "rows": rows,
        "types": types,
        "type_rows": trows,
        "mrp_available": bool(catalog),
    }
