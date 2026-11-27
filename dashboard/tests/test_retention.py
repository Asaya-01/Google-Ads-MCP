import datetime as dt

from app.retention import build as rb
from app.retention.catalog import Catalog, normalise

CAT = Catalog()
TYPES = ["freebie", "merch", "book", "gummies", ""]
UTC = dt.timezone.utc
THROUGH = dt.date(2026, 3, 31)


def at(day: str, hour: int = 12) -> dt.datetime:
    y, m, d = map(int, day.split("-"))
    return dt.datetime(y, m, d, hour, tzinfo=UTC)


def line(
    order, cust, day, title, sku="x", ptype="serum", revenue=400.0, hour=12
):
    return (order, cust, at(day, hour), title, sku, ptype, revenue)


UAS = "Even Tone Underarm Mist - Dark Patches and Odour Control Spray"
ASS = "Advanced Spot Targeting Serum"
ITB = "Fade Forward Inner Thigh & Bum Roll-On"


def census(rows, **kw):
    return rb.build(rows, CAT, TYPES, THROUGH, **kw)


def test_titles_are_normalised_the_same_way_in_sql():
    assert normalise("Glow & Lift Crème - Mini\n") == "glow & lift cr me - mini"


def test_a_repeat_customer_becomes_a_timeline_and_a_one_off_a_count():
    c = census(
        [
            line("1", "A", "2025-01-10", UAS),
            line("2", "A", "2025-02-20", ASS),
            line("3", "B", "2025-01-15", ITB),
        ]
    )
    assert c["epoch"] == "2025-01-10"
    assert len(c["multi"]) == 1 and c["stats"]["customers_single"] == 1
    skus = [s[0] for s in c["skus"]]
    uas, ass, itb = skus.index("UAS"), skus.index("ASS"), skus.index("ITB")
    vid = {v["s"]: i for i, v in enumerate(c["vars"])}
    d1, d2 = 0, 41
    assert c["multi"][0] == f"N{d1}:{vid[uas]}~400|{d2}:{vid[ass]}~400"
    assert c["singles_s"][str(itb)] == [[5, 1, 0, 400]]
    assert c["sbrand"] == [[5, 1, 1, 0, 400]]
    assert c["ndays"] == (THROUGH - dt.date(2025, 1, 10)).days


def test_orders_under_24_hours_apart_are_one_order():
    c = census(
        [
            line("1", "A", "2025-01-10", UAS, hour=10),
            line("2", "A", "2025-01-10", ASS, hour=20),  # retry, same evening
        ]
    )
    assert c["stats"]["merged_pairs"] == 1
    assert c["multi"] == [] and c["stats"]["customers_single"] == 1
    assert c["sbrand"][0][1] == 2  # one order, two products


def test_free_gifts_merch_minis_and_books_never_count():
    c = census(
        [
            line("1", "A", "2025-01-10", UAS),
            line("2", "A", "2025-03-01", "Sunshine Charm", ptype="freebie"),
            line("3", "A", "2025-03-02", ASS + " - Mini", ptype="freebie"),
            line("4", "A", "2025-03-03", ITB, revenue=0.0),
            line("5", "A", "2025-03-04", "Make It Stick", ptype="book"),
        ]
    )
    assert c["multi"] == [] and c["stats"]["customers_single"] == 1
    ex = c["stats"]["excluded"]
    assert "zero revenue (free)" in ex
    assert "product type: freebie" in ex and "product type: book" in ex


def test_sets_and_gift_boxes_not_on_the_website_are_grouped_not_lost():
    c = census(
        [
            line(
                "1",
                "A",
                "2025-01-10",
                "Floral Affair Set",
                revenue=999.0,
                ptype="combo",
            ),
            line(
                "2",
                "A",
                "2025-02-10",
                "Winning Streak Gift Box",
                revenue=1500.0,
                ptype="combo",
            ),
            line("3", "A", "2025-03-10", UAS),
        ]
    )
    assert [s[0] for s in c["skus"]] == ["UAS", "GFT", "OST"]


