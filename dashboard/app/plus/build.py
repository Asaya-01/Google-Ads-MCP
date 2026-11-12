"""Dashboard Plus page builders (Phase 1: M3 Traffic quality, M1 Profit,
M6 change markers, M7 stock snapshots). Each returns the JSON for one new
tab; nothing here writes anywhere but the job's own outputs. The browser
does the date-range maths with the existing date bar, as the other tabs do.

Missing inputs are reported as {"na": "Input needed: ..."}; nothing is ever
estimated or invented.
"""

from __future__ import annotations

import datetime as dt
import os
import re

from .. import sheets
from . import config


def _input_needed(what: str) -> dict:
    return {"na": f"Input needed: {what}"}


# ---------------------------------------------------------------- M3 traffic quality
def build_traffic(store, d1: str, run) -> dict:
    pc = config()["traffic"]
    end = dt.date.fromisoformat(d1)
    start = end - dt.timedelta(days=pc["history_days"] - 1)
    params = {"property": pc["ga4_property"], "start_date": start, "end_date": end}
    out: dict = {"title": "Traffic Quality", "as_of": d1, "config": {k: pc[k] for k in ("junk", "click_jump", "ga4_channels", "ga4_medium_paid", "inputs_needed")}}
    keys: list[str] = []
    k_idx: dict[str, int] = {}

    def key(s: str) -> int:
        if s not in k_idx:
            k_idx[s] = len(keys)
            keys.append(s)
        return k_idx[s]

    try:
        sess = run("ga4_sessions", params)
        purch = run("ga4_purchases", params)
        out["ga4"] = {
            "property": pc["ga4_property"],
            "rows": sorted([r["date"], key(r["source_medium"]), int(r["sessions"] or 0), int(r["engaged"] or 0)] for r in sess),
            "purchases": sorted([r["date"], key(r["source_medium"]), int(r["purchases"] or 0), round(float(r["revenue"] or 0), 2)] for r in purch),
        }
        out["ga4"]["keys"] = keys
    except Exception as exc:  # shown on the cards, never zero
        out["ga4"] = {"na": f"GA4 could not be read from BigQuery: {exc}"}
    out["health"] = data_health(store, d1, run)
    return out


def _channel_shares(store, d1: str) -> dict[str, float]:
    """Each channel's share of last-click Total sales over the last 30 days,
    from the existing channel_days page (read only)."""
    ch = store.get_json("pages/channel_days.json") or {}
    end = dt.date.fromisoformat(d1)
    since = (end - dt.timedelta(days=29)).isoformat()
    tot: dict[str, float] = {}
    for r in ch.get("rows") or []:
        if since <= r[0] <= d1:
            name = ch["channels"][r[1]]
            tot[name] = tot.get(name, 0.0) + float(r[6] or 0)
    s = sum(tot.values())
    return {k: v / s for k, v in tot.items()} if s else {}


def data_health(store, d1: str, run) -> dict:
    """Spec M3: share of inputs loaded within their refresh window, weighted
    by the revenue they carry; stale inputs listed by name."""
    hc = config()["data_health"]
    status = store.get_json("status/latest.json") or {}
    latest = {c.get("source"): c.get("latest_date") for c in status.get("checks") or []}
    shares = _channel_shares(store, d1)
    tables = [i["table"] for i in hc["inputs"] if i.get("table")]
    modified: dict[str, str] = {}
    table_na = None
    if tables:
        try:
            for r in run("table_freshness", {"tables": tables}):
                modified[r["table_name"]] = str(r["last_modified"])[:10]
        except Exception as exc:
            table_na = f"table metadata could not be read: {exc}"
    end = dt.date.fromisoformat(d1)
    rows = []
    for i in hc["inputs"]:
        w = i["weight"]
        weight = 1.0 if w == "store" else shares.get(w.split(":", 1)[1], 0.0) if isinstance(w, str) and w.startswith("channel:") else float(w)
        last = latest.get(i.get("source")) if i.get("source") else modified.get(i.get("table"))
        if last is None:
            rows.append({"name": i["name"], "last": None, "age_days": None, "ok": None, "weight": round(weight, 4),
                         "why": table_na if i.get("table") and table_na else "not tracked by the refresh status yet"})
            continue
        age = (end - dt.date.fromisoformat(str(last)[:10])).days
        # a table written today holds data through yesterday: age 0 or 1 is on time
        ok = age <= i["max_age_days"] if i.get("source") else age <= i["max_age_days"]
        rows.append({"name": i["name"], "last": str(last)[:10], "age_days": age, "ok": ok, "weight": round(weight, 4)})
    scored = [r for r in rows if r["ok"] is not None and r["weight"] > 0]
    tw = sum(r["weight"] for r in scored)
    score = sum(r["weight"] for r in scored if r["ok"]) / tw if tw else None
    return {"score": score, "inputs": rows, "about": hc["_about"]}


