import datetime as dt

import pytest

from app import live, rules, settings

PCFG = settings.config()["phases"]
SHAPE = [
    3,
    2,
    1,
    1,
    1,
    2,
    3,
    5,
    8,
    10,
    12,
    12,
    12,
    12,
    11,
    11,
    11,
    11,
    12,
    13,
    13,
    12,
    9,
    6,
]
START = dt.date(2026, 8, 1)


def hourly(days=70, sales=(), bumps=(), level=500, wobble=True):
    """Synthetic hourly orders. sales: [(day_index, hour, day_index, hour)]
    meaning live from the first to (not including) the second, at 3.5x."""
    rows = []
    total = sum(SHAPE)
    for i in range(days):
        d = START + dt.timedelta(days=i)
        for h in range(24):
            n = level * SHAPE[h] / total
            if wobble:
                n *= 1 + 0.08 * (((i * 7 + h * 3) % 5) - 2) / 2
            for a, ah, b, bh in sales:
                if a * 24 + ah <= i * 24 + h < b * 24 + bh:
                    n *= 3.5
            if i in bumps:
                n *= 2.0
            rows.append({"date": d.isoformat(), "hour": h, "orders": round(n)})
    return rows


def day(i):
    return (START + dt.timedelta(days=i)).isoformat()


def detect(rows, **over):
    cfg = {**PCFG, "overrides": over.get("overrides", {})}
    return rules.detect_sales_hourly(rows, cfg)


def test_a_sale_that_goes_live_in_the_evening_is_found_to_the_hour():
    res = detect(hourly(sales=[(30, 19, 34, 24)]))
    assert len(res["events"]) == 1
    e = res["events"][0]
    assert e["start"] == f"{day(30)}T19:00"
    assert e["end"].startswith(day(34))
    ph = res["phases"]
    assert ph[day(30)]["phase"] == "mixed"
    assert ph[day(30)]["start_hour"] == 19
    assert "went live at 7 pm" in ph[day(30)]["basis"]
    assert [ph[day(i)]["phase"] for i in (31, 32, 33)] == ["sale"] * 3
    assert ph[day(29)]["phase"] == "bau" and ph[day(36)]["phase"] == "bau"


def test_a_sale_that_ends_midday_leaves_a_transition_day():
    res = detect(hourly(sales=[(30, 19, 34, 12)]))
    p = res["phases"][day(34)]
    assert p["phase"] == "mixed" and p["end_hour"] == 12
    assert "ended at 12 pm" in p["basis"]
    # most of that day's orders came before noon: the two-way label follows them
    assert p["phase_eff"] in ("sale", "bau")


def test_a_one_day_push_is_not_a_sale():
    res = detect(hourly(bumps=(20,)))
    assert res["events"] == []
    assert res["phases"][day(20)]["phase"] == "bau"


def test_a_busy_stretch_of_the_month_is_not_a_sale():
    rows = hourly()
    for r in rows:  # days 5 to 14 run 1.4x all day, no step up
        i = (dt.date.fromisoformat(r["date"]) - START).days
        if 5 <= i <= 14:
            r["orders"] = round(r["orders"] * 1.4)
    assert detect(rows)["events"] == []


def test_a_long_sale_does_not_lift_its_own_yardstick():
    res = detect(hourly(days=90, sales=[(30, 18, 50, 0)]))
    ph = res["phases"]
    assert len(res["events"]) == 1
    assert all(ph[day(i)]["phase"] == "sale" for i in range(31, 50))


def test_a_manual_override_beats_the_numbers():
    res = detect(hourly(sales=[(30, 19, 34, 24)]), overrides={day(32): "bau"})
    assert res["phases"][day(32)]["phase"] == "bau"
    assert res["phases"][day(32)]["basis"] == "manual override"


def test_live_regime_spots_a_sale_going_live_and_ending():
    rows = hourly()
    base = {}
    phases = {}
    for i in range(70):
        d = day(i)
        orders = [0] * 24
        for r in rows:
            if r["date"] == d:
                orders[r["hour"]] = r["orders"]
        base[d] = {"orders": orders}
        phases[d] = "bau"
    now = dt.datetime(2026, 11, 1, 22, 10, tzinfo=live.IST)
    normal = list(base[day(5)]["orders"])
    ratio, regime = live.live_regime(normal, base, phases, now, PCFG)
    assert regime == "bau" and ratio == pytest.approx(1.0, abs=0.3)
    surge = list(normal)
    for h in (19, 20, 21):
        surge[h] *= 4
    ratio, regime = live.live_regime(surge, base, phases, now, PCFG)
    assert regime == "sale" and ratio > 3
    early = dt.datetime(2026, 11, 1, 1, 0, tzinfo=live.IST)
    assert live.live_regime(surge, base, phases, early, PCFG) == (None, None)


