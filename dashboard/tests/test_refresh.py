from app import refresh


def _row(day):
    return {"date": day, "spend": 1.0}


def test_meta_is_asked_again_when_yesterday_comes_back_empty(monkeypatch):
    calls = []

    def fake_fetch_all(token, cfg, since, until, level="ad"):
        calls.append(1)
        return [_row("2026-10-29")] + (
            [_row("2026-10-30")] if len(calls) == 3 else []
        )

    slept = []
    monkeypatch.setattr(refresh.meta, "fetch_all", fake_fetch_all)
    monkeypatch.setattr(refresh.time, "sleep", slept.append)
    rows = refresh._fetch_meta("t", {}, "2026-10-24", "2026-10-30")
    assert len(calls) == 3 and slept == [30, 60]
    assert any(r["date"] == "2026-10-30" for r in rows)


def test_meta_gives_up_after_the_retries_and_reports_what_it_has(monkeypatch):
    monkeypatch.setattr(
        refresh.meta, "fetch_all", lambda *a, **k: [_row("2026-10-29")]
    )
    monkeypatch.setattr(refresh.time, "sleep", lambda s: None)
    rows = refresh._fetch_meta("t", {}, "2026-10-24", "2026-10-30")
    assert [r["date"] for r in rows] == ["2026-10-29"]


CREDS = {
    "google-ads-client-id": "cid",
    "google-ads-client-secret": "csec",
    "google-ads-refresh-token": "rt",
}


def _gcfg():
    return refresh.settings.config()["google_ads"]


def test_google_rows_come_back_in_the_bigquery_shape(monkeypatch):
    from app import google_ads

    stream = [
        {
            "results": [
                {
                    "segments": {"date": "2026-10-30"},
                    "campaign": {"id": "23832479262", "name": "WOA_Pmax_ITB"},
                    "metrics": {
                        "costMicros": "23896560051",
                        "impressions": "488785",
                        "clicks": "8158",
                        "conversions": 9.710075,
                        "conversionsValue": 10679.0,
                    },
                }
            ]
        }
    ]

    class Resp:
        status_code = 200

        def __init__(self, body):
            self.body = body

        def json(self):
            return self.body

    def fake_post(url, **kw):
        if url == google_ads.TOKEN_URL:
            return Resp({"access_token": "tok"})
        assert "developer-token" not in kw["headers"]
        assert kw["headers"]["login-customer-id"] == "2013716241"
        return Resp(stream)

    monkeypatch.setattr(google_ads.requests, "post", fake_post)
    creds = {
        "client_id": "cid",
        "client_secret": "csec",
        "refresh_token": "rt",
    }
    rows = google_ads.fetch_daily(_gcfg(), creds, "2026-10-30", "2026-10-30")
    assert rows == [
        {
            "date": "2026-10-30",
            "campaign_id": "23832479262",
            "campaign_name": "WOA_Pmax_ITB",
            "spend": 23896.560051,
            "impressions": 488785,
            "clicks": 8158,
            "conversions": 9.710075,
            "conversion_value": 10679.0,
        }
    ]


def test_google_api_falls_back_to_bigquery_without_credentials(monkeypatch):
    monkeypatch.setattr(refresh.secrets, "get_secret", lambda name: None)
    unavailable = {}
    cfg = refresh.settings.config()
    assert (
        refresh._google_from_api(cfg, "2026-10-30", "2026-08-01", unavailable)
        is None
    )
    assert "not in Secret Manager" in unavailable["google_api"]


def test_google_api_errors_fall_back_with_the_reason(monkeypatch):
    monkeypatch.setattr(refresh.secrets, "get_secret", CREDS.get)

    def boom(*a, **k):
        raise refresh.google_ads.GoogleAdsError("PERMISSION_DENIED: no access")

    monkeypatch.setattr(refresh.google_ads, "fetch_daily", boom)
    unavailable = {}
    cfg = refresh.settings.config()
    assert (
        refresh._google_from_api(cfg, "2026-10-30", "2026-08-01", unavailable)
        is None
    )
    assert "PERMISSION_DENIED" in unavailable["google_api"]


def test_google_api_sets_the_d1_check_from_its_own_rows(monkeypatch):
    monkeypatch.setattr(refresh.secrets, "get_secret", CREDS.get)
    row = lambda d: {"date": d, "campaign_id": "1", "spend": 1.0}
    monkeypatch.setattr(
        refresh.google_ads,
        "fetch_daily",
        lambda *a, **k: [row("2026-10-29"), row("2026-10-30")],
    )
    monkeypatch.setattr(
        refresh.google_ads, "fetch_campaigns", lambda *a, **k: []
    )
    cfg = refresh.settings.config()
    src = refresh._google_from_api(cfg, "2026-10-30", "2026-08-01", {})
    assert src["check"] == {
        "source": "google_ads",
        "latest_date": "2026-10-30",
        "d1_rows": 1,
    }
