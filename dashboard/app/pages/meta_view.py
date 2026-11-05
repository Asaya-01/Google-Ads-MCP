"""The Meta view's data: one row per ad per day (the cached ad-level days),
every ad tagged once by app.meta_model (scope, offer, stage, SKU), plus
status, budget and launch date from the object reads. The browser rolls up
whatever level it shows; ratios are always worked out from the summed bases.

rows: [day, ad, spend, impressions, clicks (all), link clicks, LPV, ATC,
       3-second plays, purchases, revenue, reach of that ad-day]
A day cached before the funnel fields were kept carries null for link
clicks, LPV, ATC, 3-second plays and reach; the refresh reads those days
again a few weeks per run.
"""

from __future__ import annotations

from .. import meta_model
from .common import Context

FUNNEL = ("link_clicks", "lpv", "atc", "video_3s", "reach")


def build(ctx: Context) -> dict:
    cfg = ctx.cfg
    objs = ctx.data.get("meta_objects") or {}
    ocamp, oset, oad = objs.get("campaigns", {}), objs.get("adsets", {}), objs.get("ads", {})
    accounts = list(cfg["meta"]["accounts"].items())
    acc_idx = {a: i for i, (a, _) in enumerate(accounts)}
    name_idx = {n: i for i, (_, n) in enumerate(accounts)}
    dates, camps, sets, ads, skus, rows = [], [], [], [], [], []
    c_idx, s_idx, a_idx, k_idx = {}, {}, {}, {}

    def budget(o: dict) -> list:
        return [o.get("daily_budget"), o.get("lifetime_budget")]

    for day, day_rows in sorted((ctx.data.get("meta") or {}).items()):
        ad_rows = [r for r in day_rows if r.get("ad_id") is not None]
        if not ad_rows:
            continue  # campaign-level history: no ad to tag
        di = len(dates)
        dates.append(day)
        for r in ad_rows:
            acc = acc_idx.get(r.get("account_id"), name_idx.get(r.get("account_name"), 0))
            cid = str(r.get("campaign_id"))
            if cid not in c_idx:
                o = ocamp.get(cid, {})
                c_idx[cid] = len(camps)
                camps.append([cid, r.get("campaign_name") or o.get("name") or cid, acc,
                              meta_model.scope_of(r.get("campaign_name") or "", cfg["sessions"]),
                              o.get("status"), o.get("objective"), *budget(o), o.get("created")])
            sid = str(r.get("adset_id") or r.get("adset_name") or "")
            if sid not in s_idx:
                o = oset.get(sid, {})
                s_idx[sid] = len(sets)
                sets.append([sid, r.get("adset_name") or "(ad set)", c_idx[cid], o.get("status"), *budget(o), o.get("created")])
            aid = str(r.get("ad_id"))
            if aid not in a_idx:
                o = oad.get(aid, {})
                t = meta_model.classify(r.get("campaign_name") or "", r.get("adset_name") or "", r.get("ad_name") or "", cfg)
                code = t["sku"]["code"]
                if code not in k_idx:
                    k_idx[code] = len(skus)
                    skus.append({"code": code, "label": t["sku"]["label"], "kind": t["sku"]["kind"]})
                a_idx[aid] = len(ads)
                ads.append([aid, r.get("ad_name") or aid, s_idx[sid], o.get("status"), o.get("created"),
                            t["stage"], k_idx[code], t["offer"], t["sku"]["level"]])
            has = all(k in r for k in FUNNEL[:3])
            rows.append([
                di, a_idx[aid], round(r.get("spend") or 0, 2), r.get("impressions") or 0, r.get("clicks") or 0,
                *([round(r.get(k) or 0, 2) for k in FUNNEL[:4]] if has else [None] * 4),
                round(r.get("purchases") or 0, 2), round(r.get("purchase_value") or 0, 2),
                (r.get("reach") or 0) if has else None,
            ])
    mv = cfg["meta_view"]
    return {
        "title": "Meta",
        "as_of": ctx.d1,
        "dates": dates,
        "accounts": [{"id": a, "name": n} for a, n in accounts],
        # [id, name, account, scope, status, objective, daily budget, lifetime budget, created]
        "campaigns": camps,
        # [id, name, campaign, status, daily budget, lifetime budget, created]
        "adsets": sets,
        # [id, name, ad set, status, created, stage, sku, offer, sku decided by (ad / adset / campaign)]
        "ads": ads,
        "skus": skus,
        "rows": rows,
        "objects_at": bool(objs),
        "attribution_note": mv["attribution_note"],
        "config": {k: mv[k] for k in ("min_spend_default", "grey_below_spend", "validation", "watchlist", "labels")},
    }
