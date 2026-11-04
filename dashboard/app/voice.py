"""Speech to text for Ask Claude's mic.

The browser records the question as 16 kHz mono PCM and posts it here; this
sends it to Google Cloud Speech-to-Text in the dashboard's own GCP project, in
Indian English, with the dashboard's vocabulary (metrics, channels, product
names and codes) boosted so "ROAS", "PMax" or "Underarm Mist" come out right.
Audio is not stored anywhere; only the text goes back to the browser.
"""

from __future__ import annotations

import base64

from . import settings

URL = "https://speech.googleapis.com/v1/speech:recognize"
SCOPE = "https://www.googleapis.com/auth/cloud-platform"
MAX_SECONDS = 60  # the synchronous API's limit
RATE = 16000

# words the team says that general speech models get wrong
BASE_PHRASES = [
    "revenue", "GMV", "orders", "sessions", "perf sessions", "performance",
    "awareness", "all campaigns", "spends", "spend", "ROAS", "RoAS", "MER",
    "AOV", "CVR", "conversion rate", "CPS", "CPM", "CTR", "CPC", "CPA",
    "add to cart", "ATC", "IC", "initiated checkout", "checkout",
    "GoKwik", "Shopify", "Meta", "Facebook", "Google Ads", "Reddit",
    "PMax", "Performance Max", "Brand PMax", "Non-brand PMax", "Brand Search",
    "Demand Gen", "YouTube", "affiliate", "CRM", "flows", "broadcast",
    "TOF", "MOF", "BOF", "catalog", "funnel", "campaign", "ad set", "creative",
    "D-1", "D minus one", "BAU", "sale", "sale days", "BAU days", "burst",
    "month to date", "last month", "yesterday", "today", "so far today",
    "lakh", "lakhs", "crore", "rupees", "basket size", "buy two", "buy three",
    "new vs repeat", "repeat customers", "retention", "landing page", "UTM",
    "Asaya", "SKU", "SKUs",
]


def phrases(cfg: dict) -> list[str]:
    """The vocabulary to boost: the base list plus every product and set
    name and code in config.json, so new products are covered automatically."""
    out = list(BASE_PHRASES)
    tx = cfg.get("taxonomy", {})
    for p in tx.get("products", []) + tx.get("sets", []):
        code = p.get("code")
        label = p.get("label") or ""
        if code:
            out.append(code)
        # "UAS · Even Tone Underarm Mist" -> "Even Tone Underarm Mist"
        name = label.split("·")[-1].strip()
        if name:
            out.append(name[:100])
    seen, uniq = set(), []
    for x in out:
        k = x.lower()
        if k not in seen:
            seen.add(k)
            uniq.append(x)
    return uniq[:500]


class VoiceError(Exception):
    def __init__(self, status: int, text: str):
        super().__init__(text)
        self.status = status
        self.text = text


def _session():
    import google.auth
    from google.auth.transport.requests import AuthorizedSession

    creds, _ = google.auth.default(scopes=[SCOPE])
    return AuthorizedSession(creds)


def transcribe(audio_b64: str, vcfg: dict, session=None) -> str:
    """Text for 16 kHz mono LINEAR16 audio. Raises VoiceError with the HTTP
    status to return and a reason a person can act on."""
    try:
        raw = base64.b64decode(audio_b64 or "", validate=True)
    except (ValueError, TypeError):
        raise VoiceError(400, "The recording could not be read.")
    seconds = len(raw) / (RATE * 2)
    if seconds < 0.3:
        raise VoiceError(400, "The recording was too short.")
    if seconds > vcfg.get("max_seconds", MAX_SECONDS) + 1:
        raise VoiceError(413, "Recordings are limited to a minute.")
    session = session or _session()
    base = {
        "encoding": "LINEAR16",
        "sampleRateHertz": RATE,
        "audioChannelCount": 1,
        "languageCode": vcfg.get("language", "en-IN"),
        "enableAutomaticPunctuation": True,
        "maxAlternatives": 1,
        "speechContexts": [
            {"phrases": phrases(settings.config()), "boost": vcfg.get("boost", 12)}
        ],
    }
    models = [vcfg.get("model", "latest_long"), None]
    last = None
    for model in models:
        body = {
            "config": {**base, **({"model": model} if model else {})},
            "audio": {"content": base64.b64encode(raw).decode()},
        }
        r = session.post(URL, json=body, timeout=60)
        if r.status_code == 200:
            results = (r.json() or {}).get("results") or []
            text = " ".join(
                (res.get("alternatives") or [{}])[0].get("transcript", "").strip()
                for res in results
            ).strip()
            return text
        last = r
        # a model this language does not offer: try the default model
        if r.status_code == 400 and model:
            continue
        break
    try:
        msg = (last.json().get("error") or {}).get("message", "")
    except ValueError:
        msg = ""
    if last.status_code in (401, 403):
        raise VoiceError(
            503,
            "Google Speech-to-Text is not enabled for the dashboard yet "
            f"({msg[:160] or last.status_code}).",
        )
    raise VoiceError(502, f"Speech-to-Text error {last.status_code}: {msg[:200]}")
