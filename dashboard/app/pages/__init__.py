"""Page builders. Each takes the shared Context and returns the JSON payload
served at /api/page/<tab>."""

from __future__ import annotations

from . import d1, daily, days, marketing, overview, products, range_data, region
from .common import Context

BUILDERS = {
    "overview": overview.build,
    "daily": daily.build,
    "marketing": marketing.build,
    "products": products.build,
    "d1": d1.build,
    "region": region.build_tab,
}


def build_all(
    data: dict, cfg: dict, enabled: list[str]
) -> tuple[dict, Context]:
    ctx = Context(data, cfg)
    pages = {tab: BUILDERS[tab](ctx) for tab in enabled if tab in BUILDERS}
    # Data for the browser's date-range picker; not a tab of its own.
    pages["days"] = days.build(ctx)
    pages["campaign_days"] = range_data.campaigns(ctx)
    pages["product_days"] = range_data.products(ctx)
    pages["meta_tree"] = range_data.meta_tree(ctx)
    pages["google_tree"] = range_data.google_tree(ctx)
    pages["channel_days"] = range_data.channels(ctx)
    pages["slab_days"] = range_data.slabs(ctx)
    pages["drill_days"] = range_data.drills(ctx)
    if "region" in pages:
        pages.update(region.build_data(ctx))
    return pages, ctx
