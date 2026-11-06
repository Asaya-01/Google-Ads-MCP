"""Target vs achieved: the media plan's daily targets per channel block
(app.sheets.load_plan) for the browser, which sums them over the picked
dates and sets them against the dashboard's own numbers for the same days
(config media_plan.achieved says which field is which)."""

from __future__ import annotations

from .common import Context


def build(ctx: Context) -> dict:
    mp = ctx.cfg.get("media_plan") or {}
    plan = ctx.data.get("media_plan") or {}
    return {
        "title": "Media plan",
        "as_of": ctx.d1,
        # {date: {block: [target spend, target GMV]}}
        "days": {d: plan[d] for d in sorted(plan)},
        "achieved": mp.get("achieved") or {},
        "na": (ctx.data.get("unavailable") or {}).get("media_plan"),
    }
