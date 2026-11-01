import datetime as dt

import pytest

from app import settings, sheets

SPECS = settings.config()["manual_spends"]["sources"]


def test_numbers_are_read_as_written_in_a_sheet():
    assert sheets.to_number("34,621") == 34621
    assert sheets.to_number("Rs 5,075") == 5075
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
