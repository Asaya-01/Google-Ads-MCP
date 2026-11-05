"""The Google view's data (Marketing › Google). Every entity is tagged once
by app.google_model; the browser sums rows at whatever level it shows and
works ratios out from the summed bases.

Every row is [day, entity, *F] with F in this order:
  cost, impressions, clicks, conversions, conv. value,      (purchase only)
  other conversions, other conv. value,                     (e.g. add to cart)
  video views, 25%, 50%, 75%, 100% watched,                 (TrueView)
  eligible impressions, abs.-top impressions, top impressions,
  impressions lost to rank, impressions lost to budget      (Search IS)
null where the report is off or the level has no such number.

Pages:
  google_ads       campaigns, ad groups / asset groups, ads, the matrix rows
  google_search    keywords and search terms (lazy: loaded with the view)
  google_products  Shopping products (lazy: on expand)
  google_assets    assets (lazy: on expand)
"""

from __future__ import annotations

from collections import defaultdict

from .. import google_model
from .common import Context

F = ["cost", "impr", "clicks", "conv", "value", "oconv", "oval", "views", "q25", "q50", "q75", "q100",
     "elig", "abs", "top", "lrank", "lbudget"]
NF = len(F)


def _r(x, n=2):
    return None if x is None else round(x, n)


def _split(view: dict, cats: set[str]) -> dict:
    """(level, id, date) -> [purchase conv, purchase value, other conv, other value]."""
    out: dict = defaultdict(lambda: [0.0, 0.0, 0.0, 0.0])
    for r in view.get("conv_split") or []:
        s = out[(r["level"], r["id"], r["date"])]
        if r["cat"] in cats:
            s[0] += r["conv"]
            s[1] += r["value"]
        else:
            s[2] += r["conv"]
            s[3] += r["value"]
    return out


def _is_parts(r: dict) -> list:
    """Shares → eligible / abs-top / top / lost impressions, so a share over
    any period is Σ impressions ÷ Σ eligible (never an average of shares)."""
    share = r.get("is")
    if not share or not r.get("impr"):
        return [None] * 5
    elig = r["impr"] / share
    f = lambda k: None if r.get(k) is None else r[k] * elig  # noqa: E731
    return [elig, f("abs_top"), f("top"), f("lost_rank"), f("lost_budget")]


