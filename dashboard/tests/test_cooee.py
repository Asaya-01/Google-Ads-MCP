"""The CRO tab's Cooee pipeline: the one-time sign-in, the MCP client, the
sync job, the page and the experiment verdicts. No network: a fake Cooee
answers in the shapes the real MCP server returned when audited."""

import datetime as dt

import pytest

from app import settings
from app.cooee import build, mcp, sync, verdict
from app.store import LocalStore
from cooee_fake import FakeCooee

CC = {**settings.config()["cro"], "mcp_url": FakeCooee.MCP, "data_start": "2026-11-01", "backfill_days_per_run": 4}
NOW = dt.datetime(2026, 11, 13, 6, 0, tzinfo=dt.timezone.utc)  # 11:30 IST: D-1 is 12 Nov


@pytest.fixture()
def store(tmp_path):
    return LocalStore(str(tmp_path))


def connect(store, fake):
    url = mcp.start(store, FakeCooee.MCP, "https://dash.test/auth/cooee/callback", "owner@example.com", http=fake)
    assert url.startswith("https://auth.cooee.test/authorize?") and "code_challenge_method=S256" in url and "resource=" in url
    state = url.split("state=")[1].split("&")[0]
    mcp.finish(store, state, "good-code", http=fake)


def test_sign_in_registers_once_and_keeps_a_refresh_token(store):
    fake = FakeCooee()
    connect(store, fake)
    saved = store.get_json(mcp.TOKEN_PATH)
    assert saved["client"]["client_id"] == "dash-client" and saved["tokens"]["refresh_token"] == "rt-1"
    assert mcp.status(store)["connected"] and mcp.status(store)["connected_by"] == "owner@example.com"
    # an expired access token is renewed with the refresh token, and the new one is kept
    saved["tokens"]["expires_at"] = 0
    store.put_json(mcp.TOKEN_PATH, saved)
    assert mcp.access_token(store, http=fake) == "at-2"
    assert store.get_json(mcp.TOKEN_PATH)["tokens"]["refresh_token"] == "rt-2"


def test_a_wrong_state_or_a_revoked_sign_in_asks_to_connect_again(store):
    fake = FakeCooee()
    mcp.start(store, FakeCooee.MCP, "https://dash.test/cb", "a@b.c", http=fake)
    with pytest.raises(mcp.CooeeError):
        mcp.finish(store, "not-the-state", "good-code", http=fake)
    connect(store, fake)
    saved = store.get_json(mcp.TOKEN_PATH)
    saved["tokens"].update(expires_at=0, refresh_token="revoked")
    store.put_json(mcp.TOKEN_PATH, saved)
    with pytest.raises(mcp.NotConnected):
        mcp.access_token(store, http=fake)
    assert store.get_json(mcp.TOKEN_PATH)["last_error"]


def test_no_registration_needs_a_client_id_from_cooee(store):
    fake = FakeCooee(registration=False)
    with pytest.raises(mcp.CooeeError, match="client id"):
        mcp.start(store, FakeCooee.MCP, "https://dash.test/cb", "a@b.c", http=fake)
    assert mcp.start(store, FakeCooee.MCP, "https://dash.test/cb", "a@b.c", client_id="given", http=fake)


def test_the_client_only_calls_read_only_tools(store):
    fake = FakeCooee()
    connect(store, fake)
    c = mcp.Client(FakeCooee.MCP, lambda f: mcp.access_token(store, http=fake, force=f), http=fake).open()
    out = c.call("get_store_daily_stats", {"storeSlug": "s", "fromDate": "2026-11-01", "toDate": "2026-11-02"})
    assert len(out["processedDays"]) == 2 and c.log[0]["status"] == "ok" and c.log[0]["rows"] == 2
    with pytest.raises(mcp.CooeeError, match="read-only"):
        c.call("create_campaign", {})


def _run(store, fake, monkeypatch, **kw):
    monkeypatch.setattr(sync, "config", lambda: CC)
    return sync.run(store, lambda: mcp.Client(FakeCooee.MCP, lambda f: mcp.access_token(store, http=fake, force=f), http=fake).open(), NOW, **kw)


def test_sync_repulls_the_last_week_and_backfills_newest_first(store, monkeypatch):
    fake = FakeCooee()
    connect(store, fake)
    log = _run(store, fake, monkeypatch)
    # 6..12 Nov re-pulled, then 4 older days (5, 4, 3, 2 Nov) back-filled
    assert log["days"] == [f"2026-11-{d:02d}" for d in range(2, 13)] and log["backfill_left"] == 1 and log["status"] == "ok"
    day = store.get_json("cache/cooee/day/2026-11-12.json")
    assert set(day) >= {"funnel", "hour", "store", "campaigns", "landing", "exits", "utm", "channel", "device", "products", "variants", "impact"}
    assert len(day["funnel"]["HIGH"]) == len(sync.FUNNEL) and len(day["hour"]) == 24
    assert day["landing"]["rows"][0][:2] == ["/products/underarm-spray", "products"]
    assert day["device"]["rows"][0][:2] == ["mobile", "New"]  # visitorType comes back as sessionType
    assert day["products"]["rows"][1][2] == "Fade Forward Inner Thigh & Bum Roll-On - 70 ml"  # entities decoded
    # the same day: no second re-pull, no second snapshot; the last back-fill day only
    fake.calls.clear()
    log2 = _run(store, fake, monkeypatch)
    assert log2["days"] == ["2026-11-01"] and not any(n == "list_experiments" for n, _ in fake.calls)
    assert store.get_json("cache/cooee/sync_log.json")["runs"][0]["status"] == "ok"


