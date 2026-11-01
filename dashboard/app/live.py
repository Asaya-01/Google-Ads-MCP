"""Live "Today" tab: what is happening right now, without touching D-1.

A Cloud Run job runs every 15 minutes through the day and writes
pages/live.json. D-1 stays the verified source of truth; nothing here feeds it.

What each source can give, honestly:
  - Shopify orders and sessions: the API, so near real time.
  - Meta and Google Ads: the platforms' own APIs; their reporting usually
    trails real time by 15 to 60 minutes and purchases attribute late, so
    today's ROAS is partial.
  - GoKwik checkout funnel: only as fresh as the bot's load into BigQuery
    (its age is shown on screen). Rates are compared, not counts, because the
    load is a snapshot.

Comparisons: today so far against the same time yesterday, and against the
median of recent same-weekday days of the same phase (sale with sale, BAU
with BAU), so "up 20%" never means "a sale day against a quiet one".

Usage:
  python -m app.live            # normal scheduled run
"""

from __future__ import annotations

import argparse
import datetime as dt
import re
import statistics
import sys
from zoneinfo import ZoneInfo

from . import alerts, bq, google_ads, meta, rules, secrets, settings
from .shopify import Shopify
from .store import default_store

IST = ZoneInfo("Asia/Kolkata")
KEYS = ("orders", "gmv", "sessions", "atc")


# ------------------------------------------------------------------ helpers


def ratio(a, b):
    return rules.ratio(a, b)


def delta(value, base):
    """value / base - 1, or None when either is unknown or base is zero."""
    if value is None or base in (None, 0):
        return None
    return value / base - 1


def cum_at(hourly: list[float], t: float) -> float:
    """Running total of 24 hourly values at time t (hours since midnight),
    spreading the current hour evenly."""
    if t >= 24:
        return float(sum(hourly))
    h = int(t)
    return float(sum(hourly[:h]) + (t - h) * hourly[h])


def order_hours(
    orders: list[dict], day: str, exclude_regex: str
) -> tuple[list[int], list[float]]:
    """Hourly order count and GMV for one IST day from API orders, using the
    same valid-order rule as D-1 (not test, not cancelled, not a sample or
    influencer order)."""
    rx = re.compile(exclude_regex)
    counts, gmv = [0] * 24, [0.0] * 24
    for o in orders:
        if o["test"] or o["cancelled"] or rx.search(o["name"].upper()):
            continue
        at = dt.datetime.fromisoformat(o["created_at"].replace("Z", "+00:00"))
        at = at.astimezone(IST)
        if at.date().isoformat() != day:
            continue
        counts[at.hour] += 1
        gmv[at.hour] += o["total"]
    return counts, gmv


def metrics_at(arrays: dict, t: float) -> dict:
    """Everything the tiles show for one day at time t."""
    m = {k: cum_at(arrays[k], t) for k in KEYS}
    m["aov"] = ratio(m["gmv"], m["orders"])
    m["cvr"] = ratio(m["orders"], m["sessions"])
    m["atc_rate"] = ratio(m["atc"], m["sessions"])
    return m


def typical_at(days: list[dict], t: float) -> dict:
    """Median of each metric across baseline days, each read at time t."""
    per = [metrics_at(d, t) for d in days]
    out = {}
    for k in (*KEYS, "aov", "cvr", "atc_rate"):
        vals = [p[k] for p in per if p[k] is not None]
        out[k] = statistics.median(vals) if vals else None
    return out


def pick_typical(
    today: dt.date,
    phases: dict[str, str],
    phase: str | None,
    have: list[str],
    lcfg: dict,
) -> tuple[list[str], str, bool]:
    """Recent same-weekday days to call typical: the same phase as today when
    there are enough, else the same weekday regardless (flagged as mixed)."""
    same_wd = sorted(
        (
            d
            for d in have
            if d < today.isoformat()
            and dt.date.fromisoformat(d).weekday() == today.weekday()
        ),
        reverse=True,
    )
    if phase:
        same = [d for d in same_wd if phases.get(d) == phase]
        if len(same) >= lcfg["min_typical_days"]:
            return same[: lcfg["typical_days"]], phase, False
    return same_wd[: lcfg["typical_days"]], phase or "unknown", True


