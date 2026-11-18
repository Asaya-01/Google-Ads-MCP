"""The SEO / AEO / GEO tab: each source read through a made-up stand-in, the
page it builds, the fallbacks when a source fails, and the read-only rule.
Every number is invented; no network."""

import datetime as dt
import pathlib
import re

import pytest

from app import secrets, settings
from app.seo import ai_platform, config, job, model, page_type
from app.seo import sources as S
from app.store import LocalStore
from seo_fake import Fake

NOW = dt.datetime(2026, 11, 18, 3, 0, tzinfo=dt.timezone.utc)  # 08:30 IST
ROOT = pathlib.Path(__file__).resolve().parent.parent


@pytest.fixture(autouse=True)
def fake_secrets(monkeypatch):
    monkeypatch.setattr(secrets, "get_secret", lambda name: f"made-up-{name}")


def build(tmp_path, fake=None, store=None):
    store = store or LocalStore(str(tmp_path))
    fake = fake or Fake()
    log = job.run(store, NOW, src=fake, api_key_fn=lambda name: "made-up-key")
    return store.get_json("pages/seo.json"), log, store, fake


def test_config_is_complete_and_switched_on():
    cfg = config()
    assert set(cfg["sources"]) == {"gsc", "ga4", "crux", "psi", "keyword_planner", "dataforseo", "shopify"}
    assert cfg["sources"]["dataforseo"] is False  # paid: off until approved
    assert sum(1 for b in cfg["brands"] if b.get("own")) == 1
    assert len([b for b in cfg["brands"] if b.get("in_share")]) == 12
    assert {t["id"] for t in settings.enabled_tabs()} >= {"seo"}
    for p in cfg["speed"]["pages"]:
        assert p["path"].startswith("/")
    re.compile(cfg["gsc"]["brand_regex"])


def test_full_build(tmp_path):
    page, log, store, fake = build(tmp_path)
    assert log["status"] == "ok", log
    assert page["title"] == "SEO / AEO / GEO" and page["as_of"] == "2026-11-17"
    assert {k: v["status"] for k, v in page["sources"].items()} == {k: "ok" if on else "off" for k, on in config()["sources"].items()}

    g = page["gsc"]
    assert g["site"] == "sc-domain:worldofasaya.com" and g["end"] == "2026-11-15"
    assert len(g["daily"]["dates"]) == 480
    k = g["kpis"]
    assert k["window"]["cur"] == ("2026-10-19", "2026-11-15") or k["window"]["cur"] == ["2026-10-19", "2026-11-15"]
    cur = k["total"]["cur"]
    assert cur["days"] == 28 and cur["position"] == pytest.approx(8.0)
    assert k["branded"]["cur"]["clicks"] + k["nonbranded"]["cur"]["clicks"] < cur["clicks"]  # anonymised queries
    q = {r["key"]: r for r in g["queries"]}
    assert q["asaya underarm spray"]["branded"] and not q["pigmentation serum"]["branded"]
    assert q["lost query"]["clicks"] == 0 and q["lost query"]["clicks_prev"] == 50
    pg = {r["key"]: r for r in g["pages"]}
    assert pg["https://worldofasaya.com/"]["type"] == "Home"
    assert pg["https://worldofasaya.com/blogs/hyperpigmentation/what-is-melasma"]["type"] == "Blog post"
    assert sum(b["queries"] for b in g["buckets"]) == 3

    ai = page["ga4"]["ai"]
    assert ["2026-11-10", "ChatGPT", 40, 30, 1, 999.0] in ai and any(r[1] == "Perplexity" for r in ai)

    s = page["speed"]
    assert s["origin_url"] == "https://worldofasaya.com"
    assert s["origin"]["phone"]["passes"] is True and s["origin"]["phone"]["lcp"]["rating"] == "good"
    dk = next(b for b in s["brands"] if b["brand"] == "Dot & Key")
    assert dk["phone"]["lcp"]["rating"] == "poor" and dk["phone"]["passes"] is False
    assert len(s["history"]["phone"]["lcp"]) == 40
    blog = next(u for u in s["urls"] if u["path"] == "/blogs/hyperpigmentation")
    assert blog["phone"] is None  # too little Chrome traffic for that page
    psi = s["psi"]
    assert len(psi["latest"]) == 14 and len(psi["errors"]) == 2  # the offers page failed, the rest ran
    t = psi["latest"][0]
    assert t["score"] in (42, 81) and t["opportunities"][0]["id"] == "unused-javascript"
    assert t["third_party"][0]["entity"] == "Made-up Reviews App" and t["field"]["cls"] == pytest.approx(0.05)

    d = page["demand"]
    assert d["months"] == ["2025-11", "2025-12", "2026-01"]
    asaya = next(b for b in d["brands"] if b["own"])
    assert asaya["keywords"] == ["asaya"] and asaya["monthly"][0] == 1000
    assert len(d["category"]) == len(config()["category_keywords"])

    sh = page["shopify"]
    assert ["2026-11-10", "ChatGPT", 35, 8, 0] in sh["ai"]
    assert ["2026-11-10", "Claude", 2, 0, 0] in sh["ai"]  # referrer claude, partner UTM
    assert sh["organic"] == [["2026-11-10", "google", 300, 50, 0]]  # ads and affiliate clicks left out
    assert sh["content"]["months"] == ["2026-10", "2026-11"]


