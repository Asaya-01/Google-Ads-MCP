import datetime as dt
import json
import pathlib
import shutil
import subprocess

import pytest

ENGINE = (
    pathlib.Path(__file__).resolve().parents[1] / "static" / "range_engine.js"
)
FIELDS = ["gmv", "orders", "sessions", "atc", "spend", "perf_spend"]


def days_page(n=60, start=dt.date(2026, 9, 1), sale=(), missing=()):
    dates = [(start + dt.timedelta(days=i)).isoformat() for i in range(n)]
    values = {k: [] for k in FIELDS}
    for i, d in enumerate(dates):
        is_sale = d in sale
        orders = 100 if is_sale else 40
        values["orders"].append(orders)
        values["gmv"].append(orders * 800.0)
        values["sessions"].append(None if d in missing else 5000 + i)
        values["atc"].append(300)
        values["spend"].append(1000.0)
        values["perf_spend"].append(800.0)
    return {
        "dates": dates,
        "phase": ["sale" if d in sale else "bau" for d in dates],
        "fields": FIELDS,
        "values": values,
        "na": {"sessions": {d: 0 for d in missing}},
        "reasons": ["sessions were not pulled"],
    }


def run(page, body):
    script = (
        "const D=JSON.parse(process.argv[1]);"
        f"const E=require('{ENGINE}')(D);"
        f"console.log(JSON.stringify((()=>{{{body}}})()));"
    )
    done = subprocess.run(
        ["node", "-e", script, json.dumps(page)],
        capture_output=True,
        text=True,
        check=True,
    )
    return json.loads(done.stdout)


node = pytest.mark.skipif(not shutil.which("node"), reason="no node")


@node
def test_a_mixed_range_is_split_and_each_phase_meets_its_own_kind():
    sale = [f"2026-10-{d:02d}" for d in range(10, 15)]
    page = days_page(sale=sale + [f"2026-09-{d:02d}" for d in range(10, 13)])
    out = run(
        page,
        "const c=E.compare('2026-10-08','2026-10-17',{mode:'month'});"
        "return c.groups.map(g=>({p:g.phase,cur:g.cur.length,prev:g.prev.length,"
        "gmv:g.w.gmv,pgmv:g.pw&&g.pw.gmv,ch:g.change('gmv')}));",
    )
    by = {g["p"]: g for g in out}
    assert by["bau"]["cur"] == 5 and by["sale"]["cur"] == 5
    # month back: 8-17 Sep holds 3 sale days (10-12) and 7 BAU days
    assert by["sale"]["prev"] == 3 and by["bau"]["prev"] == 7
    assert by["sale"]["gmv"] == 5 * 100 * 800
    assert by["sale"]["pgmv"] == 3 * 100 * 800
    assert by["sale"]["ch"] == pytest.approx(0)  # per-day averages are equal
    assert by["bau"]["ch"] == pytest.approx(0)


@node
def test_a_sale_range_with_no_sale_in_the_comparison_says_so():
    sale = [f"2026-10-{d:02d}" for d in range(10, 15)]
    out = run(
        days_page(sale=sale),
        "const c=E.compare('2026-10-10','2026-10-14',{mode:'previous'});"
        "return c.groups.map(g=>({p:g.phase,pw:g.pw,note:g.note}));",
    )
    assert out[0]["p"] == "sale" and out[0]["pw"] is None
    assert "no sale days" in out[0]["note"]


@node
def test_last_matching_period_finds_the_previous_sale_event_not_a_blend():
    old = [f"2026-09-{d:02d}" for d in range(3, 6)]  # an earlier, shorter sale
    older = [f"2026-09-{d:02d}" for d in range(20, 24)]
    now = [f"2026-10-{d:02d}" for d in range(10, 15)]
    out = run(
        days_page(sale=old + older + now),
        "const c=E.compare('2026-10-10','2026-10-14',{mode:'match'});"
        "return {prev:c.groups[0].prev};",
    )
    assert out["prev"] == [f"2026-09-{d:02d}" for d in range(20, 24)]


@node
def test_a_missing_value_is_unavailable_with_its_reason_not_zero():
    page = days_page(missing=["2026-10-05"])
    out = run(
        page,
        "const w=E.windowOf(E.rangeOf('2026-10-01','2026-10-10'));"
        "return {s:w.sessions,cvr:w.cvr,why:w.na.sessions,o:w.orders};",
    )
    assert out["s"] is None and out["cvr"] is None
    assert "not pulled" in out["why"] and "2026-10-05" in out["why"]
    assert out["o"] == 400 * 0 + 10 * 40 * 1  # orders are all there


@node
def test_dates_outside_the_data_are_flagged_not_invented():
    out = run(
        days_page(n=10),
        "const c=E.compare('2026-08-25','2026-09-05',{mode:'none'});"
        "return {outside:c.outside,days:c.w.days};",
    )
    assert out["outside"] == 7 and out["days"] == 5


@node
def test_presets_include_black_friday_and_recent_sale_runs():
    sale = [f"2025-11-{d:02d}" for d in range(5, 10)]
    out = run(
        days_page(n=90, start=dt.date(2025, 10, 1), sale=sale),
        "return E.presets().map(p=>[p.id,p.from,p.to]);",
    )
    ids = [p[0] for p in out]
    assert "bf" in ids and "cm" in ids
    bf = next(p for p in out if p[0] == "bf")
    assert bf[1] == "2025-11-28"  # Black Friday 2025
    assert any(i.startswith("sale:") for i in ids)


@node
def test_each_block_names_the_sale_it_is_compared_with_to_the_hour():
    old = [f"2026-09-{d:02d}" for d in range(20, 24)]
    now = [f"2026-10-{d:02d}" for d in range(10, 15)]
    page = days_page(sale=old + now)
    page["events"] = [
        {"start": "2026-09-19T21:00", "end": "2026-09-23T24:00"},
        {"start": "2026-10-09T19:00", "end": "2026-10-14T24:00"},
    ]
    out = run(
        page,
        "const c=E.compare('2026-10-09','2026-10-15',{mode:'match'});"
        "const g=c.groups.find(x=>x.phase==='sale');"
        "return {cur:g.curEvents,prev:g.prevEvents,days:g.prev};",
    )
    assert [e["start"] for e in out["cur"]] == ["2026-10-09T19:00"]
    assert [e["start"] for e in out["prev"]] == ["2026-09-19T21:00"]
    assert out["days"] == old


@node
def test_has_all_tells_which_days_have_every_input():
    page = days_page()
    page["values"]["gmv"][3] = None
    out = run(
        page,
        "return [E.hasAll(E.dates[2],['gmv','orders']),"
        "E.hasAll(E.dates[3],['gmv','orders']),E.hasAll('1999-01-01',['gmv'])];",
    )
    assert out == [True, False, False]


@node
def test_two_periods_inside_one_sale_are_called_out():
    sale = [f"2026-10-{d:02d}" for d in range(10, 20)]
    page = days_page(sale=sale)
    page["events"] = [{"start": "2026-10-10T19:00", "end": "2026-10-19T24:00"}]
    out = run(
        page,
        "const c=E.compare('2026-10-16','2026-10-18',{mode:'custom',from:'2026-10-12',to:'2026-10-14'});"
        "return c.groups.map(g=>g.note);",
    )
    assert any(n and "same sale" in n for n in out)
