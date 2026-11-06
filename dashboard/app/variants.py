"""Readable variant labels for the Products tab: which pack, which shade or
fragrance, which size. An order line carries only its product (listing) ID
and SKU, so the variant is found from the listing's variants in the Shopify
catalog: the one with that SKU, or the listing's only variant with no SKU
(several pack-of-2 variants have none).

Labels read "Pack of 1 · 50 g" / "Pack of 2 · 50 g each" for every product
sold in more than one pack size, so the two are never confused; products
sold in one pack only read just their option ("03 - Honeydew (Medium
tone)"). A listing the product map names for something other than its pack
or size ("Challenge", "All skin types") keeps that name at the end.
"""

from __future__ import annotations

import re

_PACK_X = re.compile(r"\s*[x×]\s*(\d+)\s*$", re.I)
_PACK_OF = re.compile(r"\bpack\s*of\s*(\d+)\b", re.I)
_SIZE = re.compile(r"^\s*(\d+(?:\.\d+)?)\s*(ml|g|gm|gms|kg|l)\s*$", re.I)
# listing names in the product map that only say pack or size
_PACK_OR_SIZE = re.compile(r"^\s*(pack\s*of\s*\d+|\d+(?:\.\d+)?\s*(ml|g|gm|gms|kg|l))\s*$", re.I)


def _size(text: str) -> str:
    m = _SIZE.match(text)
    return f"{m.group(1)} {m.group(2).lower().replace('gms', 'g').replace('gm', 'g')}" if m else text.strip()


def parse(title: str, listing: str = "") -> dict:
    """{"pack", "option", "size"} from a Shopify variant title and the
    product map's name for the listing ("Pack of 2", "50 ml", "")."""
    pack, option, size = None, [], None
    t = "" if (title or "").strip() == "Default Title" else (title or "")
    for part in [p.strip() for p in t.split("/") if p.strip()]:
        m = _PACK_OF.search(part)
        if m:
            pack = int(m.group(1))
            rest = _PACK_OF.sub("", part).strip(" -·")
            if rest:
                part = rest
            else:
                continue
        m = _PACK_X.search(part)
        if m:
            pack = int(m.group(1))
            part = _PACK_X.sub("", part)
        if _SIZE.match(part):
            size = _size(part)
        else:
            option.append(part)
    lm = _PACK_OF.search(listing or "")
    if pack is None and lm:
        pack = int(lm.group(1))
    if size is None and listing and _SIZE.match(listing):
        size = _size(listing)
    return {"pack": pack or 1, "option": " · ".join(option), "size": size}


def find_title(pid: str, sku: str, catalog: dict | None) -> str | None:
    """The Shopify variant title of an order line, or None if unknown."""
    rows = ((catalog or {}).get("variants_by_product") or {}).get(str(pid)) or []
    sku = (sku or "").strip()
    if sku:
        hit = [t for s, t in rows if s == sku]
    else:
        hit = [t for s, t in rows if not s]
    if len(set(hit)) == 1:
        return hit[0]
    if not sku and len(rows) == 1:
        return rows[0][1]
    return None


def label(parsed: dict, listing: str, multi_pack: bool) -> str:
    bits = []
    if multi_pack:
        bits.append(f"Pack of {parsed['pack']}")
    if parsed["option"]:
        bits.append(parsed["option"])
    if parsed["size"]:
        bits.append(parsed["size"] + (" each" if parsed["pack"] > 1 else ""))
    if listing and not _PACK_OR_SIZE.match(listing):
        bits.append(f"{listing} listing")
    return " · ".join(bits) or "Pack of 1"
