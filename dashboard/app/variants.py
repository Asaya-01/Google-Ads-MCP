"""Variant rows on the Products tab. Every product sold in more than one
pack is split by pack only: "Pack of 1" and "Pack of 2" (plus the size when
the product comes in more than one size: "Pack of 1 · 50 ml"). The shade or
fragrance mix is shown under each pack row, not as rows of its own. A
product sold in one pack only is split by its shade or fragrance.

An order line carries only its product (listing) ID and SKU. The variant is
found, in order:
1. from the listing's own variants in the Shopify catalog: the one with that
   SKU, or the listing's only variant with no SKU (pack-of-2 variants often
   have none);
2. from the catalog's SKU → variant title list;
3. by rule: a SKU that says x2 / pack of 2 / PACK_2 is a pack of 2, and a
   SKU-less line on a product that is sold in packs is its pack of 2 (true
   of every Asaya product checked: the pack-of-1 variants all carry the
   barcode SKU).
"""

from __future__ import annotations

import re

_PACK_X = re.compile(r"\s*[x×]\s*(\d+)\s*$", re.I)
_PACK_OF = re.compile(r"\bpack\s*of\s*(\d+)\b", re.I)
_SIZE = re.compile(r"^\s*(\d+(?:\.\d+)?)\s*(ml|g|gm|gms|kg|l)\s*$", re.I)


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


_SKU_PACK = re.compile(r"(?:x\s*|(?:pack|set)\s*_?(?:of)?\s*_?)(\d+)\s*$", re.I)


def _sku_pack(sku: str) -> int | None:
    m = _SKU_PACK.search((sku or "").replace("-", " ").strip())
    return int(m.group(1)) if m else None


def resolve(pid: str, sku: str, catalog: dict | None, listing: str, multi: bool) -> dict:
    """{"pack", "option", "size", "how"} for one order line."""
    title = find_title(pid, sku, catalog)
    how = "listing"
    if title is None and sku:
        title = ((catalog or {}).get("variant_titles") or {}).get(sku.strip())
        how = "sku"
    if title is not None or _PACK_OF.search(listing or "") or (listing and _SIZE.match(listing)):
        out = parse(title or "", listing)
        out["pack"] = max(out["pack"], _sku_pack(sku) or 1)  # "IMG 50g - Set of 2" on a Default Title
        out["how"] = how if title is not None else "listing name"
        return out
    rows = ((catalog or {}).get("variants_by_product") or {}).get(str(pid)) or []
    pack = _sku_pack(sku) or (2 if not sku and multi else 1)
    # a listing with several SKU-less variants: the line cannot say which one
    how = "ambiguous" if not sku and sum(1 for s, _ in rows if not s) > 1 and not multi else "rule"
    return {"pack": pack, "option": "", "size": None, "how": how}


def row_label(v: dict, multi: bool, sizes: int) -> str:
    """The row a line falls in: its pack for a product sold in packs (with
    the size when there is more than one), else its shade or fragrance."""
    if multi:
        return f"Pack of {v['pack']}" + (f" · {v['size']}" if sizes > 1 and v.get("size") else "")
    if v.get("how") == "ambiguous":
        return "Variant not on the order line"
    return v.get("option") or v.get("size") or "Single variant"
