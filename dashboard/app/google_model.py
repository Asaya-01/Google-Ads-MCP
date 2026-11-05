"""The Google view's classification layer: every campaign, ad group and
asset group gets its tags once, when the pages are built, and every part of
the view reads them (never computed in the browser). The rules live in
config.json ("google_view", "taxonomy.google_groups", the shared
"meta_view.sku_codes" and "product_map"). Nothing here changes a cost,
conversion or value number.
"""

from __future__ import annotations

import re

from . import meta_model, rules, taxonomy

CHANNEL_TYPE = {
    "SEARCH": "Search",
    "PERFORMANCE_MAX": "PMax",
    "DEMAND_GEN": "Demand Gen",
    "VIDEO": "Video",
    "DISPLAY": "Display",
    "SHOPPING": "Shopping",
}
# the type a sub_type implies, while Google's channel type is not read
SUB_TYPE_TYPE = {
    "Brand Search": "Search",
    "Non-brand Search": "Search",
    "Brand PMax": "PMax",
    "Non-brand PMax": "PMax",
    "Demand Gen": "Demand Gen",
    "YouTube": "Video",
}


def scope_of(name: str, campaign_id: str, aware_ids: set[str], scfg: dict) -> str:
    """Performance or Awareness, by the dashboard's one rule (the name says
    awareness, or the ID is a listed awareness campaign); Reach and Amazon
    campaigns are in neither, as on every tab."""
    if campaign_id in aware_ids or rules.is_awareness_name(name, scfg):
        return "Awareness"
    kind = rules.campaign_kind(name, scfg)
    return {"perf": "Performance", "awareness": "Awareness"}.get(kind, "Excluded")


def sub_type_of(name: str, tcfg: dict) -> str:
    """The Marketing tree's split (Brand Search, Brand PMax, Non-brand PMax,
    Demand Gen, YouTube, Non-brand Search; else Other)."""
    return taxonomy.google_group(name, tcfg)


def segment_of(sub_type: str, gcfg: dict) -> str:
    return "Brand" if sub_type in gcfg["brand_sub_types"] else "Non-brand"


def type_of(channel: str | None, sub_type: str) -> str:
    if channel:
        return CHANNEL_TYPE.get(channel, channel.replace("_", " ").title())
    return SUB_TYPE_TYPE.get(sub_type, "Other")


def sku_of_names(campaign: str, group: str | None, segment: str, cfg: dict) -> dict:
    """SKU from the ad group / asset group name, then the campaign name, on
    the shared token list. No code: an offer name is Offer-only, a brand
    campaign is Brand (all products), generic set words are Sets, else Other.
    {"code", "label", "kind", "level"}"""
    mcfg, labels = cfg["meta_view"], cfg["google_view"]["labels"]
    for level, name in (("group", group), ("campaign", campaign)):
        found = meta_model.codes_in(name, mcfg)
        if not found:
            continue
        sets = [c for c in found if c["type"] != "single"]
        if sets:
            return {"code": sets[0]["code"], "label": sets[0]["display_name"], "kind": "set", "level": level}
        if len(found) == 1:
            return {"code": found[0]["code"], "label": found[0]["display_name"], "kind": "single", "level": level}
        code = " + ".join(c["code"] for c in found)
        return {"code": code, "label": code, "kind": "multi", "level": level}
    up = " ".join(n or "" for n in (group, campaign)).upper()
    if re.search(mcfg["offer_regex"], up):
        return {"code": "OFFER", "label": labels["OFFER"], "kind": "offer", "level": None}
    if segment == "Brand":
        return {"code": "BRAND", "label": labels["BRAND"], "kind": "brand", "level": None}
    generic = set(mcfg["generic_set_tokens"])
    if any(generic & set(meta_model.tokens(n)) for n in (group, campaign)):
        return {"code": "SETS", "label": labels["SETS"], "kind": "sets", "level": None}
    return {"code": "OTHER", "label": labels["OTHER"], "kind": "other", "level": None}


_ITEM = re.compile(r"shopify_[a-z]{2}_(\d+)_(\d+)", re.I)


def product_index(cfg: dict) -> dict:
    """Shopify product ID -> (product-map code, short name, variant name),
    and product-map code -> the shared SKU code it rolls up to."""
    by_id, sku_of_code = {}, {}
    for p in cfg["product_map"]["products"]:
        for pid, variant in (p.get("ids") or {}).items():
            by_id[str(pid)] = (p["code"], p["name"], variant)
    for s in cfg["meta_view"]["sku_codes"]:
        for code in s.get("product_codes") or []:
            sku_of_code.setdefault(code, s)
    return {"by_id": by_id, "sku": sku_of_code}


def sku_of_item(item_id: str, pix: dict, cfg: dict) -> dict:
    """A Shopping product item (shopify_zz_<product id>_<variant id>) to its
    SKU: the product map gives the house code, the shared sku_codes the SKU it
    rolls up to (a product with no SKU entry is its own SKU)."""
    labels = cfg["google_view"]["labels"]
    m = _ITEM.fullmatch(item_id or "")
    if not item_id:
        return {"code": "NOTPRODUCT", "label": labels["NOTPRODUCT"], "kind": "notproduct", "product": None}
    hit = pix["by_id"].get(m.group(1)) if m else None
    if not hit:
        return {"code": "UNMAPPED", "label": labels["UNMAPPED"], "kind": "unmapped", "product": m.group(1) if m else item_id}
    code, name, _variant = hit
    s = pix["sku"].get(code)
    if s:
        return {"code": s["code"], "label": s["display_name"], "kind": "set" if s["type"] != "single" else "single", "product": code}
    return {"code": code, "label": name, "kind": "single", "product": code}


def classify_campaign(name: str, campaign_id: str, channel: str | None, aware_ids: set[str], cfg: dict) -> dict:
    sub = sub_type_of(name, cfg["taxonomy"])
    seg = segment_of(sub, cfg["google_view"])
    return {
        "scope": scope_of(name, campaign_id, aware_ids, cfg["sessions"]),
        "segment": seg,
        "type": type_of(channel, sub),
        "sub_type": sub,
        "sku": sku_of_names(name, None, seg, cfg),
    }
