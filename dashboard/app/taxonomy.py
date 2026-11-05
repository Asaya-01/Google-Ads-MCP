"""Where a campaign or ad sits in the team's reporting structure, read from
its name: the funnel stage (TOF / MOF / BOF / Catalog) and the product (SKU)
for Meta, the campaign group (Brand Search, Brand PMax, Non-brand PMax, ...)
and the product for Google. The rules and codes live in config.json
("taxonomy"), so a new product code is a config change, not a code change.

Meta stage, the same rules as the daily Meta report:
  - "Catalog", "Catalogue" or "AllFunnels" in the campaign or ad name: Catalog
  - an ad name starting MOF_ or BOF_ (MG_MOF_ too): that stage. Offer
    campaigns are named TOF but carry MOF and BOF ads during a sale; those ads
    belong to MOF and BOF, not TOF.
  - otherwise MOF / BOF / TOF in the campaign name, and TOF if none.
Awareness campaigns have no stage; they are grouped by goal (ATC, landing
page views) instead.

Product, first match wins: the ad name, then the ad set, then the campaign.
Sets (Target & Fade Duo, Even Skin Duo, Body Trio, ...) are their own rows.
An ad naming two products (UAS+ITB) counts half to each. An ad with no
product is a site-wide offer ad (B2@749, Buy2@849, "Offer"), a catalog ad
(the whole catalog), or Unmapped, so the rows still add up to the total.
"""

from __future__ import annotations

import re

_SPLIT = re.compile(r"[^A-Z0-9&]+")


def _flat(name: str) -> str:
    return re.sub(r"[^A-Z0-9&]", "", (name or "").upper())


def _tokens(name: str) -> list[str]:
    return [t for t in _SPLIT.split((name or "").upper()) if t]


def products(name: str, tcfg: dict) -> list[str]:
    """Product codes a name carries, in a stable order; [] if none."""
    flat, toks = _flat(name), _tokens(name)
    out: list[str] = []
    for s in tcfg["sets"]:
        if any(k in flat for k in s["contains"]) and s["code"] not in out:
            out.append(s["code"])
    for p in tcfg["products"]:
        code = p["code"]
        if code in out:
            continue
        for tok in toks:
            for m in p["match"]:
                # UAS, UAS2, UASPACK, UASs; never a longer word that only
                # starts with the code (ASSAM is not ASS)
                if tok == m or re.fullmatch(
                    re.escape(m) + r"(\d+|PACK\w*|S)", tok
                ):
                    out.append(code)
                    break
            if code in out:
                break
    if not out and any(t in tcfg["generic_sets"] for t in toks):
        out.append("SETS")
    return out


def is_catalog(name: str, tcfg: dict) -> bool:
    flat = _flat(name)
    return any(k in flat for k in tcfg["catalog_contains"])


def meta_stage(campaign: str, ad: str | None, tcfg: dict) -> str:
    if is_catalog(campaign, tcfg) or (ad and is_catalog(ad, tcfg)):
        return "Catalog"
    a = (ad or "").upper()
    for st in ("MOF", "BOF"):
        if re.match(rf"^(MG_)?{st}(_|$)", a):
            return st
    c = (campaign or "").upper()
    for st in ("BOF", "MOF", "TOF"):
        if re.search(rf"(^|_){st}(_|$)", c):
            return st
    return "TOF"


def awareness_goal(campaign: str, tcfg: dict) -> str:
    toks = _tokens(campaign)
    for goal in tcfg["awareness_goals"]:
        if any(t in toks for t in goal["tokens"]):
            return goal["label"]
    return "Other"


def is_offer(name: str, tcfg: dict) -> bool:
    return bool(re.search(tcfg["offer_regex"], (name or "").upper()))


def product_of(
    names: list[str | None], tcfg: dict, catalog: bool = False
) -> list[str]:
    """Codes from the first name (ad, ad set, campaign) that has any;
    otherwise OFFER, CATALOG or UNMAPPED."""
    for n in names:
        if n:
            got = products(n, tcfg)
            if got:
                return got
    if catalog:
        return ["CATALOG"]
    if any(n and is_offer(n, tcfg) for n in names):
        return ["OFFER"]
    return ["UNMAPPED"]


def google_group(campaign: str, tcfg: dict) -> str:
    toks = _tokens(campaign)
    flat = _flat(campaign)
    for g in tcfg["google_groups"]:
        need = g.get("all", [])
        none = g.get("none", [])
        if all(k in flat for k in need) and not any(k in flat for k in none):
            if g.get("any") and not any(t in toks for t in g["any"]):
                continue
            # a pattern on the raw (upper-cased) name, e.g. a price offer
            if g.get("rx") and not re.search(g["rx"], (campaign or "").upper()):
                continue
            return g["label"]
    return "Other"


def labels(tcfg: dict) -> dict:
    """code -> display name, for the browser."""
    out = {p["code"]: p["label"] for p in tcfg["products"]}
    out.update({s["code"]: s["label"] for s in tcfg["sets"]})
    out.update(tcfg["special_labels"])
    return out