def test_a_paid_line_nothing_recognises_goes_to_other_and_is_listed():
    c = census(
        [
            line("1", "A", "2025-01-10", "Mystery Elixir", revenue=500.0),
            line("2", "A", "2025-02-10", UAS),
        ]
    )
    assert [s[0] for s in c["skus"]] == ["UAS", "OTH"]
    assert c["stats"]["other_top"][0]["title"] == "Mystery Elixir"


def test_shopify_type_decides_and_every_website_product_counts():
    kw = dict(revenue=500.0)
    cl = lambda t, ptype: CAT.classify(t, "x", kw["revenue"], ptype, TYPES)
    # a paid mini that Shopify types as a Serum is a product; a Freebie one is not
    assert cl("5% Multi Peptide Complex - Mini Glow", "serum")[0].code == "MPC"
    assert cl("Even Evermore Creme - Mini", "freebie")[0] is None
    # the same title can be a product or a freebie depending on its type
    assert cl("Fresh Start Smoothening Scrub", "scrub")[0].code == "FSS"
    assert cl("Fresh Start Smoothening Scrub", "freebie")[0] is None
    # website products that were missing from the first rules
    assert cl("Rapid Dark Spot Correction Set", "combo")[0].code == "RDS"
    assert cl("Travel Friendly Kit", "combo")[0].code == "TFK"
    assert cl("Better Daily Essentials", "combo")[0].code == "BDE"
    assert cl("Even Tone Underarm Mist - Pack of 2", "treatment")[0].pack == 2


def test_blank_type_counts_only_for_a_named_product():
    cl = lambda t, ptype: CAT.classify(t, "x", 500.0, ptype, TYPES)
    assert cl("Rise Renewed Night Cream", "")[0].code == "RRN"
    line_, why = cl("Mystery Elixir", "")
    assert line_ is None and "blank" in why


def test_a_product_shopify_no_longer_has_is_judged_by_its_title():
    cl = lambda t: CAT.classify(t, "x", 400.0, "(no product match)", TYPES)
    assert cl("Travel Kit (4 minis + Pouch)")[0] is None
    assert cl("Glow & Lift Creme - Mini")[1] == "mini or trial size"
    assert cl("Anti Pigmentation Set + Pouch")[0].code == "APS"
    assert cl("Even Tone Underarm Mist")[0].code == "UAS"


def test_variants_and_packs_are_kept_apart():
    c = census(
        [
            line("1", "A", "2025-01-10", UAS, sku="Sweet_Vanilla_packof2"),
            line("2", "A", "2025-02-10", UAS, sku="8906161981436"),
        ],
        variant_titles={"8906161981436": "Berry Crush / 100 ml"},
    )
    labels = [v["label"] for v in c["vars"]]
    assert "Sweet Vanilla · Pack of 2" in labels and "Berry Crush" in labels


def test_a_customer_with_no_counted_lines_is_not_in_the_census():
    c = census(
        [
            line("1", "A", "2025-01-10", UAS),
            line("2", "Z", "2025-01-11", "Tote Bag", ptype="merch"),
        ]
    )
    assert c["stats"]["customers"] == 1


# ---- the builder and the JavaScript engine agree --------------------------
import json
import pathlib
import random
import shutil
import subprocess

import pytest

ENGINE = (
    pathlib.Path(__file__).resolve().parents[1]
    / "static"
    / "retention_engine.js"
)


def _synthetic():
    """200 customers with 1-4 orders, at least 3 days apart, and the answer
    worked out independently of both implementations."""
    rng = random.Random(7)
    titles = [UAS, ASS, ITB]
    rows, truth = [], {}
    start = dt.date(2025, 1, 1)
    oid = 0
    for c in range(200):
        d = start + dt.timedelta(days=rng.randrange(0, 300))
        days = [d]
        for _ in range(rng.choice([0, 0, 1, 1, 2, 3])):
            days.append(days[-1] + dt.timedelta(days=rng.randrange(3, 120)))
        days = [x for x in days if x <= dt.date(2026, 3, 31)]
        truth[str(c)] = days
        for day in days:
            oid += 1
            rows.append(
                (
                    str(oid),
                    str(c),
                    at(day.isoformat()),
                    rng.choice(titles),
                    "x",
                    "serum",
                    400.0,
                )
            )
    return rows, truth


