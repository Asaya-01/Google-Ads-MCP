"""Reads finance's files into pnl_monthly_actuals rows, untouched: every
channel, every line, as the workbook names it. Three inputs are understood:

- the Investor Data Pack workbook (its "Channel P&L" tab: a "Line item" header
  row with the months, then one block per channel, ₹ lakh);
- the monthly MIS workbook (COGS Master: COGS per unit by EAN; Sales Dump: the
  month's sales lines with their COGS, of which the Shopify ones are the
  Website);
- the JSON extract of the investor pack the review artifact was built from
  (table channel_pnl, ₹ crore), for the first load.

Nothing here changes a number: amounts are only converted to rupees.
"""

from __future__ import annotations

import datetime as dt
import io
import json
import re

from . import config, line_key, month_key, norm

LAKH, CRORE = 1e5, 1e7
# the extract's field names → the workbook's own labels (build_pack.py's map)
PACK_FIELDS = {
    "gmv": "GMV", "disc": "Discounts / trade margin", "gross": "Gross sales", "net_rev": "Net revenue", "cogs": "COGS",
    "gm": "Gross margin", "fees": "DPC / payment gateway / marketplace fees", "packaging": "Packaging", "storage": "Storage",
    "logistics": "Logistics (outward)", "cm1": "CM1", "ads": "Visibility spends (ads)", "promos": "Consumer promos", "samples": "Samples",
    "chan_spend": "Total channel & performance spends", "cm2": "CM2", "influencer": "Influencer / awareness", "agency": "Agency fees",
    "brand": "Total brand building", "cm3": "CM3",
}


class ImportError_(ValueError):
    pass


def _num(v):
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def _row(cfg, month, channel, label, amount):
    key = line_key(label, cfg["lines"])
    ln = next((x for x in cfg["lines"] if x["key"] == key), {})
    return {"month": month, "channel": str(channel).strip(), "line_item": str(label).strip(), "line_item_key": key,
            "amount": round(amount, 2), "sign": ln.get("sign"), "level": ln.get("level")}


# ------------------------------------------------------------ channel P&L


def channel_pnl_rows(table: list[list], cfg: dict, unit: float = LAKH) -> list[dict]:
    """Rows of a "Channel P&L" tab → long rows for every channel and line."""
    head = next((i for i, r in enumerate(table) if r and norm(r[0]) == "line item"), None)
    if head is None:
        raise ImportError_('no "Line item" header row in the Channel P&L tab')
    cols = {j: month_key(v) for j, v in enumerate(table[head]) if j and month_key(v)}
    if not cols:
        raise ImportError_("the Channel P&L header row has no month columns")
    out, channel = [], None
    for r in table[head + 1:]:
        if not r or r[0] is None or not str(r[0]).strip():
            continue
        label = str(r[0]).strip()
        if norm(label) == "checks":
            break
        vals = {m: _num(r[j]) for j, m in cols.items() if j < len(r)}
        if all(v is None for v in vals.values()):
            channel = label  # a block header: the channel's name
            continue
        if channel is None:
            continue
        for m, v in vals.items():
            if v is not None:
                out.append(_row(cfg, m, channel, label, v * unit))
    if not out:
        raise ImportError_("the Channel P&L tab has no channel rows")
    return out


def pack_json_rows(pack: dict, cfg: dict) -> list[dict]:
    """The review artifact's extract (asaya_pack.json): table channel_pnl, ₹ crore."""
    table = ((pack or {}).get("tables") or {}).get("channel_pnl")
    if not table:
        raise ImportError_("no channel_pnl table in the JSON file")
    out = []
    for r in table:
        m = month_key(r.get("month"))
        if not m:
            continue  # the Apr–Oct total column is not a month
        for f, label in PACK_FIELDS.items():
            v = _num(r.get(f))
            if v is not None:
                out.append(_row(cfg, m, r["channel"], label, v * CRORE))
    return out


# ------------------------------------------------------------ MIS