def live_regime(
    today_hours: list[float],
    base: dict,
    phases: dict[str, str],
    now: dt.datetime,
    cfg: dict,
) -> tuple[float | None, str | None]:
    """Read today's regime from the last three complete hours of orders against
    the same hours on recent BAU days: a sale goes live in the evening, and
    orders jump several times over at that moment. Returns (ratio, regime)
    where regime is "sale", "bau" or None when it cannot tell."""
    h = now.hour
    if h < 3:
        return None, None
    lo = h - 3
    bau = [d for d in base if phases.get(d) == "bau"]
    if len(bau) < 3:
        return None, None
    ref = statistics.median(sum(base[d]["orders"][lo:h]) for d in bau)
    recent = sum(today_hours[lo:h])
    if ref < 5:
        return None, None
    ratio = recent / ref
    on = cfg["hourly"]["on_ratio"]
    if ratio >= on and recent >= 20:
        return ratio, "sale"
    if ratio <= cfg["hourly"]["off_ratio"] - 0.1:
        return ratio, "bau"
    return ratio, None


def estimate_other_spend(
    days: dict,
    assumed: str | None,
    gmv_now: float | None,
    t: float,
    cfg: dict,
) -> dict:
    """Today's spend so far on the channels that have no live source.

    The sheets are filled in with a lag, so yesterday's number is usually not
    there yet; the basis is the most recent filled days of the same kind (sale
    with sale, BAU with BAU), falling back to any kind when there are too few.
      per_hour: CRM sends go out through the day, so a typical day's spend x
                the share of the day gone (hours so far / 24).
      per_gmv : affiliate cost follows sales, so its share of GMV on those
                days x today's GMV so far.
    Returns {channel: {"value", "basis", "dates"}} and a "total"."""
    mcfg = cfg["manual_spends"]["live_estimate"]
    n = mcfg["basis_days"]
    out: dict = {"affiliate": None, "crm": None, "total": None}
    if not days or not days.get("dates"):
        return out
    dates, phase = days["dates"], days.get("phase") or []

    def pick(field: str, need_gmv: bool = False):
        rows = [
            i
            for i in range(len(dates))
            if days["values"][field][i] is not None
            and (not need_gmv or days["values"]["gmv"][i])
        ]
        same = [i for i in rows if assumed and phase[i] == assumed]
        use = same if len(same) >= 3 else rows
        kind = assumed if use is same and assumed else "any kind of"
        use = use[-n:]
        return use, kind

    parts = []
    for ch, field, how in (
        ("affiliate", "affiliate_spend", mcfg["affiliate"]),
        ("crm", "crm_spend", mcfg["crm"]),
    ):
        use, kind = pick(field, need_gmv=how == "per_gmv")
        if len(use) < 2:
            continue
        span = f"{dates[use[0]]} to {dates[use[-1]]}"
        label = {"bau": "BAU", "sale": "sale"}.get(kind, kind)
        if how == "per_gmv":
            gmv = sum(days["values"]["gmv"][i] for i in use)
            share = sum(days["values"][field][i] for i in use) / gmv
            if gmv_now is None:
                continue
            value = share * gmv_now
            basis = (
                f"{share * 100:.1f}% of GMV, from {len(use)} {label} days "
                f"({span}), x today's GMV so far"
            )
        else:
            daily = statistics.median(days["values"][field][i] for i in use)
            value = daily * min(t, 24) / 24
            basis = (
                f"a typical {label} day's Rs {daily:,.0f} (median of "
                f"{len(use)} days, {span}) x {min(t, 24):.1f}/24 of the day"
            )
        out[ch] = {
            "value": value,
            "basis": basis,
            "dates": [dates[i] for i in use],
        }
        parts.append(value)
    if len(parts) == 2:
        out["total"] = sum(parts)
    return out


def curve(hourly: list[float], upto: int | None) -> list[float | None]:
    """Running total at the end of each hour; None after hour `upto`."""
    out, run = [], 0.0
    for h in range(24):
        run += hourly[h]
        out.append(round(run, 2) if upto is None or h <= upto else None)
    return out


