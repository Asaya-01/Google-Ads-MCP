"""The Google view's classification layer and data pages (synthetic data,
made-up IDs and numbers)."""

from collections import defaultdict

import pytest

from app import google_model, settings
from app.pages import build_all

from google_fixture import CAMPS, add_google
from test_pages import CFG, D1, START, _dataset

C = settings.config()


@pytest.fixture(scope="module")
def built():
    data = add_google(_dataset(with_meta=True), D1, START)
    pages, ctx = build_all(data, CFG, [t["id"] for t in settings.enabled_tabs()])
    return pages, ctx, data


def tags(name, cid="1", channel=None):
    t = google_model.classify_campaign(name, cid, channel, set(), C)
    return t["scope"], t["segment"], t["type"], t["sub_type"], t["sku"]["code"]


def test_every_campaign_gets_scope_segment_type_sub_type_and_sku():
    assert tags("WOA_Search_Brand_Topkey_120825", channel="SEARCH") == ("Performance", "Brand", "Search", "Brand Search", "BRAND")
    assert tags("WOA_Pmax_Brand_AllProducts_130825") == ("Performance", "Brand", "PMax", "Brand PMax", "BRAND")
    assert tags("WOA_Pmax_ITB_110526") == ("Performance", "Non-brand", "PMax", "Non-brand PMax", "ITB")
    assert tags("WOA_DemandGen_Rem_021225") == ("Performance", "Non-brand", "Demand Gen", "Demand Gen", "OTHER")
    assert tags("WOA_Awareness_VV_YT_TF_010626", channel="VIDEO") == ("Awareness", "Non-brand", "Video", "YouTube", "OTHER")
    assert tags("WOA_Awareness_DemandGen_ATC_HydBlr_261026")[0] == "Awareness"


def test_offer_pmax_is_brand_and_offer_only():
    # decided 5 Nov 2026: offer Performance Max campaigns are brand
    assert tags("WOA_Pmax_Lifetime_Oct_B2@749_Phase1_131026") == ("Performance", "Brand", "PMax", "Brand PMax", "OFFER")
    assert tags("WOA_Pmax_Non-offer_UAS_120226")[3] == "Non-brand PMax"


def test_sku_matches_whole_tokens_and_the_ad_group_name_wins():
    assert google_model.sku_of_names("WOA_Pmax_SpotGel_120226", None, "Non-brand", C)["code"] == "SpotGel"
    assert google_model.sku_of_names("WOA_Pmax_Sets_130126", None, "Non-brand", C)["code"] == "SETS"
    assert google_model.sku_of_names("WOA_DemandGen_Rem_021225", "Rem_UAS", "Non-brand", C)["code"] == "UAS"
    assert google_model.sku_of_names("WOA_Pmax_ASSAM_1", None, "Non-brand", C)["code"] == "OTHER"  # ASS is not ASSAM


def test_product_items_map_through_the_product_map():
    pix = google_model.product_index(C)
    s = lambda i: google_model.sku_of_item(i, pix, C)["code"]  # noqa: E731
    assert s("shopify_zz_10107079721273_51745443283257") == "ITB"
    assert s("shopify_zz_10163957203257_52071710327097") == "TargetAndFadeDuo"  # TFDUO rolls up to the shared SKU
    assert s("shopify_zz_1_2") == "UNMAPPED"
    assert s("") == "NOTPRODUCT"


def test_conversions_are_the_purchase_action_only(built):
    pages, _, _ = built
    P = pages["google_ads"]
    assert P["purchase_only"] is True
    idx = {c[0]: i for i, c in enumerate(P["campaigns"])}
    F = P["fields"]
    sums = defaultdict(lambda: defaultdict(float))
    for r in P["crows"]:
        for f in ("conv", "value", "oconv", "oval"):
            sums[r[1]][f] += r[2 + F.index(f)] or 0
    atc = sums[idx["9000000007"]]
    assert atc["conv"] == 0 and atc["value"] == 0 and atc["oconv"] > 0 and atc["oval"] > 0
    brand = sums[idx["9000000001"]]
    assert brand["conv"] > 0 and brand["oconv"] == 0
    assert all(P["pure"][idx[c[0]]] for c in CAMPS if c[0] != "9000000007")


