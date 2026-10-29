"""Page builders. Each takes the shared Context and returns the JSON payload
served at /api/page/<tab>."""

from __future__ import annotations

from . import d1, daily, marketing, overview, products
from .common import Context

BUILDERS = {
    "overview": overview.build,
    "daily": daily.build,
    "marketing": marketing.build,
    "products": products.build,
    "d1": d1.build,
}


def build_all(
    data: dict, cfg: dict, enabled: list[str]
) -> tuple[dict, Context]:
    ctx = Context(data, cfg)
    return {tab: BUILDERS[tab](ctx) for tab in enabled if tab in BUILDERS}, ctx
