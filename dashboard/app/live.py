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
    targets: dict | None = None,
    today: str | None = None,
) -> dict:
    """Today's spend so far on the channels that have no live source.

    The sheets are filled in with a lag, so yesterday's number is usually not
    there yet; the basis is the most recent filled days of the same kind (sale
    with sale, BAU with BAU), falling back to any kind when there are too few.
      per_hour: CRM sends go out through the day, so a typical day's spend x
                the share of the day gone (hours so far / 24).
      per_gmv : affiliate cost follows sales, so its share of GMV on those
                days x today's GMV so far.
      target_per_hour: today's planned spend from the media-plan workbook x
                the share of the day gone (Reddit); without a plan for today,
                per_hour on the days since `reddit_history_from`.
    Returns {channel: {"value", "basis", "dates"}} and a "total"."""
    mcfg = cfg["manual_spends"]["live_estimate"]
    n = mcfg["basis_days"]
    out: dict = {"affiliate": None, "crm": None, "reddit": None, "total": None}
    if not days or not days.get("dates"):
        return out
    dates, phase = days["dates"], days.get("phase") or []

    def pick(field: str, need_gmv: bool = False, since: str | None = None):
        rows = [
            i
            for i in range(len(dates))
            if days["values"][field][i] is not None
            and (not need_gmv or days["values"]["gmv"][i])
            and (not since or dates[i] >= since)
        ]
        same = [i for i in rows if assumed and phase[i] == assumed]
        use = same if len(same) >= 3 else rows
        kind = assumed if use is same and assumed else "any kind of"
        use = use[-n:]
        return use, kind

    parts = []
    share_of_day = min(t, 24) / 24
    for ch, field, how in (
        ("affiliate", "affiliate_spend", mcfg["affiliate"]),
        ("crm", "crm_spend", mcfg["crm"]),
        ("reddit", "reddit_spend", mcfg.get("reddit", "per_hour")),
    ):
        if how == "target_per_hour":
            plan = (targets or {}).get(today) if today else None
            if plan is not None:
                out[ch] = {
                    "value": plan * share_of_day,
                    "basis": f"today's plan of Rs {plan:,.0f} in the media-plan "
                    f"sheet x {min(t, 24):.1f}/24 of the day",
                    "dates": [today],
                }
                parts.append(out[ch]["value"])
                continue
            how = "per_hour"
        if field not in days["values"]:
            continue
        use, kind = pick(
            field,
            need_gmv=how == "per_gmv",
            since=mcfg.get("reddit_history_from") if ch == "reddit" else None,
        )
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
    # Reddit is a small, newer source: the total does not wait for it
    if out["affiliate"] and out["crm"]:
        out["total"] = sum(
            (out[c] or {}).get("value", 0.0)
            for c in ("affiliate", "crm", "reddit")
        )
    return out


def report_perf_sessions(
    rows: list[dict], day: str, aware: set, known: set, cfg: dict
) -> int:
    """Perf. sessions as the team's sheet and the D-1 tab count them: a UTM
    source on the team's list, with a UTM campaign, not awareness or social."""
    from .pages.common import _report_source

    allowed = {x.lower() for x in cfg["sessions"]["report_perf_sources"]}
    n = 0
    for r in rows:
        kind, _ = rules.session_kind(
            r["utm_source"], r["utm_campaign"], aware, known, cfg["sessions"], day
        )
        if (
            kind == "perf"
            and (r.get("utm_campaign") or "").strip()
            and _report_source(r.get("utm_source"), allowed)
        ):
            n += r["sessions"]
    return n


def snap_at(snaps: dict, day: str, t: float, slack: float = 0.6):
    """The value saved on `day` at the latest run no later than hour `t` (and
    no more than `slack` hours before it), or None."""
    best = None
    for h, v in snaps.get(day) or []:
        if h <= t + 0.02 and t - h <= slack and (best is None or h > best[0]):
            best = (h, v)
    return None if best is None else best[1]


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


KINDS = ("perf", "awareness", "social")


def _kind(name: str, cid, scfg: dict, aware_ids: set[str]) -> str:
    """The campaign type, as on the other tabs: Reach is social; a Google
    campaign on the awareness list (by id) or any campaign named awareness is
    awareness; the rest is performance."""
    if rules.is_social_name(name, scfg):
        return "social"
    if cid is not None and str(cid) in aware_ids:
        return "awareness"
    return rules.campaign_kind(name, scfg)