@pytest.mark.skipif(not shutil.which("node"), reason="node is not installed")
def test_the_engine_reproduces_an_independent_count_from_the_built_census(
    tmp_path,
):
    rows, truth = _synthetic()
    census = census_for(rows)
    f = tmp_path / "census.json"
    f.write_text(json.dumps(census))
    script = (
        "const P=JSON.parse(require('fs').readFileSync(process.argv[1]));"
        f"const E=require('{ENGINE}')(P);"
        "const r=E.computeBrand(0,E.NDAYS,90);"
        "console.log(JSON.stringify({n1:r.n[1],cb:r.cb[90],ch:r.ch[90],nd:E.NDAYS}));"
    )
    out = json.loads(
        subprocess.run(
            ["node", "-e", script, str(f)],
            capture_output=True,
            text=True,
            check=True,
        ).stdout
    )
    epoch = min(d[0] for d in truth.values())
    ndays = (THROUGH - epoch).days
    assert out["nd"] == ndays
    cohort = [d for d in truth.values() if (d[0] - epoch).days <= ndays - 90]
    repeated = [d for d in cohort if len(d) > 1 and (d[1] - d[0]).days <= 90]
    assert out["cb"] == len(cohort) and out["ch"] == len(repeated)
    assert out["n1"] == len(cohort)  # one count per customer in the cohort


def census_for(rows):
    return rb.build(rows, CAT, TYPES, THROUGH)


def test_a_paid_lip_balm_is_a_product_but_the_free_lip_pot_is_not():
    cl = lambda t, ptype: CAT.classify(t, "x", 190.0, ptype, TYPES)
    assert cl("BOBA Lip Balm", "")[0].code == "BLB"
    assert cl("Soft Spot Lip & Cheek Blurring Pot", "freebie")[0] is None


@pytest.mark.skipif(not shutil.which("node"), reason="node is not installed")
def test_the_engine_values_customers_like_an_independent_sum(tmp_path):
    rows, truth = _synthetic()
    f = tmp_path / "census.json"
    f.write_text(json.dumps(census_for(rows)))
    script = (
        "const P=JSON.parse(require('fs').readFileSync(process.argv[1]));"
        f"const E=require('{ENGINE}')(P);"
        "const v=E.computeValue(0,E.NDAYS,90);"
        "const m=E.computeMonthly(0,E.NDAYS);"
        "const pv=E.computeProductValue(0,E.NDAYS);"
        "console.log(JSON.stringify({v,months:m.reduce((s,x)=>s+x.n,0),"
        "pv:pv.reduce((s,x)=>s+x.n,0)}));"
    )
    out = json.loads(
        subprocess.run(
            ["node", "-e", script, str(f)],
            capture_output=True,
            text=True,
            check=True,
        ).stdout
    )
    epoch = min(d[0] for d in truth.values())
    ndays = (THROUGH - epoch).days
    day = lambda x: (x - epoch).days
    cohort = [d for d in truth.values() if day(d[0]) <= ndays - 90]
    expect = sum(
        400 * sum(1 for x in d if day(x) - day(d[0]) <= 90) for d in cohort
    )
    ltv90 = next(x for x in out["v"]["ltv"] if x["h"] == 90)
    assert ltv90["n"] == len(cohort)
    assert ltv90["per"] == pytest.approx(expect / len(cohort))
    assert out["v"]["cust"] == len(truth) == out["months"]
    assert out["v"]["firstAov"] == pytest.approx(400)
    assert out["v"]["repAov"] == pytest.approx(400)


