"""Days: the per-day facts for the whole history window, as compact columns.

Not a tab. The browser reads it to recompute any date range against any
comparison range (Shopify-style), with sale days compared to sale days and BAU
days to BAU days, without another round trip. Counts only: every rate is
recomputed from the counts in the browser, never averaged across days.
"""

from __future__ import annotations

from .common import COUNT_FIELDS, Context


def build(ctx: Context) -> dict:
    dates = sorted(ctx.facts)
    reasons: list[str] = []
    index: dict[str, int] = {}
    na: dict[str, dict[str, int]] = {}
    values: dict[str, list] = {}
    for k in COUNT_FIELDS:
        col = []
        for d in dates:
            f = ctx.facts[d]
            v = f.get(k)
            col.append(v)
            if v is None:
                why = f["na"].get(k)
                if why:
                    if why not in index:
                        index[why] = len(reasons)
                        reasons.append(why)
                    na.setdefault(k, {})[d] = index[why]
        values[k] = col
    return {
        "title": "Days",
        "as_of": ctx.d1,
        "dates": dates,
        "phase": [ctx.facts[d].get("phase") for d in dates],
        # why a day got its label; for a transition day, when the sale
        # went live or ended
        "phase_note": [ctx.facts[d].get("phase_basis") for d in dates],
        "phase_eff": [ctx.facts[d].get("phase_eff") for d in dates],
        "phase_source": ctx.phase_source,
        "events": ctx.sale_events,
        "fields": COUNT_FIELDS,
        "values": values,
        "na": na,
        "reasons": reasons,
    }
