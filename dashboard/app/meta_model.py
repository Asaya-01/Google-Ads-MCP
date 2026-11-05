"""The Meta view's classification layer: every ad gets four tags (scope,
offer, stage, SKU), computed once when the pages are built and reused by
every part of the view. The rules live in config.json ("meta_view"); see
its _about. Nothing here changes a spend, purchase or revenue number.
"""

from __future__ import annotations

import re
from functools import lru_cache

from . import rules, taxonomy

_SPLIT = re.compile(r"[^A-Z0-9&@]+")


def tokens(name: str | None) -> list[str]:
    """Whole tokens of a name: split on _ - | space + and any other
    punctuation except & (Glow&lift) and @ (B2@749)."""
    return [t for t in _SPLIT.split((name or "").upper()) if t]


@lru_cache(maxsize=None)
def _single_rx(tok: str) -> re.Pattern:
    # a single product also matches with a number or pack suffix: ITB1, UASPACK
    return re.compile(re.escape(tok) + r"(\d+|PACK\w*)?")


def codes_in(name: str | None, mcfg: dict) -> list[dict]:
    """The sku_codes a name carries, in config order."""
    toks = tokens(name)
    out = []
    for c in mcfg["sku_codes"]:
        single = c["type"] == "single"
        for m in c["match_tokens"]:
            mu = m.upper()
            if any(t == mu or (single and _single_rx(mu).fullmatch(t)) for t in toks):
                out.append(c)
                break
    return out


def sku_of(campaign: str, adset: str, ad: str, stage: str, mcfg: dict) -> dict:
    """{"code", "label", "kind", "level"}: kind is single, set, multi,
    catalog, offer_creative, sets or other; level says which name decided."""
    for level, name in (("ad", ad), ("adset", adset), ("campaign", campaign)):
        found = codes_in(name, mcfg)
        if not found:
            continue
        sets = [c for c in found if c["type"] != "single"]
        if sets:
            c = sets[0]
            return {"code": c["code"], "label": c["display_name"], "kind": "set", "level": level}
        if len(found) == 1:
            c = found[0]
            return {"code": c["code"], "label": c["display_name"], "kind": "single", "level": level}
        code = " + ".join(c["code"] for c in found)
        return {"code": code, "label": code, "kind": "multi", "level": level}
    labels = mcfg["labels"]
    if stage == "Catalog":
        return {"code": "CATALOG", "label": labels["CATALOG"], "kind": "catalog", "level": None}
    if re.search(mcfg["offer_regex"], (ad or "").upper()):
        return {"code": "OFFERCREATIVE", "label": labels["OFFERCREATIVE"], "kind": "offer_creative", "level": None}
    generic = set(mcfg["generic_set_tokens"])
    if any(generic & set(tokens(n)) for n in (ad, adset, campaign)):
        return {"code": "SETS", "label": labels["SETS"], "kind": "sets", "level": None}
    return {"code": "OTHER", "label": labels["OTHER"], "kind": "other", "level": None}


def offer_of(campaign: str, adset: str, ad: str, mcfg: dict) -> str:
    """Offer only from the ad name (offer ads say so); Non-offer from any
    level; otherwise Not tagged, so the name can be fixed."""
    non = re.compile(mcfg["non_offer_regex"])
    a = (ad or "").upper()
    if non.search(a):
        return "Non-offer"
    if re.search(mcfg["offer_regex"], a):
        return "Offer"
    if any(non.search((n or "").upper()) for n in (adset, campaign)):
        return "Non-offer"
    return "Not tagged"


def scope_of(campaign: str, scfg: dict) -> str:
    """Performance, Awareness, or Excluded (Reach and Amazon campaigns: in
    neither, as everywhere on the dashboard)."""
    kind = rules.campaign_kind(campaign, scfg)
    return {"perf": "Performance", "awareness": "Awareness"}.get(kind, "Excluded")


def classify(campaign: str, adset: str, ad: str, cfg: dict) -> dict:
    mcfg, tcfg = cfg["meta_view"], cfg["taxonomy"]
    stage = taxonomy.meta_stage(campaign, ad, tcfg)
    return {
        "scope": scope_of(campaign, cfg["sessions"]),
        "offer": offer_of(campaign, adset, ad, mcfg),
        "stage": stage,
        "sku": sku_of(campaign, adset, ad, stage, mcfg),
    }
