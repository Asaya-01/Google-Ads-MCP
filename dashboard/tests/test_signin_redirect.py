"""Redirect sign-in (phones and in-app browsers): Google posts the ID token
as a form; the CSRF token must match Google's cookie."""

import pytest
from fastapi.testclient import TestClient

from app import main


@pytest.fixture()
def client(monkeypatch, tmp_path):
    monkeypatch.setenv("STORE_DIR", str(tmp_path))
    monkeypatch.delenv("DEV_USER_EMAIL", raising=False)
    return TestClient(main.app)


def test_a_missing_or_mismatched_csrf_token_is_refused(client):
    r = client.post("/auth/google/redirect", content="credential=x&g_csrf_token=a",
                    headers={"Content-Type": "application/x-www-form-urlencoded"}, follow_redirects=False)
    assert r.status_code == 303 and "signin_error=" in r.headers["location"]
    client.cookies.set("g_csrf_token", "b")
    r = client.post("/auth/google/redirect", content="credential=x&g_csrf_token=a",
                    headers={"Content-Type": "application/x-www-form-urlencoded"}, follow_redirects=False)
    assert r.status_code == 303 and "signin_error=" in r.headers["location"]


def test_a_verified_allowlisted_email_gets_a_session(client, monkeypatch):
    monkeypatch.setattr(main, "_verified_email", lambda cred: "someone@example.com")
    monkeypatch.setattr(main, "serializer", lambda: type("S", (), {"dumps": staticmethod(lambda e: "signed")})())
    client.cookies.set("g_csrf_token", "t")
    r = client.post("/auth/google/redirect", content="credential=x&g_csrf_token=t",
                    headers={"Content-Type": "application/x-www-form-urlencoded"}, follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"] == "/"
    assert main.COOKIE in r.headers.get("set-cookie", "")


def test_a_refused_email_comes_back_with_the_reason(client, monkeypatch):
    def refuse(cred):
        raise main.HTTPException(403, "someone@example.com is not on the dashboard allowlist")
    monkeypatch.setattr(main, "_verified_email", refuse)
    client.cookies.set("g_csrf_token", "t")
    r = client.post("/auth/google/redirect", content="credential=x&g_csrf_token=t",
                    headers={"Content-Type": "application/x-www-form-urlencoded"}, follow_redirects=False)
    assert r.status_code == 303 and "allowlist" in r.headers["location"]


# ---- direct sign-in (phones): a link to Google's page, the ID token posted back
from urllib.parse import parse_qs, urlparse  # noqa: E402

from itsdangerous import URLSafeTimedSerializer  # noqa: E402

SIGNER = URLSafeTimedSerializer("test-key", salt="asaya-dashboard-oauth-state")


@pytest.fixture()
def direct(client, monkeypatch):
    monkeypatch.setenv("GOOGLE_OAUTH_CLIENT_ID", "cid.apps.googleusercontent.com")
    monkeypatch.setattr(main, "oauth_serializer", lambda: SIGNER)
    monkeypatch.setattr(main, "serializer", lambda: type("S", (), {"dumps": staticmethod(lambda e: "signed")})())
    return client


def _post(client, body):
    return client.post("/auth/google/redirect", content=body,
                       headers={"Content-Type": "application/x-www-form-urlencoded"}, follow_redirects=False)


def test_start_sends_the_phone_to_googles_page_with_a_one_time_state(direct):
    r = direct.get("/auth/google/start", headers={"host": "dash.example.run.app", "x-forwarded-proto": "https"}, follow_redirects=False)
    assert r.status_code == 302
    u = urlparse(r.headers["location"])
    q = {k: v[0] for k, v in parse_qs(u.query).items()}
    assert u.netloc == "accounts.google.com" and q["client_id"] == "cid.apps.googleusercontent.com"
    assert q["redirect_uri"] == "https://dash.example.run.app/auth/google/redirect"
    assert q["response_type"] == "id_token" and q["response_mode"] == "form_post" and q["scope"] == "openid email"
    cookie = r.headers["set-cookie"]
    assert main.OAUTH_COOKIE in cookie and "samesite=none" in cookie.lower() and "httponly" in cookie.lower()
    saved = SIGNER.loads(cookie.split(main.OAUTH_COOKIE + "=")[1].split(";")[0].strip('"'))
    assert saved == {"s": q["state"], "n": q["nonce"]}


def test_the_posted_id_token_signs_in_when_state_and_nonce_match(direct, monkeypatch):
    seen = {}

    def ok(cred, nonce=None):
        seen.update(cred=cred, nonce=nonce)
        return "someone@example.com"
    monkeypatch.setattr(main, "_verified_email", ok)
    direct.cookies.set(main.OAUTH_COOKIE, SIGNER.dumps({"s": "S1", "n": "N1"}))
    r = _post(direct, "id_token=tok&state=S1")
    assert r.status_code == 303 and r.headers["location"] == "/"
    assert seen == {"cred": "tok", "nonce": "N1"} and main.COOKIE in r.headers.get("set-cookie", "")


def test_a_wrong_or_missing_state_or_a_cancel_comes_back_with_a_reason(direct, monkeypatch):
    monkeypatch.setattr(main, "_verified_email", lambda cred, nonce=None: "someone@example.com")
    r = _post(direct, "id_token=tok&state=S1")  # no cookie: another browser, or too late
    assert r.status_code == 303 and "signin_error=" in r.headers["location"]
    direct.cookies.set(main.OAUTH_COOKIE, SIGNER.dumps({"s": "S1", "n": "N1"}))
    r = _post(direct, "id_token=tok&state=OTHER")
    assert "signin_error=" in r.headers["location"]
    r = _post(direct, "error=access_denied&state=S1")
    assert "signin_error=" in r.headers["location"] and "cancelled" in r.headers["location"]


def test_a_token_without_the_nonce_is_refused():
    with pytest.raises(main.HTTPException) as e:
        import unittest.mock as m
        with m.patch("google.oauth2.id_token.verify_oauth2_token", return_value={"email": "a@b.c", "email_verified": True, "nonce": "other"}):
            main._verified_email("tok", nonce="N1")
    assert e.value.status_code == 401