def _ad_totals(
    rows: list[dict],
    cfg: dict,
    value_key: str,
    count_key: str,
    aware_ids: set[str] | None = None,
):
    """Spend, Awareness-free ("Perf") spend and value, totals per campaign
    type over every campaign, and a campaign table."""
    scfg = cfg["sessions"]
    aware_ids = aware_ids or set()
    camps: dict[str, dict] = {}
    for r in rows:
        name = r.get("campaign_name") or "(unnamed)"
        kind = _kind(name, r.get("campaign_id"), scfg, aware_ids)
        c = camps.setdefault(
            name,
            {
                "campaign": name,
                "kind": kind,
                "awareness": kind == "awareness",
                "spend": 0.0,
                "value": 0.0,
                "results": 0.0,
                "clicks": 0,
                "impressions": 0,
            },
        )
        c["spend"] += r.get("spend") or 0
        c["value"] += r.get(value_key) or 0
        c["results"] += r.get(count_key) or 0
        c["clicks"] += r.get("clicks") or 0
        c["impressions"] += r.get("impressions") or 0
    table = sorted(camps.values(), key=lambda c: -c["spend"])
    perf = [c for c in table if c["kind"] == "perf"]
    out = {
        "spend": sum(c["spend"] for c in table),
        "perf_spend": sum(c["spend"] for c in perf),
        "perf_value": sum(c["value"] for c in perf),
        "results": sum(c["results"] for c in perf),
    }
    out["roas"] = ratio(out["perf_value"], out["perf_spend"])
    out["by_kind"] = {
        k: {
            f: sum(c[f] for c in table if c["kind"] == k)
            for f in ("spend", "value", "clicks", "impressions")
        }
        for k in KINDS
    }
    for c in table:
        c["roas"] = (
            ratio(c["value"], c["spend"]) if c["kind"] == "perf" else None
        )
    return out, table


