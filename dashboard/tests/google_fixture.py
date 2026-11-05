"""A synthetic Google Ads dataset for the Google view tests: every report
switched on, made-up IDs and numbers (never real ones; this repo is public).
The ad groups and asset groups add up to their campaigns, so child = parent
holds; one awareness campaign bids on add-to-cart, as in the account."""

from __future__ import annotations

from app import rules

# id, name, channel, per-day cost, purchase conv, purchase value, other (ATC) conv, other value, impressions, clicks
CAMPS = [
    ("9000000001", "WOA_Search_Brand_Topkey_120825", "SEARCH", 6000, 60, 66000, 0, 0, 2000, 800),
    ("9000000002", "WOA_Pmax_Brand_AllProducts_130825", "PERFORMANCE_MAX", 15000, 50, 52000, 0, 0, 40000, 900),
    ("9000000003", "WOA_Pmax_ITB_110526", "PERFORMANCE_MAX", 20000, 20, 19000, 0, 0, 200000, 4000),
    ("9000000004", "WOA_Pmax_UAS_101025", "PERFORMANCE_MAX", 9000, 9, 8000, 0, 0, 90000, 1500),
    ("9000000005", "WOA_Pmax_Lifetime_Oct_B2@749_Phase1_131026", "PERFORMANCE_MAX", 8000, 30, 25000, 0, 0, 30000, 700),
    ("9000000006", "WOA_DemandGen_Rem_021225", "DEMAND_GEN", 10000, 25, 23000, 0, 0, 100000, 1000),
    ("9000000007", "WOA_Awareness_DemandGen_ATC_HydBlr_261026", "DEMAND_GEN", 2000, 0, 0, 50, 70000, 60000, 600),
    ("9000000008", "WOA_Awareness_VV_YT_TF_010626", "VIDEO", 3000, 0, 0, 0, 0, 60000, 120),
]
SALE_ONLY = {"9000000005"}
GROUP = {  # campaign -> (level, group id, name)
    "9000000001": ("ad_group", "8000000001", "TopKey_Brand"),
    "9000000002": ("asset_group", "8000000002", "Brand_signals"),
    "9000000003": ("asset_group", "8000000003", "ITB_All"),
    "9000000004": ("asset_group", "8000000004", "UAS_main"),
    "9000000005": ("asset_group", "8000000005", "Offer_B2@749"),
    "9000000006": ("ad_group", "8000000006", "Rem_UAS"),
    "9000000007": ("ad_group", "8000000007", "ATC_HydBlr"),
    "9000000008": ("ad_group", "8000000008", "HP_InMarket"),
}
ADS = {"8000000001": ["7000000001", "7000000002"], "8000000006": ["7000000006"], "8000000007": ["7000000007"], "8000000008": ["7000000008"]}
# Shopping products: campaign -> [(item, share of cost, share of purchase conv and value)]
PRODUCTS = {
    "9000000002": [("shopify_zz_9813999190329_50539527012665", 0.4, 0.45), ("shopify_zz_10107079721273_51745443283257", 0.3, 0.35)],
    "9000000003": [("shopify_zz_10107079721273_51745443283257", 0.7, 0.8), ("shopify_zz_10163957203257_52071710327097", 0.2, 0.1), ("", 0.05, 0.0)],
    "9000000004": [("shopify_zz_9813999190329_50539527012665", 0.8, 0.9)],
}
KEYWORDS = [("8000000001~11", "asaya", 0.9, 10), ("8000000001~12", "asya", 0.05, 8), ("8000000001~13", "worldofasaya", 0.05, 4)]
# search terms: (term, keyword id, share of the keyword's cost, converts?)
TERMS = [("asaya", "8000000001~11", 0.95, True), ("aasaya", "8000000001~11", 0.03, True), ("asya", "8000000001~12", 1.0, True),
         ("plum combo kit", "8000000001~13", 1.0, False)]


