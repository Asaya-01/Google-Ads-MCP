"""The Awareness tab's numbers: geo series, media status, donors, the quick
tracker, drift, verdicts and the GeoLift panels. Made-up rows; no network."""

import csv
import io

import pytest

from app import settings
from app.awareness import config, job, model
from awareness_fake import phases, rows

# made-up private figures (the real ones live in the bucket, never in the repository)
PRIVATE = {"tests": {"TN_TF_STATE_2026_11": {"weekly_spend": 100000}, "TN_TF_CITY_2026_11": {"weekly_spend": 100000}},
           "media_events": {"META_TF_KERALA_LEAK_2026_11": {"leak_share": 0.04}},
           "acceptance": {"website_orders": 1000, "tn_weekly_sales": 260000, "chennai_daily_sales": 30000, "coimbatore_daily_sales": 6000}}
CFG = config(PRIVATE)
TODAY = "2026-11-13"


@pytest.fixture(scope="module")
def built():
    return job.build(rows(), CFG, TODAY, phases(), "test calendar", {"tests": {}},
                     {"website_orders": {"raw_orders": 1000, "kept_orders": 900, "cancelled_orders": 50}})


def test_geos_weeks_and_totals_add_up(built):
    p = built["page"]
    assert p["weeks"][0] == "2026-01-05" and p["as_of"] == "2026-11-12"
    states = {g["key"]: g for g in p["geos"]["state"]}
    assert "tamil nadu" in states and "unknown" not in states
    # India = every state + the unknown / long-tail rows, week by week (acceptance check 8)
    i = 10
    s = sum(g["w"]["sales"]["ALL"][i] for g in p["geos"]["state"]) + p["geos"]["state_rest"]["w"]["sales"]["ALL"][i]
    assert s == pytest.approx(p["national"]["sales"]["ALL"][i], abs=len(states) + 2)
    # channel groups add up to ALL
    tn = states["tamil nadu"]["w"]["sales"]
    assert tn["ALL"][i] == pytest.approx(tn["D2C"][i] + tn["MARKETPLACE"][i] + tn["QUICK_COMMERCE"][i], abs=3)
    assert set(p["week_phase"]) <= {"Sale", "BAU", "Mixed", "Unknown"} and "Mixed" in p["week_phase"]


def test_media_status_follows_the_events(built):
    p = built["page"]
    wk = p["weeks"].index("2026-11-02")
    st = {g["key"]: g["media"][wk] for g in p["geos"]["state"]}
    assert st["tamil nadu"] == "Treatment"
    assert st["karnataka"] == "Contaminated" and st["telangana"] == "Contaminated" and st["kerala"] == "Contaminated"
    assert st["maharashtra"] == "Dark"
    early = p["weeks"].index("2026-06-01")
    assert {g["media"][early] for g in p["geos"]["state"]} == {"None"}
    city = {g["key"]: g["media"][wk] for g in p["geos"]["city"]}
    assert city["chennai metro"] == "Treatment" and city["bengaluru"] == "Contaminated" and city["mumbai"] == "Dark"


def test_donors_follow_the_rule_and_say_why(built):
    tests = {t["test_id"]: t for t in built["page"]["tests"]}
    st = {d["location"]: d for d in tests["TN_TF_STATE_2026_11"]["donors"]}
    assert st["tamil nadu"]["exclusion_reason"] == "Treatment"
    assert st["karnataka"]["exclusion_reason"].startswith("Contaminated: GOOGLE_DG")
    assert st["kerala"]["exclusion_reason"].startswith("Contaminated: META_TF_KERALA")
    assert st["maharashtra"]["included"] and st["maharashtra"]["correlation"] is not None  # going dark is the design, not an exclusion
    assert st["assam"]["included"]  # Rs 3k+ a day clears the Rs 2k state floor
    ct = {d["location"]: d for d in tests["TN_TF_CITY_2026_11"]["donors"]}
    assert ct["madurai"]["exclusion_reason"] in ("Same-state spillover", "Low volume")
    assert ct["chennai metro"]["exclusion_reason"] == "Treatment" and ct["coimbatore"]["exclusion_reason"] == "Treatment"
    assert ct["bengaluru"]["exclusion_reason"].startswith("Contaminated") and ct["mumbai"]["included"]


