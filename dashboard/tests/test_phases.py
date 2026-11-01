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
