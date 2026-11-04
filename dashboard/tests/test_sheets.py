import datetime as dt

import pytest

from app import settings, sheets

SPECS = settings.config()["manual_spends"]["sources"]


def test_numbers_are_read_as_written_in_a_sheet():
    assert sheets.to_number("12,345") == 12345
    assert sheets.to_number("Rs 1,234") == 1234
    assert sheets.to_number("2.55%") == 2.55
    assert sheets.to_number("") is None and sheets.to_number(None) is None
    assert sheets.to_number("n/a") is None
    assert sheets.to_number(12) == 12


def test_a_date_without_a_year_walks_forward_and_wraps_in_january():
    st = {"start_year": 2026}
    fmt = "%b %d"
    got = [
        sheets.parse_date(x, fmt, st)
        for x in ("Nov 30", "Dec 31", "Jan 1", "Feb 2")
    ]
    assert got == [
        dt.date(2026, 11, 30),
        dt.date(2026, 12, 31),
        dt.date(2027, 1, 1),
        dt.date(2027, 2, 2),
    ]


def test_zeros_after_the_last_filled_day_are_not_entered_not_spent_nothing():
    rows = [
        ["6", "2026-06-01", "628", "429,722", "65,371", "21,815", "3.0"],
        ["6", "2026-06-02", "644", "438,009", "35,877", "13,116", "2.7"],
        ["6", "2026-06-03", "609", "422,514", "0", "0", "0.0"],  # a real zero
        ["6", "2026-06-04", "568", "403,294", "45,975", "16,974", "2.7"],
        ["6", "2026-06-05", "0", "0", "0", "0", "0.0"],  # not entered yet
        ["6", "2026-06-06", "0", "0", "0", "0", "0.0"],
    ]
    out = sheets.parse_daily(rows, SPECS["affiliate"])
    assert out["filled_through"] == "2026-06-04"
    assert out["days"]["2026-06-03"] == {"spend": 0.0, "revenue": 0.0}
    assert out["days"]["2026-06-04"]["spend"] == 16974
    assert out["days"]["2026-06-04"]["revenue"] == 45975
    assert "2026-06-05" not in out["days"]


def test_a_date_written_twice_keeps_the_row_with_the_spend():
    rows = [
        ["14/10/2026", "18733", "15006", "1414", "2313", "14610", "109430"],
        ["14/10/2026", "0", "0", "0", "0", "0", "109430"],
        ["15/10/2026", "22883", "16978", "3138", "2767", "16934", "146353"],
    ]
    out = sheets.parse_daily(rows, SPECS["crm_flow"])
    assert out["days"]["2026-10-14"]["spend"] == 14610
    assert out["days"]["2026-10-14"]["revenue"] == 109430  # not added twice
    assert any("twice" in n for n in out["notes"])


def test_the_broadcast_sheet_is_filled_through_the_day_the_flow_sheet_is():
    broadcast = [
        ["Oct 28", "16,785.86", "6,818.85"],
        ["Oct 29", "0", "0"],
        ["Oct 30", "587.86", "4,364.99"],
        ["Oct 31", "0", "0"],
        ["Nov 1", "0", "0"],
    ]
    # the year walk starts from the first row; make it autumn 2026
    spec = {**SPECS["crm_broadcast"], "start_year": 2026}
    b = sheets.parse_daily(broadcast, spec)
    flow = sheets.parse_daily(
        [
            ["30/10/2026", "14136", "12111", "646", "1379", "11604", "48346"],
            ["31/10/2026", "9000", "8000", "400", "600", "8100", "30000"],
        ],
        SPECS["crm_flow"],
    )
    assert b["filled_through"] == "2026-10-30"
    parsed = {"crm_broadcast": b, "crm_flow": flow}
    sheets.apply_follow(parsed, SPECS)
    assert parsed["crm_broadcast"]["filled_through"] == "2026-10-31"
    # 31 Oct had no broadcast: a real zero, now that the CRM team has filled it
    assert parsed["crm_broadcast"]["days"]["2026-10-31"]["spend"] == 0.0
    assert "2026-11-01" not in parsed["crm_broadcast"]["days"]


