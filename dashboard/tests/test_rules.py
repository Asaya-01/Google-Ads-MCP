import datetime as dt

from app import rules, settings

CFG = settings.config()


def test_ratio_never_divides_by_zero_or_missing():
    assert rules.ratio(5, 0) is None
    assert rules.ratio(None, 5) is None
    assert rules.ratio(5, None) is None
    assert rules.ratio(5, 2) == 2.5
    assert rules.pct_change(110, 100) == 0.1
    assert rules.pct_change(1, 0) is None


def test_channels_use_utm_and_fall_back_to_no_utm():
    ch = lambda s, m="": rules.classify_channel(
        {"utm_source": s, "utm_medium": m}, CFG["channels"]
    )
    assert ch("facebook", "cpc") == "Meta Ads"
    assert ch("facebook", "paid") == "Meta Ads"
    assert ch("ig", "social") == "Organic Social"
    assert ch("google", "cpc") == "Google Ads"
    assert ch("reddit", "cpc") == "Reddit Ads"
    assert ch("cashkaro", "affiliate") == "Affiliate"
    assert ch("KWE", "WA") == "CRM"
    assert ch("") == "No UTM (direct / organic)"
    assert (
        ch("direct", "na") == "No UTM (direct / organic)"
    )  # GoKwik's "no UTM"
    assert (
        ch("google", "product_sync") == "Organic Search"
    )  # Shopping free listings
    assert ch("somethingnew", "x") == "Other"


def test_session_kind_follows_the_brief():
    scfg = CFG["sessions"]
    aware, known = {"24394676551"}, {"24394676551", "23832479262"}
    kind = lambda s, c: rules.session_kind(s, c, aware, known, scfg)
    # Meta: campaign name starts with woa_awareness_, any case
    assert kind("facebook", "WOA_Awareness_TOF_Sales_Skincare_ATC_UAS") == (
        "awareness",
        None,
    )
    assert kind("facebook", "WOA_TOF_Sales_AdvantageSales_Non-offer_ITB") == (
        "perf",
        None,
    )
    # Google: campaign ID in the awareness set
    assert kind("google", "24394676551") == ("awareness", None)
    assert kind("google", "23832479262") == ("perf", None)
    # Google ID not in GOOGLEADS_CONSOLIDATED: Perf, but flagged
    assert kind("google", "29999999999") == ("perf", "29999999999")
    # Google with no campaign ID, direct, email: Perf
    assert kind("google", "") == ("perf", None)
    assert kind("google", "Asaya_Traffic_HP") == ("perf", None)
    assert kind("", "") == ("perf", None)


def test_google_awareness_set_is_built_from_campaign_names():
    campaigns = [
        {"campaign_id": "1", "campaign_name": "WOA_Awareness_DemandGen_ATC"},
        {"campaign_id": "2", "campaign_name": "test_Awareness_nipun_reel"},
        {"campaign_id": "3", "campaign_name": "WOA_Pmax_ITB"},
    ]
    aware, known = rules.google_awareness_ids(
        campaigns, CFG["sessions"]["google_awareness_name_regex"]
    )
    assert aware == {"1", "2"}
    assert known == {"1", "2", "3"}


def _series(start: str, gmv_by_day: list[float], spend_by_day=None):
    d0 = dt.date.fromisoformat(start)
    return [
        {
            "date": (d0 + dt.timedelta(days=i)).isoformat(),
            "gmv": g,
            "meta_spend": spend_by_day[i] if spend_by_day else None,
        }
        for i, g in enumerate(gmv_by_day)
    ]