def ads_block(
    rows: list[dict] | None,
    today: str,
    yesterday: str,
    cfg: dict,
    value_key: str,
    count_key: str,
    reason: str | None,
    aware_ids: set[str] | None = None,
) -> dict:
    if rows is None:
        return {"na": reason or "not available"}
    t, table = _ad_totals(
        [r for r in rows if r["date"] == today],
        cfg,
        value_key,
        count_key,
        aware_ids,
    )
    y, _ = _ad_totals(
        [r for r in rows if r["date"] == yesterday],
        cfg,
        value_key,
        count_key,
        aware_ids,
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
        # Today's hourly buckets stop at "now": the current hour's bucket
        # already holds only the minutes so far, so today is its whole array.
        # (Spreading the current hour, as cum_at does, is only right for the
        # complete baseline days; doing it to today counted that hour twice
        # short.)
        now_m = metrics_at(today_arr, 24)
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
        set(inp.get("google_aware_ids") or []),
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
    est = estimate_other_spend(
        inp.get("days_manual"),
        assumed,
        gmv_now,
        t,
        cfg,
        targets=inp.get("reddit_targets"),
        today=today,
    )
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
            "Shopify GMV so far / Meta + Google (actual) + affiliate + CRM + Reddit (estimated)",
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

    # -- per campaign type, for the Performance / Awareness / All switch ----
    def kind_spend(blk, which, kind, f="spend"):
        d = blk.get(which)
        return None if not d else d["by_kind"][kind][f]

    def plus(*vals):
        return None if any(v is None for v in vals) else sum(vals)

    est_rows = [
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
            "label": "Reddit (sales campaigns)",
            "value": (est["reddit"] or {}).get("value"),
            "kind": "estimate",
            "note": (est["reddit"] or {}).get("basis")
            or "not enough filled days in the Reddit sheet to estimate "
            "(left out of the total)",
        },
    ]
    other_t = est["total"]
    perf_all_t = plus(perf_t, other_t)
    y_perf_overall = None
    if yesterday in (dm.get("dates") or []):
        i = dm["dates"].index(yesterday)
        y_perf_overall = ratio(
            dm["values"]["gmv"][i],
            (dm["values"].get("perf_all_spend") or [None] * (i + 1))[i],
        )

    def platform(label, blk, api, kinds):
        """A platform's total, then one row per campaign type under it."""
        rows = [
            {
                "label": label,
                "value": (blk.get("today") or {}).get("spend"),
                "kind": "actual",
                "note": f"every {label} campaign, from {api}",
            }
        ]
        for k, name in kinds:
            rows.append(
                {
                    "label": name,
                    "value": kind_spend(blk, "today", k),
                    "kind": "actual",
                    "level": 1,
                    "note": {
                        "perf": "sales campaigns",
                        "awareness": "awareness campaigns",
                        "social": "the Reach and Amazon campaigns: in total spend only",
                    }[k],
                }
            )
        return rows

    aw_meta = kind_spend(meta_blk, "today", "awareness")
    aw_google = kind_spend(google_blk, "today", "awareness")
    aw_total = plus(aw_meta, aw_google)
    aw_impr = plus(
        kind_spend(meta_blk, "today", "awareness", "impressions"),
        kind_spend(google_blk, "today", "awareness", "impressions"),
    )
    aw_clicks = plus(
        kind_spend(meta_blk, "today", "awareness", "clicks"),
        kind_spend(google_blk, "today", "awareness", "clicks"),
    )
    views = {
        "perf": {
            "spend_breakdown": [
                {
                    "label": "Meta",
                    "value": kind_spend(meta_blk, "today", "perf"),
                    "kind": "actual",
                    "note": "sales campaigns, from Meta's API; awareness and Reach left out",
                },
                {
                    "label": "Google Ads",
                    "value": kind_spend(google_blk, "today", "perf"),
                    "kind": "actual",
                    "note": "sales campaigns, from Google's API; awareness campaigns left out",
                },
                *est_rows,
                {
                    "label": "All channels",
                    "value": perf_all_t,
                    "kind": "estimate",
                    "note": "performance spend: Meta and Google sales campaigns plus the estimates above",
                },
            ],
            "cards": cards[:3]
            + [
                {
                    "key": "overall_perf_roas",
                    "label": "Overall ROAS (Perf, est.)",
                    "value": ratio(gmv_now, perf_all_t),
                    "yesterday": y_perf_overall,
                    "delta": delta(ratio(gmv_now, perf_all_t), y_perf_overall),
                    "sub": "Shopify GMV so far / sales-campaign spend on every channel: Meta + Google (actual) + affiliate + CRM + Reddit (estimated)",
                    "na": None
                    if ratio(gmv_now, perf_all_t) is not None
                    else (
                        "ad spend for today is not in yet"
                        if perf_t is None
                        else "there are not enough filled days in the affiliate and CRM sheets to estimate them"
                    ),
                }
            ],
        },
        "aw": {
            "spend_breakdown": [
                {
                    "label": "Meta",
                    "value": aw_meta,
                    "kind": "actual",
                    "note": "awareness campaigns, from Meta's API (Reach is social, left out)",
                },
                {
                    "label": "Google Ads",
                    "value": aw_google,
                    "kind": "actual",
                    "note": "awareness campaigns, from Google's API",
                },
                {
                    "label": "Reddit (traffic campaigns)",
                    "value": None,
                    "kind": "actual",
                    "note": "no live source yet: Reddit traffic spend will come from BigQuery once the Reddit bot loads it",
                },
                {
                    "label": "All channels",
                    "value": aw_total,
                    "kind": "actual",
                    "note": "Meta and Google awareness campaigns",
                },
            ],
            "totals": {
                "spend": aw_total,
                "meta_spend": aw_meta,
                "google_spend": aw_google,
                "impressions": aw_impr,
                "clicks": aw_clicks,
            },
        },
        "all": {
            "spend_breakdown": platform(
                "Meta",
                meta_blk,
                "Meta's API, a little behind real time",
                [("perf", "Performance"), ("awareness", "Awareness"), ("social", "Reach & Amazon")],
            )
            + platform(
                "Google Ads",
                google_blk,
                "Google's API",
                [("perf", "Performance"), ("awareness", "Awareness")],
            )
            + est_rows
            + [
                {
                    "label": "All channels",
                    "value": all_t,
                    "kind": "estimate",
                    "note": "every Meta and Google campaign plus the estimates above",
                }
            ],
            "cards": cards,
        },
    }

    # -- the scorecard: the team's sheet, row for row -----------------------
    T = {x["key"]: x for x in (shopify or {}).get("tiles", [])}

    def tv(k, f="value"):
        x = T.get(k) or {}
        return None if x.get("na") and f == "value" else x.get(f)

    def dmv(field):
        if yesterday not in (dm.get("dates") or []):
            return None
        i = dm["dates"].index(yesterday)
        return ((dm.get("values") or {}).get(field) or [None] * (i + 1))[i]

    def latest(field, also=None):
        """(date, value) of the latest day up to yesterday with `field` (and
        `also`) filled in the sheets: they are entered with a lag."""
        dates = dm.get("dates") or []
        vals = (dm.get("values") or {}).get(field) or []
        other = (dm.get("values") or {}).get(also) if also else None
        for i in range(len(dates) - 1, -1, -1):
            if dates[i] > yesterday or i >= len(vals):
                continue
            if vals[i] is not None and (other is None or (i < len(other) and other[i] is not None)):
                return dates[i], vals[i], i
        return None, None, None

    def day_name(d):
        return "yesterday's" if d == yesterday else dt.date.fromisoformat(d).strftime("%-d %b's")

    snaps = inp.get("perf_snapshots") or {}
    perf_now = (
        (inp.get("perf_sessions") or {}).get("value")
        if "perf_sessions" not in unavailable
        else None
    )
    typ_d = (shopify or {}).get("typical_dates") or []
    perf_y = snap_at(snaps, yesterday, t)
    typ_vals = [v for v in (snap_at(snaps, d, t) for d in typ_d) if v is not None]
    perf_typ = (
        statistics.median(typ_vals)
        if len(typ_vals) >= max(1, lcfg.get("min_typical_days", 2))
        else None
    )

    def item(key, label, unit, value, na=None, yday=None, typ=None, ref=None, note=None, est=False):
        return {
            "key": key,
            "label": label,
            "unit": unit,
            "value": value,
            "na": None if value is not None else (na or "not available yet"),
            "yesterday": yday,
            "typical": typ,
            "vs_yesterday": delta(value, yday),
            "vs_typical": delta(value, typ),
            "ref": ref,
            "note": note,
            "estimate": est,
        }

    def full_day(v_today, v_yday, field=None, on=None):
        """Spend so far against yesterday's whole day (or the latest day the
        sheets are filled for)."""
        label = f"of {day_name(on)} full day" if on else "of yesterday's full day"
        if v_yday is None and field:
            d, v_yday, _ = latest(field)
            if d:
                label = f"of {day_name(d)} full day"
        if v_yday is None:
            return None
        return {"label": label, "value": v_yday, "share": ratio(v_today, v_yday)}

    def tile_item(key, label, unit):
        x = T.get(key) or {}
        return item(key, label, unit, tv(key), x.get("na") or unavailable.get("shopify_orders"),
                    x.get("yesterday"), x.get("typical"))

    meta_s, meta_y = kind_spend(meta_blk, "today", "perf"), kind_spend(meta_blk, "yesterday", "perf")
    goog_s, goog_y = kind_spend(google_blk, "today", "perf"), kind_spend(google_blk, "yesterday", "perf")
    red = est["reddit"] or {}
    aff, crm = est["affiliate"] or {}, est["crm"] or {}
    crm_aff = plus(aff.get("value"), crm.get("value"))
    crm_aff_y = plus(dmv("affiliate_spend"), dmv("crm_spend"))
    d_ca = yesterday
    if crm_aff_y is None:
        d_ca, _, i_ca = latest("affiliate_spend", "crm_spend")
        if d_ca:
            crm_aff_y = (dm["values"]["affiliate_spend"][i_ca] or 0) + (dm["values"]["crm_spend"][i_ca] or 0)
    d_f, f_spend, i_f = latest("perf_all_spend", "sessions")
    final_lbl = f"{day_name(d_f)} final" if d_f else "yesterday's final"
    f_gmv = dm["values"]["gmv"][i_f] if d_f else None
    f_sess = dm["values"]["sessions"][i_f] if d_f else None
    orders_now, sess_now = tv("orders"), tv("sessions")
    cvr_perf = ratio(orders_now, perf_now)
    scorecard = {
        "groups": [
            {
                "title": "Sales",
                "items": [
                    tile_item("orders", "Orders", "int"),
                    tile_item("gmv", "GMV", "inr"),
                    tile_item("aov", "AOV", "inr"),
                ],
            },
            {
                "title": "Performance spends",
                "note": "Sales campaigns only. Awareness, Reach and Reddit traffic spend are never in these, or in ROAS.",
                "items": [
                    item("meta_spend", "Meta spends", "inr", meta_s, meta_blk.get("na"),
                         ref=full_day(meta_s, meta_y), note="sales campaigns, from Meta's API"),
                    item("google_spend", "Google", "inr", goog_s, google_blk.get("na"),
                         ref=full_day(goog_s, goog_y), note="sales campaigns, from Google's API"),
                    item("reddit_spend", "Reddit", "inr", red.get("value"),
                         "no plan for today in the media-plan sheet and too few filled days to estimate",
                         ref=full_day(red.get("value"), dmv("reddit_spend"), "reddit_spend"), note=red.get("basis"), est=True),
                    item("crm_aff_spend", "CRM + Affiliates", "inr", crm_aff,
                         "not enough filled days in the affiliate and CRM sheets to estimate",
                         ref=full_day(crm_aff, crm_aff_y, on=d_ca),
                         note=(f"affiliate Rs {aff['value']:,.0f} + CRM Rs {crm['value']:,.0f}, estimated"
                               if crm_aff is not None else None), est=True),
                    item("total_spend", "Total Spends", "inr", perf_all_t,
                         "a spend above is missing", ref=full_day(perf_all_t, dmv("perf_all_spend"), "perf_all_spend"),
                         note="Meta + Google + Reddit + CRM + affiliates, sales only", est=True),
                ],
            },
            {
                "title": "Returns",
                "items": [
                    item("roas", "ROAS", "x", ratio(gmv_now, perf_all_t), "a spend is missing",
                         ref={"label": final_lbl, "value": ratio(f_gmv, f_spend)},
                         note="GMV / Total Spends: performance spend only"),
                    item("cps", "CPS", "inr2", ratio(perf_all_t, sess_now), "a spend or sessions are missing",
                         ref={"label": final_lbl, "value": ratio(f_spend, f_sess)},
                         note="Total Spends / Sessions"),
                ],
            },
            {
                "title": "Traffic and conversion",
                "items": [
                    tile_item("sessions", "Sessions", "int"),
                    item("perf_sessions", "Perf Sessions", "int", perf_now, unavailable.get("perf_sessions"),
                         perf_y, perf_typ,
                         note="the team's paid, affiliate and CRM sources with a UTM campaign; awareness and Reach left out"),
                    item("cvr", "CVR % on overall sessions", "pct", tv("cvr"),
                         (T.get("cvr") or {}).get("na"), (T.get("cvr") or {}).get("yesterday"),
                         (T.get("cvr") or {}).get("typical"), note="Orders / Sessions"),
                    item("cvr_perf", "CVR % on Perf", "pct", cvr_perf, unavailable.get("perf_sessions"),
                         ratio(tv("orders", "yesterday"), perf_y), ratio(tv("orders", "typical"), perf_typ),
                         note="Orders / Perf Sessions"),
                ],
            },
        ],
        "perf_compare_note": (
            None
            if perf_y is not None
            else "Perf Sessions are compared from the second day on: the live job saves them on every run, "
            "because Shopify cannot split yesterday's sessions by hour and UTM."
        ),
    }

    # say which spend is missing when the total cannot be added up
    spend_items = scorecard["groups"][1]["items"]
    missing = [i["label"] for i in spend_items[:-1] if i["value"] is None]
    if missing:
        why = f"{' and '.join(missing)} {'is' if len(missing) == 1 else 'are'} missing"
        spend_items[-1]["na"] = why
        for i in scorecard["groups"][2]["items"]:
            if i["value"] is None:
                i["na"] = why

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
        "scorecard": scorecard,
        # the All campaigns view; "views" has each campaign type
        "spend_breakdown": views["all"]["spend_breakdown"],
        "views": views,
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


