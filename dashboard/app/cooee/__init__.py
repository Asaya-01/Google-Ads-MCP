"""Cooee (on-site CRO / personalisation) data for the CRO tab, read from
Cooee's MCP server with fixed tool calls. No model is involved anywhere in
moving the data: app/cooee/mcp.py is a plain JSON-RPC client."""

from __future__ import annotations

from functools import lru_cache

from .. import settings


@lru_cache(maxsize=1)
def config() -> dict:
    return settings.config()["cro"]