# ---------------------------------------------------------------- sheet inputs
def _sheet_rows(env: str, tab: str) -> tuple[list[dict] | None, str | None]:
    """Rows of a sheet tab as dicts keyed by the lower-cased header, or
    (None, why) when the sheet is not set or cannot be read."""
    sid = (os.environ.get(env) or "").strip()
    if not sid:
        return None, f"the sheet id is not set ({env})"
    try:
        raw = sheets.fetch_rows(sid, tab, 1)
    except Exception as exc:
        return None, f"{type(exc).__name__}: {exc}"
    if not raw:
        return [], None
    head = [re.sub(r"[^a-z0-9]+", "_", str(h).strip().lower()).strip("_") for h in raw[0]]
    return [dict(zip(head, r)) for r in raw[1:] if any(str(c).strip() for c in r)], None


def _num(v):
    return sheets.to_number(v)


def _date(v) -> str | None:
    s = str(v or "").strip()
    for f in ("%Y-%m-%d", "%d-%b-%Y", "%d/%m/%Y", "%d-%m-%Y"):
        try:
            return dt.datetime.strptime(s, f).date().isoformat()
        except ValueError:
            continue
    return None


# ---------------------------------------------------------------- M1 profit
def build_profit(store, d1: str) -> dict:
    pc = config()["profit"]
    out: dict = {"title": "Profit", "as_of": d1, "reference": pc["break_even_reference"], "finance_pl_note": pc["finance_pl_note"]}
    gst = pc["gst_inclusive_total_sales"]
    out["gst"] = {"inclusive": gst, "rate": pc["gst_rate"]} if gst is not None else {**_input_needed("GST treatment of Total sales"), "detail": "Is Total sales GST-inclusive, and at what rate? Margin maths is net of GST."}
    rows, why = _sheet_rows(pc["cogs_sheet_env"], "COGS")
    if rows is None:
        out["cogs"] = {**_input_needed("landed COGS per variant"), "detail": why, "format": pc["cogs_format"]}
    else:
        cogs = [[str(r.get("sku", "")).strip(), _num(r.get("landed_cost")), _date(r.get("effective_from")) or "2000-01-01"] for r in rows]
        out["cogs"] = {"rows": sorted(c for c in cogs if c[0] and c[1] is not None)}
    rows, why = _sheet_rows(pc["rate_card_sheet_env"], "Rate card")
    if rows is None:
        out["rate_card"] = {**_input_needed("shipping, COD and gateway fee rate card"), "detail": why, "format": pc["rate_card_format"]}
    else:
        out["rate_card"] = {"rows": [[str(r.get("item", "")).strip().lower(), _num(r.get("value")), str(r.get("unit", "")).strip(), _date(r.get("effective_from")) or "2000-01-01"] for r in rows if r.get("item")]}
    rows, why = _sheet_rows(pc["influencer_sheet_env"], "Spend")
    if rows is None:
        out["influencer"] = {**_input_needed("monthly influencer and awareness spend"), "detail": why, "format": pc["influencer_format"]}
    else:
        out["influencer"] = {"months": {str(r.get("month", "")).strip()[:7]: [_num(r.get("influencer")) or 0.0, _num(r.get("awareness_other")) or 0.0] for r in rows if r.get("month")}}
    return out


