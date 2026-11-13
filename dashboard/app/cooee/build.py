"""pages/cro.json from the Cooee day files and snapshots in the bucket.

Rows of numbers per day, like the other range tabs, so the browser sums any
date range the header picks (BAU vs BAU, Sale vs Sale) the same way. Only
additive counts are stored per day; rates are worked out from the sums.
Distinct visitors do not add across days, so RPV for a range comes from a
live call (/api/cro/live), not from these rows.
"""

from __future__ import annotations

import datetime as dt

from . import config, mcp, verdict

INTENT_ORDER = ["ALL", "NO", "LOW", "MEDIUM", "HIGH"]
FUNNEL_FIELDS = ["sessions", "visitors", "product_view", "atc", "cart_open", "checkout", "payment", "order_sessions",
                 "orders", "revenue", "bounced"]
SEG_FIELDS = ["sessions", "bounced", "atc", "order_sessions", "revenue", "high_sessions", "high_order_sessions"]


class _Keys:
    def __init__(self):
        self.keys: list = []
        self.ix: dict = {}

    def __call__(self, k) -> int:
        t = tuple(k) if isinstance(k, list) else k
        if t not in self.ix:
            self.ix[t] = len(self.keys)
            self.keys.append(k)
        return self.ix[t]


def _code_of(cfg: dict) -> dict[str, str]:
    out = {}
    for p in cfg.get("product_map", {}).get("products", []):
        for pid in (p.get("ids") or {}):
            out[str(pid)] = p["code"]
    return out


def page(store, cfg: dict, now: dt.datetime, days_page: dict | None = None) -> dict:
    cc = cfg["cro"]
    state = store.get_json("cache/cooee/state.json") or {}
    days = sorted(state.get("days") or [])
    conn = mcp.status(store)
    sync = store.get_json("cache/cooee/sync_log.json") or {}
    out: dict = {
        "title": "CRO", "store_slug": cc["store_slug"], "generated_at": now.isoformat(),
        "as_of": days[-1] if days else None, "days": days, "connection": conn,
        "sync": {"runs": (sync.get("runs") or [])[:10], "last": {k: v for k, v in (sync.get("last") or {}).items() if k != "calls"},
                 "calls": (sync.get("last") or {}).get("calls", [])[-60:], "data_start": cc["data_start"]},
        "rules": {k: cc[k] for k in ("verdict", "flags", "min_segment_sessions", "recon_warn")},
        "funnel": {"fields": FUNNEL_FIELDS, "intents": INTENT_ORDER, "rows": []},
        "seg_fields": SEG_FIELDS,
        "hour": [], "store": [], "recon": [],
        "dashboard_base": f"https://dashboard.letscooee.com/store/{cc['store_slug']}",
    }
    if not days:
        out["na"] = ("Cooee is not connected yet: click Connect Cooee." if not conn["connected"]
                     else "Cooee is connected; the first sync has not finished yet.")
        out["experiments"], out["backlog"] = [], cc.get("backlog") or []
        return out
    codes = _code_of(cfg)
    K = {k: _Keys() for k in ("landing", "exits", "utm", "channel", "device", "products", "variants", "campaigns")}
    R = {k: [] for k in K}
    other, ptot, impact = [], [], {}
    for d in days:
        f = store.get_json(f"cache/cooee/day/{d}.json") or {}
        for i, name in enumerate(INTENT_ORDER):
            vals = (f.get("funnel") or {}).get(name)
            if vals:
                out["funnel"]["rows"].append([d, i, *vals])
        for h in f.get("hour") or []:
            out["hour"].append([d, *h])
        st = f.get("store") or {}
        if st:
            out["store"].append([d, st.get("totalRevenue") or 0, st.get("totalOrders") or 0, st.get("netRevenue") or 0,
                                 st.get("cooeeRevenue") or 0, st.get("cooeeOrders") or 0])
        fa = (f.get("funnel") or {}).get("ALL")
        if fa:
            out["recon"].append([d, fa[0], fa[8], fa[9], fa[5], fa[6]])  # sessions, orders, revenue, checkout, payment
        for key, nk in (("landing", 2), ("utm", 3), ("channel", 2), ("device", 2)):
            blk = f.get(key) or {}
            for r in blk.get("rows") or []:
                R[key].append([d, K[key](r[:nk]), *r[nk:]])
            if key == "landing" and blk.get("summary"):
                s = blk["summary"]
                tot = [s.get("sessionCount") or 0, s.get("bouncedSessionCount") or 0, s.get("sessionsWithAddToCart") or 0,
                       s.get("sessionsWithOrder") or 0, s.get("revenue") or 0]
                got = [sum(r[2 + j] for r in blk["rows"]) for j in range(5)]
                rest = [max(0, a - b) for a, b in zip(tot, got)]
                if any(rest):
                    other.append([d, *rest])
        for r in (f.get("exits") or {}).get("rows") or []:
            R["exits"].append([d, K["exits"](r[0]), r[1], r[2]])
        for key in ("products", "variants"):
            blk = f.get(key) or {}
            for r in blk.get("rows") or []:
                pid, vid, name = r[0], r[1], r[2]
                k = [pid, name, codes.get(pid, "")] if key == "products" else [pid, vid, name, codes.get(pid, "")]
                R[key].append([d, K[key](k[:1] if key == "products" else k[:2]), *r[3:]])
                K[key].keys[K[key](k[:1] if key == "products" else k[:2])] = k  # latest name wins
            if key == "products" and blk.get("totals"):
                t = blk["totals"]
                ptot.append([d, *(t.get(x) or 0 for x in ("views", "addToCarts", "removesFromCart", "purchases", "unitsSold", "revenue"))])
        for r in f.get("campaigns") or []:
            ci = K["campaigns"]([r[0]])
            K["campaigns"].keys[ci] = {"seq": r[0], "name": r[1], "status": r[2], "objective": r[3], "delivery": r[4]}
            R["campaigns"].append([d, ci, *r[5:]])
        if f.get("impact"):
            impact[d] = f["impact"]
    for key in ("landing", "exits", "utm", "channel", "device", "products", "variants"):
        out[key] = {"keys": K[key].keys, "rows": R[key]}
    out["landing"]["other"] = other
    out["products"]["totals"] = ptot
    # campaign attributes from the latest snapshot, for those with no rows too
    snaps = sorted(state.get("snaps") or [])
    latest = store.get_json(f"cache/cooee/snap/{snaps[-1]}.json") if snaps else None
    camp_attr = {c["sequenceNumber"]: c for c in (latest or {}).get("campaigns") or []}
    keys = []
    for k in K["campaigns"].keys:
        a = camp_attr.get(k["seq"]) or {}
        keys.append({**k, "status": a.get("status") or k["status"], "published": a.get("publishedAt"),
                     "url": f"{out['dashboard_base']}/campaigns/detail/{k['seq']}"})
    out["campaigns"] = {"keys": keys, "rows": R["campaigns"], "all": len(camp_attr), "notes": (latest or {}).get("notes") or []}
    out["experiments"] = experiments(store, snaps, cc, (latest or {}).get("date") or days[-1])
    last_imp = impact.get(days[-1]) or {}
    out["impact"] = {"latest": last_imp, "running": bool(last_imp.get("exposed") or last_imp.get("groups")),
                     "days": [[d, v] for d, v in impact.items() if v.get("exposed") or v.get("groups")]}
    out["backlog"] = cc.get("backlog") or []
    return out