def test_a_changed_response_shape_fails_the_run_loudly(store, monkeypatch):
    fake = FakeCooee(shape_break="get_product_report")
    connect(store, fake)
    with pytest.raises(sync.ShapeError):
        _run(store, fake, monkeypatch)
    last = store.get_json("cache/cooee/sync_log.json")["last"]
    assert last["status"] == "error" and "shape" in last["error"]


def test_the_page_has_days_rows_and_verdicts(store, monkeypatch):
    fake = FakeCooee()
    connect(store, fake)
    _run(store, fake, monkeypatch, max_backfill=20)
    cfg = {**settings.config(), "cro": CC}
    p = build.page(store, cfg, NOW, {})
    assert p["days"][0] == "2026-11-01" and p["days"][-1] == "2026-11-12" and p["connection"]["connected"]
    assert p["funnel"]["fields"][0] == "sessions" and {r[1] for r in p["funnel"]["rows"]} == {0, 1, 2, 3, 4}
    assert p["landing"]["keys"][0] == ["/products/underarm-spray", "products"] and p["landing"]["other"]
    assert p["products"]["keys"][0][2] == "UAS"  # Cooee's productId is the Shopify product id
    assert p["campaigns"]["keys"][0]["url"].endswith("/campaigns/detail/253")
    ex = {e["seq"]: e for e in p["experiments"]}
    assert ex["152"]["verdict"] == "Invalid: split mismatch"
    assert ex["245"]["verdict"] == "Inconclusive" and ex["245"]["source"] == "Cooee" and ex["245"]["p"] == 0.7913
    assert ex["266"]["verdict"] == "Too early" or ex["266"]["verdict"] == "Inconclusive"
    assert ex["266"]["exposure"] is not None and ex["266"]["exposure"] < 0.05  # most visitors never saw the widget
    assert ex["252"]["verdict"] == "Draft"
    assert p["impact"]["running"] is False


def test_page_before_the_first_sync_says_connect(store):
    p = build.page(store, settings.config(), NOW, {})
    assert p["days"] == [] and "Connect Cooee" in p["na"]


def test_verdict_rules():
    R = settings.config()["cro"]["verdict"]
    arm = lambda k, ctrl, vis, orders, split=50: {"key": k, "name": k, "isControl": ctrl, "split": split,  # noqa: E731
                                                   "stats": {"uniqueVisitors": vis, "influencedOrders": orders, "influencedRevenue": orders * 800.0}}
    base = {"status": "PUBLISHED", "publishedAt": "2026-09-01T00:00:00Z"}
    win = verdict.verdict({**base, "variations": [arm("a", False, 50000, 1300), arm("b", True, 50000, 1000)]}, "2026-11-12", R)
    assert win["verdict"] == "Winner" and win["source"] == "computed" and win["p"] < 0.05
    lose = verdict.verdict({**base, "variations": [arm("a", False, 50000, 800), arm("b", True, 50000, 1000)]}, "2026-11-12", R)
    assert lose["verdict"] == "Loser"
    early = verdict.verdict({**base, "publishedAt": "2026-11-10T00:00:00Z", "variations": [arm("a", False, 50000, 1300), arm("b", True, 50000, 1000)]}, "2026-11-12", R)
    assert early["verdict"] == "Too early"
    srm = verdict.verdict({**base, "variations": [arm("a", False, 59500, 1500), arm("b", True, 40500, 1000)]}, "2026-11-12", R)
    assert srm["verdict"] == "Invalid: split mismatch" and srm["srm"]["p"] < 0.001
    # an uneven configured split is not a mismatch
    ok = verdict.verdict({**base, "variations": [arm("a", False, 90000, 2000, 90), arm("b", True, 10000, 220, 10)]}, "2026-11-12", R)
    assert ok["verdict"] != "Invalid: split mismatch"
    assert verdict._chi2_sf(3.841, 1) == pytest.approx(0.05, abs=1e-3) and verdict._chi2_sf(5.991, 2) == pytest.approx(0.05, abs=1e-3)


def test_routes_serve_the_connect_page_before_any_sync(monkeypatch, tmp_path):
    from fastapi.testclient import TestClient

    from app import main

    monkeypatch.setenv("STORE_DIR", str(tmp_path))
    monkeypatch.setenv("DEV_USER_EMAIL", "dev@local")
    monkeypatch.setattr(main, "_store", None)
    c = TestClient(main.app)
    p = c.get("/api/page/cro").json()
    assert p["connection"]["connected"] is False and "Connect Cooee" in p["na"]
    r = c.get("/api/cro/live?start=2026-11-01&end=2026-11-07")
    assert r.status_code == 409 and "Connect Cooee" in r.json()["detail"]
    assert c.get("/api/cro/live?start=bad&end=2026-11-07").status_code == 400


def test_an_unreachable_cooee_is_an_error_not_a_crash(store):
    import requests

    class Down(FakeCooee):
        def post(self, url, **kw):
            if url == FakeCooee.MCP:
                raise requests.exceptions.ProxyError("tunnel 403")
            return super().post(url, **kw)
    fake = Down()
    connect(store, fake)
    with pytest.raises(mcp.CooeeError, match="could not be reached"):
        mcp.Client(FakeCooee.MCP, lambda f: mcp.access_token(store, http=fake, force=f), http=fake, retries=1).open()
