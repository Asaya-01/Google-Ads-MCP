"""The Meta view's classification layer and data page."""

import pytest

from app import meta_model, settings
from app.pages import build_all

from test_pages import CFG, _dataset

C = settings.config()


def sku(ad, adset="", campaign="WOA_TOF_Sales"):
    t = meta_model.classify(campaign, adset, ad, C)
    return t["sku"]["code"], t["sku"]["kind"], t["sku"]["level"]


def test_codes_match_whole_tokens_never_inside_other_words():
    assert sku("TOF_PHOTO_HOTSTAR_Video")[0] == "OTHER"
    assert sku("TOF_CLASS_ASSET_GLASS")[0] == "OTHER"
    assert sku("TOF_PEELOFF_Video")[0] == "OTHER"
    assert sku("TOF_HOT_Video") == ("HOT", "single", "ad")


def test_a_number_or_pack_glued_to_a_code_still_matches():
    assert sku("Amazon_GreatIndianSale_ITB1")[0] == "ITB"
    assert sku("TOF_UASPACK_Static")[0] == "UAS"


def test_sets_win_over_single_products_and_match_as_one_word():
    assert sku("AdvSets_EvenSkinDuo_PlotTwist")[0] == "EvenSkinDuo"
    assert sku("TOF_HEADTOTOESET_Video")[0] == "HeadToToeSet"
    assert sku("TOF_TargetAndFadeDuo_UAS")[0] == "TargetAndFadeDuo"


def test_two_products_and_no_set_make_one_combined_row():
    code, kind, _ = sku("BOF_UAS+ITB_Buy2@849_Static1_Offer_301026")
    assert (code, kind) == ("UAS + ITB", "multi")
    assert sku("MOF_ITB_UAS_ASS_Offer")[0] == "UAS + ASS + ITB"  # config order


def test_the_ad_name_wins_then_the_ad_set_then_the_campaign():
    assert sku("Video_1", adset="MOF_ASS_Main") == ("ASS", "single", "adset")
    assert sku("Video_1", adset="Main", campaign="WOA_TOF_Sales_ITB") == ("ITB", "single", "campaign")
    assert sku("UAS_Video", adset="MOF_ASS_Main") == ("UAS", "single", "ad")


def test_names_with_no_product_land_in_named_buckets():
    assert sku("Pack_of_1", campaign="WOA_AllFunnels_Catalog")[0] == "CATALOG"
    assert sku("AdvLifeStyle_Jiya_B3@999")[0] == "OFFERCREATIVE"
    assert sku("Sets_Duos_Video")[0] == "SETS"
    assert sku("Brand_Film")[0] == "OTHER"


def offer(ad, adset="", campaign="WOA_MOF_Sales"):
    return meta_model.offer_of(campaign, adset, ad, C["meta_view"])


def test_offer_comes_from_the_ad_name_non_offer_from_any_level():
    assert offer("MOF_UAS_Static_Offer_301026") == "Offer"
    assert offer("AdvSignals_Priya_B3@999") == "Offer"
    assert offer("MOF_UAS_Static_Non-offer") == "Non-offer"
    assert offer("MOF_UAS_Static", adset="MOF_Sales_Non-offer_ITB") == "Non-offer"
    # an offer ad set whose ad does not say Offer: the name needs fixing
    assert offer("MOF_UAS_Static", adset="MOF_Sales_Offer_Main") == "Not tagged"
    assert offer("MOF_UAS_Static") == "Not tagged"


def test_awareness_is_the_name_except_reach_and_amazon():
    s = lambda c: meta_model.scope_of(c, C["sessions"])
    assert s("WOA_Awareness_TOF_ATC_UAS") == "Awareness"
    assert s("WOA_Awareness_TOF_Reach") == "Excluded"
    assert s("WOA_Awareness_TOF_Sales_Amazon") == "Excluded"
    assert s("WOA_TOF_Sales") == "Performance"


def test_every_ad_is_tagged_and_meta_spend_ties_to_the_dashboard():
    pages, ctx = build_all(_dataset(with_meta=True), CFG, [t["id"] for t in settings.enabled_tabs()])
    m = pages["meta_ads"]
    assert m["rows"] and all(a[5] in ("TOF", "MOF", "BOF", "Catalog") for a in m["ads"])
    assert all(a[7] in ("Offer", "Non-offer", "Not tagged") for a in m["ads"])
    by_day = {}
    for r in m["rows"]:
        by_day[m["dates"][r[0]]] = by_day.get(m["dates"][r[0]], 0) + r[2]
    for d, spend in by_day.items():
        assert spend == pytest.approx(ctx.facts[d]["meta_spend"], abs=0.05)
