"""Profitability tab: the D2C (Website) P&L from finance's channel P&L, month
by month, Net revenue → Gross margin → CM1 → CM2 → CM3 (the workbook's own
levels; it stops at CM3).

Data lives only in the dashboard's private bucket (the repository is public
and BigQuery is read-only for the dashboard):

  private/pnl/actuals/<version>.json   every channel and line of one import,
                                       untouched (pnl_monthly_actuals)
  private/pnl/mis/<version>.json       COGS by SKU and the Website sales dump
                                       from an MIS upload
  private/pnl/costs/<table>.json       Phase 2 cost inputs (empty until given)
  private/pnl/index.json               the imports, newest first, and which
                                       one is active
  pages/profitability.json             the tab: the Website slice only

Re-imports create a new version; nothing is ever overwritten or edited.
"""

from __future__ import annotations

import copy
import datetime as dt
import re

from .. import settings

ROOT = "private/pnl"
INDEX = f"{ROOT}/index.json"
PAGE = "pages/profitability.json"
COST_TABLES = ["cogs_sku", "logistics", "payment", "other_variable", "allocation_rules"]


def config() -> dict:
    return copy.deepcopy(settings.config()["profitability"])


def norm(label) -> str:
    """A workbook label made comparable: lower case, one space, plain dashes."""
    t = str(label or "").replace("–", "-").replace("—", "-").replace("⁠", "")
    return re.sub(r"\s+", " ", t).strip().lower()


def line_key(label: str, lines: list[dict]) -> str | None:
    """Which configured line a workbook row is, or None (kept, shown as unmapped)."""
    n = norm(label)
    for ln in lines:
        for rx in ln.get("match") or []:
            if re.search(rx, n):
                return ln["key"]
    return None


def month_key(label) -> str | None:
    """'Apr-26', "Apr'26", 'April 2026', a date → '2026-04'."""
    if isinstance(label, (dt.date, dt.datetime)):
        return f"{label.year:04d}-{label.month:02d}"
    t = norm(label).replace("'", "-").replace("’", "-")
    m = re.match(r"^([a-z]{3})[a-z]*[\s\-]*(\d{2,4})$", t)
    if not m:
        return None
    months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
    if m.group(1) not in months:
        return None
    y = int(m.group(2))
    y = y + 2000 if y < 100 else y
    return f"{y:04d}-{months.index(m.group(1)) + 1:02d}"


def is_d2c(channel: str, cfg: dict) -> bool:
    return bool(re.search(cfg["d2c_channel"], norm(channel)))