def test_the_reddit_block_reads_spend_only_and_stops_at_the_last_filled_day():
    pad = [""] * 32  # columns A..AF
    row = lambda d, spend: [d, "Sun", "BAU", "BAU", *[""] * 27, "8,800", spend]
    rows = [
        row("01-Nov-2026", "6,950"),
        row("02-Nov-2026", "7,263"),
        row("03-Nov-2026", ""),  # not entered yet
        ["NOVEMBER TOTAL", *pad],
    ]
    assert len(rows[0]) == 33  # the spend is column AG
    out = sheets.parse_daily(rows, SPECS["reddit"])
    assert out["filled_through"] == "2026-11-02"
    assert out["days"]["2026-11-01"]["spend"] == 6950
    assert out["days"]["2026-11-02"]["spend"] == 7263
    assert "2026-11-03" not in out["days"]


def test_monthly_workbooks_are_put_together_and_the_larger_spend_wins():
    a = {
        "days": {
            "2026-10-30": {"spend": 100.0, "revenue": 0.0},
            "2026-10-31": {"spend": 200.0, "revenue": 0.0},
        },
        "filled_through": "2026-10-31",
        "notes": [],
    }
    b = {
        "days": {
            "2026-10-31": {"spend": 250.0, "revenue": 0.0},
            "2026-11-01": {"spend": 300.0, "revenue": 0.0},
        },
        "filled_through": "2026-11-01",
        "notes": ["x"],
    }
    out = sheets.merge_parsed([a, b])
    assert sorted(out["days"]) == ["2026-10-30", "2026-10-31", "2026-11-01"]
    assert out["days"]["2026-10-31"]["spend"] == 250.0
    assert out["filled_through"] == "2026-11-01"
    assert sheets.merge_parsed([a]) is a


def _workbook(label_row, label_col, actual_col, days, fmt):
    """A monthly workbook laid out like the team's: title rows, a row naming
    the blocks, a header row, then one row per day."""
    width = actual_col + 3
    blank = [""] * width
    rows = [list(blank) for _ in range(4)]
    rows[label_row][label_col] = "REDDIT"
    head = rows[3]
    head[0], head[label_col], head[actual_col] = (
        "Date",
        "Target Spend ₹",
        "Actual Spends" if actual_col % 2 else "Actual Spend ₹",
    )
    for d, spend in days:
        row = list(blank)
        row[0], row[label_col], row[actual_col] = d, "8,800", spend
        rows.append(row)
    rows.append(["NOVEMBER TOTAL"] + [""] * (width - 1))
    return rows


def test_the_reddit_block_is_found_by_name_in_each_months_layout():
    oct_rows = _workbook(
        1, 38, 39, [("01-Oct-26", "₹10,000"), ("02-Oct-26", "₹11,000")], 0
    )
    nov_rows = _workbook(
        2, 31, 32, [("01-Nov-2026", "6,950"), ("02-Nov-2026", "")], 0
    )
    assert sheets.locate_block(oct_rows, "REDDIT") == (39, 3)
    assert sheets.locate_block(nov_rows, "REDDIT") == (32, 3)
    assert sheets.locate_block(oct_rows, "GOOGLE") is None
    spec = {**SPECS["reddit"], "date_col": "A"}
    for rows, (col, header) in ((oct_rows, (39, 3)), (nov_rows, (32, 3))):
        spec["columns"] = {"spend": sheets.col_letters(col)}
        out = sheets.parse_daily(rows[header + 1 :], spec)
        assert out["filled_through"] in ("2026-10-02", "2026-11-01")
    oct_out = sheets.parse_daily(
        oct_rows[4:], {**spec, "columns": {"spend": "AN"}}
    )
    assert oct_out["days"]["2026-10-01"]["spend"] == 10000
    assert oct_out["days"]["2026-10-02"]["spend"] == 11000
    nov_out = sheets.parse_daily(
        nov_rows[4:], {**spec, "columns": {"spend": "AG"}}
    )
    assert nov_out["days"]["2026-11-01"]["spend"] == 6950
    assert "2026-11-02" not in nov_out["days"]  # not entered yet


def test_dates_may_be_written_two_ways():
    assert sheets.parse_date("01-Oct-26", ["%d-%b-%Y", "%d-%b-%y"]) == dt.date(
        2026, 10, 1
    )
    assert sheets.parse_date(
        "01-Nov-2026", ["%d-%b-%Y", "%d-%b-%y"]
    ) == dt.date(2026, 11, 1)
    assert sheets.parse_date("nonsense", ["%d-%b-%Y", "%d-%b-%y"]) is None