SALES_LOGIC = "shopify-sales-report"


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
    # days built before the switch to Shopify's sales report are rebuilt
    if cache.get("logic") != SALES_LOGIC:
        cache = {"days": {}}
    days = cache.get("days", {})
    first_run_today = cache.get("built") != today.isoformat()
    todo = [
        d
        for d in sorted(wanted)
        if d not in days or (first_run_today and d == yesterday.isoformat())
    ]
    names = [n for n in cfg["orders"]["exclude_name_regex"].split("|") if n]
    sales = None
    if todo:
        try:
            # Shopify's own Sales report, hour by hour: the D-1 numbers
            sales = shop.sales_hourly(todo[0], yesterday.isoformat(), names)
        except Exception as exc:
            notes["baseline_sales"] = (
                "Shopify's sales report by hour could not be read, so past "
                f"days use orders without cancellations instead: {exc}"
            )
    if todo and sales is None:
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
        y = yesterday.isoformat()
        if y in todo:
            # Yesterday comes straight from Shopify, not BigQuery: the BigQuery
            # copy is still catching up for much of the day after, and a
            # half-synced yesterday made every "vs yesterday" figure wrong.
            try:
                api = shop.orders_between(
                    f"{y}T00:00:00+05:30", f"{today.isoformat()}T00:00:00+05:30"
                )
                counts, gmv = order_hours(
                    api, y, cfg["orders"]["exclude_name_regex"]
                )
                by_day[y] = {"orders": counts, "gmv": gmv}
            except Exception as exc:
                notes["yesterday_orders"] = (
                    "Yesterday's orders could not be read from Shopify, so "
                    f"the BigQuery copy is used and may be incomplete: {exc}"
                )
    if todo:
        by_day = sales if sales is not None else by_day
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
        "cache/live/baseline.json",
        {
            "built": today.isoformat(),
            # only days read from the sales report count as built with it
            "logic": SALES_LOGIC if (not todo or sales is not None) else None,
            "days": keep,
        },
    )
    return keep