def add_google(data: dict, d1: str, start: str) -> dict:
    days = rules.date_range(start, d1)
    sale = set(rules.date_range("2026-09-25", "2026-09-29")) | set(rules.date_range("2026-10-22", "2026-10-26"))
    gads, tree, split, iss, video, kws, terms, prods, assets = [], [], [], [], [], [], [], [], []
    for d in days:
        for cid, name, ch, cost, conv, value, oconv, oval, impr, clicks in CAMPS:
            if cid in SALE_ONLY and d not in sale:
                continue
            gads.append({"date": d, "campaign_id": cid, "campaign_name": name, "spend": float(cost), "impressions": impr,
                         "clicks": clicks, "conversions": float(conv + oconv), "conversion_value": float(value + oval)})
            if conv:
                split.append({"level": "campaign", "id": cid, "date": d, "cat": "PURCHASE", "conv": float(conv), "value": float(value)})
            if oconv:
                split.append({"level": "campaign", "id": cid, "date": d, "cat": "ADD_TO_CART", "conv": float(oconv), "value": float(oval)})
            lvl, gid, gname = GROUP[cid]
            base = {"date": d, "campaign_id": cid, "spend": float(cost), "impressions": impr, "clicks": clicks,
                    "conversions": float(conv + oconv), "conversion_value": float(value + oval)}
            tree.append({**base, "level": lvl, "group_id": gid, "group_name": gname})
            for lv, key in ((lvl, gid),):
                if conv:
                    split.append({"level": lv, "id": key, "date": d, "cat": "PURCHASE", "conv": float(conv), "value": float(value)})
                if oconv:
                    split.append({"level": lv, "id": key, "date": d, "cat": "ADD_TO_CART", "conv": float(oconv), "value": float(oval)})
            ads = ADS.get(gid, [])
            for i, aid in enumerate(ads):
                f = 1 / len(ads)
                tree.append({**{k: (v * f if isinstance(v, float) else v) for k, v in base.items()}, "level": "ad", "group_id": gid,
                             "ad_id": aid, "ad_name": "", "ad_type": "RESPONSIVE_SEARCH_AD" if ch == "SEARCH" else "DEMAND_GEN_VIDEO_RESPONSIVE_AD"})
                if conv:
                    split.append({"level": "ad", "id": aid, "date": d, "cat": "PURCHASE", "conv": conv * f, "value": value * f})
                if oconv:
                    split.append({"level": "ad", "id": aid, "date": d, "cat": "ADD_TO_CART", "conv": oconv * f, "value": oval * f})
            if ch == "SEARCH":
                for lv, key, extra in (("campaign", cid, {"lost_budget": 0.0}), ("ad_group", gid, {"lost_budget": None})):
                    iss.append({"level": lv, "id": key, "date": d, "impr": impr, "is": 0.92, "abs_top": 0.86, "top": 0.87, "lost_rank": 0.08, **extra})
                for kid, text, share, qs in KEYWORDS:
                    kws.append({"date": d, "campaign_id": cid, "group_id": gid, "id": kid, "text": text, "match": "EXACT", "status": "ENABLED",
                                "qs": qs, "qs_rel": "BELOW_AVERAGE" if qs < 5 else "ABOVE_AVERAGE", "qs_lp": "ABOVE_AVERAGE", "qs_ctr": "AVERAGE",
                                "is": 0.92, "abs_top": 0.86, "lost_rank": 0.08, "cost": cost * share, "impr": int(impr * share),
                                "clicks": int(clicks * share), "conv": conv * share if text != "worldofasaya" else 0.0, "value": value * share if text != "worldofasaya" else 0.0})
                    split.append({"level": "keyword", "id": kid, "date": d, "cat": "PURCHASE", "conv": conv * share if text != "worldofasaya" else 0.0, "value": value * share if text != "worldofasaya" else 0.0})
                for term, kid, share, converts in TERMS:
                    k = next(x for x in KEYWORDS if x[0] == kid)
                    kc = cost * k[2]
                    terms.append({"date": d, "campaign_id": cid, "group_id": gid, "term": term, "status": "ADDED" if term == k[1] else "NONE",
                                  "match": "EXACT" if term == k[1] else "NEAR_EXACT", "kw_id": kid, "kw_text": k[1],
                                  "cost": kc * share * 0.9, "impr": int(impr * k[2] * share * 0.9), "clicks": int(clicks * k[2] * share * 0.9),
                                  "conv": conv * k[2] * share * 0.9 if converts else 0.0, "value": value * k[2] * share * 0.9 if converts else 0.0})
            if ch in ("VIDEO", "DEMAND_GEN"):
                for lv, key in (("campaign", cid), (lvl, gid), *(("ad", a) for a in ads)):
                    f = 1 / len(ads) if lv == "ad" else 1
                    video.append({"level": lv, "id": key, "date": d, "views": int(impr * 0.3 * f), "q25": impr * 0.4 * f, "q50": impr * 0.25 * f, "q75": impr * 0.18 * f, "q100": impr * 0.12 * f})
            for item, cs, vs in PRODUCTS.get(cid, []):
                pkey = f"{cid}|{item}"
                prods.append({"date": d, "campaign_id": cid, "item": item, "title": "Product " + item[-6:], "cost": cost * cs,
                              "impr": int(impr * 1.5), "clicks": int(clicks * cs), "conv": conv * vs, "value": value * vs})
                if conv * vs:
                    split.append({"level": "product", "id": pkey, "date": d, "cat": "PURCHASE", "conv": conv * vs, "value": value * vs})
            if lvl == "asset_group":
                for j, (field, typ, text) in enumerate((("HEADLINE", "TEXT", "Fade dark patches"), ("DESCRIPTION", "TEXT", "A roll-on for inner thighs"), ("MARKETING_IMAGE", "IMAGE", "img_a.png"))):
                    assets.append({"date": d, "campaign_id": cid, "parent": f"asg:{gid}", "asset_id": f"{gid}{j}", "type": typ, "field": field, "label": None,
                                   "text": text, "cost": cost * 0.6, "impr": int(impr * 0.6), "clicks": int(clicks * 0.6), "conv": 0.0, "value": 0.0})
    tree_from = days[0]
    on = {k: True for k in ("conv_split", "impression_share", "objects", "keywords", "search_terms", "products", "assets", "video")}
    objects = {
        "campaigns": {cid: {"name": name, "status": "PAUSED" if cid in SALE_ONLY else "ENABLED", "primary": "PAUSED" if cid in SALE_ONLY else "ELIGIBLE",
                            "reasons": ["BUDGET_CONSTRAINED"] if cid == "9000000001" else [], "bidding": "MAXIMIZE_CONVERSION_VALUE", "channel": ch,
                            "sub_channel": None, "start": "2026-01-01", "end": None, "budget_day": cost * 1.1, "budget_total": None,
                            "budget_period": "DAILY", "target_roas": None}
                      for cid, name, ch, cost, *_ in CAMPS},
        "ad_groups": {GROUP[c][1]: {"campaign_id": c, "name": GROUP[c][2], "status": "ENABLED", "type": None, "primary": "ELIGIBLE"} for c in GROUP if GROUP[c][0] == "ad_group"},
        "asset_groups": {GROUP[c][1]: {"campaign_id": c, "name": GROUP[c][2], "status": "ENABLED", "strength": "GOOD", "primary": "ELIGIBLE"} for c in GROUP if GROUP[c][0] == "asset_group"},
        "ads": {a: {"group_id": g, "name": "", "type": None, "status": "ENABLED", "strength": "POOR", "primary": "ELIGIBLE", "url": "https://example.com/p"} for g, l in ADS.items() for a in l},
    }
    data["google_ads"] = gads
    data["google_campaigns"] = [{"campaign_id": c[0], "campaign_name": c[1]} for c in CAMPS]
    data["google_tree"] = tree
    data["google_view"] = {
        "on": on, "from": tree_from, "assets_from": tree_from,
        "conv_levels": ["campaign", "ad_group", "asset_group", "ad", "keyword", "product"],
        "conv_split": split, "impression_share": iss, "objects": objects, "keywords": kws,
        "search_terms": terms, "products": prods, "assets": assets, "video": video,
    }
    return data
