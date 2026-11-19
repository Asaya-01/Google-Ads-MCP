"""Turns an order line (title, sku, revenue, product type) into a canonical
retention product, or an exclusion reason. The rules live in
retention_catalog.json so they can be edited and run in SQL as well."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass

from .. import settings

PATH = settings.ROOT / "retention_catalog.json"
NON_ASCII = re.compile(r"[^\x00-\x7f]")
SPACES = re.compile(r"\s+")


def normalise(title: str) -> str:
    return SPACES.sub(" ", NON_ASCII.sub(" ", (title or "").lower())).strip()


@dataclass(frozen=True)
class Line:
    """One counted order line: a product, and which variant and pack."""

    code: str
    sub: str  # fragrance or shade; "—" when the product has none
    pack: int  # units in one line of it: 1, or the pack size (2, 6...)


class Catalog:
    def __init__(self, spec: dict | None = None):
        spec = spec or json.loads(PATH.read_text(encoding="utf-8"))
        self.spec = spec
        rx = lambda rules: [
            (r["reason"], re.compile(r["pattern"])) for r in rules
        ]
        self.always = rx(spec["exclude_always"])
        self.if_untyped = rx(spec["exclude_if_type_unknown"])
        self.unless = rx(spec["exclude_unless_product"])
        self.products = [
            {**p, "_re": re.compile(p["pattern"])} for p in spec["products"]
        ]
        self.groups = [
            {**g, "_re": re.compile(g["pattern"])} for g in spec["groups"]
        ]
        self.other = spec["other"]
        self.pack_re = re.compile(spec["pack_pattern"])
        self.combo_hints = [
            (re.compile(rx), n) for rx, n in (spec.get("combo_hint") or {}).get("rules", [])
        ]
        self.names = {p["code"]: p["name"] for p in self.products}
        self.names.update({g["code"]: g["name"] for g in self.groups})
        self.names[self.other["code"]] = self.other["name"]
        self.order = (
            [p["code"] for p in self.products]
            + [g["code"] for g in self.groups]
            + [self.other["code"]]
        )

    def classify(
        self,
        title: str,
        sku: str,
        revenue: float,
        product_type: str,
        exclude_types: list[str],
        variant_title: str = "",
        pack: int | None = None,
    ) -> tuple[Line | None, str | None]:
        """(Line, None) for a counted line, (None, reason) for an excluded one.

        Shopify's own product type decides what is not a product (Freebie,
        Merch, Book, Gummies). A blank type counts only when the title is a
        named product; a product Shopify no longer has (no type to go by) is
        judged by its title."""
        ptype = product_type or ""
        if revenue is None or revenue <= 0:
            return None, "zero revenue (free)"
        if "🎁" in (title or ""):
            return None, "gift line"
        if ptype and ptype in exclude_types:
            return None, f"product type: {ptype}"
        nt = normalise(title)
        for reason, rx in self.always:
            if rx.search(nt):
                return None, reason
        if ptype in ("", "(no product match)"):
            for reason, rx in self.if_untyped:
                if rx.search(nt):
                    return None, reason
        for p in self.products:
            if p["_re"].search(nt):
                return self._line(p, nt, sku, variant_title, pack), None
        for reason, rx in self.unless:
            if rx.search(nt):
                return None, reason
        if ptype == "" and "" in exclude_types:
            return None, "product type: blank, not a named product"
        for g in self.groups:
            if g["_re"].search(nt):
                return self._line(g, nt, sku, variant_title, pack), None
        return (
            self._line({"code": self.other["code"]}, nt, sku, variant_title, pack),
            None,
        )

    def combo_of(self, title: str) -> int | None:
        """Products inside a set, read from its name ("duo" 2, "trio" 3,
        "3-step" 3), for old sets the combo list does not have."""
        nt = normalise(title)
        for rx, n in self.combo_hints:
            m = rx.search(nt)
            if m:
                return n or int(m.group(1))
        return None

    def pack_of(self, text: str) -> int:
        """Units in one line, read from its title, variant title and SKU."""
        m = self.pack_re.search(text)
        return int(next(g for g in m.groups() if g)) if m else 1

    def _line(self, p: dict, nt: str, sku: str, variant_title: str, pack: int | None = None) -> Line:
        text = " ".join(
            [
                nt,
                normalise(variant_title),
                (sku or "").lower().replace("_", " "),
            ]
        )
        # the Shopify catalog's pack for this listing and SKU decides when it
        # knows; otherwise the title, variant title and SKU
        pack = pack if pack and pack > 1 else self.pack_of(text)
        subs = p.get("subs")
        if not subs:
            return Line(p["code"], "—", pack)
        sub = p.get("default_sub", "Unspecified")
        patterns = p.get("sub_patterns") or {
            s: s.lower() for s in subs if s != "Mixed"
        }
        hits = [s for s, pat in patterns.items() if re.search(pat, text)]
        if len(hits) == 1:
            sub = hits[0]
        elif len(hits) > 1:
            sub = "Mixed" if "Mixed" in subs else hits[0]
        elif "mixed" in text and "Mixed" in subs:
            sub = "Mixed"
        return Line(p["code"], sub, pack)


def label(sub: str, pack: int) -> str:
    base = "Standard" if sub == "—" else sub
    return (
        base
        if pack == 1
        else (f"Pack of {pack}" if sub == "—" else f"{sub} · Pack of {pack}")
    )
