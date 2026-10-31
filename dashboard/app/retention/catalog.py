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
    pack: int  # 1 or 2


class Catalog:
    def __init__(self, spec: dict | None = None):
        spec = spec or json.loads(PATH.read_text(encoding="utf-8"))
        self.spec = spec
        self.count_minis = bool(spec.get("count_minis"))
        self.always = [
            (r["reason"], re.compile(r["pattern"]))
            for r in spec["exclude_always"]
            if self.count_minis is False or r["reason"] != "mini or trial size"
        ]
        self.unless = [
            (r["reason"], re.compile(r["pattern"]))
            for r in spec["exclude_unless_product"]
        ]
        self.products = [
            {**p, "_re": re.compile(p["pattern"])} for p in spec["products"]
        ]
        self.other = spec["other"]
        self.pack_re = re.compile(spec["pack_pattern"])
        self.names = {p["code"]: p["name"] for p in self.products}
        self.names[self.other["code"]] = self.other["name"]
        self.order = [p["code"] for p in self.products] + [self.other["code"]]
        self._by_code = {p["code"]: p for p in self.products}

    def classify(
        self,
        title: str,
        sku: str,
        revenue: float,
        product_type: str,
        exclude_types: list[str],
        variant_title: str = "",
    ) -> tuple[Line | None, str | None]:
        """(Line, None) for a counted line, (None, reason) for an excluded one."""
        if revenue is None or revenue <= 0:
            return None, "zero revenue (free)"
        if "🎁" in (title or ""):
            return None, "gift line"
        if (product_type or "") in exclude_types:
            return None, f"product type: {product_type or 'blank'}"
        nt = normalise(title)
        for reason, rx in self.always:
            if rx.search(nt):
                return None, reason
        for p in self.products:
            if p["_re"].search(nt):
                return self._line(p, nt, sku, variant_title), None
        for reason, rx in self.unless:
            if rx.search(nt):
                return None, reason
        return (
            self._line({"code": self.other["code"]}, nt, sku, variant_title),
            None,
        )

    def _line(self, p: dict, nt: str, sku: str, variant_title: str) -> Line:
        text = " ".join(
            [
                nt,
                normalise(variant_title),
                (sku or "").lower().replace("_", " "),
            ]
        )
        pack = 2 if self.pack_re.search(text) else 1
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
        else ("Pack of 2" if sub == "—" else f"{sub} · Pack of 2")
    )