# ---------------------------------------------------------------- M6 change markers
def build_site(store, d1: str) -> dict:
    sc = config()["site"]
    out: dict = {"title": "Site", "as_of": d1, "cooee": _input_needed(sc["cooee_note"])}
    rows, why = _sheet_rows(sc["changes_sheet_env"], "Changes")
    if rows is None:
        out["changes"] = {**_input_needed("the Shopify Changes Tracker sheet"), "detail": why, "format": sc["changes_format"]}
    else:
        out["changes"] = {"rows": sorted([d, str(r.get("change", "")).strip(), str(r.get("area", "")).strip(), str(r.get("owner", "")).strip()]
                                         for r in rows if (d := _date(r.get("date"))))}
    return out


# ---------------------------------------------------------------- M7 stock snapshots
SHOPIFY_SCHEMA = [("snapshot_date", "DATE"), ("taken_at", "TIMESTAMP"), ("product_id", "STRING"), ("variant_id", "STRING"),
                  ("sku", "STRING"), ("product_title", "STRING"), ("variant_title", "STRING"), ("product_status", "STRING"), ("available", "INT64")]


def shopify_inventory(shop) -> list[dict]:
    """Available units per variant, now (Shopify keeps no history)."""
    q = """query($after: String) { productVariants(first: 250, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes { id sku title inventoryQuantity product { id title status } } } }"""
    out, after = [], None
    while True:
        page = shop.graphql(q, {"after": after})["productVariants"]
        for v in page["nodes"]:
            out.append({
                "product_id": v["product"]["id"].rsplit("/", 1)[-1], "variant_id": v["id"].rsplit("/", 1)[-1],
                "sku": (v.get("sku") or "").strip(), "product_title": v["product"].get("title") or "",
                "variant_title": v.get("title") or "", "product_status": v["product"].get("status") or "",
                "available": v.get("inventoryQuantity"),
            })
        if not page["pageInfo"]["hasNextPage"]:
            return out
        after = page["pageInfo"]["endCursor"]


def take_snapshots(today: str, shop_factory, bq) -> dict:
    """Today's snapshots into dashboard_plus, at most one per table per day.
    Returns what happened per source (written / already there / why not)."""
    sc = config()["stock"]
    done: dict = {}
    try:
        if bq.has_date(sc["shopify_table"], today):
            done["shopify"] = "already taken today"
        else:
            now = dt.datetime.now(dt.timezone.utc).isoformat()
            rows = [{"snapshot_date": today, "taken_at": now, **r} for r in shopify_inventory(shop_factory())]
            done["shopify"] = f"{bq.append_rows(sc['shopify_table'], rows, SHOPIFY_SCHEMA)} variants written"
    except Exception as exc:
        done["shopify"] = f"not taken: {type(exc).__name__}: {exc}"
    try:
        if bq.has_date(sc["unicommerce_table"], today):
            done["unicommerce"] = "already taken today"
        else:
            bq.append_query("unicommerce_snapshot_append", sc["unicommerce_table"], unicommerce_source=sc["unicommerce_source"])
            done["unicommerce"] = "written"
    except Exception as exc:
        done["unicommerce"] = f"not taken: {type(exc).__name__}: {exc}"
    return done


def build_stock(d1: str, bq, taken: dict) -> dict:
    sc = config()["stock"]
    out: dict = {"title": "Inventory", "as_of": d1, "taken": taken, "about": sc["_about"]}
    for key, table, qty in (("shopify", sc["shopify_table"], "available"), ("unicommerce", sc["unicommerce_table"], "inventory")):
        try:
            if not bq.table_exists(table):
                out[key] = {"na": "no snapshot yet: the first one is taken on the job's next run", "days": []}
                continue
            days = bq.run("snapshot_days", {}, table=table, qty=qty)
            latest = bq.run("snapshot_latest", {}, table=table)
            out[key] = {
                "days": [[r["snapshot_date"], int(r["rows_n"]), int(r["units"] or 0)] for r in days],
                "latest": [[r.get("sku"), r.get("product_title") or r.get("name"), r.get("variant_title") or r.get("facility"), r.get(qty)] for r in latest],
            }
        except Exception as exc:
            out[key] = {"na": f"{type(exc).__name__}: {exc}", "days": []}
    return out