def median_curve(days: list[dict], key: str) -> list[float | None]:
    if not days:
        return [None] * 24
    cs = [curve(d[key], None) for d in days]
    return [round(statistics.median(c[h] for c in cs), 2) for h in range(24)]


# --------------------------------------------------------------------- ads


def _ad_totals(rows: list[dict], cfg: dict, value_key: str, count_key: str):
    """Spend, Awareness-free ("Perf") spend and value, and a campaign table."""
    scfg = cfg["sessions"]
    camps: dict[str, dict] = {}
    for r in rows:
        name = r.get("campaign_name") or "(unnamed)"
        c = camps.setdefault(
            name,
            {
                "campaign": name,
                "awareness": rules.is_awareness_name(name, scfg),
                "spend": 0.0,
                "value": 0.0,
                "results": 0.0,
                "clicks": 0,
            },
        )
        c["spend"] += r.get("spend") or 0
        c["value"] += r.get(value_key) or 0
        c["results"] += r.get(count_key) or 0
        c["clicks"] += r.get("clicks") or 0
    table = sorted(camps.values(), key=lambda c: -c["spend"])
    perf = [c for c in table if not c["awareness"]]
    out = {
        "spend": sum(c["spend"] for c in table),
        "perf_spend": sum(c["spend"] for c in perf),
        "perf_value": sum(c["value"] for c in perf),
        "results": sum(c["results"] for c in perf),
    }
    out["roas"] = ratio(out["perf_value"], out["perf_spend"])
    for c in table:
        c["roas"] = None if c["awareness"] else ratio(c["value"], c["spend"])
    return out, table


def ads_block(
    rows: list[dict] | None,
    today: str,
    yesterday: str,
    cfg: dict,
    value_key: str,
    count_key: str,
    reason: str | None,
) -> dict:
    if rows is None:
        return {"na": reason or "not available"}
    t, table = _ad_totals(
        [r for r in rows if r["date"] == today], cfg, value_key, count_key
    )
    y, _ = _ad_totals(
        [r for r in rows if r["date"] == yesterday], cfg, value_key, count_key
    )
    has_today = any(r["date"] == today for r in rows)
    has_yday = any(r["date"] == yesterday for r in rows)
    return {
        "today": t if has_today else None,
        "yesterday": y if has_yday else None,
        "spend_pct_of_yesterday": (
            ratio(t["spend"], y["spend"]) if has_today and has_yday else None
        ),
        "campaigns": table[:15],
        "na": None if has_today else "no spend reported for today yet",
    }


# --------------------------------------------------------------------- page