def test_phases_flag_spikes_and_use_spend_in_the_grey_zone():
    #        40 BAU days       5 sale days       3 BAU    grey+spend  3 BAU    grey, BAU spend   5 BAU
    gmv = (
        [500_000] * 40
        + [1_200_000] * 5
        + [500_000] * 3
        + [700_000]
        + [500_000] * 3
        + [700_000]
        + [500_000] * 5
    )
    spend = (
        [100_000] * 40
        + [250_000] * 5
        + [100_000] * 3
        + [200_000]
        + [100_000] * 3
        + [100_000]
        + [100_000] * 5
    )
    phases = rules.detect_phases(
        _series("2026-08-01", gmv, spend), CFG["phases"]
    )
    days = sorted(phases)
    assert all(phases[d]["phase"] == "bau" for d in days[28:40])
    assert all(phases[d]["phase"] == "sale" for d in days[40:45])
    assert phases[days[48]]["phase"] == "sale"  # grey zone, Meta spend scaled
    assert (
        phases[days[52]]["phase"] == "bau"
    )  # grey zone, Meta spend at BAU, no sale nearby
    assert phases[days[57]]["phase"] == "bau"


def test_grey_days_next_to_a_sale_are_its_shoulders():
    #        40 BAU days     grey   2 sale days        grey     grey     grey     BAU
    gmv = (
        [500_000] * 40
        + [700_000]
        + [1_200_000] * 2
        + [750_000, 700_000, 680_000]
        + [500_000]
    )
    spend = (
        [100_000] * 40 + [100_000] + [250_000] * 2 + [100_000] * 3 + [100_000]
    )
    phases = rules.detect_phases(
        _series("2026-08-01", gmv, spend), CFG["phases"]
    )
    days = sorted(phases)
    assert phases[days[40]]["phase"] == "sale"  # opening shoulder
    assert phases[days[43]]["phase"] == "sale"  # tail, 1 day out
    assert phases[days[44]]["phase"] == "sale"  # tail, 2 days out
    assert (
        phases[days[45]]["phase"] == "bau"
    )  # 3 days out: beyond shoulder_days
    assert "shoulder" in phases[days[43]]["basis"]


def test_phase_override_wins():
    cfg = {**CFG["phases"], "overrides": {"2026-08-05": "sale"}}
    phases = rules.detect_phases(_series("2026-08-01", [500_000] * 10), cfg)
    assert phases["2026-08-05"] == {
        "phase": "sale",
        "basis": "manual override",
        "gmv_ratio": 1.0,
        "spend_ratio": None,
    }


def _phases(sale_days: set[str], start="2026-08-01", end="2026-10-28"):
    return {
        d: {"phase": "sale" if d in sale_days else "bau"}
        for d in rules.date_range(start, end)
    }


def test_bau_window_matches_bau_days_of_the_previous_month():
    sales = set(rules.date_range("2026-09-25", "2026-09-29")) | set(
        rules.date_range("2026-10-22", "2026-10-26")
    )
    win = rules.d1_windows("2026-10-28", _phases(sales), CFG["d1"])
    assert win["phase"] == "bau"
    assert win["current"] == ["2026-10-27", "2026-10-28"]
    assert len(win["prior"]) == 2
    assert all(d.startswith("2026-09") and d not in sales for d in win["prior"])
    assert win["note"] is None


def test_bau_window_is_capped_at_seven_days():
    win = rules.d1_windows("2026-10-28", _phases(set()), CFG["d1"])
    assert win["current"] == rules.date_range("2026-10-22", "2026-10-28")
    assert win["prior"] == rules.date_range("2026-09-22", "2026-09-28")


def test_sale_window_matches_the_previous_sale():
    sales = set(rules.date_range("2026-09-25", "2026-09-29")) | set(
        rules.date_range("2026-10-22", "2026-10-26")
    )
    win = rules.d1_windows("2026-10-24", _phases(sales), CFG["d1"])
    assert win["phase"] == "sale"
    assert win["current"] == ["2026-10-22", "2026-10-23", "2026-10-24"]
    assert win["prior"] == ["2026-09-25", "2026-09-26", "2026-09-27"]


def test_unequal_windows_are_flagged():
    sales = set(rules.date_range("2026-09-26", "2026-09-27")) | set(
        rules.date_range("2026-10-22", "2026-10-26")
    )
    win = rules.d1_windows("2026-10-26", _phases(sales), CFG["d1"])
    assert len(win["current"]) == 5 and len(win["prior"]) == 2
    assert "differ in length" in win["note"]
