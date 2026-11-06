"""Target vs achieved: the media plan's targets are read from the monthly
workbook's blocks wherever their columns sit (made-up numbers)."""

from app import settings, sheets
from app.pages import build_all

from test_pages import CFG, D1, _dataset

C = settings.config()
GROUP = ["Target Spend ₹", "Actual Spend ₹", "Achv %", "Target GMV ₹", "Actual GMV ₹", "Achv %", "Target ROAS", "Actual ROAS", "Achv %"]
BLOCKS = ["Shopify", "META", "GOOGLE", "REDDIT", "CRM FLOW", "CRM BROADCAST", "AFFILIATES", "OVERALL (all channels)"]


def sheet(day_rows):
    head3 = ["", "", "", ""] + [x for b in BLOCKS for x in [b] + [""] * 8]
    head4 = ["Date", "Day", "Day type", "Phase"] + GROUP * len(BLOCKS) + ["Target Net Revenue ₹"]
    rows = [["TITLE"], ["note"], head3, head4]
    for day, n in day_rows:
        r = [day, "Sun", "BAU", "BAU"]
        for i, _ in enumerate(BLOCKS):
            r += [f"{n * (i + 1):,}", "999", "1%", f"{2 * n * (i + 1):,}", "999", "1%", "2.0x", "9x", "1%"]
        rows.append(r)
    return rows


def test_the_blocks_targets_are_read_and_actuals_ignored():
    got = sheets.parse_plan(sheet([("01-Nov-2026", 1000), ("02-Nov-2026", 2000)]), C["media_plan"])
    assert got["2026-11-01"]["store"] == [1000.0, 2000.0]
    assert got["2026-11-02"]["meta"] == [4000.0, 8000.0]
    assert got["2026-11-01"]["affiliate"] == [7000.0, 14000.0]
    assert set(got["2026-11-01"]) == {"store", "meta", "google", "reddit", "crm_flow", "crm_broadcast", "affiliate"}


def test_columns_moved_by_a_month_are_still_found():
    rows = [[""] + r for r in sheet([("01-Nov-2026", 1000)])]
    rows[4][0] = ""
    rows = [r[1:] if i == 4 else r for i, r in enumerate(rows)]  # the date stays in column A
    rows[4] = ["01-Nov-2026"] + rows[4]
    got = sheets.parse_plan(rows, C["media_plan"])
    assert got["2026-11-01"]["google"] == [3000.0, 6000.0]


def test_the_plan_page_carries_the_days_and_the_achieved_fields():
    data = _dataset(with_meta=True)
    data["media_plan"] = {D1: {"store": [1000.0, 2000.0]}}
    pages, _ = build_all(data, CFG, [t["id"] for t in settings.enabled_tabs()])
    P = pages["plan_days"]
    assert P["days"] == {D1: {"store": [1000.0, 2000.0]}}
    assert P["achieved"]["store"]["revenue"] == "gmv"
    days = pages["days"]
    for k, a in P["achieved"].items():
        for f in (a["spend"], a["revenue"]):
            assert f is None or f in days["fields"], f
