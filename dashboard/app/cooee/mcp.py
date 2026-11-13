"""A small, deterministic client for Cooee's MCP server (streamable HTTP,
JSON-RPC 2.0), and the one-time sign-in that lets a scheduled job use it.

Sign-in follows the MCP authorization spec, the same way Claude's connector
does: discover the authorization server from the MCP server's protected-
resource metadata, register this dashboard as an OAuth client (dynamic
client registration), send the person who clicks "Connect Cooee" through
Cooee's consent page with PKCE, and keep the access and refresh tokens.
After that the job refreshes the access token itself; nobody signs in again
unless Cooee revokes or expires the refresh token, which Data health shows.

Tokens live in the dashboard's private bucket (private/cooee_oauth.json),
never in pages/, which is the only prefix the web app serves.

Read only: the client only ever sends `initialize`, `tools/list` and
`tools/call`, and refuses any tool not on the read-only list.
"""

from __future__ import annotations

import base64
import datetime as dt
import hashlib
import json
import secrets as pysecrets
import time
from urllib.parse import urlencode, urlparse

import requests

TOKEN_PATH = "private/cooee_oauth.json"
PENDING_PATH = "private/cooee_oauth_pending.json"
PROTOCOL = "2025-06-18"
READ_ONLY_TOOLS = {
    "list_stores", "get_store", "get_store_daily_stats", "get_store_kpis", "get_landing_page_report",
    "get_product_report", "get_campaign_report", "list_campaigns", "get_campaign", "list_experiments",
    "get_experiment", "get_impact_report", "list_products",
}


class CooeeError(RuntimeError):
    pass


class NotConnected(CooeeError):
    """No usable sign-in: someone needs to click "Connect Cooee"."""


def _now() -> float:
    return time.time()


# ---------------------------------------------------------------- discovery and sign-in
def _origin(url: str) -> str:
    u = urlparse(url)
    return f"{u.scheme}://{u.netloc}"


def discover(mcp_url: str, http=requests) -> dict:
    """The authorization server's endpoints for this MCP server."""
    base, path = _origin(mcp_url), urlparse(mcp_url).path.rstrip("/")
    prm = None
    for cand in (f"{base}/.well-known/oauth-protected-resource{path}", f"{base}/.well-known/oauth-protected-resource"):
        r = http.get(cand, timeout=20)
        if r.status_code == 200:
            prm = r.json()
            break
    issuer = (prm or {}).get("authorization_servers", [base])[0].rstrip("/")
    asm = None
    ip = urlparse(issuer).path.rstrip("/")
    for cand in (f"{_origin(issuer)}/.well-known/oauth-authorization-server{ip}", f"{_origin(issuer)}/.well-known/openid-configuration{ip}",
                 f"{issuer}/.well-known/oauth-authorization-server", f"{issuer}/.well-known/openid-configuration"):
        r = http.get(cand, timeout=20)
        if r.status_code == 200:
            asm = r.json()
            break
    if not asm:
        raise CooeeError(f"Cooee's sign-in server could not be found from {mcp_url} (no OAuth metadata)")
    return {
        "issuer": asm.get("issuer", issuer),
        "authorization_endpoint": asm["authorization_endpoint"],
        "token_endpoint": asm["token_endpoint"],
        "registration_endpoint": asm.get("registration_endpoint"),
        "scopes": (prm or {}).get("scopes_supported") or asm.get("scopes_supported") or [],
        "resource": (prm or {}).get("resource") or mcp_url,
    }


def register(meta: dict, redirect_uri: str, client_id: str | None = None, http=requests) -> dict:
    """This dashboard as an OAuth client of Cooee: registered once, or a
    client id Cooee issued (COOEE_OAUTH_CLIENT_ID) when registration is off."""
    if client_id:
        return {"client_id": client_id, "redirect_uris": [redirect_uri]}
    if not meta.get("registration_endpoint"):
        raise CooeeError("Cooee does not allow client registration; ask Cooee for an OAuth client id for this dashboard")
    r = http.post(meta["registration_endpoint"], json={
        "client_name": "Asaya D2C dashboard (read-only sync)",
        "redirect_uris": [redirect_uri],
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "token_endpoint_auth_method": "none",
        **({"scope": " ".join(meta["scopes"])} if meta.get("scopes") else {}),
    }, timeout=20)
    if r.status_code not in (200, 201):
        raise CooeeError(f"Cooee refused to register the dashboard (HTTP {r.status_code}): {r.text[:300]}")
    return r.json()