@pytest.mark.skipif(not shutil.which("node"), reason="node is not installed")
def test_value_can_be_scoped_to_customers_acquired_on_one_product(tmp_path):
    rows = [
        line("1", "A", "2025-01-10", UAS),
        line("2", "A", "2025-01-30", ASS),
        line("3", "B", "2025-01-11", ASS),
        line("4", "C", "2025-01-12", UAS),
        line("5", "D", "2025-01-13", ITB),
    ]
    c = census(rows)
    f = tmp_path / "census.json"
    f.write_text(json.dumps(c))
    code = Catalog().classify(UAS, "x", 400.0, "serum", TYPES)[0].code
    script = (
        "const P=JSON.parse(require('fs').readFileSync(process.argv[1]));"
        f"const E=require('{ENGINE}')(P);"
        f"const i=P.skus.findIndex((s)=>s[0]==='{code}');"
        "const all=E.computeValue(0,E.NDAYS,90);"
        "const v=E.computeValue(0,E.NDAYS,90,i);"
        "const m=E.computeMonthly(0,E.NDAYS,i);"
        "console.log(JSON.stringify({all:all.cust,v,m:m.reduce((s,x)=>s+x.n,0)}));"
    )
    out = json.loads(
        subprocess.run(
            ["node", "-e", script, str(f)],
            capture_output=True,
            text=True,
            check=True,
        ).stdout
    )
    assert out["all"] == 4 and out["v"]["cust"] == 2 and out["m"] == 2
    assert out["v"]["size"] is None
    ltv90 = next(x for x in out["v"]["ltv"] if x["h"] == 90)
    assert ltv90["per"] == pytest.approx((800 + 400) / 2)


@pytest.mark.skipif(not shutil.which("node"), reason="node is not installed")
def test_the_90_day_figure_is_90_days_whatever_horizon_is_picked(tmp_path):
    """"Bought it again within 90 days" counts only buyers with 90 days of
    runway and a same-product repeat inside 90 days. It used to copy the
    figure for the horizon picked (30, 180, ...)."""
    rng = random.Random(11)
    titles = [UAS, ASS, ITB]
    rows, timelines, oid = [], [], 0
    start = dt.date(2025, 1, 1)
    for c in range(300):
        d = start + dt.timedelta(days=rng.randrange(0, 420))
        tl = [(d, rng.choice(titles))]
        for _ in range(rng.choice([0, 1, 1, 2, 3])):
            nd = tl[-1][0] + dt.timedelta(days=rng.randrange(3, 150))
            if nd <= THROUGH:
                tl.append((nd, rng.choice(titles)))
        timelines.append(tl)
        for day, title in tl:
            oid += 1
            rows.append((str(oid), str(c), at(day.isoformat()), title, "x", "serum", 400.0))
    f = tmp_path / "census.json"
    f.write_text(json.dumps(census_for(rows)))
    code = CAT.classify(UAS, "x", 400.0, "serum", TYPES)[0].code
    script = (
        "const P=JSON.parse(require('fs').readFileSync(process.argv[1]));"
        f"const E=require('{ENGINE}')(P);"
        "const pick=(hz)=>E.compute(0,E.NDAYS,'product',hz).find((r)=>r.code==="
        f"'{code}');"
        "const a=pick(30),b=pick(180),c=pick(90);"
        "console.log(JSON.stringify({nd:E.NDAYS,a:[a.m90_base,a.m90_rate],"
        "b:[b.m90_base,b.m90_rate],c:[c.m90_base,c.m90_rate,c.base,c.rate]}));"
    )
    out = json.loads(
        subprocess.run(
            ["node", "-e", script, str(f)], capture_output=True, text=True, check=True
        ).stdout
    )
    epoch = min(tl[0][0] for tl in timelines)
    end90 = out["nd"] - 90
    base = hit = 0
    for tl in timelines:
        uas = [d for d, t in tl if t == UAS]
        if not uas or (uas[0] - epoch).days > end90:
            continue
        base += 1
        if any(0 < (d - uas[0]).days <= 90 for d in uas[1:]):
            hit += 1
    want = [base, pytest.approx(100 * hit / base)]
    assert out["a"] == want and out["b"] == want
    # with a 90-day horizon the two figures are the same thing
    assert out["c"][0] == out["c"][2] and out["c"][1] == pytest.approx(out["c"][3])


