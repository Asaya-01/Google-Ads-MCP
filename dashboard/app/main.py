"""Web service: Google sign-in, Firestore allowlist, and the page snapshots
the refresh job writes, served at /api/page/<tab>.

Sign-in: the page uses Google Identity Services; the ID token is verified
here, the email must be an active document in the Firestore collection
`dashboard_allowlist` (document ID = lower-case email), and the session is a
signed, HTTP-only cookie. The allowlist is re-checked every few minutes, so
removing someone takes effect without a redeploy.
"""

from __future__ import annotations

import json
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
            {"id": t["id"], "label": t["label"], "report": bool(t.get("report"))}
            for t in settings.enabled_tabs()
        ],
        "display": settings.config().get("display", {}),
        "product_map": settings.config().get("product_map", {}).get("products", []),
        "sold_in_packs": settings.config().get("product_map", {}).get("sold_in_packs", []),
        "phase_overrides": settings.config().get("phases", {}).get("overrides", {}),
        "live_flag": settings.config().get("live", {}).get("flag_spend_without_return", {}),
        "checkout": {
            k: settings.config().get("pulse", {}).get(k)
            for k in ("watch_drop", "problem_drop", "baseline_days", "min_baseline_days")
        },
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


@app.post("/api/ask")
async def ask_claude(request: Request, user: str = Depends(current_user)):
    """Ask Claude: streams the answer as server-sent events (app/ask.py)."""
    from fastapi.responses import StreamingResponse

    from . import ask

    cfg = ask.config()
    if not cfg.get("enabled"):
        raise HTTPException(404, "Ask Claude is turned off in config.json")
    try:
        body = await request.json()
    except ValueError:
        raise HTTPException(400, "Expected JSON")
    if not isinstance(body, dict):
        raise HTTPException(400, "Expected a JSON object")
    if not ask.allow(user, cfg.get("questions_per_user_per_hour", 40)):
        raise HTTPException(
            429, "That's the hourly limit for questions. Try again later."
        )
    view = body.get("view") if isinstance(body.get("view"), dict) else None

    def events():
        try:
            for ev in ask.answer(
                body.get("question"),
                body.get("history"),
                view,
                cfg,
                store(),
                voice=bool(body.get("voice")),
            ):
                yield f"data: {json.dumps(ev, default=str)}\n\n"
        except Exception as exc:  # report, never hang the browser
            print(json.dumps({"ask": "failed", "error": type(exc).__name__}))
            yield 'data: {"t": "error", "text": "Something went wrong while answering. Try again."}\n\n'

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )


@app.post("/api/transcribe")
async def transcribe(request: Request, user: str = Depends(current_user)):
    """Ask Claude's mic: speech to text (app/voice.py). Returns {"text"}."""
    from . import ask, voice

    vcfg = ask.config().get("voice") or {}
    if not vcfg.get("enabled", True):
        raise HTTPException(503, "Voice input is turned off in config.json")
    body = await request.body()
    if len(body) > 4_000_000:
        raise HTTPException(413, "Recordings are limited to a minute.")
    try:
        data = json.loads(body)
    except ValueError:
        raise HTTPException(400, "Expected JSON")
    if not isinstance(data, dict):
        raise HTTPException(400, "Expected a JSON object")
    if not ask.allow(f"voice:{user}", vcfg.get("per_user_per_hour", 120)):
        raise HTTPException(429, "That's the hourly limit for voice questions.")
    from starlette.concurrency import run_in_threadpool

    try:
        text = await run_in_threadpool(voice.transcribe, data.get("audio"), vcfg)
    except voice.VoiceError as exc:
        print(json.dumps({"voice": "failed", "status": exc.status}))
        raise HTTPException(exc.status, exc.text)
    return {"text": text}


@app.get("/api/region/{key}")
def region_state(key: str, user: str = Depends(current_user)):
    """One state's products by city, for the Region tab (loaded on click)."""
    import re

    if not re.fullmatch(r"[a-z]{2,6}", key):  # a state's key, or "all"
        raise HTTPException(404, "No such state")
    payload = store().get_json(f"pages/region_sku/{key}.json")
    if payload is None:
        return {"rows": [], "na": "no product detail for this state yet"}
    return payload