def test_share_of_search_only_counts_the_share_set():
    cfg = config()
    res = [{"text": "asaya", "keywordMetrics": {"avgMonthlySearches": "100", "monthlySearchVolumes": [{"year": 2026, "month": "MAY", "monthlySearches": "100"}]}},
           {"text": "dot and key", "keywordMetrics": {"avgMonthlySearches": "300", "monthlySearchVolumes": [{"year": 2026, "month": "MAY", "monthlySearches": "300"}]}},
           {"text": "plum goodness", "keywordMetrics": {"avgMonthlySearches": "900", "monthlySearchVolumes": [{"year": 2026, "month": "MAY", "monthlySearches": "900"}]}}]
    t = model.keyword_table(res, cfg["brands"], [])
    by = {b["brand"]: b for b in t["brands"]}
    assert by["Asaya"]["share"] == [0.25] and by["Dot & Key"]["share"] == [0.75]
    assert by["Plum"]["share"] == [None] and by["Plum"]["monthly"] == [900]


def test_failed_source_keeps_last_good_and_others_still_build(tmp_path):
    page, _, store, _ = build(tmp_path)
    assert page["gsc"]["kpis"]
    page2, log, _, _ = build(tmp_path, fake=Fake(fail={"gsc", "shopify"}), store=store)
    assert log["status"] == "partial" and set(log["errors"]) == {"gsc", "shopify"}
    assert page2["sources"]["gsc"]["status"] == "error" and page2["sources"]["gsc"]["stale_from"]
    assert page2["gsc"]["kpis"] == page["gsc"]["kpis"]  # the last good result, marked stale
    assert page2["sources"]["ga4"]["status"] == "ok"


def test_keyword_planner_explorer_access_is_explained(tmp_path):
    page, log, _, _ = build(tmp_path, fake=Fake(fail={"explorer"}))
    err = page["sources"]["keyword_planner"]["error"]
    assert "Basic API access" in err and page["demand"] is None
    assert page["sources"]["gsc"]["status"] == "ok"


def test_keyword_planner_runs_weekly_not_daily(tmp_path):
    page, _, store, fake = build(tmp_path)
    fake2 = Fake()
    called = []
    fake2.keyword_history = lambda *a, **k: called.append(1) or []
    page2, _, _, _ = build(tmp_path, fake=fake2, store=store)
    assert not called and "kept from" in page2["sources"]["keyword_planner"]["detail"]
    assert page2["demand"] == page["demand"]


def test_no_property_access_says_so(tmp_path):
    page, _, _, _ = build(tmp_path, fake=Fake(sites=[{"siteUrl": "https://other.com/", "permissionLevel": "siteOwner"}]))
    assert "cannot read a Search Console property" in page["sources"]["gsc"]["error"]


