"""Alerts: a structured ERROR log entry (a Cloud Monitoring log-based alert
policy turns it into an email) and, optionally, a chat webhook."""

from __future__ import annotations

import json
import sys

import requests

from . import settings

ALERT_MARKER = "asaya-dashboard-alert"


def send(title: str, lines: list[str]) -> None:
    print(
        json.dumps(
            {
                "severity": "ERROR",
                "alert": ALERT_MARKER,
                "message": title,
                "details": lines,
            }
        ),
        file=sys.stderr,
        flush=True,
    )
    webhook = settings.env("ALERT_WEBHOOK_URL")
    if webhook:
        try:
            requests.post(
                webhook,
                json={"text": "\n".join([f"*{title}*", *lines])},
                timeout=15,
            )
        except requests.RequestException as exc:
            print(
                json.dumps(
                    {
                        "severity": "WARNING",
                        "message": f"Alert webhook failed: {exc}",
                    }
                ),
                file=sys.stderr,
            )


def log(message: str, **fields) -> None:
    print(
        json.dumps(
            {"severity": "INFO", "message": message, **fields}, default=str
        ),
        flush=True,
    )
