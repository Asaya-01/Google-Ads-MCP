"""Experiment verdicts for the CRO tab: fixed rules, computed here, never by a
model.

  1. Invalid: split mismatch  chi-square test of visitors per arm against
                              the configured split, p < srm_p (0.001)
  2. Too early                fewer than min_days live, or an arm under
                              min_visitors visitors or min_orders orders
  3. Winner / Loser           orders per visitor, two-proportion z-test,
                              p < alpha (0.05)
  4. Inconclusive             otherwise

Cooee's own liftVsControl and p-value are used where it gives them (theme,
template, split-URL and price tests); for widget-vs-exclusion tests
(AB_TEST) they are computed here, and the card says which. Revenue per
visitor lift has no variance available, so it is shown as directional only.
"""

from __future__ import annotations

import datetime as dt
import math


def _chi2_sf(x: float, df: int) -> float:
    """P(chi-square with df degrees of freedom > x)."""
    if x <= 0:
        return 1.0
    if df == 1:
        return math.erfc(math.sqrt(x / 2))
    # regularised upper incomplete gamma Q(df/2, x/2), by series / continued fraction
    a, z = df / 2.0, x / 2.0
    if z < a + 1:
        term = s = 1.0 / a
        n = a
        for _ in range(500):
            n += 1
            term *= z / n
            s += term
            if abs(term) < abs(s) * 1e-12:
                break
        return max(0.0, 1.0 - s * math.exp(-z + a * math.log(z) - math.lgamma(a)))
    b, c, d = z + 1 - a, 1e300, 1.0 / (z + 1 - a)
    h = d
    for i in range(1, 500):
        an = -i * (i - a)
        b += 2
        d = an * d + b
        d = 1e-300 if abs(d) < 1e-300 else d
        c = b + an / c
        c = 1e-300 if abs(c) < 1e-300 else c
        d = 1.0 / d
        h *= d * c
        if abs(d * c - 1) < 1e-12:
            break
    return min(1.0, math.exp(-z + a * math.log(z) - math.lgamma(a)) * h)


def srm(visitors: list[float], splits: list[float]) -> dict:
    total, ssum = sum(visitors), sum(splits) or 1
    if total <= 0 or len(visitors) < 2:
        return {"chi2": None, "p": None}
    x = sum((v - total * s / ssum) ** 2 / (total * s / ssum) for v, s in zip(visitors, splits) if s > 0)
    return {"chi2": round(x, 3), "p": _chi2_sf(x, len(visitors) - 1)}


def two_prop(o1: float, n1: float, o2: float, n2: float) -> float | None:
    """Two-sided p-value of the difference in rates o1/n1 vs o2/n2."""
    if not (n1 and n2):
        return None
    p = (o1 + o2) / (n1 + n2)
    se = math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2)) if 0 < p < 1 else 0
    if not se:
        return None
    return math.erfc(abs(o1 / n1 - o2 / n2) / se / math.sqrt(2))


def arms(exp: dict) -> list[dict]:
    """Each arm as {key, name, control, split, visitors, sessions, orders,
    revenue, ...} whatever the experiment type."""
    out = []
    for v in exp.get("variations") or []:
        s = v.get("stats") or {}
        native = "visitors" in s
        visitors = s.get("visitors") if native else s.get("uniqueVisitors")
        orders = s.get("orders") if native else s.get("influencedOrders")
        revenue = s.get("revenue") if native else s.get("influencedRevenue")
        out.append({
            "key": v.get("key"), "name": (v.get("name") or "").strip(), "control": bool(v.get("isControl")),
            "split": v.get("split"), "visitors": visitors or 0, "orders": orders or 0, "revenue": float(revenue or 0),
            "sessions": s.get("sessions"), "impressions": s.get("impressions"), "interactions": s.get("interactions"),
            "cart_additions": s.get("cartAdditions"),
            # rates Cooee gives as percentages, kept as fractions here
            "atc_rate": s["addToCartRate"] / 100 if s.get("addToCartRate") is not None else None,
            "checkout_rate": s["checkoutRate"] / 100 if s.get("checkoutRate") is not None else None,
            "bounce_rate": s["bounceRate"] / 100 if s.get("bounceRate") is not None else None,
            "lift": v.get("liftVsControl"),
        })
    return out


def verdict(exp: dict, today: str, rules: dict) -> dict:
    a = arms(exp)
    ctrl = next((x for x in a if x["control"]), None)
    pub = (exp.get("publishedAt") or "")[:10]
    days_live = (dt.date.fromisoformat(today) - dt.date.fromisoformat(pub)).days if pub else None
    out = {"arms": a, "days_live": days_live, "source": None, "lift_opv": None, "lift_rpv": None, "p": None,
           "srm": None, "exposure": None, "verdict": "Not started", "why": ""}
    if not a or ctrl is None or exp.get("status") == "DRAFT":
        out["why"] = "draft or no control arm"
        return out
    out["srm"] = srm([x["visitors"] for x in a], [x["split"] or 0 for x in a])
    var = [x for x in a if not x["control"]]
    best = max(var, key=lambda x: x["visitors"]) if var else None
    if best and best["visitors"] and ctrl["visitors"]:
        opv_v, opv_c = best["orders"] / best["visitors"], ctrl["orders"] / ctrl["visitors"]
        rpv_v, rpv_c = best["revenue"] / best["visitors"], ctrl["revenue"] / ctrl["visitors"]
        if best.get("lift") and best["lift"].get("conversionRatePValue") is not None:
            out.update(source="Cooee", lift_opv=best["lift"].get("conversionRate", 0) / 100,
                       lift_rpv=(best["lift"].get("revenuePerVisitor") or 0) / 100, p=best["lift"]["conversionRatePValue"])
        else:
            out.update(source="computed", lift_opv=(opv_v / opv_c - 1) if opv_c else None,
                       lift_rpv=(rpv_v / rpv_c - 1) if rpv_c else None,
                       p=two_prop(best["orders"], best["visitors"], ctrl["orders"], ctrl["visitors"]))
        if best.get("impressions") is not None and best["visitors"]:
            out["exposure"] = best["impressions"] / best["visitors"] if best["impressions"] < best["visitors"] else None
    if out["srm"]["p"] is not None and out["srm"]["p"] < rules["srm_p"]:
        shares = ", ".join(f"{x['name'] or x['key']} {x['visitors'] / sum(y['visitors'] for y in a):.1%}" for x in a)
        out.update(verdict="Invalid: split mismatch", why=f"visitors split {shares} against the configured {'/'.join(str(x['split']) for x in a)}")
        return out
    small = [x for x in a if x["visitors"] < rules["min_visitors"] or x["orders"] < rules["min_orders"]]
    if days_live is not None and days_live < rules["min_days"] or small:
        out.update(verdict="Too early", why=(f"{days_live} days live" if days_live is not None and days_live < rules["min_days"]
                                            else f"{small[0]['name'] or small[0]['key']} has {small[0]['visitors']:,} visitors and {small[0]['orders']:,} orders"))
        return out
    if out["p"] is not None and out["p"] < rules["alpha"] and out["lift_opv"] is not None:
        out.update(verdict="Winner" if out["lift_opv"] > 0 else "Loser", why=f"orders per visitor {out['lift_opv']:+.1%}, p = {out['p']:.3f}")
    else:
        out.update(verdict="Inconclusive", why=f"orders per visitor {out['lift_opv']:+.1%}, p = {out['p']:.2f}" if out["p"] is not None else "no orders to compare")
    return out