def history(
    cfg: dict, store, shop, now: dt.datetime, base: dict, phases: dict,
    perf_snaps: dict, notes: dict,
) -> int:
    """Hourly Orders, Total sales (Shopify's Sales report, as on D-1),
    sessions and add-to-carts for every past day in the last `days` days, so
    Today can be compared with any earlier day (a previous offer). Past days
    do not change: each is read once, `chunk_days` at a time, newest first;
    the baseline's days (yesterday re-read each morning) override. Publishes
    pages/live_history.json. Returns the number of days still to fill."""
    hc = cfg["live"]["history"]
    today = now.date()
    yesterday = today - dt.timedelta(days=1)
    first = today - dt.timedelta(days=hc["days"])
    cache = store.get_json("cache/live/history.json") or {}
    if cache.get("logic") != SALES_LOGIC:
        cache = {"logic": SALES_LOGIC, "days": {}, "empty": []}
    days: dict = cache.get("days") or {}
    empty = set(cache.get("empty") or [])
    changed = False
    for d, v in base.items():  # the baseline's days are the freshest copy
        if d < today.isoformat() and all(k in v for k in ("orders", "gmv", "sessions", "atc")):
            new = {k: v[k] for k in ("orders", "gmv", "sessions", "atc")}
            if days.get(d) != new:
                days[d], changed = new, True
    wanted = [
        (first + dt.timedelta(days=i)).isoformat()
        for i in range((yesterday - first).days + 1)
    ]
    missing = sorted((d for d in wanted if d not in days and d not in empty), reverse=True)
    names = [n for n in cfg["orders"]["exclude_name_regex"].split("|") if n]
    for _ in range(hc["chunks_per_run"]):
        if not missing:
            break
        end = dt.date.fromisoformat(missing[0])
        start = max(first, end - dt.timedelta(days=hc["chunk_days"] - 1))
        a, b = start.isoformat(), end.isoformat()
        try:
            sales = shop.sales_hourly(a, b, names)
            sess = shop.sessions_hourly_range(a, b)
        except Exception as exc:
            notes["history"] = f"Past days for comparison could not all be read yet ({a} to {b}): {exc}"
            break
        for d in [x for x in missing if a <= x <= b]:
            sd, ss = sales.get(d), sess.get(d)
            if sd is None and ss is None:
                empty.add(d)
            else:
                days[d] = {
                    "orders": (sd or {}).get("orders") or [0] * 24,
                    "gmv": [round(x, 2) for x in (sd or {}).get("gmv") or [0.0] * 24],
                    "sessions": (ss or {}).get("sessions") or [0] * 24,
                    "atc": (ss or {}).get("atc") or [0] * 24,
                }
        missing = [x for x in missing if not a <= x <= b]
        changed = True
    days = {d: v for d, v in days.items() if d >= first.isoformat()}
    if changed or cache.get("built") != today.isoformat():
        store.put_json(
            "cache/live/history.json",
            {"logic": SALES_LOGIC, "built": today.isoformat(), "days": days,
             "empty": sorted(e for e in empty if e >= first.isoformat())},
        )
        store.put_json(
            "pages/live_history.json",
            {
                "title": "Today: past days",
                "generated_at": now.isoformat(),
                "as_of": yesterday.isoformat(),
                "fields": ["orders", "gmv", "sessions", "atc"],
                "days": {d: [v["orders"], v["gmv"], v["sessions"], v["atc"]] for d, v in sorted(days.items())},
                "phases": {d: phases[d] for d in days if d in phases},
                "perf": {d: v for d, v in perf_snaps.items() if d in days},
                "pending_days": len(missing),
                "notes": [
                    "Orders and Total sales: Shopify's Sales report by hour, as on D-1 (influencer and sample orders left out).",
                    "Sessions and add-to-carts: Shopify sessions by hour.",
                    "Perf sessions so far exist only for days the live tab ran on (kept from now on); spend so far is not kept for past days.",
                ],
            },
        )
    return len(missing)


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
        keep = (
            "gmv",
            "affiliate_spend",
            "crm_spend",
            "reddit_spend",
            "all_spend",
            "perf_all_spend",
            "sessions",
            "meta_perf_spend",
            "google_perf_spend",
        )
        vals = days.get("values") or {}
        inp["days_manual"] = {
            "dates": days["dates"],
            "phase": days.get("phase") or [],
            "values": {
                k: vals.get(k) or [None] * len(days["dates"]) for k in keep
            },
        }
        # GMV is Shopify's Total sales, as on D-1 (ROAS, the affiliate share)
        if vals.get("sh_sales"):
            inp["days_manual"]["values"]["gmv"] = vals["sh_sales"]
    # Google awareness campaigns by id, the same list the other tabs use
    cd = store.get_json("pages/campaign_days.json") or {}
    g_names = (cd.get("google") or {}).get("names", [])
    extra_ids = {str(i) for i in cfg["sessions"].get("google_awareness_extra_ids") or []}
    aware_ids = {
        str(n["id"]) for n in g_names if n.get("kind") == "awareness" or n.get("awareness")
    } | extra_ids
    known_ids = {str(n["id"]) for n in g_names} | extra_ids
    inp["google_aware_ids"] = sorted(aware_ids)
    # today's Reddit plan from the media-plan workbook (read by the refresh)
    ms = store.get_json("cache/manual_spends.json") or {}
    inp["reddit_targets"] = (ms.get("reddit") or {}).get("targets") or {}
    inp["phases_eff"] = {
        d: p
        for d, p in zip(days.get("dates", []), days.get("phase_eff", []))
        if p
    }

    shop = None
    try:
        shop = _shop(cfg)
        inp["base"] = baseline(cfg, store, shop, now, notes)
        names = [n for n in cfg["orders"]["exclude_name_regex"].split("|") if n]
        try:
            # Orders and Total sales as Shopify's Sales report counts them:
            # the same numbers as the D-1 tab and the team's sheet
            sh = shop.sales_hourly(day, day, names).get(day) or {
                "orders": [0] * 24,
                "gmv": [0.0] * 24,
            }
            counts, gmv = sh["orders"], sh["gmv"]
        except Exception as exc:
            notes["today_sales"] = (
                "Shopify's sales report could not be read, so today counts "
                f"orders without cancellations instead: {exc}"
            )
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
        # Perf. sessions so far, saved on every run: Shopify cannot split
        # yesterday's sessions by hour and UTM, so the saved runs are what
        # today is compared with (same time yesterday, typical days)
        snaps = store.get_json("cache/live/perf_sessions.json") or {}
        try:
            sd = shop.sessions_day(day, cfg["sessions"]["breakdown_limit"])
            perf = report_perf_sessions(sd["rows"], day, aware_ids, known_ids, cfg)
            t_now = round(now.hour + now.minute / 60, 3)
            snaps[day] = [x for x in snaps.get(day, []) if x[0] < t_now] + [[t_now, perf]]
            keep = sorted(snaps)[-cfg["live"]["history"]["days"]:]
            snaps = {d: snaps[d] for d in keep}
            store.put_json("cache/live/perf_sessions.json", snaps)
            inp["perf_sessions"] = {"value": perf, "truncated": sd.get("truncated")}
        except Exception as exc:
            unavailable["perf_sessions"] = f"Shopify sessions by UTM: {exc}"
        inp["perf_snapshots"] = snaps
        try:  # past days for "compare with a past day"; never stops the live page
            history(cfg, store, shop, now, inp["base"], inp["phases"], snaps, notes)
        except Exception as exc:
            notes["history"] = f"Past days for comparison not updated: {exc}"
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