# ------------------------------------------------ catalog and basket fixes

def test_aqua_rush_and_every_underarm_mist_fragrance_is_its_own_variant():
    titles = {"8906161981580": "Aqua Rush / 100 ml", "Aqua_Rush_packof2": "Aqua Rush / 100 ml x 2",
              "8906161981023": "Fresh / 100 ml", "UAS_Mixed": "Mixed / 100 ml x 2"}
    c = census([line("1", "A", "2025-01-10", UAS, sku="8906161981580"),
                line("2", "A", "2025-02-10", UAS, sku="Aqua_Rush_packof2"),
                line("3", "B", "2025-01-10", UAS, sku="8906161981023"),
                line("4", "B", "2025-02-10", UAS, sku="UAS_Mixed")], variant_titles=titles)
    labels = {v["label"] for v in c["vars"]}
    assert {"Aqua Rush", "Aqua Rush · Pack of 2", "Fresh", "Mixed · Pack of 2"} <= labels


def test_named_products_that_were_missed_or_merged():
    def code(title, ptype="serum"):
        ln, why = CAT.classify(title, "", 500.0, ptype, TYPES)
        return ln.code if ln else why
    assert code("Oil-Free Barrier+ Crème - Barrier Repair & Hydrating Moisturizer", "moisturiser") == "OFB"  # "free" inside oil-free
    assert code("Moisture Cocoon Crème - Free", "moisturiser") == "free gift or test line"
    assert code("Glow Forward Radiance Serum") == "GFR"
    assert code("Radiance Serum - Korean Brightening Serum for Face") == "RAD"
    assert code("Advanced Anti-Pigmentation Set", "combo") == "AAP"
    assert code("4-Step Advanced Anti-Pigmentation Set", "combo") == "A4S"
    assert code("Anti Pigmentation Set", "combo") == "APS"
    assert code("Fresh Start Smoothening Scrub", "scrub") == "FSS"
    assert code("Even tone undermist - Sweet vanilla", "(no product match)") == "UAS"


def test_packs_come_from_the_catalog_even_without_a_sku():
    catalog = {"variants_by_product": {"10107079721273": [["inner_thigh_bum_roll_on", "70 ml"], ["", "70 ml x 2"]]}}
    rows = [line("1", "A", "2025-01-10", ITB, sku="") + ("10107079721273", 1),
            line("2", "A", "2025-02-10", ITB, sku="inner_thigh_bum_roll_on") + ("10107079721273", 1)]
    c = census(rows, catalog=catalog)
    assert {v["label"] for v in c["vars"]} == {"Standard", "Pack of 2"}
    hc = CAT.classify("Set of 6 Hand Creams", "", 900.0, "(no product match)", TYPES)[0]
    assert hc.code == "LHC" and hc.pack == 6


def test_basket_size_counts_products_like_the_basket_tab():
    """A combo counts the products inside, a pack of 2 counts 2, quantity
    counts, gifts do not: the same rule as the Basket size tab."""
    TFD = "Target & Fade Duo"
    rows = [
        line("1", "A", "2025-01-10", TFD, ptype="combo") + ("10163957203257", 1),       # combo of 2 -> 2
        line("1b", "A", "2025-03-10", ASS) + ("p", 1),
        line("2", "B", "2025-01-10", UAS, sku="Sweet_Vanilla_packof2") + ("p2", 1),  # pack of 2 -> 2
        line("2", "B", "2025-01-10", "Sunshine Charm", ptype="freebie") + ("g", 1),   # gift: not counted
        line("3", "C", "2025-01-10", ASS) + ("p", 3),                                 # quantity 3 -> 3+
        line("4", "D", "2025-01-10", ASS) + ("p", 1),                                 # single -> 1
    ]
    c = census(rows, combos={"10163957203257": 2})
    assert c["fbs"] == [2]  # A is the only repeat customer: first order = the duo
    z = {(d, size): n for d, size, n, _x, _r in c["sbrand"]}
    day = (dt.date(2025, 1, 10) - dt.date.fromisoformat(c["epoch"])).days
    assert z[(day, 2)] == 1 and z[(day, 3)] == 1 and z[(day, 1)] == 1
    assert c["stats"]["first_order_products"] == {"1": 1, "2": 2, "3": 1}
    # an old set with no product id: its name says how many products
    old = census([line("9", "E", "2025-01-10", "Sun-Ready Twin Set", ptype="(no product match)") + ("", 1),
                  line("9b", "E", "2025-03-10", ASS) + ("p", 1)])
    assert old["fbs"] == [2]