def build(inp: dict, cfg: dict, now: dt.datetime) -> dict:
    """The live page from collected inputs. Pure: no network, no clock."""
    lcfg = cfg["live"]
    today = now.date().isoformat()
    yesterday = (now.date() - dt.timedelta(days=1)).isoformat()
    t = now.hour + now.minute / 60 + now.second / 3600
    base = inp["base"]  # {date: {orders, gmv, sessions, atc}}
    unavailable = dict(inp.get("unavailable") or {})
    notes: list[str] = []

    phases = inp.get("phases") or {}
    phases_eff = inp.get("phases_eff") or phases
    overrides = cfg.get("phases", {}).get("overrides") or {}
    assumed = overrides.get(today) or (
        phases_eff.get(yesterday) or phases.get(yesterday)
    )
    regime_note = None
    if inp.get("today") is not None and today not in overrides:
        lr, regime = live_regime(
            inp["today"]["orders"], base, phases, now, cfg["phases"]
        )
        if regime == "sale" and assumed != "sale":
            assumed = "sale"
            regime_note = (
                f"Orders over the last 3 hours are {lr:.1f}x a normal BAU "
                "day at this time, so a sale looks to have gone live: today is "
                "being compared with sale days."
            )
        elif regime == "bau" and assumed == "sale":
            assumed = "bau"
            regime_note = (
                f"Orders over the last 3 hours are back to {lr:.1f}x normal, "
                "so the sale looks to be over: today is being compared with "
                "BAU days."
            )
    typ_dates, typ_phase, mixed = pick_typical(
        now.date(), phases, assumed, list(base), lcfg
    )
    weekday = now.strftime("%A")
    if regime_note:
        notes.append(regime_note)
    elif assumed:
        why = (
            "set in config.json" if today in overrides else "same as yesterday"
        )
        notes.append(
            f"Today is being treated as a {assumed} day ({why}). If that is "
            "wrong, set today in phases.overrides in config.json; the "
            "typical-day comparison then uses the right kind of day."
        )
    if mixed:
        notes.append(
            f"Fewer than {lcfg['min_typical_days']} recent {weekday}s were "
            f"{assumed or 'of a known phase'} days, so the typical {weekday} "
            "mixes sale and BAU days. Read it with care."
        )
    for key, reason in (inp.get("notes") or {}).items():
        notes.append(reason)

    # -- shopify: tiles and curves ---------------------------------------
    shopify = None
    today_arr = inp.get("today")
    if today_arr is not None:
        if not today_arr.get("sessions_ok", True):
            unavailable.setdefault(
                "shopify_sessions", "Shopify sessions were not available"
            )
        yday = base.get(yesterday)
        typ_days = [base[d] for d in typ_dates]
        now_m = metrics_at(today_arr, t)
        yday_m = metrics_at(yday, t) if yday else None
        typ_m = typical_at(typ_days, t) if typ_days else None
        tiles = []
        for key, label, unit in (
            ("orders", "Orders", "int"),
            ("gmv", "GMV", "inr"),
            ("aov", "AOV", "inr"),
            ("sessions", "Sessions", "int"),
            ("cvr", "Conversion rate", "pct"),
            ("atc_rate", "Add-to-cart rate", "pct"),
        ):
            sess_dep = key in ("sessions", "cvr", "atc_rate")
            na = (
                unavailable.get("shopify_sessions")
                if sess_dep and "shopify_sessions" in unavailable
                else None
            )
            tiles.append(
                {
                    "key": key,
                    "label": label,
                    "unit": unit,
                    "na": na,
                    "value": None if na else now_m[key],
                    "yesterday": yday_m[key] if yday_m else None,
                    "typical": typ_m[key] if typ_m else None,
                    "vs_yesterday": delta(now_m[key], yday_m and yday_m[key]),
                    "vs_typical": delta(now_m[key], typ_m and typ_m[key]),
                }
            )
        upto = now.hour
        shopify = {
            "tiles": tiles,
            "curves": {
                "hours": list(range(24)),
                "series": {
                    key: {
                        "today": curve(today_arr[key], upto),
                        "yesterday": curve(yday[key], None) if yday else None,
                        "typical": (
                            median_curve(typ_days, key) if typ_days else None
                        ),
                    }
                    for key in ("gmv", "orders", "sessions")
                },
            },
            "typical_dates": typ_dates,
            "typical_label": (
                f"Typical {weekday} · "
                f"{'BAU' if typ_phase == 'bau' else typ_phase} · "
                f"{len(typ_dates)} recent day{'s' if len(typ_dates) != 1 else ''}"
            ),
            "yesterday_label": "Yesterday, same time",
        }
    else:
        unavailable.setdefault("shopify_orders", "Shopify orders not pulled")

    # -- checkout (GoKwik) -------------------------------------------------
    gk = inp.get("gokwik")
    gokwik = {"na": unavailable.get("gokwik", "GoKwik data not available")}
    if gk is not None:
        rows = gk["rows"]
        td = rows.get(today)
        past = [rows[d] for d in sorted(rows) if d < today][-7:]

        def steps(r):
            return [
                ("Checkout started", r["checkout_started"], None),
                (
                    "Reached address",
                    r["address_landed"],
                    ratio(r["address_landed"], r["checkout_started"]),
                ),
                (
                    "Reached payment",
                    r["payment_step_reached"],
                    ratio(r["payment_step_reached"], r["address_landed"]),
                ),
                (
                    "Converted",
                    r["converted"],
                    ratio(r["converted"], r["payment_step_reached"]),
                ),
            ]

        if td and td.get("checkout_started"):
            pooled = {
                k: sum(p[k] or 0 for p in past)
                for k in (
                    "checkout_started",
                    "address_landed",
                    "payment_step_reached",
                    "converted",
                )
            }
            typ_steps = steps(pooled) if past else None
            age = None
            if td.get("loaded_at"):
                loaded = dt.datetime.fromisoformat(td["loaded_at"])
                if loaded.tzinfo is None:
                    loaded = loaded.replace(tzinfo=dt.timezone.utc)
                age = max(0, int((now - loaded).total_seconds() // 60))
            gokwik = {
                "loaded_at": td.get("loaded_at"),
                "age_minutes": age,
                "stale": age is not None
                and age > lcfg["stale_minutes"]["gokwik"],
                "overall": ratio(td["converted"], td["checkout_started"]),
                "overall_typical": (
                    ratio(pooled["converted"], pooled["checkout_started"])
                    if past
                    else None
                ),
                "steps": [
                    {
                        "label": label,
                        "count": count,
                        "rate": rate,
                        "typical": typ_steps[i][2] if typ_steps else None,
                        "delta": (
                            delta(rate, typ_steps[i][2]) if typ_steps else None
                        ),
                    }
                    for i, (label, count, rate) in enumerate(steps(td))
                ],
                "typical_days": len(past),
                "na": None,
            }
        else:
            gokwik = {
                "na": (
                    "GoKwik has not loaded any rows for today yet. The live "
                    "checkout view needs the BigQuery load to run through the "
                    "day (planned every 30 minutes)."
                )
            }

    # -- ads ---------------------------------------------------------------
    meta_rows = inp.get("meta_rows")
    google_rows = inp.get("google_rows")
    meta_blk = ads_block(
        meta_rows,
        today,
        yesterday,
        cfg,
        "purchase_value",
        "purchases",
        unavailable.get("meta"),
    )
    google_blk = ads_block(
        google_rows,
        today,
        yesterday,
        cfg,
        "conversion_value",
        "conversions",
        unavailable.get("google"),
    )

    # -- returns cards (same definitions as the D-1 pulse) ------------------
    gmv_now = next(
        (
            x["value"]
            for x in (shopify or {}).get("tiles", [])
            if x["key"] == "gmv"
        ),
        None,
    )
    ybase = base.get(yesterday)
    gmv_y = sum(ybase["gmv"]) if ybase else None

    def side(blk, k):
        return (blk.get("today") or {}).get(k), (
            blk.get("yesterday") or {}
        ).get(k)

    m_t, m_y = side(meta_blk, "roas")
    g_t, g_y = side(google_blk, "roas")
    spend_t = (
        (meta_blk["today"]["spend"] + google_blk["today"]["spend"])
        if meta_blk.get("today") and google_blk.get("today")
        else None
    )
    spend_y = (
        (meta_blk["yesterday"]["spend"] + google_blk["yesterday"]["spend"])
        if meta_blk.get("yesterday") and google_blk.get("yesterday")
        else None
    )
    perf_t = (
        (meta_blk["today"]["perf_spend"] + google_blk["today"]["perf_spend"])
        if meta_blk.get("today") and google_blk.get("today")
        else None
    )
    perf_y = (
        (
            meta_blk["yesterday"]["perf_spend"]
            + google_blk["yesterday"]["perf_spend"]
        )
        if meta_blk.get("yesterday") and google_blk.get("yesterday")
        else None
    )
    est = estimate_other_spend(inp.get("days_manual"), assumed, gmv_now, t, cfg)
    dm = inp.get("days_manual") or {}
    y_overall = None
    if yesterday in (dm.get("dates") or []):
        i = dm["dates"].index(yesterday)
        y_overall = ratio(dm["values"]["gmv"][i], dm["values"]["all_spend"][i])
    all_t = (
        spend_t + est["total"]
        if spend_t is not None and est["total"] is not None
        else None
    )
    cards = []
    for key, label, v, y, sub, na in (
        (
            "meta_roas",
            "Meta ROAS",
            m_t,
            m_y,
            "Meta-reported purchase value / sales-campaign spend",
            meta_blk.get("na"),
        ),
        (
            "google_roas",
            "Google Ads ROAS",
            g_t,
            g_y,
            "Google-reported conversion value / sales-campaign spend",
            google_blk.get("na"),
        ),
        (
            "perf_roas",
            "Shopify ROAS (Perf)",
            ratio(gmv_now, perf_t),
            ratio(gmv_y, perf_y),
            "Shopify GMV so far / sales-campaign spend so far",
            None if perf_t is not None else "ad spend for today is not in yet",
        ),
        (
            "mer",
            "MER",
            ratio(gmv_now, spend_t),
            ratio(gmv_y, spend_y),
            "Shopify GMV so far / Meta + Google spend so far",
            None if spend_t is not None else "ad spend for today is not in yet",
        ),
        (
            "overall_roas",
            "Overall ROAS (est.)",
            ratio(gmv_now, all_t),
            y_overall,
            "Shopify GMV so far / Meta + Google (actual) + affiliate + CRM (estimated)",
            (
                "ad spend for today is not in yet"
                if spend_t is None
                else "there are not enough filled days in the affiliate and CRM sheets to estimate them"
            ),
        ),
    ):
        cards.append(
            {
                "key": key,
                "label": label,
                "value": v,
                "yesterday": y,
                "delta": delta(v, y),
                "sub": sub,
                "na": None if v is not None else na,
            }
        )

    # -- sources and freshness ----------------------------------------------
    stale = lcfg["stale_minutes"]
    sources = [
        {
            "key": "shopify",
            "label": "Shopify orders & sessions",
            "as_of": now.isoformat(timespec="seconds"),
            "note": "Live from the Shopify API",
            "ok": "shopify_orders" not in unavailable,
            "reason": unavailable.get("shopify_orders"),
        },
        {
            "key": "meta",
            "label": "Meta Ads",
            "as_of": now.isoformat(timespec="seconds"),
            "note": "Meta reports 15 to 60 minutes behind; purchases attribute late",
            "ok": "meta" not in unavailable,
            "reason": unavailable.get("meta"),
        },
        {
            "key": "google",
            "label": "Google Ads",
            "as_of": now.isoformat(timespec="seconds"),
            "note": "Google reports with a delay; conversions attribute late",
            "ok": "google" not in unavailable,
            "reason": unavailable.get("google"),
        },
        {
            "key": "gokwik",
            "label": "GoKwik checkout",
            "as_of": gokwik.get("loaded_at"),
            "note": (
                "As fresh as the BigQuery load"
                + (
                    f" (loaded {gokwik['age_minutes']} min ago)"
                    if gokwik.get("age_minutes") is not None
                    else ""
                )
            ),
            "ok": not gokwik.get("na") and not gokwik.get("stale"),
            "reason": gokwik.get("na")
            or (
                f"last load was {gokwik['age_minutes']} minutes ago"
                if gokwik.get("stale")
                else None
            ),
        },
    ]
    notes.append(
        "Today's ad numbers are partial: platforms report late and "
        "attribute purchases after the fact, so today's ROAS usually "
        "improves by tomorrow. Compare spend as a share of yesterday's."
    )
    return {
        "title": "Today (live)",
        "today": today,
        "weekday": weekday,
        "as_of": None,
        "hour_now": round(t, 2),
        "generated_at": now.isoformat(timespec="seconds"),
        "refresh_seconds": lcfg["refresh_seconds"],
        "assumed_phase": assumed,
        "shopify": shopify,
        "gokwik": gokwik,
        "meta": meta_blk,
        "google": google_blk,
        "cards": cards,
        "spend_breakdown": [
            {
                "label": "Meta",
                "value": (meta_blk.get("today") or {}).get("spend"),
                "kind": "actual",
                "note": "from Meta's API, a little behind real time",
            },
            {
                "label": "Google Ads",
                "value": (google_blk.get("today") or {}).get("spend"),
                "kind": "actual",
                "note": "from Google's API",
            },
            {
                "label": "Affiliate",
                "value": (est["affiliate"] or {}).get("value"),
                "kind": "estimate",
                "note": (est["affiliate"] or {}).get("basis")
                or "not enough filled days in the sheet to estimate",
            },
            {
                "label": "CRM (flow + broadcast)",
                "value": (est["crm"] or {}).get("value"),
                "kind": "estimate",
                "note": (est["crm"] or {}).get("basis")
                or "not enough filled days in the sheets to estimate",
            },
            {
                "label": "All channels",
                "value": all_t,
                "kind": "estimate",
                "note": "actual Meta and Google plus the two estimates",
            },
        ],
        "unavailable": unavailable,
        "sources": sources,
        "notes": notes,
    }


# --------------------------------------------------------------- collection


def _shop(cfg: dict) -> Shopify:
    scfg = cfg["shopify"]
    cid = secrets.get_secret(scfg["client_id_secret"])
    sec = secrets.get_secret(scfg["client_secret_secret"])
    if not (cid and sec):
        raise RuntimeError("Shopify client ID / secret not in Secret Manager")
    return Shopify(scfg["store"], scfg["api_version"], cid, sec)


def baseline(
    cfg: dict, store, shop: Shopify, now: dt.datetime, notes: dict
) -> dict:
    """Hourly orders, GMV, sessions and add-to-carts for yesterday and the
    recent same-weekday days. Built once a day and cached: past days do not
    change, and yesterday is rebuilt on the first run of each day so a late
    BigQuery sync is picked up."""
    lcfg = cfg["live"]
    today = now.date()
    yesterday = today - dt.timedelta(days=1)
    wanted = {yesterday.isoformat()}
    for w in range(1, lcfg["typical_weeks"] + 1):
        d = today - dt.timedelta(days=7 * w)
        wanted.add(d.isoformat())
    cache = store.get_json("cache/live/baseline.json") or {"days": {}}
    days = cache.get("days", {})
    first_run_today = cache.get("built") != today.isoformat()
    todo = [
        d
        for d in sorted(wanted)
        if d not in days or (first_run_today and d == yesterday.isoformat())
    ]
    if todo:
        rows = bq.run(
            "orders_hourly",
            start_date=dt.date.fromisoformat(todo[0]),
            end_date=yesterday,
            exclude_name_regex=cfg["orders"]["exclude_name_regex"],
        )
        by_day: dict[str, dict] = {}
        for r in rows:
            d = by_day.setdefault(
                r["date"], {"orders": [0] * 24, "gmv": [0.0] * 24}
            )
            d["orders"][int(r["hour"])] = int(r["orders"])
            d["gmv"][int(r["hour"])] = float(r["gmv"] or 0)
        for d in todo:
            day = by_day.get(d)
            if not day:
                continue
            try:
                s, a, _ = shop.sessions_hourly(d)
            except Exception as exc:  # keep the day, without the funnel part
                notes[f"sessions_{d}"] = (
                    f"Shopify hourly sessions for {d} unavailable: {exc}"
                )
                continue
            days[d] = {**day, "sessions": s, "atc": a}
    keep = {d: v for d, v in days.items() if d in wanted}
    store.put_json(
        "cache/live/baseline.json", {"built": today.isoformat(), "days": keep}
    )
    y = yesterday.isoformat()
    if y in keep:
        try:
            theirs = shop.orders_count(y)
            ours = sum(keep[y]["orders"])
            if theirs and abs(ours - theirs) / theirs > 0.015:
                notes["yesterday_sync"] = (
                    f"BigQuery has {ours:,} orders for yesterday against "
                    f"Shopify's {theirs:,}, so yesterday's curve may be "
                    "incomplete until the BigQuery sync finishes."
                )
        except Exception:
            pass
    return keep


def collect(cfg: dict, store, now: dt.datetime) -> dict:
    today = now.date()
    day = today.isoformat()
    tomorrow = (today + dt.timedelta(days=1)).isoformat()
    yesterday = (today - dt.timedelta(days=1)).isoformat()
    unavailable: dict[str, str] = {}
    notes: dict[str, str] = {}
    inp: dict = {"unavailable": unavailable, "notes": notes, "base": {}}

    # phases from the Daily tab's last build, so sale days compare with sale
    days = store.get_json("pages/days.json") or {}
    inp["phases"] = {
        d: p for d, p in zip(days.get("dates", []), days.get("phase", [])) if p
    }
    if days.get("dates"):
        keep = ("gmv", "affiliate_spend", "crm_spend", "all_spend")
        inp["days_manual"] = {
            "dates": days["dates"],
            "phase": days.get("phase") or [],
            "values": {
                k: (days.get("values") or {}).get(k)
                or [None] * len(days["dates"])
                for k in keep
            },
        }
    inp["phases_eff"] = {
        d: p
        for d, p in zip(days.get("dates", []), days.get("phase_eff", []))
        if p
    }

    shop = None
    try:
        shop = _shop(cfg)
        inp["base"] = baseline(cfg, store, shop, now, notes)
        orders = shop.orders_between(
            f"{day}T00:00:00+05:30", f"{tomorrow}T00:00:00+05:30"
        )
        counts, gmv = order_hours(
            orders, day, cfg["orders"]["exclude_name_regex"]
        )
        today_arr = {
            "orders": counts,
            "gmv": gmv,
            "sessions": [0] * 24,
            "atc": [0] * 24,
        }
        try:
            s, a, _ = shop.sessions_hourly(day)
            today_arr.update(sessions=s, atc=a, sessions_ok=True)
        except Exception as exc:
            today_arr["sessions_ok"] = False
            unavailable["shopify_sessions"] = f"Shopify sessions: {exc}"
        inp["today"] = today_arr
    except Exception as exc:
        unavailable["shopify_orders"] = f"Shopify API: {exc}"

    # GoKwik: latest load per day, last 8 days plus today
    try:
        rows = bq.run(
            "gokwik_live",
            start_date=today - dt.timedelta(days=8),
            end_date=today,
        )
        inp["gokwik"] = {"rows": {r["date"]: r for r in rows}}
    except Exception as exc:
        unavailable["gokwik"] = f"BigQuery: {exc}"

    # Meta, campaign level, yesterday and today
    mcfg = cfg["meta"]
    token = secrets.get_secret(mcfg["token_secret"])
    if not token:
        unavailable["meta"] = "Meta system-user token not in Secret Manager"
    else:
        try:
            inp["meta_rows"] = meta.fetch_all(
                token, mcfg, yesterday, day, level="campaign"
            )
        except Exception as exc:
            unavailable["meta"] = f"Meta API: {exc}"

    gcfg = cfg["google_ads"]
    creds = {
        "client_id": secrets.get_secret(gcfg["client_id_secret"]),
        "client_secret": secrets.get_secret(gcfg["client_secret_secret"]),
        "refresh_token": secrets.get_secret(gcfg["refresh_token_secret"]),
    }
    if not all(creds.values()):
        unavailable["google"] = (
            "Google Ads API credentials not in Secret Manager"
        )
    else:
        try:
            inp["google_rows"] = google_ads.fetch_daily(
                gcfg, creds, yesterday, day
            )
        except Exception as exc:
            unavailable["google"] = f"Google Ads API: {exc}"
    return inp


def run() -> int:
    cfg = settings.config()
    store = default_store()
    now = dt.datetime.now(IST)
    inp = collect(cfg, store, now)
    page = build(inp, cfg, now)
    store.put_json("pages/live.json", page)
    alerts.log(
        "Live refresh finished",
        unavailable=list(page["unavailable"]),
        at=page["generated_at"],
    )
    return 0


def _alert_crash(exc: Exception) -> None:
    now = dt.datetime.now(IST)
    try:
        store = default_store()
        last = (store.get_json("status/live_crash.json") or {}).get("alerted")
        if last and (now - dt.datetime.fromisoformat(last)) < dt.timedelta(
            hours=3
        ):
            return
        store.put_json("status/live_crash.json", {"alerted": now.isoformat()})
    except Exception:
        pass
    alerts.send(
        f"Asaya dashboard: the live refresh crashed at {now:%H:%M} IST",
        [
            f"{type(exc).__name__}: {str(exc)[:400]}",
            "The Today tab keeps showing the last good refresh and says how old it is.",
        ],
    )


def main(argv: list[str] | None = None) -> int:
    argparse.ArgumentParser(description=__doc__).parse_args(argv)
    try:
        return run()
    except Exception as exc:
        _alert_crash(exc)
        raise


if __name__ == "__main__":
    sys.exit(main())
