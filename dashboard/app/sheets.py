"""Spends the platforms' APIs do not carry (affiliate, CRM flow, CRM broadcast),
read from the team's Google Sheets on every refresh.

The sheets are shared with the dashboard's service account as Viewer. Each
source is described in config.json (manual_spends.sources): which tab, which
columns hold the date, the spend and the revenue, how dates are written, and
how to tell a day nobody has filled in yet from a real zero.

The hard part is exactly that. These sheets are pre-filled with zeros for days
that have not happened or not been entered, so a zero at the end of the sheet
is "not entered yet", never "spent nothing". A zero before the last day with a
number (a day with no broadcast) is a real zero. The latest day with a number
is the day the source is "filled through"; later days are unavailable.
"""

from __future__ import annotations

import datetime as dt
import os
import re

SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly"
API = "https://sheets.googleapis.com/v4/spreadsheets"


class SheetsError(RuntimeError):
    pass


# ------------------------------------------------------------------ parsing


def col_letters(index: int) -> str:
    out = ""
    n = index + 1
    while n:
        n, r = divmod(n - 1, 26)
        out = chr(65 + r) + out
    return out


def locate_block(rows: list[list], label: str) -> tuple[int, int] | None:
    """Where a channel's block is in a monthly workbook whose columns move
    from month to month: (column of its "Actual Spend" cell, row of the
    header it sits in), or None. The block's name ("REDDIT") is in one of
    the first rows, above its Target column; its Actual Spend column is the
    first one after it whose header says actual and spend."""
    want = label.strip().upper()
    for r in range(min(len(rows), 6)):
        for c, cell in enumerate(rows[r]):
            if str(cell).strip().upper() != want:
                continue
            for hr in range(r, min(len(rows), r + 4)):
                for k in range(c, min(c + 6, len(rows[hr]))):
                    t = str(rows[hr][k]).lower()
                    if "actual" in t and "spend" in t:
                        return k, hr
    return None


def col_index(letters: str) -> int:
    n = 0
    for ch in letters.upper():
        n = n * 26 + (ord(ch) - 64)
    return n - 1