@pytest.mark.skipif(not shutil.which("node"), reason="node is not installed")
def test_a_new_variant_is_known_even_when_a_window_has_no_buyers_of_it(tmp_path):
    """Aqua Rush launched late: a 90-day window cut before its launch has no
    buyers of it, and the tab must still list it and say when it first sold."""
    titles = {"8906161981580": "Aqua Rush / 100 ml", "8906161981023": "Fresh / 100 ml"}
    rows = [line("1", "A", "2025-01-10", UAS, sku="8906161981023"),
            line("2", "B", "2026-03-20", UAS, sku="8906161981580"),
            line("3", "B", "2026-03-25", ASS)]
    c = census(rows, variant_titles=titles)
    f = tmp_path / "census.json"
    f.write_text(json.dumps(c))
    script = (
        "const P=JSON.parse(require('fs').readFileSync(process.argv[1]));"
        f"const E=require('{ENGINE}')(P);"
        "console.log(JSON.stringify(E.VARS.map((v,i)=>[v.label,E.FIRST_V[i]])));"
    )
    out = dict(json.loads(subprocess.run(["node", "-e", script, str(f)], capture_output=True, text=True, check=True).stdout))
    epoch = dt.date.fromisoformat(c["epoch"])
    assert out["Aqua Rush"] == (dt.date(2026, 3, 20) - epoch).days and out["Fresh"] == 0


@pytest.mark.skipif(not shutil.which("node"), reason="node is not installed")
def test_why_it_moved_compares_the_cohort_with_the_one_before(tmp_path):
    """100 new customers in each of two 30-day windows; 30 of the earlier and
    10 of the later buy again 20 days after their first order."""
    rows, n = [], 0
    start = dt.date(2025, 1, 1)
    for w, back in ((0, 30), (1, 10)):
        for i in range(100):
            n += 1
            d = start + dt.timedelta(days=w * 30 + i % 30)
            rows.append(line(f"o{n}", f"c{w}-{i}", d.isoformat(), UAS))
            if i < back:
                rows.append(line(f"r{n}", f"c{w}-{i}", (d + dt.timedelta(days=20)).isoformat(), UAS))
    f = tmp_path / "census.json"
    f.write_text(json.dumps(census_for(rows)))
    static = pathlib.Path(__file__).resolve().parents[1] / "static"
    script = r"""
const vm = require("vm"), fs = require("fs"), P = JSON.parse(fs.readFileSync(process.argv[1]));
const E = require(process.argv[2] + "/retention_engine.js")(P);
const ctx = { console, Intl, Math, Number, Object, JSON, Array, String, Set, Map, Date, E };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(process.argv[2] + "/metrics.js", "utf8"), ctx);
vm.runInContext(`const esc = (s) => String(s ?? ""); const dayLabel = (d) => d; const inGroup = new Intl.NumberFormat("en-IN"); var RG = { channel: "all" };`
  + fs.readFileSync(process.argv[2] + "/insights.js", "utf8") + `globalThis.out = insRetention(E, 30, 59);`, ctx);
console.log(JSON.stringify(ctx.out));
"""
    out = json.loads(subprocess.run(["node", "-e", script, str(f), str(static)], capture_output=True, text=True, check=True).stdout)
    assert "10.0% of customers new to Asaya came back within 90 days, against 30.0%" in out
    assert "−20.0 pp" in out
    assert "about 20 fewer repeat buyers" in out
