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
