"""SEO / AEO / GEO tab: search demand, organic search, AI assistants and
website speed. Every source is read only; the job writes only to the
dashboard's own bucket (pages/seo.json and cache/seo/*). Nothing is written
to BigQuery, Google Ads, Search Console, GA4 or Shopify.

Settings live in config.json -> seo. Each source has its own switch in
seo.sources and is skipped when it is off.
"""

from __future__ import annotations

import copy
import re

from .. import settings

PAGE_PATH = "pages/seo.json"
CACHE = "cache/seo"


def config() -> dict:
    return copy.deepcopy(settings.config()["seo"])


def enabled(cfg: dict, source: str) -> bool:
    return bool((cfg.get("sources") or {}).get(source))


def ai_platform(row: dict, platforms: list[dict]) -> str | None:
    """Which AI assistant a Shopify / GA4 session came from, or None. A
    platform matches on its UTM source (ChatGPT tags its links
    utm_source=chatgpt.com) or on the referrer name Shopify records."""
    utm = (row.get("utm_source") or "").strip().lower()
    ref = (row.get("referrer_name") or "").strip().lower()
    ga4 = (row.get("ga4_source") or "").strip().lower()
    for p in platforms:
        if utm and utm in (p.get("utm_sources") or []):
            return p["name"]
    for p in platforms:
        if ref and ref in (p.get("referrer_names") or []):
            return p["name"]
    for p in platforms:
        if ga4 and p.get("ga4_source_regex") and re.search(p["ga4_source_regex"], ga4):
            return p["name"]
    return None


def page_type(path: str, types: list[list[str]]) -> str:
    """Home, Product, Collection, Blog post... from a URL or path."""
    p = re.sub(r"^https?://[^/]+", "", path or "") or "/"
    p = p.split("?")[0].split("#")[0] or "/"
    for name, rx in types:
        if re.search(rx, p):
            return name
    return "Other"