def experiments(store, snaps: list[str], cc: dict, today: str) -> list[dict]:
    hist: dict[str, list] = {}
    latest = {}
    for sd in snaps[-400:]:
        s = store.get_json(f"cache/cooee/snap/{sd}.json") or {}
        for e in s.get("experiments") or []:
            seq = str(e.get("sequenceNumber"))
            latest[seq] = e
            if e.get("status") == "DRAFT" or not e.get("variations"):
                continue
            v = verdict.verdict(e, sd, cc["verdict"])
            hist.setdefault(seq, []).append([sd, v["lift_opv"], v["lift_rpv"], v["p"], sum(a["visitors"] for a in v["arms"])])
    out = []
    for seq, e in latest.items():
        v = verdict.verdict(e, today, cc["verdict"]) if e.get("status") != "DRAFT" else {"verdict": "Draft", "arms": [], "why": ""}
        out.append({
            "seq": seq, "name": (e.get("name") or "").strip(), "type": e.get("type"), "status": e.get("status"),
            "created": (e.get("createdAt") or "")[:10], "published": (e.get("publishedAt") or "")[:10],
            "updated": (e.get("updatedAt") or "")[:10], "page_type": (e.get("config") or {}).get("pageType"),
            "url": e.get("dashboardUrl") or f"https://dashboard.letscooee.com/store/{cc['store_slug']}/experiments/detail/{seq}",
            **{k: v.get(k) for k in ("verdict", "why", "arms", "days_live", "source", "lift_opv", "lift_rpv", "p", "srm", "exposure")},
            "history": hist.get(seq, []),
        })
    out.sort(key=lambda x: -int(x["seq"]) if str(x["seq"]).isdigit() else 0)
    return out
