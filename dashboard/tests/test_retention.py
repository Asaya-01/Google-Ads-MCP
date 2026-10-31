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
