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
            a = agg.setdefault(key, [name, 0.0, 0.0, 0.0, 0, 0])
            a[0] = name
            a[1] += r.get("spend") or 0
            a[2] += r.get("purchase_value") or 0
            a[3] += r.get("purchases") or 0
            a[4] += r.get("clicks") or 0
            a[5] += r.get("impressions") or 0
        for key, a in agg.items():
            if key not in index:
                index[key] = len(names)
                names.append({"account": key[0], "id": key[1]})
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
                    a[5],
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
            key, [r.get("campaign_name") or "", 0.0, 0.0, 0.0, 0, 0]
        )
        a[0] = r.get("campaign_name") or a[0]
        a[1] += r.get("spend") or 0
        a[2] += r.get("conversion_value") or 0
        a[3] += r.get("conversions") or 0
        a[4] += r.get("clicks") or 0
        a[5] += r.get("impressions") or 0
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
                a[5],
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


def meta_tree(ctx: Context) -> dict:
    """Campaign > ad set > ad, per day, for the days that have ad-level data
    (the recent ones, plus the history filled in a few weeks per run)."""
    scfg = ctx.cfg["sessions"]
    camps: list[dict] = []
    c_idx: dict[tuple, int] = {}
    sets: list[dict] = []
    s_idx: dict[tuple, int] = {}
    ads: list[dict] = []
    a_idx: dict[tuple, int] = {}
    rows: list[list] = []
    days = []
    for day, day_rows in sorted((ctx.data.get("meta") or {}).items()):
        ad_rows = [
            r
            for r in day_rows
            if r.get("ad_id") is not None and r.get("campaign_name") is not None
        ]
        if not ad_rows:
            continue
        days.append(day)
        for r in ad_rows:
            ckey = (r["account_name"], str(r.get("campaign_id")))
            if ckey not in c_idx:
                c_idx[ckey] = len(camps)
                camps.append({"account": ckey[0], "id": ckey[1]})
            camps[c_idx[ckey]].update(
                name=r["campaign_name"],
                awareness=rules.is_awareness_name(r["campaign_name"], scfg),
            )
            # older caches carry no ad set id: fall back to its name
            skey = (ckey, str(r.get("adset_id") or r.get("adset_name") or ""))
            if skey not in s_idx:
                s_idx[skey] = len(sets)
                sets.append({"c": c_idx[ckey]})
            sets[s_idx[skey]]["name"] = r.get("adset_name") or "(ad set)"
            akey = (skey, str(r.get("ad_id")))
            if akey not in a_idx:
                a_idx[akey] = len(ads)
                ads.append({"s": s_idx[skey]})
            ads[a_idx[akey]]["name"] = r.get("ad_name") or str(r.get("ad_id"))
            rows.append(
                [
                    day,
                    a_idx[akey],
                    round(r.get("spend") or 0, 2),
                    round(r.get("purchase_value") or 0, 2),
                    round(r.get("purchases") or 0, 2),
                    r.get("clicks") or 0,
                    r.get("impressions") or 0,
                ]
            )
    return {
        "title": "Meta ads",
        "as_of": ctx.d1,
        "from": days[0] if days else None,
        "to": days[-1] if days else None,
        "campaigns": camps,
        "adsets": sets,
        "ads": ads,
        "rows": rows,
    }


def google_tree(ctx: Context) -> dict:
    """Campaign > ad group or asset group > ad, per day, from the Google Ads
    API. Performance Max has asset groups and no ads below them."""
    scfg = ctx.cfg["sessions"]
    camps: dict[str, dict] = {}
    for r in ctx.data.get("google_ads") or []:
        camps.setdefault(str(r["campaign_id"]), {})["name"] = r.get(
            "campaign_name"
        )
    c_list: list[dict] = []
    c_idx: dict[str, int] = {}
    groups: list[dict] = []
    g_idx: dict[tuple, int] = {}
    ads: list[dict] = []
    a_idx: dict[str, int] = {}
    group_rows: list[list] = []
    ad_rows: list[list] = []
    days = set()

    def camp(cid: str) -> int:
        if cid not in c_idx:
            name = (
                camps.get(cid, {}).get("name")
                or ctx.google_names.get(cid)
                or cid
            )
            c_idx[cid] = len(c_list)
            c_list.append(
                {
                    "id": cid,
                    "name": name,
                    "awareness": cid in ctx.aware_ids
                    or rules.is_awareness_name(name, scfg),
                }
            )
        return c_idx[cid]

    nums = lambda r: [
        round(r["spend"], 2),
        round(r["conversion_value"], 2),
        round(r["conversions"], 2),
        r["clicks"],
        r["impressions"],
    ]
    tree = ctx.data.get("google_tree") or []
    for r in tree:
        if r["level"] in ("ad_group", "asset_group"):
            key = (r["level"], r["group_id"])
            if key not in g_idx:
                g_idx[key] = len(groups)
                groups.append(
                    {
                        "c": camp(r["campaign_id"]),
                        "kind": r["level"],
                        "name": r["group_name"] or r["group_id"],
                    }
                )
            days.add(r["date"])
            group_rows.append([r["date"], g_idx[key], *nums(r)])
    for r in tree:
        if r["level"] != "ad":
            continue
        gkey = ("ad_group", r["group_id"])
        if gkey not in g_idx:
            continue
        if r["ad_id"] not in a_idx:
            a_idx[r["ad_id"]] = len(ads)
            nice = r["ad_type"].replace("_", " ").lower().capitalize()
            ads.append(
                {
                    "g": g_idx[gkey],
                    "name": r["ad_name"] or f"{nice} {r['ad_id']}",
                    "type": nice,
                }
            )
        ad_rows.append([r["date"], a_idx[r["ad_id"]], *nums(r)])
    return {
        "title": "Google ads",
        "as_of": ctx.d1,
        "from": min(days) if days else None,
        "to": max(days) if days else None,
        "campaigns": c_list,
        "groups": groups,
        "ads": ads,
        "group_rows": group_rows,
        "ad_rows": ad_rows,
    }