def test_psi_runs_once_a_day(tmp_path):
    _, _, store, _ = build(tmp_path)
    fake = Fake()
    runs = []
    orig = fake.psi
    fake.psi = lambda *a: runs.append(a[1]) or orig(*a)
    build(tmp_path, fake=fake, store=store)
    assert all("offers" in u for u in runs)  # only the page that failed earlier is tried again


def test_switched_off_source_is_not_called(tmp_path, monkeypatch):
    cfg = config()
    cfg["sources"]["psi"] = False
    monkeypatch.setattr(job, "config", lambda: cfg)
    fake = Fake()
    fake.psi = lambda *a: (_ for _ in ()).throw(AssertionError("psi called while off"))
    page, _, _, _ = build(tmp_path, fake=fake)
    assert page["sources"]["psi"]["status"] == "off"


def test_ai_platform_and_page_type_rules():
    plats = config()["ai_platforms"]
    assert ai_platform({"utm_source": "chatgpt.com"}, plats) == "ChatGPT"
    assert ai_platform({"referrer_name": "perplexity"}, plats) == "Perplexity"
    assert ai_platform({"ga4_source": "gemini.google.com"}, plats) == "Gemini"
    assert ai_platform({"referrer_name": "google", "utm_source": "google"}, plats) is None
    assert ai_platform({"referrer_name": "meta"}, plats) is None  # Meta, not Meta AI: never guessed
    types = config()["page_types"]
    assert page_type("https://worldofasaya.com/products/x?variant=1", types) == "Product"
    assert page_type("/blogs/acne", types) == "Blog" and page_type("/blogs/acne/post", types) == "Blog post"


def test_alerts_are_rule_based():
    cfg = config()
    page = {"gsc": {"kpis": {"branded": {"cur": {"clicks": 70}, "prev": {"clicks": 100}}, "nonbranded": {"cur": {"clicks": 95}, "prev": {"clicks": 100}}}},
            "speed": {"origin": {"phone": {"passes": False, "lcp": {"rating": "poor"}, "inp": {"rating": "good"}, "cls": {"rating": "good"}}},
                      "history": {"lcp": [2000, 2000, 2000, 2000, 2400], "inp": [200] * 5}},
            "demand": {"brands": [{"own": True, "share": [0.10, 0.07]}]}}
    texts = [a["text"] for a in model.alerts(page, cfg)]
    assert any("Branded clicks down 30%" in t for t in texts)
    assert not any("Non-branded" in t for t in texts)
    assert any("Mobile fails Core Web Vitals" in t and "LCP" in t for t in texts)
    assert any("LCP p75 is 20% worse" in t for t in texts)
    assert any("Share of search fell 3.0 pp" in t for t in texts)


def test_read_only():
    """Nothing in the SEO code writes to a source: only GETs, Search Console /
    GA4 / Keyword Planner report queries (POST reads), CrUX / PSI lookups, and
    the bucket. No BigQuery, no mutations, read-only scopes."""
    code = "".join((ROOT / "app" / "seo" / f).read_text() for f in ("__init__.py", "sources.py", "model.py", "job.py"))
    assert not re.search(r"import bq|from \.\. import .*\bbq\b|google\.cloud import bigquery|bq\.run", code)
    assert "mutation" not in code
    assert re.findall(r"auth/[a-z.]+", code) == ["auth/webmasters.readonly", "auth/analytics.readonly"]
    posts = re.findall(r"(?:requests|sess)\.post\(([^,]+)", code)
    assert all(re.search(r"url|f\"\{GA4_DATA\}|DATAFORSEO_API", p) for p in posts), posts
    for verb in (".delete(", ".put(", ".patch("):
        assert verb not in code
    assert "searchAnalytics/query" in code and ":runReport" in code and "generateKeywordHistoricalMetrics" in code
    assert "keywordPlans" not in code  # no keyword plan is ever created


