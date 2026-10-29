"""Root-cause commentary for the D-1 tab, written by Claude once per refresh.

The model sees only the numbers on the D-1 page. It is told not to invent
causes; checkout-side movements need the Shopify Changes Tracker, which the
dashboard does not read yet, so the model must say so instead of guessing.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json

from . import secrets

SYSTEM = """You are the Head of D2C at Asaya, an Indian skincare brand (worldofasaya.com), reviewing yesterday's website funnel before the morning stand-up.

You get the D-1 tab of the internal dashboard as JSON: a current window and a phase-matched prior window (BAU vs BAU, or sale vs sale), their totals, the change between them, and drill-downs by channel, source, campaign, landing page and product.

Write the commentary management reads:
- Open with one line on the headline movement (revenue, orders, CVR) against the prior window.
- Then 3 to 6 bullets. Each names what changed, where it came from (channel, then source, then the specific campaign or landing page or product), why the data says it moved, and one action the team can take today.
- Every percentage to 2 decimal places. Use Rs and Indian digit grouping (e.g. Rs 3,47,336).
- When "basis" is "per_day", the windows differ in length: compare per-day values and rates, not totals.
- Use only the numbers in the JSON. If a cause is not visible in the data, say which split would explain it instead of guessing.
- Checkout-side movements (ATC to IC, IC to orders) need the Shopify Changes Tracker, which this dashboard does not read yet. Flag them as needing that check; never assume a checkout cause.
- Plain text with "- " bullets. No headings, no preamble, under 300 words."""


def _summary(page: dict) -> dict:
    def trim(rows, k=8):
        return sorted(rows, key=lambda r: -abs(r.get("change") or 0))[:k]

    return {
        "as_of": page["as_of"],
        "phase": page["phase"],
        "basis": page["basis"],
        "window_note": page["window_note"],
        "prior": {
            "start": page["prior"]["start"],
            "end": page["prior"]["end"],
            "total": page["prior"]["total"],
        },
        "current": {
            "start": page["current"]["start"],
            "end": page["current"]["end"],
            "total": page["current"]["total"],
            "days": page["current"]["rows"],
        },
        "delta": page["delta"],
        "unavailable": page["current"]["na"],
        "drilldowns": {k: trim(v) for k, v in page["drilldowns"].items()},
    }


def fingerprint(page: dict) -> str:
    return hashlib.sha256(
        json.dumps(_summary(page), sort_keys=True, default=str).encode()
    ).hexdigest()[:16]


def generate(page: dict, cfg: dict) -> dict:
    if not cfg.get("enabled"):
        return {"text": None, "na": "Commentary is turned off in config.json"}
    api_key = secrets.get_secret(cfg["api_key_secret"])
    if not api_key:
        return {
            "text": None,
            "na": f"Anthropic API key not in Secret Manager ({cfg['api_key_secret']})",
        }

    import anthropic

    client = anthropic.Anthropic(api_key=api_key)
    try:
        resp = client.beta.messages.create(
            model=cfg["model"],
            max_tokens=16000,
            output_config={"effort": cfg["effort"]},
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            system=SYSTEM,
            messages=[
                {
                    "role": "user",
                    "content": json.dumps(_summary(page), default=str),
                }
            ],
        )
    except anthropic.APIStatusError as exc:
        return {"text": None, "na": f"Claude API error {exc.status_code}"}
    except anthropic.APIConnectionError:
        return {"text": None, "na": "Could not reach the Claude API"}
    if resp.stop_reason == "refusal":
        return {
            "text": None,
            "na": "The model declined to write commentary for this payload",
        }
    text = "".join(b.text for b in resp.content if b.type == "text").strip()
    return {
        "text": text or None,
        "na": None if text else "The model returned no text",
        "model": resp.model,
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(
            timespec="seconds"
        ),
        "fingerprint": fingerprint(page),
    }
