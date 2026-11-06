"""Readable variant labels on the Products tab: every product sold in more
than one pack says which pack each row is (the listings and variant titles
below are Asaya's own catalog entries)."""

from app import settings
from app.pages import build_all
from app import variants as V

from test_pages import CFG, D1, _dataset

CATALOG = {
    # EEC: the main listing has "50 g" and a SKU-less "50 g x2"; a separate pack-of-2 listing
    "9648174924089": [["8906161980750", "50 g"], ["", "50 g x2"]],
    "10077290856761": [["", "50 g x2"]],
    "10057407004985": [["8906161980750", "50 g"]],
    # KNE
    "9747086246201": [["8906161981030", "50 g"], ["", "50 g X 2"]],
    "10167116824889": [["", "50 g X 2"]],
    # ASS
    "9512852291897": [["8906161980637", "30 ml"], ["Depigmentation Serum 30mlx2", "30 ml X 2"]],
    # UAS fragrances
    "9813999190329": [["8906161981436", "Berry Crush / 100 ml"], ["Berry_Crush_packof2", "Berry Crush / 100 ml x 2"]],
    # HOT shades, one pack only
    "9834489119033": [["8906161980712", "03 - Honeydew (Medium tone)"]],
}


def lab(pid, sku, listing="", multi=True):
    return V.label(V.parse(V.find_title(pid, sku, {"variants_by_product": CATALOG}) or "", listing), listing, multi)


def test_the_sku_less_variant_is_found_and_says_pack_of_2():
    assert lab("9648174924089", "") == "Pack of 2 · 50 g each"
    assert lab("9648174924089", "8906161980750") == "Pack of 1 · 50 g"
    assert lab("10077290856761", "", "Pack of 2") == "Pack of 2 · 50 g each"
    assert lab("9747086246201", "") == "Pack of 2 · 50 g each"


def test_other_listings_keep_their_name_and_options_stay():
    assert lab("10057407004985", "8906161980750", "All skin types") == "Pack of 1 · 50 g · All skin types listing"
    assert lab("9813999190329", "Berry_Crush_packof2") == "Pack of 2 · Berry Crush · 100 ml each"
    assert lab("9834489119033", "8906161980712", multi=False) == "03 - Honeydew (Medium tone)"


def test_products_page_carries_the_full_labels():
    data = _dataset(with_meta=True)
    data["catalog"] = {**data["catalog"], "variants_by_product": CATALOG}
    d = data["products"] = []
    for sku, units in (("8906161980750", 5), ("", 3)):
        d.append({"date": D1, "product_id": "9648174924089", "sku": sku, "product_title": "Even Evermore Crème",
                  "product_type": "moisturizer", "drop_reason": None, "line_count": units, "units": units,
                  "revenue": 500.0 * units, "gross_sales": 500.0 * units})
    pages, _ = build_all(data, CFG, [t["id"] for t in settings.enabled_tabs()])
    labels = {v["label"] for v in pages["product_days"]["variants"]}
    assert labels == {"Pack of 1 · 50 g", "Pack of 2 · 50 g each"}