def test_quick_tracker_sees_the_lift_and_drift_sees_donors_fall(built):
    t = next(x for x in built["page"]["tests"] if x["test_id"] == "TN_TF_STATE_2026_11")
    wk = [w for w in t["quick"]["weeks"] if w["complete"]]
    assert wk and all(w["lift_pct"] > 0.08 for w in wk)  # +15% vs donors at -5%: about +20%
    assert t["drift"]["pct"] is not None and t["drift"]["pct"] < 0
    assert t["verdict"]["main"] == "Too early" and t["verdict"]["days_in"] == 13 and t["verdict"]["days_total"] == 42


def test_panels_are_dense_lowercase_and_eligible_only(built):
    for level in ("state", "city"):
        rd = list(csv.DictReader(io.StringIO(built["panels"][level])))
        locs = {r["location"] for r in rd}
        dates = {r["date"] for r in rd}
        assert len(rd) == len(locs) * len(dates)  # acceptance check 5
        assert all(l == l.lower() for l in locs) and "unknown" not in locs
    city = {r["location"] for r in csv.DictReader(io.StringIO(built["panels"]["city"]))}
    assert "coimbatore" in city  # a treatment city is always in
    assert "madurai" not in city  # Rs 1.2k a day is under the Rs 4k city floor


def test_acceptance_checks(built):
    ch = {str(c["id"]): c for c in built["page"]["checks"]}
    assert ch["1"]["pass"] and ch["2"]["pass"] and ch["3"]["value"].startswith("Rs") and ch["4a"]["value"].startswith("Rs")
    assert ch["4a"]["pass"] is not None and "target" in ch["4a"]["value"]  # a target is set, so a verdict is given
    assert ch["6"]["pass"] is None  # waits for GeoLift
    assert ch["7"]["pass"] and "karnataka" in ch["7"]["value"]


def test_private_figures_lay_over_config_and_stay_out_of_it():
    raw = settings.config()["awareness"]
    assert all(t["weekly_spend"] is None for t in raw["tests"])
    assert not any(v for k, v in raw["acceptance"].items() if not k.startswith("_"))
    assert CFG["tests"][0]["weekly_spend"] == 100000 and raw["tests"][0]["weekly_spend"] is None  # overlay copies, never mutates
    leak = next(e for e in CFG["media_events"] if e["event_id"] == "META_TF_KERALA_LEAK_2026_11")
    assert leak["leak_share"] == 0.04
    no = job.build(rows(), config(), TODAY, phases(), "x", {"tests": {}}, {})
    c3 = next(c for c in no["page"]["checks"] if c["id"] == 3)
    assert c3["pass"] is None and "no target" in c3["value"]


def test_verdict_rules():
    t = {**CFG["tests"][0]}
    power = {"run_type": "power", "plausible_lift": 0.08, "mde_42d": 0.29}
    v = model.verdict(t, "2026-11-20", [{"run_type": "interim", "lift_pct": 0.12}, power], -0.15, False, CFG)
    assert v["main"] == "Interim: trending up" and "Underpowered" in v["flags"] and "Check validity" in v["flags"]
    fin = model.verdict(t, "2026-12-20", [{"run_type": "final", "lift_pct": 0.1, "p_value": 0.04, "ci_low": 1000, "ci_high": 9000}], None, False, CFG)
    assert fin["main"] == "Final: lift detected"
    no = model.verdict(t, "2026-12-20", [{"run_type": "final", "lift_pct": 0.1, "p_value": 0.3, "ci_low": -1000, "ci_high": 9000}], None, False, CFG)
    assert no["main"] == "Final: no detectable lift"
    assert model.verdict({**t, "status": "planned"}, "2026-10-01", [], None, False, CFG)["main"] == "Planned"