def start(store, mcp_url: str, redirect_uri: str, who: str, client_id: str | None = None, http=requests) -> str:
    """Step 1 of "Connect Cooee": the URL of Cooee's consent page."""
    meta = discover(mcp_url, http)
    saved = store.get_json(TOKEN_PATH) or {}
    client = saved.get("client") if saved.get("client", {}).get("redirect_uris") == [redirect_uri] and not client_id else None
    client = client or register(meta, redirect_uri, client_id, http)
    verifier = base64.urlsafe_b64encode(pysecrets.token_bytes(48)).decode().rstrip("=")
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    state = pysecrets.token_urlsafe(24)
    store.put_json(PENDING_PATH, {"state": state, "verifier": verifier, "meta": meta, "client": client,
                                  "redirect_uri": redirect_uri, "who": who, "at": _now()})
    q = {"response_type": "code", "client_id": client["client_id"], "redirect_uri": redirect_uri,
         "code_challenge": challenge, "code_challenge_method": "S256", "state": state, "resource": meta["resource"]}
    if meta.get("scopes"):
        q["scope"] = " ".join(meta["scopes"])
    return meta["authorization_endpoint"] + ("&" if "?" in meta["authorization_endpoint"] else "?") + urlencode(q)


def _token_request(meta: dict, client: dict, data: dict, http=requests) -> dict:
    body = {**data, "client_id": client["client_id"]}
    auth = None
    if client.get("client_secret"):
        auth = (client["client_id"], client["client_secret"])
    r = http.post(meta["token_endpoint"], data=body, auth=auth, timeout=30,
                  headers={"Accept": "application/json"})
    if r.status_code != 200:
        raise CooeeError(f"Cooee's token endpoint answered HTTP {r.status_code}: {r.text[:300]}")
    tok = r.json()
    if "access_token" not in tok:
        raise CooeeError("Cooee's token endpoint returned no access token")
    return tok


def finish(store, state: str, code: str, http=requests) -> dict:
    """Step 2: Cooee sent the person back with a code; swap it for tokens."""
    p = store.get_json(PENDING_PATH) or {}
    if not p or p.get("state") != state or _now() - p.get("at", 0) > 900:
        raise CooeeError("this sign-in link expired or was opened in another browser; click Connect Cooee again")
    tok = _token_request(p["meta"], p["client"], {"grant_type": "authorization_code", "code": code,
                                                   "redirect_uri": p["redirect_uri"], "code_verifier": p["verifier"],
                                                   "resource": p["meta"]["resource"]}, http)
    saved = {"meta": p["meta"], "client": p["client"], "tokens": _stamp(tok), "connected_by": p["who"],
             "connected_at": dt.datetime.now(dt.timezone.utc).isoformat(), "last_error": None}
    store.put_json(TOKEN_PATH, saved)
    store.put_json(PENDING_PATH, {})
    return saved


def _stamp(tok: dict, old: dict | None = None) -> dict:
    out = {"access_token": tok["access_token"], "token_type": tok.get("token_type", "Bearer"),
           "expires_at": _now() + float(tok.get("expires_in") or 3600) - 60,
           "refresh_token": tok.get("refresh_token") or (old or {}).get("refresh_token")}
    return out


def access_token(store, http=requests, force: bool = False) -> str:
    """A valid access token, refreshed when it is about to expire (the new
    refresh token is saved at once when Cooee rotates it)."""
    saved = store.get_json(TOKEN_PATH) or {}
    tok = saved.get("tokens")
    if not tok:
        raise NotConnected("Cooee is not connected: open the CRO tab and click Connect Cooee")
    if not force and tok.get("expires_at", 0) > _now():
        return tok["access_token"]
    if not tok.get("refresh_token"):
        raise NotConnected("Cooee's sign-in expired and Cooee gave no refresh token: click Connect Cooee again")
    try:
        new = _token_request(saved["meta"], saved["client"], {"grant_type": "refresh_token", "refresh_token": tok["refresh_token"],
                                                               "resource": saved["meta"]["resource"]}, http)
    except CooeeError as exc:
        # another process may have just rotated it: use theirs if it is fresh
        again = store.get_json(TOKEN_PATH) or {}
        t2 = again.get("tokens") or {}
        if t2.get("access_token") != tok.get("access_token") and t2.get("expires_at", 0) > _now():
            return t2["access_token"]
        saved["last_error"] = str(exc)
        store.put_json(TOKEN_PATH, saved)
        raise NotConnected(f"Cooee's sign-in could not be renewed ({exc}): click Connect Cooee again") from exc
    saved["tokens"] = _stamp(new, tok)
    saved["last_error"] = None
    store.put_json(TOKEN_PATH, saved)
    return saved["tokens"]["access_token"]


