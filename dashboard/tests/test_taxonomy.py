"""Funnel stage, product and Google group from campaign and ad names."""

from app import settings, taxonomy as T

CFG = settings.config()
TX = CFG["taxonomy"]


def stage(campaign, ad=None):
    return T.meta_stage(campaign, ad, TX)


def prod(*names, catalog=False):
    return T.product_of(list(names), TX, catalog=catalog)


def test_stage_follows_the_ad_name_first():
    offer = (
        "WOA_TOF_Sales_OpenAdvantageOffer_LifetimeBudget_October_Phase1_B2@749"
    )
    # sale-time MOF and BOF ads inside a TOF-named offer campaign are not TOF
    assert stage(offer, "MOF_UAS+ITB_Buy2@849_Static_221026") == "MOF"
    assert stage(offer, "BOF_ASS+HOT_Buy2@849_Video_221026") == "BOF"
    assert (
        stage(offer, "AdvOpen_Creator_B2@749_Video_UGC_Offer_100926") == "TOF"
    )
    assert stage("WOA_MOF_Sales", "MOF_HPRange_SpotFading_Static") == "MOF"
    assert stage("WOA_BOF_Sales", "Static_UAS") == "BOF"
    assert (
        stage("MG_TOF_Sales_Broad_Targeting_Non-offer", "MG_Broad_Peel")
        == "TOF"
    )
    assert stage("WOA_TOF_Sales_AdvantageSales_Non-offer_ITB") == "TOF"


def test_catalog_wins_over_a_stage():
    assert stage("WOA_MOF_Sales_ATC_Catalog") == "Catalog"
    assert stage("WOA_TOF_Sales_DABA_Catalogue") == "Catalog"
    assert (
        stage("WOA_Sales_Open_Catalog_AllFunnels", "Pack_190626") == "Catalog"
    )


def test_products_from_ad_then_ad_set_then_campaign():
    assert prod("MOF_UAS+ITB_Buy2@849_Static") == ["UAS", "ITB"]
    assert prod("ATCFitness_ITB_RollOnTube_Static_150526") == ["ITB"]
    assert prod("Open_Peel_ClinicallyProven_Static1") == ["PEEL"]
    assert prod("AdvSales_EEC2_Static") == ["EEC"]
    # a code inside a longer word is not that product
    assert prod("Video_Assam_Hotel_Static") == ["UNMAPPED"]
    # the ad set, then the campaign, when the ad does not name one
    assert prod("Video_UGC_1", "Set_HOT", "WOA_TOF_Sales") == ["HOT"]
    assert prod(
        "Video_UGC_1", "Set", "WOA_TOF_Sales_AdvantageSales_Non-offer_SpotGel"
    ) == ["SPOTGEL"]


def test_sets_are_their_own_rows():
    assert prod("AdvSets_TargetAndFadeDuo_DearDark_GIF") == ["TFDUO"]
    assert prod("AdvSets_EvenSkinDuo_Static") == ["ESDUO"]
    assert prod("Adv_EvenToneTrio_Video") == ["TRIO"]
    assert prod("Adv_HeadToToeSet_Static") == ["H2T"]
    assert prod("AdvSets_Collab_Video") == ["SETS"]
    assert prod("Video", "", "WOA_TOF_Sales_AdvantageSales_Sets_Duos") == [
        "SETS"
    ]


def test_ads_with_no_product_are_offer_catalog_or_unmapped():
    assert prod("AdvCosmetics_Creator_B2@749_Video_UGC_Offer_100926") == [
        "OFFER"
    ]
    assert prod("AdvLifeStyle_BirthdaySale_Creator_Collab") == ["OFFER"]
    assert prod("AllFunnels_Catalog_Packof1and2", catalog=True) == ["CATALOG"]
    # "Non-offer" is not an offer
    assert prod("Open_Brand_Video", "", "WOA_TOF_Sales_Open_Non-offer") == [
        "UNMAPPED"
    ]


def test_awareness_goal():
    g = lambda n: T.awareness_goal(n, TX)
    assert g("WOA_Awareness_TOF_Sales_Skincare_ATC_UAS") == "Add to cart (ATC)"
    assert g("WOA_Awareness_TOF_Sales_Fitness_LPV_ITB") == (
        "Landing page views (LPV)"
    )
    assert g("WOA_Awareness_TOF_Sales_Amazon") == "Amazon"


def test_google_groups():
    g = lambda n: T.google_group(n, TX)
    assert g("WOA_Search_Brand_Topkey_120825") == "Brand Search"
    assert g("WOA_Pmax_Brand_AllProducts_130825") == "Brand PMax"
    assert g("WOA_Pmax_ITB_110526") == "Non-brand PMax"
    # offer PMax campaigns are Brand PMax (decided 5 Nov 2026)
    assert g("WOA_Pmax_Lifetime_Oct_B2@749_Phase1_131026") == "Brand PMax"
    assert g("WOA_Pmax_OfferOnly_120226") == "Brand PMax"
    assert g("WOA_Pmax_Non-offer_UAS_120226") == "Non-brand PMax"
    assert g("WOA_DemandGen_Rem_021225") == "Demand Gen"
    assert g("WOA_Awareness_VV_YT_TF_Hyd_070826") == "YouTube"
    assert g("Something_Else") == "Other"
    assert prod("WOA_Pmax_ITB_110526") == ["ITB"]
    assert prod("WOA_Pmax_Sets_130126") == ["SETS"]
    assert prod("WOA_Pmax_Lifetime_Oct_B2@749_Phase1_131026") == ["OFFER"]


def test_every_code_has_a_label():
    labels = T.labels(TX)
    for code in [p["code"] for p in TX["products"]] + [
        "SETS",
        "OFFER",
        "CATALOG",
        "UNMAPPED",
    ]:
        assert labels.get(code)
