"""Compact per-day tables the browser aggregates for any date range.

Not tabs. Marketing needs per-day, per-campaign spend and value; Products
needs per-day, per-product units and revenue. Each is stored once for the
whole history window, as rows of numbers plus a list of names, and the
browser sums whatever days the picker selects.
"""

from __future__ import annotations

from .. import rules, taxonomy
from .common import Context


def _meta_campaign(name: str, cfg: dict) -> dict:
    """Kind, and the stage, goal and products the campaign name alone gives
    (used for days with no ad-level detail)."""
    tcfg = cfg["taxonomy"]
    kind = rules.campaign_kind(name, cfg["sessions"])
    out = {
        "kind": kind,
        "awareness": kind == "awareness",
        "stage": taxonomy.meta_stage(name, None, tcfg),
    }
    out["prod"] = taxonomy.product_of(
        [name], tcfg, catalog=out["stage"] == "Catalog"
    )
    if kind == "awareness":
        out["goal"] = taxonomy.awareness_goal(name, tcfg)
    return out


def _google_campaign(name: str, aware: bool, cfg: dict) -> dict:
    tcfg = cfg["taxonomy"]
    kind = "awareness" if aware else rules.campaign_kind(name, cfg["sessions"])
    group = taxonomy.google_group(name, tcfg)
    return {
        "kind": kind,
        "awareness": kind == "awareness",
        "group": group,
        "prod": (
            taxonomy.product_of([name], tcfg)
            if group in tcfg["google_sku_groups"]
            else []
        ),
    }


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
            names[index[key]].update(name=a[0], **_meta_campaign(a[0], ctx.cfg))
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
            **_google_campaign(
                name,
                cid in ctx.aware_ids or rules.is_awareness_name(name, scfg),
                ctx.cfg,
            ),
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
        "labels": taxonomy.labels(ctx.cfg["taxonomy"]),
        "google_sku_groups": ctx.cfg["taxonomy"]["google_sku_groups"],
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
    (the recent ones, plus the history filled in a few weeks per run). Each
    ad carries its funnel stage and products, read from its own name."""
    tcfg = ctx.cfg["taxonomy"]
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
                **_meta_campaign(r["campaign_name"], ctx.cfg),
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
            ad = ads[a_idx[akey]]
            ad["name"] = r.get("ad_name") or str(r.get("ad_id"))
            if "stage" not in ad:
                # the ad's own name decides its stage and product
                ad["stage"] = taxonomy.meta_stage(
                    r["campaign_name"], r.get("ad_name"), tcfg
                )
                ad["prod"] = taxonomy.product_of(
                    [r.get("ad_name"), r.get("adset_name"), r["campaign_name"]],
                    tcfg,
                    catalog=ad["stage"] == "Catalog",
                )
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
                    **_google_campaign(
                        name,
                        cid in ctx.aware_ids
                        or rules.is_awareness_name(name, scfg),
                        ctx.cfg,
                    ),
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


def channels(ctx: Context) -> dict:
    """Sessions, add-to-carts, orders and GMV per day by the channel the UTM
    says they came from (last click, as Shopify records it), split by
    campaign type so each view can keep its own. Rows are
    [date, channel, kind, sessions, atc, orders, gmv]."""
    names: list[str] = []
    index: dict[str, int] = {}
    kinds = ["perf", "awareness", "social"]
    agg: dict[tuple, list] = {}

    def slot(day: str, channel: str, kind: str) -> list:
        if channel not in index:
            index[channel] = len(names)
            names.append(channel)
        key = (day, index[channel], kinds.index(kind))
        return agg.setdefault(key, [0, 0, 0, 0.0])

    sessions_days = set()
    for day, rows in ctx.session_rows.items():
        sessions_days.add(day)
        for r in rows:
            a = slot(day, r["channel"], r["kind"])
            a[0] += r["sessions"] or 0
            a[1] += r["atc"] or 0
    order_days = set()
    for r in ctx.order_rows:
        order_days.add(r["date"])
        a = slot(r["date"], r["channel"], r["kind"])
        a[2] += r.get("orders") or 0
        a[3] += r.get("gmv") or 0.0
    return {
        "title": "Channel days",
        "as_of": ctx.d1,
        "channels": names,
        "kinds": kinds,
        "rows": [
            [d, c, k, a[0], a[1], a[2], round(a[3], 2)]
            for (d, c, k), a in sorted(agg.items())
        ],
        # a day missing from either list has no data for it, not zero
        "session_days": sorted(sessions_days),
        "order_days": sorted(order_days),
    }


SLAB_TOP = 5  # the last slab is "5 or more"


def slabs(ctx: Context) -> dict:
    """Basket size per day: orders, units and sales by how many items the
    order held (gifts, merch and the other excluded types do not count).
    Rows are [date, slab, orders, units, sales, gmv]. Slab 0 is an order
    with nothing but excluded items; SLAB_TOP is "that many or more"."""
    rows = ctx.data.get("order_slabs")
    if rows is None:
        return {
            "title": "Basket size",
            "as_of": ctx.d1,
            "top": SLAB_TOP,
            "rows": [],
            "days": [],
            "na": "the basket-size query has not been loaded",
        }
    return {
        "title": "Basket size",
        "as_of": ctx.d1,
        "top": SLAB_TOP,
        "rows": [
            [
                r["date"],
                int(r["slab"]),
                int(r["orders"]),
                int(r["units"] or 0),
                round(r["sales"] or 0, 2),
                round(r["gmv"] or 0, 2),
            ]
            for r in sorted(rows, key=lambda r: (r["date"], r["slab"]))
        ],
        # a day with orders always has a row; a day absent here has no data
        "days": sorted({r["date"] for r in rows}),
        "na": None,
    }
