"""Web service: Google sign-in, Firestore allowlist, and the page snapshots
the refresh job writes, served at /api/page/<tab>.

Sign-in: the page uses Google Identity Services; the ID token is verified
here, the email must be an active document in the Firestore collection
`dashboard_allowlist` (document ID = lower-case email), and the session is a
signed, HTTP-only cookie. The allowlist is re-checked every few minutes, so
removing someone takes effect without a redeploy.
"""

from __future__ import annotations

import time

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from . import secrets, settings
from .store import default_store

COOKIE = "asaya_dash"
SESSION_SECONDS = 12 * 3600
ALLOWLIST_COLLECTION = "dashboard_allowlist"
ALLOWLIST_TTL = 300

app = FastAPI(
    title="Asaya D2C dashboard", docs_url=None, redoc_url=None, openapi_url=None
)
app.add_middleware(GZipMiddleware, minimum_size=1000)
_store = None
_serializer = None
_allow_cache: dict[str, tuple[bool, float]] = {}


def store():
    global _store
    if _store is None:
        _store = default_store()
    return _store


def serializer() -> URLSafeTimedSerializer:
    global _serializer
    if _serializer is None:
        key = secrets.get_secret("dashboard-session-key")
        if not key:
            raise RuntimeError("Secret dashboard-session-key is missing")
        _serializer = URLSafeTimedSerializer(
            key, salt="asaya-dashboard-session"
        )
    return _serializer


def dev_user() -> str | None:
    """Local development only: skips sign-in when serving from a local store."""
    if settings.env("STORE_DIR") and settings.env("DEV_USER_EMAIL"):
        return settings.env("DEV_USER_EMAIL")
    return None


def is_allowed(email: str) -> bool:
    email = email.lower()
    cached = _allow_cache.get(email)
    if cached and time.time() - cached[1] < ALLOWLIST_TTL:
        return cached[0]
    from google.cloud import firestore

    doc = (
        firestore.Client(project=settings.config()["gcp"]["project"])
        .collection(ALLOWLIST_COLLECTION)
        .document(email)
        .get()
    )
    allowed = (
        doc.exists and (doc.to_dict() or {}).get("active", True) is not False
    )
    _allow_cache[email] = (allowed, time.time())
    return allowed


def current_user(request: Request) -> str:
    dev = dev_user()
    if dev:
        return dev
    token = request.cookies.get(COOKIE)
    if not token:
        raise HTTPException(401, "Sign in required")
    try:
        email = serializer().loads(token, max_age=SESSION_SECONDS)
    except SignatureExpired:
        raise HTTPException(401, "Session expired")
    except BadSignature:
        raise HTTPException(401, "Sign in required")
    if not is_allowed(email):
        raise HTTPException(403, "Not on the dashboard allowlist")
    return email


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "same-origin"
    if request.url.path.startswith(("/api/", "/auth/")):
        response.headers["Cache-Control"] = "no-store"
    return response


@app.get("/healthz")
def healthz():
    return {"ok": True}


SHELL_HEAD = (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">'
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'
    "<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}"
    "body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style></head><body>"
)


@app.get("/")
def index():
    # static/app.html is a page fragment; the same file is used for the
    # offline preview, so the document shell is added here.
    fragment = settings.app_fragment()
    return HTMLResponse(
        SHELL_HEAD + fragment + "</body></html>",
        headers={"Cache-Control": "no-cache"},
    )


@app.get("/api/config")
def public_config():
    """What the page needs before sign-in: the OAuth client ID and tab list."""
    return {
        "brand": settings.config()["brand"],
        "google_client_id": settings.env("GOOGLE_OAUTH_CLIENT_ID"),
        "dev_mode": bool(dev_user()),
        "tabs": [
            {"id": t["id"], "label": t["label"]}
            for t in settings.enabled_tabs()
        ],
    }


@app.post("/auth/google")
async def sign_in(request: Request):
    from google.auth.transport import requests as google_requests
    from google.oauth2 import id_token

    body = await request.json()
    client_id = settings.env("GOOGLE_OAUTH_CLIENT_ID")
    try:
        claims = id_token.verify_oauth2_token(
            body.get("credential", ""), google_requests.Request(), client_id
        )
    except ValueError:
        raise HTTPException(401, "Google sign-in could not be verified")
    email = (claims.get("email") or "").lower()
    if not email or not claims.get("email_verified"):
        raise HTTPException(401, "Google account email is not verified")
    if not is_allowed(email):
        raise HTTPException(403, f"{email} is not on the dashboard allowlist")
    response = JSONResponse({"email": email})
    response.set_cookie(
        COOKIE,
        serializer().dumps(email),
        max_age=SESSION_SECONDS,
        httponly=True,
        secure=True,
        samesite="lax",
    )
    return response


@app.post("/auth/logout")
def sign_out():
    response = JSONResponse({"ok": True})
    response.delete_cookie(COOKIE)
    return response


@app.get("/api/me")
def me(user: str = Depends(current_user)):
    return {"email": user}


@app.get("/api/status")
def status(user: str = Depends(current_user)):
    return store().get_json("status/latest.json") or {}


_census_cache: dict = {"at": 0.0, "text": None}
CENSUS_TTL = 600


@app.get("/api/retention/census")
def retention_census(user: str = Depends(current_user)):
    """The retention census: per-customer purchase timelines, no names, emails
    or phone numbers. A few MB, so it is gzipped and cached for ten minutes."""
    now = time.time()
    if _census_cache["text"] is None or now - _census_cache["at"] > CENSUS_TTL:
        _census_cache["text"] = store().get_text("retention/census.json")
        _census_cache["at"] = now
    if _census_cache["text"] is None:
        return Response(
            content='{"error": "The retention census has not been built yet. It is rebuilt every morning."}',
            status_code=503,
            media_type="application/json",
        )
    return Response(
        content=_census_cache["text"], media_type="application/json"
    )


@app.get("/api/page/{tab}")
def page(tab: str, user: str = Depends(current_user)):
    if tab not in {t["id"] for t in settings.enabled_tabs()}:
        raise HTTPException(404, "No such tab")
    payload = store().get_json(f"pages/{tab}.json")
    if payload is None:
        return Response(
            content='{"error": "This tab has not been built yet. The refresh job runs from 07:00 IST."}',
            status_code=503,
            media_type="application/json",
        )
    return payload