def mis_payload(sheets: dict[str, list[list]], cfg: dict, file_name: str = "") -> dict:
    """COGS per unit by EAN and the month's Website sales lines (Shopify
    rows of the Sales Dump: item, quantity, sale value ex-GST, COGS, MRP
    sales). The month comes from the Marketing Sheet header or the file name."""
    month = None
    for r in (sheets.get("Marketing Sheet") or [])[:3]:
        for v in r:
            month = month or month_key(v)
    if not month:
        m = re.search(r"([A-Za-z]{3})[a-z]*[-_ ]?(\d{4}|\d{2})", file_name or "")
        month = month_key(f"{m.group(1)}-{m.group(2)}") if m else None
    cogs = []
    for r in (sheets.get("COGS Master") or [])[1:]:
        if r and r[0] and _num(r[2] if len(r) > 2 else None) is not None:
            cogs.append({"name": str(r[0]).strip(), "ean": str(r[1]).strip() if r[1] else "", "cogs": _num(r[2])})
    lines = []
    dump = sheets.get("Sales Dump") or []
    if dump:
        hdr = [norm(c) for c in dump[0]]
        ix = lambda name: hdr.index(name) if name in hdr else None  # noqa: E731
        c = {k: ix(k) for k in ("markings", "item name", "billed quantity", "sale value", "cogs value", "mrp sales", "channel tagging")}
        if None in (c["item name"], c["sale value"], c["channel tagging"]):
            raise ImportError_("the Sales Dump has no Item Name / Sale Value / Channel Tagging columns")
        agg: dict[str, list] = {}
        for r in dump[1:]:
            tag = norm(r[c["channel tagging"]]) if len(r) > c["channel tagging"] else ""
            if not re.search(cfg["sales_dump_d2c_tag"], tag):
                continue
            sale = _num(r[c["sale value"]])
            if sale is None:
                continue
            a = agg.setdefault(str(r[c["item name"]]).strip(), [0.0, 0.0, 0.0, 0.0])
            a[0] += _num(r[c["billed quantity"]]) or 0
            a[1] += sale
            a[2] += _num(r[c["cogs value"]]) or 0
            a[3] += _num(r[c["mrp sales"]]) or 0
        lines = [{"item": k, "qty": round(v[0]), "net_revenue": round(v[1], 2), "cogs": round(v[2], 2), "mrp_sales": round(v[3], 2)} for k, v in agg.items()]
    if not cogs and not lines:
        raise ImportError_("no COGS Master or Sales Dump sheet")
    return {"month": month, "cogs_master": cogs, "d2c_skus": sorted(lines, key=lambda x: -x["net_revenue"])}


# ------------------------------------------------------------ files


def read_upload(data: bytes, file_name: str) -> list[tuple[str, dict]]:
    """What an uploaded file holds: [("actuals", {"rows": [...]}), ("mis", {...})]."""
    cfg = config()
    name = (file_name or "").lower()
    if name.endswith(".json") or data[:1] in (b"{", b"["):
        try:
            pack = json.loads(data.decode("utf-8"))
        except ValueError as exc:
            raise ImportError_(f"not a JSON file: {exc}")
        return [("actuals", {"rows": pack_json_rows(pack, cfg), "unit": "₹ crore (JSON extract)"})]
    try:
        from openpyxl import load_workbook
    except ImportError:  # pragma: no cover
        raise ImportError_("openpyxl is not installed")
    try:
        wb = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    except Exception as exc:
        raise ImportError_(f"not an Excel file: {type(exc).__name__}")
    out = []
    names = {ws.title.strip(): ws for ws in wb.worksheets}
    cp = next((ws for t, ws in names.items() if norm(t) in ("channel p&l", "channel pnl")), None)
    if cp is not None:
        out.append(("actuals", {"rows": channel_pnl_rows([list(r) for r in cp.iter_rows(values_only=True)], cfg), "unit": "₹ lakh"}))
    want = {"COGS Master", "Sales Dump", "Marketing Sheet"}
    if want & set(names):
        # only these sheets are read; nothing else in the workbook is touched
        sheets = {t: [list(r) for r in names[t].iter_rows(values_only=True)] for t in want if t in names}
        out.append(("mis", mis_payload(sheets, cfg, file_name)))
    if not out:
        raise ImportError_('the workbook has neither a "Channel P&L" tab nor COGS Master / Sales Dump sheets')
    return out


def save(store, kind: str, payload: dict, source_name: str, by: str, now: dt.datetime | None = None) -> dict:
    """A new version; never overwrites. The newest import of each kind is active."""
    now = now or dt.datetime.now(dt.timezone.utc)
    version = now.strftime("%Y%m%dT%H%M%S") + f"-{kind}"
    stamp = now.isoformat(timespec="seconds")
    body = {"source_version": version, "kind": kind, "source_name": source_name, "imported_at": stamp, "imported_by": by, **payload}
    if kind == "actuals":
        for r in body["rows"]:
            r["source_version"], r["imported_at"] = version, stamp
    path = f"private/pnl/{'actuals' if kind == 'actuals' else 'mis'}/{version}.json"
    store.put_json(path, body)
    idx = store.get_json("private/pnl/index.json") or {"versions": []}
    entry = {"version": version, "kind": kind, "source_name": source_name, "imported_at": stamp, "imported_by": by, "path": path}
    if kind == "actuals":
        entry["months"] = sorted({r["month"] for r in body["rows"]})
        entry["channels"] = sorted({r["channel"] for r in body["rows"]})
        entry["rows"] = len(body["rows"])
    else:
        entry["months"] = [payload.get("month")] if payload.get("month") else []
    idx["versions"] = [entry] + idx["versions"]
    store.put_json("private/pnl/index.json", idx)
    return entry