def test_the_team_calendar_labels_read_as_phases():
    from app.rules import calendar_phase as cp

    assert cp("BAU")["phase"] == "bau"
    assert cp("BAU — Ramp +19.2%")["phase"] == "bau"
    assert cp("BAU (App Early Access)")["phase"] == "bau"
    assert cp("Sale")["phase"] == "sale"
    assert cp("Burst 1")["phase"] == "sale"
    assert cp("BURST — Buy 2 @ 699")["phase"] == "sale"
    go = cp("Sale (Go-live 6PM)")
    assert go["phase"] == "mixed" and go["start_hour"] == 18
    assert go["phase_eff"] == "bau"  # live for 6 of the 24 hours
    assert cp("Sale (Ends 11:59PM)")["phase"] == "sale"  # a full sale day
    early = cp("Sale (Ends 2PM)")
    assert early["phase"] == "mixed" and early["end_hour"] == 14
    assert cp("") is None and cp("Holiday") is None


def test_the_calendar_wins_where_it_speaks_and_rebuilds_the_sales():
    from app.rules import apply_calendar

    detected = {
        "2026-11-01": {"phase": "sale", "phase_eff": "sale", "basis": "x"},
        "2026-11-02": {"phase": "mixed", "phase_eff": "bau", "basis": "x"},
        "2026-11-20": {"phase": "bau", "phase_eff": "bau", "basis": "x"},
    }
    events = [
        {
            "start": "2026-10-31T19:00",
            "end": "2026-11-02T10:00",
            "hours": 39,
            "uplift": 2.3,
        },
        {
            "start": "2026-12-05T18:00",
            "end": "2026-12-06T24:00",
            "hours": 30,
            "uplift": 2.5,
        },
    ]
    labels = {
        "2026-11-01": "BAU — Ramp +19.2%",
        "2026-11-02": "BAU — Ramp +19.2%",
        "2026-10-13": "Sale (Go-live 6PM)",
        "2026-10-14": "Sale",
        "2026-10-18": "Sale (Ends 11:59PM)",
        "2026-10-15": "Sale",
        "2026-10-16": "Sale",
        "2026-10-17": "Sale",
    }
    phases, evs = apply_calendar(detected, events, labels)
    assert phases["2026-11-01"]["phase"] == "bau"
    assert phases["2026-11-02"]["phase"] == "bau"
    assert phases["2026-11-20"]["basis"] == "x"  # not in the calendar: kept
    assert phases["2026-10-13"]["phase"] == "mixed"
    # the detected 31 Oct - 2 Nov "sale" is gone; the December one stays
    starts = [e["start"] for e in evs]
    assert "2026-10-31T19:00" not in starts and "2026-12-05T18:00" in starts
    oct_sale = next(e for e in evs if e["start"].startswith("2026-10-13"))
    assert oct_sale["start"] == "2026-10-13T18:00"
    assert oct_sale["end"] == "2026-10-18T24:00"


def test_calendar_labels_come_from_the_phase_column_first():
    from app import sheets, settings

    spec = settings.config()["manual_spends"]["phase_plan"]
    nov = [
        ["ASAYA — NOVEMBER 2026"],
        [],
        ["", "", "", "", "Shopify"],
        ["Date", "Day", "Day type", "Phase"],
        ["01-Nov-2026", "Sun", "BAU — Ramp +19.2%", "BAU"],
        ["13-Nov-2026", "Fri", "BURST — Buy 2 @ 699", "Burst 1"],
        ["NOVEMBER TOTAL"],
    ]
    assert sheets.calendar_labels(nov, spec) == {
        "2026-11-01": "BAU",
        "2026-11-13": "Burst 1",
    }
    octo = [
        ["TARGET vs ACHIEVED — OCTOBER 2026"],
        ["", "", "OVERALL"],
        ["MTD"],
        ["Date", "Day Type", "Target Spends"],
        ["13-Oct-26", "Sale (Go-live 6PM)", "₹1"],
        ["19-Oct-26", "BAU", "₹1"],
    ]
    assert sheets.calendar_labels(octo, spec) == {
        "2026-10-13": "Sale (Go-live 6PM)",
        "2026-10-19": "BAU",
    }