def to_number(value) -> float | None:
    """A number as written in a sheet: "34,621", "Rs 5,075", "2.55%", "".
    None when the cell is empty or not a number."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = re.sub(r"[^\d.\-]", "", str(value).replace(",", ""))
    if text in ("", "-", ".", "-."):
        return None
    try:
        return float(text)
    except ValueError:
        return None


def parse_date(text, fmt, state: dict | None = None) -> dt.date | None:
    """A date as written in the sheet. `fmt` is a strptime format, or a list
    of them (months written "01-Oct-26" one month and "01-Nov-2026" the
    next): the first that fits wins. A format
    without a year ("%b %d": "May 1") walks forward from `start_year`, taking
    the next year each time the month wraps from December to January."""
    s = str(text or "").strip()
    if not s:
        return None
    if isinstance(fmt, (list, tuple)):
        for f in fmt:
            got = parse_date(s, f, state)
            if got is not None:
                return got
        return None
    if "%Y" in fmt or "%y" in fmt:
        try:
            return dt.datetime.strptime(s, fmt).date()
        except ValueError:
            return None
    try:
        probe = dt.datetime.strptime(f"{s} 2000", fmt + " %Y")
    except ValueError:
        return None
    st = state if state is not None else {}
    year = st.setdefault("year", st.get("start_year", dt.date.today().year))
    last_month = st.get("month")
    if last_month is not None and probe.month < last_month:
        year += 1
        st["year"] = year
    st["month"] = probe.month
    try:
        return dt.date(year, probe.month, probe.day)
    except ValueError:  # 29 Feb in a common year
        return None


def parse_daily(rows: list[list], spec: dict) -> dict:
    """One source's rows -> {"days": {iso: {"spend", "revenue"}},
    "filled_through": iso | None, "notes": [..]}.

    A date that appears twice (a pasted-over row) keeps the row with the larger
    spend, and says so. Days after `filled_through` are left out entirely: the
    caller treats them as unavailable, not zero."""
    cols = spec["columns"]
    idx = {k: col_index(v) for k, v in cols.items()}
    di = col_index(spec["date_col"])
    state = {"start_year": spec.get("start_year", dt.date.today().year)}
    seen: dict[str, dict] = {}
    dupes: set[str] = set()
    for row in rows:
        cell = row[di] if di < len(row) else None
        day = parse_date(cell, spec["date_format"], state)
        if day is None:
            continue
        rec = {}
        for key, i in idx.items():
            rec[key] = to_number(row[i]) if i < len(row) else None
        key = day.isoformat()
        if key in seen:
            dupes.add(key)
            if (rec.get("spend") or 0) <= (seen[key].get("spend") or 0):
                continue
        seen[key] = rec
    last = None
    for key in sorted(seen):
        if (seen[key].get("spend") or 0) > 0 or (
            seen[key].get("revenue") or 0
        ) > 0:
            last = key
    days = {
        k: {
            "spend": v.get("spend") or 0.0,
            "revenue": v.get("revenue") or 0.0,
        }
        for k, v in seen.items()
        if last is not None and k <= last
    }
    notes = []
    if dupes:
        notes.append(
            "Some dates appear twice ("
            + ", ".join(sorted(dupes)[:5])
            + "); the row with the larger spend was used."
        )
    return {"days": days, "filled_through": last, "notes": notes}


def merge_parsed(parts: list[dict]) -> dict:
    """Several parsed workbooks of one source (one per month) as one. A day
    in two of them keeps the larger spend."""
    if len(parts) == 1:
        return parts[0]
    days: dict[str, dict] = {}
    notes: list[str] = []
    for p in parts:
        notes += p["notes"]
        for day, rec in p["days"].items():
            if day not in days or rec["spend"] > days[day]["spend"]:
                days[day] = rec
    last = [p["filled_through"] for p in parts if p["filled_through"]]
    return {
        "days": dict(sorted(days.items())),
        "filled_through": max(last) if last else None,
        "notes": notes,
    }


def apply_follow(parsed: dict[str, dict], specs: dict) -> None:
    """A source that is updated together with another one (the broadcast
    sheet follows the CRM flow sheet) is filled through the later of the two,
    because its genuine no-broadcast days are zeros that look unentered."""
    for name, spec in specs.items():
        follow = spec.get("filled_through_follows")
        if not follow or follow not in parsed or name not in parsed:
            continue
        mine, theirs = parsed[name], parsed[follow]
        end = max(
            x for x in (mine["filled_through"], theirs["filled_through"]) if x
        )
        if end == mine["filled_through"]:
            continue
        # the days between were genuine zeros: add them back
        start = dt.date.fromisoformat(mine["filled_through"] or end)
        stop = dt.date.fromisoformat(end)
        d = start
        while d <= stop:
            mine["days"].setdefault(
                d.isoformat(), {"spend": 0.0, "revenue": 0.0}
            )
            d += dt.timedelta(days=1)
        mine["filled_through"] = end


# --------------------------------------------------------------------- API


def _session():
    import google.auth
    from google.auth.transport.requests import AuthorizedSession

    source, _ = google.auth.default()
    target = os.environ.get("RUNTIME_SA_EMAIL")
    if target:
        # Workspace APIs need their own scope; the service account's default
        # token does not carry one, so it asks for a short-lived token for
        # itself with the Sheets scope.
        from google.auth import impersonated_credentials

        creds = impersonated_credentials.Credentials(
            source_credentials=source,
            target_principal=target,
            target_scopes=[SCOPE],
            lifetime=3600,
        )
    else:
        creds = google.auth.default(scopes=[SCOPE])[0]
    return AuthorizedSession(creds)


def fetch_rows(spreadsheet_id: str, tab: str, first_row: int) -> list[list]:
    """The cells as shown on screen (so "34,621" stays text we parse), from
    `first_row` down, columns A to AZ."""
    from urllib.parse import quote

    rng = quote(f"'{tab}'!A{first_row}:CZ", safe="")
    url = (
        f"{API}/{spreadsheet_id}/values/{rng}"
        "?valueRenderOption=FORMATTED_VALUE&majorDimension=ROWS"
    )
    resp = _session().get(url, timeout=60)
    if resp.status_code == 403:
        raise SheetsError(
            "no access to the sheet: share it with the dashboard's service "
            "account (Viewer) and make sure the Sheets API is enabled"
        )
    if resp.status_code == 404:
        raise SheetsError("sheet or tab not found (check the id and tab name)")
    if resp.status_code != 200:
        raise SheetsError(f"Google Sheets answered HTTP {resp.status_code}")
    return resp.json().get("values") or []


def read_workbook(sheet_id: str, spec: dict) -> dict:
    """One workbook of a source. With a "block" in the spec the columns are
    found by name (monthly workbooks move them); otherwise they are the ones
    written in the spec."""
    if not spec.get("block"):
        return parse_daily(
            fetch_rows(sheet_id, spec["tab"], spec["header_row"] + 1), spec
        )
    rows = fetch_rows(sheet_id, spec["tab"], 1)
    found = locate_block(rows, spec["block"])
    if not found:
        raise SheetsError(
            f"no {spec['block']} block with an Actual Spend column in the "
            f"'{spec['tab']}' tab"
        )
    col, header = found
    found_spec = {
        **spec,
        "date_col": "A",
        "columns": {"spend": col_letters(col)},
    }
    return parse_daily(rows[header + 1 :], found_spec)


def load_all(cfg: dict) -> tuple[dict, dict]:
    """(parsed sources, {source: reason it could not be read})."""
    specs = cfg["manual_spends"]["sources"]
    out: dict[str, dict] = {}
    failed: dict[str, str] = {}
    for name, spec in specs.items():
        raw = os.environ.get(spec["sheet_env"]) or ""
        ids = [x.strip() for x in raw.split(",") if x.strip()]
        if not ids:
            failed[name] = f"sheet id not set ({spec['sheet_env']})"
            continue
        try:
            # a source kept in monthly workbooks lists them all, comma
            # separated; the days of every workbook are put together
            parts = [read_workbook(i, spec) for i in ids]
            out[name] = merge_parsed(parts)
        except Exception as exc:
            failed[name] = f"{type(exc).__name__}: {exc}"
    apply_follow(out, specs)
    return out, failed
