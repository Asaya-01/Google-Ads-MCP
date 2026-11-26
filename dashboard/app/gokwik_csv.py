"""GoKwik checkout CSV uploads (Today fixes, A6): the fallback while GoKwik's
automated BigQuery load is missing for a day.

The file is GoKwik's own export, checkoutAnalyticsFunnelWithMarketingParams-
report-*.csv. Every upload is kept untouched in the dashboard's private bucket
(gokwik_csv_snapshots):

  private/atc/gokwik_csv/<upload_id>.json   upload_id, uploaded_at, uploaded_by,
                                            file_name, file_sha256, rows
  private/atc/gokwik_csv/index.json         the uploads, newest first

The same file uploaded twice is stored once (its SHA-256). Uploads never
overwrite or mix with the automated load: a day is read from an upload only
when the automated load has no rows for it, and is labelled as such.
"""

from __future__ import annotations

import csv
import datetime as dt
import hashlib
import io
import re

from . import settings

ROOT = "private/atc/gokwik_csv"
INDEX = f"{ROOT}/index.json"
STAGES = [
    ("checkout_started", "Checkout Started"),
    ("address_landed", "Address Landed"),
    ("payment_step", "Payment Step Reached"),
    ("method_selected", "Payment Method Selected"),
    ("converted", "Sessions Converted"),
]
KEYS = ["UTM Source", "UTM Medium", "UTM Campaign", "UTM Term", "UTM Content", "Landing Page", "Origin Referrer"]


class UploadError(ValueError):
    pass


def _cfg() -> dict:
    return settings.config().get("today_v2") or {}


def _num(v) -> int:
    t = re.sub(r"[,\s%]", "", str(v or ""))
    try:
        return int(float(t)) if t else 0
    except ValueError:
        raise UploadError(f"not a number: {v!r}")


def _date(v) -> str:
    t = str(v or "").strip()
    for f in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%d-%b-%Y", "%d %b %Y", "%Y/%m/%d"):
        try:
            return dt.datetime.strptime(t, f).date().isoformat()
        except ValueError:
            pass
    raise UploadError(f"unreadable date: {v!r}")


def parse(data: bytes) -> list[dict]:
    """The export's rows, checked: the header must be exactly GoKwik's columns."""
    want = _cfg().get("gokwik_csv_columns") or []
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise UploadError("not a UTF-8 CSV file")
    rows = list(csv.reader(io.StringIO(text)))
    if not rows:
        raise UploadError("the file is empty")
    head = [h.strip() for h in rows[0]]
    # GoKwik's download starts with a serial-number column ("S.no"): ignored
    if head and head[0].lower().replace(" ", "").replace(".", "") in ("sno", "srno", "serialno", "#"):
        head, rows = head[1:], [r[1:] for r in rows]
    if head != want:
        missing = [c for c in want if c not in head]
        extra = [c for c in head if c not in want]
        raise UploadError(
            "the columns are not GoKwik's checkout export"
            + (f"; missing: {', '.join(missing)}" if missing else "")
            + (f"; unexpected: {', '.join(extra)}" if extra else "")
        )
    out = []
    for r in rows[1:]:
        if not any(x.strip() for x in r):
            continue
        rec = dict(zip(head, r))
        row = {"date": _date(rec["Date"]), **{k: (rec.get(k) or "").strip() for k in KEYS}}
        for key, col in STAGES:
            row[key] = _num(rec.get(col))
        out.append(row)
    if not out:
        raise UploadError("the file has a header but no rows")
    return out


def save(store, data: bytes, file_name: str, by: str, now: dt.datetime | None = None) -> dict:
    """Stores one upload (or finds the identical one already stored)."""
    rows = parse(data)
    sha = hashlib.sha256(data).hexdigest()
    idx = store.get_json(INDEX) or {"uploads": []}
    dup = next((u for u in idx["uploads"] if u["file_sha256"] == sha), None)
    if dup:
        return {**dup, "duplicate": True}
    now = now or dt.datetime.now(dt.timezone.utc)
    uid = now.strftime("%Y%m%dT%H%M%S") + "-" + sha[:8]
    entry = {"upload_id": uid, "uploaded_at": now.isoformat(timespec="seconds"), "uploaded_by": by,
             "file_name": file_name, "file_sha256": sha, "dates": sorted({r["date"] for r in rows}), "rows": len(rows)}
    store.put_json(f"{ROOT}/{uid}.json", {**entry, "rows": rows})
    idx["uploads"] = [entry] + idx["uploads"]
    store.put_json(INDEX, idx)
    return {**entry, "duplicate": False}


def tagged(row: dict) -> bool:
    ex = {x.lower() for x in _cfg().get("tagged_excludes") or []}
    return (row.get("UTM Source") or "").strip().lower() not in ex


def _totals(rows: list[dict]) -> dict:
    return {k: sum(r[k] for r in rows) for k, _ in STAGES}


def _rates(t: dict) -> dict:
    def r(a, b):
        return t[a] / t[b] if t.get(b) else None
    return {"conversion": r("converted", "checkout_started"), "method_to_order": r("converted", "method_selected"),
            "payment_to_method": r("method_selected", "payment_step")}


def _cuts(rows: list[dict], key: str, limit: int = 25) -> list[dict]:
    agg: dict[str, list[dict]] = {}
    for r in rows:
        agg.setdefault(r.get(key) or "(none)", []).append(r)
    out = [{"key": k, **_totals(v), **_rates(_totals(v))} for k, v in agg.items()]
    return sorted(out, key=lambda x: -x["checkout_started"])[:limit]


def summary(store, day: str) -> dict | None:
    """The newest upload holding `day`, its totals (all and tagged traffic),
    the cuts, and the increment since the previous upload of the same day."""
    idx = store.get_json(INDEX) or {"uploads": []}
    ups = [u for u in idx["uploads"] if day in (u.get("dates") or [])]
    if not ups:
        return None
    bodies = [(u, store.get_json(f"{ROOT}/{u['upload_id']}.json") or {}) for u in ups[:2]]

    def day_rows(b):
        return [r for r in b.get("rows") or [] if r["date"] == day]

    cur = day_rows(bodies[0][1])
    out = {"day": day, "upload": {k: bodies[0][0][k] for k in ("upload_id", "uploaded_at", "file_name")},
           "uploads_for_day": len(ups)}
    for name, sel in (("all", cur), ("tagged", [r for r in cur if tagged(r)])):
        t = _totals(sel)
        out[name] = {**t, **_rates(t)}
    out["cuts"] = {"source": _cuts(cur, "UTM Source"), "campaign": _cuts(cur, "UTM Campaign"), "landing": _cuts(cur, "Landing Page")}
    if len(bodies) > 1:
        prev = day_rows(bodies[1][1])
        inc = {}
        for name, a, b in (("all", cur, prev), ("tagged", [r for r in cur if tagged(r)], [r for r in prev if tagged(r)])):
            ta, tb = _totals(a), _totals(b)
            d = {k: ta[k] - tb[k] for k in ta}
            inc[name] = {**d, **_rates(d)}
        out["since_last"] = {"from": bodies[1][0]["uploaded_at"], "to": bodies[0][0]["uploaded_at"], **inc}
    return out