def test_tab_is_served(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient

    from app import main

    page, _, store, _ = build(tmp_path)
    monkeypatch.setattr(main, "store", lambda: store)
    main.app.dependency_overrides[main.current_user] = lambda: "someone@example.com"
    try:
        r = TestClient(main.app).get("/api/page/seo")
        assert r.status_code == 200 and r.json()["title"] == "SEO / AEO / GEO"
    finally:
        main.app.dependency_overrides.clear()


def test_without_an_api_key_lab_tests_still_run(tmp_path):
    store = LocalStore(str(tmp_path))
    fake = Fake()
    keys = []
    orig = fake.psi
    fake.psi = lambda key, url, strategy: keys.append(key) or orig(key, url, strategy)
    job.run(store, NOW, src=fake, api_key_fn=lambda name: None)
    page = store.get_json("pages/seo.json")
    assert page["sources"]["crux"]["status"] == "error" and "no API key" in page["sources"]["crux"]["error"]
    assert page["sources"]["psi"]["status"] == "ok" and "without an API key" in page["sources"]["psi"]["detail"]
    assert keys and set(keys) == {None}


def test_keyword_planner_prefers_its_own_project_credentials(tmp_path, monkeypatch):
    got = {}
    fake = Fake()
    fake.keyword_history = lambda gcfg, creds, *a: got.update(creds) or []
    job.pull_keywords(config(), src=fake)
    assert got["client_id"] == "made-up-keyword-planner-client-id"
    monkeypatch.setattr(secrets, "get_secret", lambda n: None if n.startswith("keyword-planner") else f"made-up-{n}")
    job.pull_keywords(config(), src=fake)
    assert got["client_id"] == "made-up-google-ads-client-id"  # falls back to the dashboard's own


def test_dataforseo_fills_search_demand_when_on(tmp_path, monkeypatch):
    cfg = config()
    cfg["sources"].update(dataforseo=True, keyword_planner=False)
    monkeypatch.setattr(job, "config", lambda: cfg)
    fake = Fake()
    sent = {}

    def volume(login, password, keywords, location, language):
        sent.update(login=login, n=len(keywords), location=location, language=language)
        return [{"text": k, "closeVariants": [], "keywordMetrics": {"avgMonthlySearches": 500, "competition": "LOW",
                 "monthlySearchVolumes": [{"year": 2026, "month": "OCTOBER", "monthlySearches": 500}]}} for k in keywords]
    fake.dataforseo_volume = volume
    page, _, _, _ = build(tmp_path, fake=fake)
    assert page["sources"]["dataforseo"]["status"] == "ok" and page["sources"]["keyword_planner"]["status"] == "off"
    assert sent == {"login": "made-up-dataforseo-login", "n": len(job._keywords(cfg)), "location": 2356, "language": "en"}
    asaya = next(b for b in page["demand"]["brands"] if b["own"])
    assert page["demand"]["months"] == ["2026-10"] and asaya["monthly"] == [500]


def test_dataforseo_response_is_read_into_keyword_planner_shape(monkeypatch):
    class Resp:
        status_code = 200
        def json(self):
            return {"status_code": 20000, "tasks": [{"status_code": 20000, "result": [
                {"keyword": "asaya", "search_volume": 33100, "competition": "LOW",
                 "monthly_searches": [{"year": 2026, "month": 9, "search_volume": 49500}, {"year": 2026, "month": 8, "search_volume": 40500}]}]}]}
    calls = []
    monkeypatch.setattr(S.requests, "post", lambda url, **kw: calls.append((url, kw)) or Resp())
    out = S.dataforseo_volume("u", "p", ["asaya"], 2356, "en")
    assert calls[0][0].endswith("/keywords_data/google_ads/search_volume/live") and calls[0][1]["json"] == [{"keywords": ["asaya"], "location_code": 2356, "language_code": "en"}]
    m = out[0]["keywordMetrics"]
    assert m["avgMonthlySearches"] == 33100 and {"year": 2026, "month": "SEPTEMBER", "monthlySearches": 49500} in m["monthlySearchVolumes"]
    t = model.keyword_table(out, config()["brands"], [])
    assert t["months"] == ["2026-08", "2026-09"]
