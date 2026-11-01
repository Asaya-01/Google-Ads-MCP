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


def parse_date(text, fmt: str, state: dict | None = None) -> dt.date | None:
    """A date as written in the sheet. `fmt` is a strptime format. A format
    without a year ("%b %d": "May 1") walks forward from `start_year`, taking
    the next year each time the month wraps from December to January."""
    s = str(text or "").strip()
    if not s:
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

    rng = quote(f"'{tab}'!A{first_row}:AZ", safe="")
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


def load_all(cfg: dict) -> tuple[dict, dict]:
    """(parsed sources, {source: reason it could not be read})."""
    specs = cfg["manual_spends"]["sources"]
    out: dict[str, dict] = {}
    failed: dict[str, str] = {}
    for name, spec in specs.items():
        sheet_id = os.environ.get(spec["sheet_env"])
        if not sheet_id:
            failed[name] = f"sheet id not set ({spec['sheet_env']})"
            continue
        try:
            rows = fetch_rows(sheet_id, spec["tab"], spec["header_row"] + 1)
            out[name] = parse_daily(rows, spec)
        except Exception as exc:
            failed[name] = f"{type(exc).__name__}: {exc}"
    apply_follow(out, specs)
    return out, failed