def test_cost_ties_to_the_google_spend_every_tab_uses(built):
    pages, ctx, _ = built
    P = pages["google_ads"]
    F = P["fields"]
    for day in ("2026-10-01", "2026-10-24", D1):
        d = P["dates"].index(day)
        mine = sum(r[2 + F.index("cost")] for r in P["crows"] if r[0] == d)
        perf = sum(r[2] for r in P["crows"] if r[0] == d and P["campaigns"][r[1]][2] == "Performance")
        assert mine == pytest.approx(ctx.facts[day]["google_spend"])
        assert perf == pytest.approx(ctx.facts[day]["google_perf_spend"])


def test_the_matrix_rows_add_up_to_the_campaigns(built):
    pages, _, _ = built
    P = pages["google_ads"]
    camp, mat = defaultdict(float), defaultdict(float)
    for r in P["crows"]:
        camp[(r[0], r[1], "cost")] += r[2]
        camp[(r[0], r[1], "value")] += r[2 + 4]
    for r in P["mrows"]:
        mat[(r[0], r[1], "cost")] += r[4]
        mat[(r[0], r[1], "value")] += r[8] or 0
    assert camp.keys() == mat.keys()
    for k in camp:
        assert mat[k] == pytest.approx(camp[k], abs=0.6)
    # product-feed (P) and name (N) sources are both used
    assert {r[3] for r in P["mrows"]} == {0, 1}


def test_children_add_up_to_their_campaign(built):
    pages, _, _ = built
    P = pages["google_ads"]
    camp, grp = defaultdict(float), defaultdict(float)
    for r in P["crows"]:
        camp[(r[0], r[1])] += r[2]
    for r in P["grows"]:
        grp[(r[0], P["groups"][r[1]][2])] += r[2]
    assert all(grp[k] == pytest.approx(v) for k, v in camp.items() if k in grp)


def test_impression_share_is_reweighted_not_averaged(built):
    pages, _, _ = built
    P = pages["google_ads"]
    F = P["fields"]
    rows = [r for r in P["crows"] if P["campaigns"][r[1]][0] == "9000000001"]
    impr = sum(r[2 + F.index("impr")] for r in rows)
    elig = sum(r[2 + F.index("elig")] for r in rows)
    assert impr / elig == pytest.approx(0.92, abs=1e-3)
    assert all(r[2 + F.index("elig")] is None for r in P["crows"] if P["campaigns"][r[1]][4] != "Search")


def test_reports_that_are_off_leave_their_levels_empty_not_zero():
    data = add_google(_dataset(with_meta=True), D1, START)
    v = data["google_view"]
    v["on"] = {k: k == "conv_split" for k in v["on"]}
    pages, _ = build_all(data, CFG, [t["id"] for t in settings.enabled_tabs()])
    P = pages["google_ads"]
    F = P["fields"]
    assert all(r[2 + F.index("views")] is None and r[2 + F.index("elig")] is None for r in P["crows"])
    assert pages["google_search"]["keywords"] == [] and pages["google_products"]["products"] == []
    assert P["has_products"] is False


def test_without_the_split_conversions_are_googles_column_and_say_so():
    data = add_google(_dataset(with_meta=True), D1, START)
    data["google_view"]["conv_levels"] = []
    pages, _ = build_all(data, CFG, [t["id"] for t in settings.enabled_tabs()])
    P = pages["google_ads"]
    assert P["purchase_only"] is False
    assert "every primary action" in P["attribution_note"]


def test_the_search_terms_and_keywords_land_on_their_ad_group(built):
    pages, _, _ = built
    S, P = pages["google_search"], pages["google_ads"]
    assert {k[1] for k in S["keywords"]} == {"asaya", "asya", "worldofasaya"}
    g = {x[0]: i for i, x in enumerate(P["groups"])}["8000000001"]
    assert all(t[1] == g for t in S["terms"])
    plum = next(t for t in S["terms"] if t[0] == "plum combo kit")
    assert S["keywords"][plum[2]][1] == "worldofasaya"