def status(store) -> dict:
    saved = store.get_json(TOKEN_PATH) or {}
    return {"connected": bool(saved.get("tokens")), "connected_by": saved.get("connected_by"),
            "connected_at": saved.get("connected_at"), "last_error": saved.get("last_error")}


# ---------------------------------------------------------------- JSON-RPC over streamable HTTP
def _parse(resp) -> dict:
    """A JSON-RPC response from a JSON body or an SSE stream."""
    ctype = resp.headers.get("Content-Type", "")
    if "text/event-stream" in ctype:
        last = None
        for line in resp.text.splitlines():
            if line.startswith("data:"):
                try:
                    msg = json.loads(line[5:].strip())
                except ValueError:
                    continue
                if "result" in msg or "error" in msg:
                    last = msg
        if last is None:
            raise CooeeError("Cooee's MCP server sent no result")
        return last
    return resp.json()


class Client:
    """One MCP session. call(tool, args) returns the tool's JSON result."""

    def __init__(self, url: str, token_fn, http=None, timeout: int = 90, retries: int = 4):
        self.url, self.token_fn = url, token_fn
        self.http = http or requests.Session()
        self.timeout, self.retries = timeout, retries
        self.session_id = None
        self._id = 0
        self.log: list[dict] = []

    def _post(self, payload: dict, notify: bool = False):
        headers = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream",
                   "Authorization": f"Bearer {self.token_fn(False)}", "MCP-Protocol-Version": PROTOCOL}
        if self.session_id:
            headers["Mcp-Session-Id"] = self.session_id
        r = self.http.post(self.url, json=payload, headers=headers, timeout=self.timeout)
        if r.status_code == 401:  # expired between runs: refresh once
            headers["Authorization"] = f"Bearer {self.token_fn(True)}"
            r = self.http.post(self.url, json=payload, headers=headers, timeout=self.timeout)
        if r.status_code == 401:
            raise NotConnected("Cooee refused the sign-in (401): click Connect Cooee again")
        if notify:
            return None
        if r.status_code >= 400:
            raise CooeeError(f"Cooee's MCP server answered HTTP {r.status_code}: {r.text[:300]}")
        if r.headers.get("Mcp-Session-Id"):
            self.session_id = r.headers["Mcp-Session-Id"]
        return _parse(r)

    def _rpc(self, method: str, params: dict) -> dict:
        self._id += 1
        msg = self._post({"jsonrpc": "2.0", "id": self._id, "method": method, "params": params})
        if "error" in msg:
            raise CooeeError(f"{method}: {msg['error'].get('message', msg['error'])}")
        return msg["result"]

    def open(self) -> "Client":
        self._rpc("initialize", {"protocolVersion": PROTOCOL, "capabilities": {},
                                 "clientInfo": {"name": "asaya-d2c-dashboard", "version": "1"}})
        self._post({"jsonrpc": "2.0", "method": "notifications/initialized"}, notify=True)
        return self

    def tools(self) -> list[str]:
        return [t["name"] for t in self._rpc("tools/list", {}).get("tools", [])]

    def call(self, tool: str, args: dict):
        if tool not in READ_ONLY_TOOLS:
            raise CooeeError(f"{tool} is not on the read-only list")
        if self.session_id is None:
            self.open()
        t0, err, out = time.time(), None, None
        for attempt in range(self.retries):
            try:
                res = self._rpc("tools/call", {"name": tool, "arguments": args})
                if res.get("isError"):
                    raise CooeeError(f"{tool}: " + " ".join(c.get("text", "") for c in res.get("content", []))[:300])
                if isinstance(res.get("structuredContent"), dict):
                    out = res["structuredContent"]
                else:
                    text = "".join(c.get("text", "") for c in res.get("content", []) if c.get("type") == "text")
                    out = json.loads(text)
                err = None
                break
            except NotConnected:
                raise
            except (requests.RequestException, CooeeError, ValueError) as exc:
                err = exc
                if isinstance(exc, CooeeError) and "HTTP 4" in str(exc) and "HTTP 429" not in str(exc):
                    break  # a bad request will not get better
                time.sleep(min(30, 2 ** attempt))
        self.log.append({"tool": tool, "args": args, "ms": int((time.time() - t0) * 1000),
                         "status": "ok" if err is None else "error", "error": None if err is None else str(err)[:300],
                         "rows": _rows(out)})
        if err is not None:
            raise err if isinstance(err, CooeeError) else CooeeError(f"{tool}: {err}")
        return out


def _rows(out) -> int | None:
    if not isinstance(out, dict):
        return None
    for k in ("items", "rows", "products", "processedDays", "experiments", "campaigns", "variations"):
        if isinstance(out.get(k), list):
            return len(out[k])
    return None