def build(ctx: Context) -> dict:
    cfg, data = ctx.cfg, ctx.data
    gv = cfg["google_view"]
    view = data.get("google_view") or {}
    on = view.get("on") or {}
    objs = (view.get("objects") or {}) if on.get("objects") else {}
    ocamp, ogrp, oasg, oad = (objs.get(k) or {} for k in ("campaigns", "ad_groups", "asset_groups", "ads"))
    conv_levels = set(view.get("conv_levels") or []) if on.get("conv_split") else set()
    split = _split(view, set(gv["purchase_categories"]))
    pix = google_model.product_index(cfg)

    # ------------------------------------------------------------ dates
    dset = {r["date"] for r in data.get("google_ads") or []}
    dset |= {r["date"] for r in data.get("google_tree") or []}
    dates = sorted(d for d in dset if d <= ctx.d1)
    di = {d: i for i, d in enumerate(dates)}

    # ------------------------------------------------------------ entities
    skus: list[dict] = []
    k_idx: dict[str, int] = {}

    def sku(t: dict) -> int:
        if t["code"] not in k_idx:
            k_idx[t["code"]] = len(skus)
            skus.append({"code": t["code"], "label": t["label"], "kind": t["kind"]})
        return k_idx[t["code"]]

    names = {str(r["campaign_id"]): r.get("campaign_name") for r in data.get("google_ads") or []}
    camps: list[list] = []
    c_idx: dict[str, int] = {}
    ctag: dict[int, dict] = {}

    def camp(cid: str) -> int:
        cid = str(cid)
        if cid not in c_idx:
            o = ocamp.get(cid, {})
            name = names.get(cid) or o.get("name") or ctx.google_names.get(cid) or cid
            t = google_model.classify_campaign(name, cid, o.get("channel"), ctx.aware_ids, cfg)
            c_idx[cid] = len(camps)
            ctag[c_idx[cid]] = t
            camps.append([cid, name, t["scope"], t["segment"], t["type"], t["sub_type"], sku(t["sku"]),
                          o.get("status"), o.get("primary"), o.get("bidding"), o.get("budget_day"),
                          o.get("budget_total"), o.get("start"), o.get("end"), o.get("target_roas"),
                          "BUDGET_CONSTRAINED" in (o.get("reasons") or [])])
        return c_idx[cid]

    groups: list[list] = []
    g_idx: dict[str, int] = {}

    def group(gid: str, kind: str, cid: str, name: str | None) -> int:
        key = f"{kind}:{gid}"
        if key not in g_idx:
            ci = camp(cid)
            o = (oasg if kind == "asg" else ogrp).get(str(gid), {})
            nm = name or o.get("name") or str(gid)
            t = ctag[ci]
            s = google_model.sku_of_names(camps[ci][1], nm, t["segment"], cfg)
            g_idx[key] = len(groups)
            groups.append([str(gid), nm, ci, kind, o.get("status"), o.get("strength"), sku(s), o.get("primary"), o.get("type")])
        return g_idx[key]

    ads: list[list] = []
    a_idx: dict[str, int] = {}

    def ad(aid: str, gi: int, name: str | None, typ: str | None) -> int:
        if aid not in a_idx:
            o = oad.get(aid, {})
            nice = (typ or o.get("type") or "").replace("_", " ").lower().capitalize()
            a_idx[aid] = len(ads)
            ads.append([aid, name or o.get("name") or f"{nice} {aid}".strip(), gi, nice,
                        o.get("status"), o.get("strength"), o.get("url")])
        return a_idx[aid]

    # ------------------------------------------------------------ rows
    # a report's data is used only while its switch is on
    video = {(r["level"], r["id"], r["date"]): r for r in (view.get("video") or [] if on.get("video") else [])}
    iss = {(r["level"], r["id"], r["date"]): r for r in (view.get("impression_share") or [] if on.get("impression_share") else [])}

    def row(level: str, eid: str, date: str, cost, impr, clicks, conv, value) -> list:
        s = split.get((level, eid, date)) if level in conv_levels else None
        if level in conv_levels:
            pc, pv, oc, ov = s or (0.0, 0.0, 0.0, 0.0)
        else:  # no split for this level: Google's Conversions column as is
            pc, pv, oc, ov = conv, value, None, None
        v = video.get((level, eid, date))
        vid = [v["views"], v["q25"], v["q50"], v["q75"], v["q100"]] if v else ([0, 0, 0, 0, 0] if on.get("video") else [None] * 5)
        i = iss.get((level, eid, date))
        isp = _is_parts(i) if i else [None] * 5
        return [_r(cost), impr, clicks, _r(pc), _r(pv), _r(oc), _r(ov), *vid, *[_r(x, 1) for x in isp]]

    crows, grows, arows = [], [], []
    ctot: dict[tuple, list] = {}
    for r in data.get("google_ads") or []:
        if r["date"] not in di:
            continue
        cid = str(r["campaign_id"])
        ci = camp(cid)
        vals = row("campaign", cid, r["date"], r["spend"], r["impressions"], r["clicks"], r["conversions"], r["conversion_value"])
        crows.append([di[r["date"]], ci, *vals])
        ctot[(r["date"], ci)] = vals
    for r in data.get("google_tree") or []:
        if r["date"] not in di or r["level"] not in ("ad_group", "asset_group"):
            continue
        kind = "asg" if r["level"] == "asset_group" else "ag"
        gi = group(r["group_id"], kind, r["campaign_id"], r.get("group_name"))
        grows.append([di[r["date"]], gi, *row(r["level"], r["group_id"], r["date"], r["spend"], r["impressions"], r["clicks"], r["conversions"], r["conversion_value"])])
    for r in data.get("google_tree") or []:
        if r["date"] not in di or r["level"] != "ad":
            continue
        gi = g_idx.get(f"ag:{r['group_id']}")
        if gi is None:
            continue
        ai = ad(r["ad_id"], gi, r.get("ad_name"), r.get("ad_type"))
        arows.append([di[r["date"]], ai, *row("ad", r["ad_id"], r["date"], r["spend"], r["impressions"], r["clicks"], r["conversions"], r["conversion_value"])])
    # objects with no delivery in the window still get a row in the lists
    for cid in ocamp:
        camp(cid)

    # ------------------------------------------------------------ products (lazy page) and the matrix rows
    products, p_idx, prows = [], {}, []
    by_cd: dict[tuple, list] = defaultdict(list)  # (date, campaign) -> [(sku, cost, clicks, conv, value, oconv)]
    if on.get("products") and "products" in view:
        for r in view["products"]:
            if r["date"] not in di:
                continue
            ci = camp(r["campaign_id"])
            key = f"{r['campaign_id']}|{r['item']}"
            if key not in p_idx:
                t = google_model.sku_of_item(r["item"], pix, cfg)
                p_idx[key] = len(products)
                products.append([r["item"], r["title"], ci, sku(t), t["product"]])
            pi = p_idx[key]
            s = split.get(("product", key, r["date"])) if "product" in conv_levels else None
            pc, pv, oc = (s[0], s[1], s[2]) if s else ((0.0, 0.0, 0.0) if "product" in conv_levels else (r["conv"], r["value"], 0.0))
            prows.append([di[r["date"]], pi, _r(r["cost"]), r["impr"], r["clicks"], _r(pc), _r(pv), _r(oc)])
            by_cd[(r["date"], ci)].append((products[pi][3], r["cost"], r["clicks"], pc, pv, oc))
    # matrix rows: [day, campaign, sku, source (0 = product feed P, 1 = name N),
    #               cost, impressions (N only), clicks, conv, value]
    mrows = []
    for (date, ci), vals in ctot.items():
        d, name_sku = di[date], camps[ci][6]
        parts = by_cd.get((date, ci))
        if not parts:
            mrows.append([d, ci, name_sku, 1, vals[0], vals[1], vals[2], vals[3], vals[4]])
            continue
        agg: dict[int, list] = defaultdict(lambda: [0.0, 0, 0.0, 0.0])
        for k, cost, clicks, pc, pv, _oc in parts:
            a = agg[k]
            a[0] += cost; a[1] += clicks; a[2] += pc; a[3] += pv  # noqa: E702
        for k, a in agg.items():
            mrows.append([d, ci, k, 0, _r(a[0]), None, a[1], _r(a[2]), _r(a[3])])
        rest = [vals[0] - sum(a[0] for a in agg.values()), vals[2] - sum(a[1] for a in agg.values()),
                (vals[3] or 0) - sum(a[2] for a in agg.values()), (vals[4] or 0) - sum(a[3] for a in agg.values())]
        rest = [0 if abs(x) < 0.5 else x for x in rest]
        if any(rest):  # what the product report does not attribute stays on the name's SKU
            mrows.append([d, ci, name_sku, 1, _r(rest[0]), None, rest[1], _r(rest[2]), _r(rest[3])])

    # ------------------------------------------------------------ keywords and search terms (lazy page)
    kws, k_i, krows = [], {}, []
    for r in (view.get("keywords") or []) if on.get("keywords") else []:
        if r["date"] not in di:
            continue
        gi = group(r["group_id"], "ag", r["campaign_id"], None)
        if r["id"] not in k_i:
            k_i[r["id"]] = len(kws)
            kws.append([r["id"], r["text"], r["match"], gi, r["status"], r["qs"], r["qs_ctr"], r["qs_rel"], r["qs_lp"]])
        else:  # the latest day's Quality Score is today's
            kws[k_i[r["id"]]][5:9] = [r["qs"], r["qs_ctr"], r["qs_rel"], r["qs_lp"]]
        s = split.get(("keyword", r["id"], r["date"])) if "keyword" in conv_levels else None
        pc, pv = (s[0], s[1]) if s else ((0.0, 0.0) if "keyword" in conv_levels else (r["conv"], r["value"]))
        isp = _is_parts({**r, "lost_budget": None})
        krows.append([di[r["date"]], k_i[r["id"]], _r(r["cost"]), r["impr"], r["clicks"], _r(pc, 3), _r(pv),
                      _r(isp[0], 1), _r(isp[1], 1), _r(isp[3], 1)])
    terms, t_i, trows = [], {}, []
    gid_kw = {k[0]: i for i, k in enumerate(kws)}
    for r in (view.get("search_terms") or []) if on.get("search_terms") else []:
        if r["date"] not in di:
            continue
        gi = group(r["group_id"], "ag", r["campaign_id"], None)
        key = (gi, r["term"], r["kw_id"])
        if key not in t_i:
            t_i[key] = len(terms)
            terms.append([r["term"], gi, gid_kw.get(r["kw_id"]), r["match"], r["status"], r["kw_text"]])
        trows.append([di[r["date"]], t_i[key], _r(r["cost"]), r["impr"], r["clicks"], _r(r["conv"], 3), _r(r["value"])])

    # ------------------------------------------------------------ assets (lazy page)
    assets, x_i, xrows = [], {}, []
    for r in (view.get("assets") or []) if on.get("assets") else []:
        if r["date"] not in di:
            continue
        kind, pid = r["parent"].split(":", 1)
        if kind == "asg":
            parent = group(pid, "asg", r["campaign_id"], None)
        else:
            parent = a_idx.get(pid)
            if parent is None:
                continue
        key = f"{r['parent']}|{r['asset_id']}|{r['field']}"
        if key not in x_i:
            x_i[key] = len(assets)
            assets.append([r["asset_id"], kind, parent, r["type"], r["field"], r["text"], r["label"]])
        elif r["label"]:
            assets[x_i[key]][6] = r["label"]
        xrows.append([di[r["date"]], x_i[key], _r(r["cost"]), r["impr"], r["clicks"]])

    # campaigns whose Conversions column is all purchases over the window (so
    # levels with no split, like search terms, can show conversions)
    tot_conv: dict[int, float] = defaultdict(float)
    for r in data.get("google_ads") or []:
        if r["date"] in di:
            tot_conv[c_idx[str(r["campaign_id"])]] += r["conversions"] or 0
    pur_conv: dict[int, float] = defaultdict(float)
    for x in crows:
        pur_conv[x[1]] += x[2 + 3] or 0
    pure = [abs(tot_conv[i] - pur_conv[i]) <= max(0.5, 0.005 * tot_conv[i]) for i in range(len(camps))]

    acct = cfg["google_ads"]["account_id"]
    main = {
        "title": "Google",
        "as_of": ctx.d1,
        "dates": dates,
        "fields": F,
        "tree_from": view.get("from") or (min((r["date"] for r in data.get("google_tree") or []), default=None)),
        "assets_from": view.get("assets_from"),
        "account": acct,
        "on": on,
        "purchase_only": "campaign" in conv_levels,
        "conv_levels": sorted(conv_levels),
        # [id, name, scope, segment, type, sub_type, sku, status, primary status,
        #  bidding, daily budget, total budget, start, end, target ROAS, limited by budget]
        "campaigns": camps,
        "pure": pure,
        # [id, name, campaign, kind (ag / asg), status, ad strength, sku, primary status, ad group type]
        "groups": groups,
        # [id, name, group, type, status, ad strength, final URL]
        "ads": ads,
        "skus": skus,
        "crows": crows,
        "grows": grows,
        "arows": arows,
        "mrows": mrows,
        "has_products": bool(products),
        "unavailable": {k: v for k, v in (data.get("unavailable") or {}).items() if k.startswith("google")},
        "attribution_note": gv["attribution_note"] if "campaign" in conv_levels else gv["attribution_note"].replace(
            "the purchase action only", "every primary action (the purchase split is not read yet)"),
        "config": {k: gv[k] for k in ("min_cost_default", "grey_below_cost", "targets", "target_amber", "working",
                                      "watchlist", "leakage_amber", "validation", "labels", "brand_terms",
                                      "brand_terms_note", "hero_skus", "brand_sub_types")},
    }
    return {
        "google_ads": main,
        "google_search": {"title": "Google search", "as_of": ctx.d1, "dates": dates, "on": on,
                          # [id, text, match type, group, status, QS, expected CTR, ad relevance, landing page]
                          "keywords": kws,
                          # [day, keyword, cost, impressions, clicks, conv, value, eligible impr, abs-top impr, lost to rank]
                          "krows": krows,
                          # [term, group, keyword, match type, status, keyword text]
                          "terms": terms,
                          "trows": trows},
        "google_products": {"title": "Google products", "as_of": ctx.d1, "dates": dates, "on": on,
                            # [item id, title, campaign, sku, product-map code]
                            "products": products,
                            # [day, product, cost, impressions, clicks, conv, value, other conv]
                            "rows": prows},
        "google_assets": {"title": "Google assets", "as_of": ctx.d1, "dates": dates, "on": on,
                          # [asset id, parent kind (asg / ad), parent, type, field, text, performance label]
                          "assets": assets,
                          # [day, asset, cost, impressions, clicks]
                          "rows": xrows},
    }
