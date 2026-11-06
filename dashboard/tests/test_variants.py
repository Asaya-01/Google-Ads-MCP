"""Variant rows on the Products tab: a product sold in packs is split by
pack only (Pack of 1 / Pack of 2), with its shade or fragrance mix shown
under each pack. The listings and variant titles below are Asaya's own
catalog entries; units are made up."""

from app import settings
from app import variants as V
from app.pages import build_all

from test_pages import CFG, D1, _dataset

CATALOG = {
    # KNE: the main listing has "50 g" and a SKU-less "50 g X 2"; a separate pack-of-2 listing
    "9747086246201": [["8906161981030", "50 g"], ["", "50 g X 2"]],
    "10167116824889": [["", "50 g X 2"]],
    # EEC, including a draft "All skin types" listing
    "9648174924089": [["8906161980750", "50 g"], ["", "50 g x2"]],
    "10077290856761": [["", "50 g x2"]],
    "10057407004985": [["8906161980750", "50 g"]],
    # UAS fragrances, a 50 ml listing and a pack-of-2 listing
    "9813999190329": [["8906161981436", "Berry Crush / 100 ml"], ["Berry_Crush_packof2", "Berry Crush / 100 ml x 2"],
                      ["8906161981023", "Fresh / 100 ml"], ["100 ml x 2", "Fresh / 100 ml x 2"]],
    "10136775033145": [["8906161981450", "50 ml"]],
    # HOT: shades, one pack only
    "9834489119033": [["8906161980712", "03 - Honeydew (Medium tone)"], ["8906161981078", "05 - Moonbeam (Deep tone)"]],
}


def line(pid, sku, units):
    return {"date": D1, "product_id": pid, "sku": sku, "product_title": "x", "product_type": "cream",
            "drop_reason": None, "line_count": units, "units": units, "revenue": 500.0 * units, "gross_sales": 500.0 * units}


def labels(lines, catalog=CATALOG):
    data = _dataset(with_meta=True)
    data["catalog"] = {**data["catalog"], "variants_by_product": catalog} if catalog is not None else {**data["catalog"]}
    data["products"] = lines
    pages, _ = build_all(data, CFG, [t["id"] for t in settings.enabled_tabs()])
    pd = pages["product_days"]
    out = {}
    for v in pd["variants"]:
        units = sum(r[2] for r in pd["vrows"] if r[1] == pd["variants"].index(v))
        out[v["label"]] = out.get(v["label"], 0) + units
    return out


def test_kne_has_exactly_pack_of_1_and_pack_of_2():
    got = labels([line("9747086246201", "8906161981030", 623), line("9747086246201", "", 55), line("10167116824889", "", 1)])
    assert got == {"Pack of 1": 623, "Pack of 2": 56}


def test_eec_draft_listing_folds_into_pack_of_1():
    got = labels([line("9648174924089", "8906161980750", 448), line("9648174924089", "", 35),
                  line("10077290856761", "", 1), line("10057407004985", "8906161980750", 4)])
    assert got == {"Pack of 1": 452, "Pack of 2": 36}


def test_uas_packs_keep_the_size_when_there_are_two_sizes():
    got = labels([line("9813999190329", "8906161981436", 10), line("9813999190329", "Berry_Crush_packof2", 4),
                  line("9813999190329", "100 ml x 2", 3), line("10136775033145", "8906161981450", 2)])
    assert got == {"Pack of 1 · 100 ml": 10, "Pack of 2 · 100 ml": 7, "Pack of 1 · 50 ml": 2}


def test_a_product_in_one_pack_is_split_by_shade():
    got = labels([line("9834489119033", "8906161980712", 5), line("9834489119033", "8906161981078", 2)])
    assert got == {"03 - Honeydew (Medium tone)": 5, "05 - Moonbeam (Deep tone)": 2}


def test_without_the_catalog_the_rule_still_gives_the_packs():
    # an old cached catalog: no per-listing variants; KNE has a pack-of-2 listing in the product map
    got = labels([line("9747086246201", "8906161981030", 623), line("9747086246201", "", 55), line("10167116824889", "", 1)], catalog=None)
    assert got == {"Pack of 1": 623, "Pack of 2": 56}


def test_sku_names_that_say_a_pack():
    for sku in ("Berry_Crush_packof2", "UAS_PACK_2", "100 ml x 2", "Depigmentation Serum 30mlx2"):
        assert V.resolve("1", sku, None, "", True)["pack"] == 2, sku
    assert V.resolve("1", "8906161981030", None, "", True)["pack"] == 1


def test_without_the_catalog_the_packs_list_still_splits_itb():
    # ITB has no pack-of-2 listing; its pack of 2 is a SKU-less variant
    got = labels([line("10107079721273", "inner_thigh_bum_roll_on", 90), line("10107079721273", "", 10)], catalog=None)
    assert got == {"Pack of 1": 90, "Pack of 2": 10}
