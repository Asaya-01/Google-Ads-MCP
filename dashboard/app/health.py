"""The Data health page: where each source stands for D-1, when it arrived,
whether it ties out to its source system, and how the last week went."""

from __future__ import annotations

import datetime as dt

# (key, label, where it comes from)
SOURCES = [
    (
        "shopify_orders",
        "Shopify orders",
        "BigQuery (Maplemonk copy of Shopify)",
    ),
    (
        "shopify_order_items",
        "Shopify order lines",
        "BigQuery (Maplemonk copy of Shopify)",
    ),
    (
        "shopify_sessions",
        "Shopify sessions and landing pages",
        "Shopify API (ShopifyQL)",
    ),
    ("gokwik_funnel", "GoKwik checkout funnel", "BigQuery (GoKwik bot load)"),
    (
        "gokwik_orders",
        "GoKwik orders (attribution)",
        "BigQuery (GoKwik bot load)",
    ),
    ("google_ads", "Google Ads", "Google Ads API"),
    ("meta_ads", "Meta Ads", "Meta Marketing API"),
]
KEYS = [s[0] for s in SOURCES]


def _latest_and_rows(key: str, data: dict) -> tuple[str | None, int | None]:
    d1 = data["d1"]
    if key == "meta_ads":
        days = {d: r for d, r in (data.get("meta") or {}).items() if r}
        latest = max((d for d in days if d <= d1), default=None)
        return latest, len(days.get(d1, []))
    if key == "shopify_sessions":
        sessions = data.get("sessions") or {}
        days = [
            d
            for d, s in sessions.items()
            if (s.get("totals") or {}).get("sessions") and d <= d1
        ]
        d1_sessions = (sessions.get(d1) or {}).get("totals", {}).get("sessions")
        return (max(days) if days else None), d1_sessions
    for c in data.get("checks") or []:
        if c["source"] == key:
            return (str(c["latest_date"]) if c["latest_date"] else None), c[
                "d1_rows"
            ]
    return None, None


def build(
    cfg: dict,
    data: dict,
    missing: dict,
    status: dict,
    history: list[dict | None],
    generated_at: str,
) -> dict:
    arrived = status.get("arrived") or {}
    gsrc = data.get("google_source") or {}
    sources = []
    for key, label, origin in SOURCES:
        if key == "google_ads" and gsrc.get("mode") != "api":
            origin = "BigQuery copy of Google Ads"
        latest, rows = _latest_and_rows(key, data)
        note = missing.get(key)
        if (
            key == "google_ads"
            and gsrc.get("mode") != "api"
            and gsrc.get("note")
        ):
            note = (note + "; " if note else "") + gsrc["note"]
        sources.append(
            {
                "key": key,
                "label": label,
                "origin": origin,
                "latest_date": latest,
                "d1_rows": rows,
                "state": "waiting" if key in missing else "ok",
                "arrived_at": arrived.get(key),
                "note": note,
            }
        )
    d1 = dt.date.fromisoformat(data["d1"])
    days = []
    for i, st in enumerate(history):
        if not st:
            continue
        days.append(
            {
                "day": (d1 - dt.timedelta(days=i)).isoformat(),
                "complete": bool(st.get("complete")),
                "completed_at": st.get("completed_at"),
                "arrived": st.get("arrived") or {},
            }
        )
    return {
        "title": "Data health",
        "as_of": data["d1"],
        "generated_at": generated_at,
        "complete": not missing,
        "attempts": status.get("attempts"),
        "waiting_on": sorted(missing),
        "sources": sources,
        "reconcile": data.get("reconcile") or [],
        "history": days,
        "source_labels": {k: label for k, label, _ in SOURCES},
        "notes": [
            "A day is complete when every source has D-1 and the blocking cross-checks agree. Until then each run rebuilds the pages with whatever is present.",
            "Cross-checks compare our copy with the source system's own total: Shopify's order count against BigQuery, and Meta and Google account totals against the row-level pull.",
            "Arrival times are when a run first saw the source with D-1 in it, in IST.",
        ],
    }