@app.post("/api/meta/reach")
async def meta_reach(request: Request, user: str = Depends(current_user)):
    """Unique reach and frequency for a period, for every ad in the view or a
    set of ads (a campaign, ad set, SKU or stage rollup). Reach cannot be
    added up from rows, so it is asked of Meta and cached for six hours."""
    import datetime as _dt
    import hashlib
    import re as _re

    from . import meta

    body = await request.json()
    since, until = str(body.get("since", "")), str(body.get("until", ""))
    ads = [str(a) for a in (body.get("ads") or []) if _re.fullmatch(r"\d{5,25}", str(a))][:2000]
    if not (_re.fullmatch(r"\d{4}-\d{2}-\d{2}", since) and _re.fullmatch(r"\d{4}-\d{2}-\d{2}", until)):
        raise HTTPException(400, "since and until must be dates")
    key = hashlib.sha1(f"{since}|{until}|{','.join(sorted(ads))}".encode()).hexdigest()
    st = store()
    hit = st.get_json(f"cache/meta_reach/{key}.json")
    now = _dt.datetime.now(_dt.timezone.utc)
    if hit and now - _dt.datetime.fromisoformat(hit["at"]) < _dt.timedelta(hours=6):
        return hit["value"]
    mcfg = settings.config()["meta"]
    try:
        token = secrets.get_secret(mcfg["token_secret"])
    except Exception:  # Secret Manager unreachable: n/a, never an error page
        token = None
    if not token:
        return {"reach": None, "frequency": None, "na": "the Meta token is not available to the dashboard"}
    try:
        value = meta.reach_for(token, mcfg, since, until, ads or None)
    except Exception as exc:  # shown as n/a with the reason, never zero
        return {"reach": None, "frequency": None, "na": f"Meta: {exc}"}
    st.put_json(f"cache/meta_reach/{key}.json", {"at": now.isoformat(), "value": value})
    return value


def _google_creds() -> dict | None:
    gcfg = settings.config()["google_ads"]
    try:
        creds = {
            "client_id": secrets.get_secret(gcfg["client_id_secret"]),
            "client_secret": secrets.get_secret(gcfg["client_secret_secret"]),
            "refresh_token": secrets.get_secret(gcfg["refresh_token_secret"]),
        }
    except Exception:  # Secret Manager unreachable: n/a, never an error page
        return None
    return creds if all(creds.values()) else None


async def _google_on_demand(request: Request, flag: str, label: str, fetch):
    """Shared by the Google view's on-demand reads (search insights, reach):
    validated ids and dates, the report's switch, a six-hour cache."""
    import datetime as _dt
    import hashlib
    import re as _re

    body = await request.json()
    since, until = str(body.get("since", "")), str(body.get("until", ""))
    ids = sorted({str(c) for c in (body.get("campaigns") or []) if _re.fullmatch(r"\d{5,25}", str(c))})[:50]
    if not (_re.fullmatch(r"\d{4}-\d{2}-\d{2}", since) and _re.fullmatch(r"\d{4}-\d{2}-\d{2}", until)):
        raise HTTPException(400, "since and until must be dates")
    gcfg = settings.config()["google_ads"]
    if not (gcfg.get("reports") or {}).get(flag):
        return {"na": f"{label} is a pipeline addition that is not switched on yet (config google_ads.reports.{flag})"}
    if not ids:
        return {"na": "no campaigns in view"}
    key = hashlib.sha1(f"{flag}|{since}|{until}|{','.join(ids)}".encode()).hexdigest()
    st = store()
    hit = st.get_json(f"cache/google_{flag}/{key}.json")
    now = _dt.datetime.now(_dt.timezone.utc)
    if hit and now - _dt.datetime.fromisoformat(hit["at"]) < _dt.timedelta(hours=6):
        return hit["value"]
    creds = _google_creds()
    if not creds:
        return {"na": "the Google Ads credentials are not available to the dashboard"}
    try:
        value = fetch(gcfg, creds, ids, since, until)
    except Exception as exc:  # shown as n/a with the reason, never zero
        return {"na": f"Google Ads: {exc}"}
    st.put_json(f"cache/google_{flag}/{key}.json", {"at": now.isoformat(), "value": value})
    return value


@app.post("/api/google/insights")
async def google_insights(request: Request, user: str = Depends(current_user)):
    """Performance Max search query categories for a period, per campaign
    (Google gives them only as period totals). Read-only."""
    from . import google_ads

    return await _google_on_demand(
        request, "insights", "Search insights",
        lambda g, c, ids, a, b: {"campaigns": google_ads.fetch_insights(g, c, ids, a, b)},
    )


@app.post("/api/google/reach")
async def google_reach(request: Request, user: str = Depends(current_user)):
    """Unique users and frequency for a period and set of campaigns. Read-only."""
    from . import google_ads

    return await _google_on_demand(request, "reach", "Google reach", google_ads.fetch_reach)


@app.get("/api/page/{tab}")
def page(tab: str, user: str = Depends(current_user)):
    if tab not in {t["id"] for t in settings.enabled_tabs()} | {
        "days",
        "campaign_days",
        "product_days",
        "meta_tree",
        "google_tree",
        "channel_days",
        "slab_days",
        "drill_days",
        "region_days",
        "meta_ads",
        "google_ads",
        "google_search",
        "google_products",
        "google_assets",
        "plan_days",
    }:
        raise HTTPException(404, "No such tab")
    payload = store().get_json(f"pages/{tab}.json")
    if payload is None:
        return Response(
            content='{"error": "This tab has not been built yet. The refresh job runs from 07:00 IST."}',
            status_code=503,
            media_type="application/json",
        )
    return payload
