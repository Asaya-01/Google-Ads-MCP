#!/usr/bin/env python3
"""Today tab numbers for fixed windows, for the before/after integrity check.

  python3 tools/today_snapshot.py <pages dir> <out.json>

Reads live_history.json (hourly Orders, Total sales, sessions, add-to-carts of
past days) and live.json (the keys the Today tab shows). The output holds
business numbers: keep it outside the repository.
"""

import json
import sys
from pathlib import Path

WINDOWS = [("2026-11-24", "2026-11-24", 10, 12), ("2026-11-23", "2026-11-23", 0, 23), ("2026-11-01", "2026-11-04", 0, 23)]
FIELDS = ["orders", "gmv", "sessions", "atc"]


def load(d, name):
    try:
        return json.loads((Path(d) / f"{name}.json").read_text())
    except FileNotFoundError:
        return None


def main(d, out):
    H = load(d, "live_history") or {"days": {}}
    snap = {"windows": {}, "live_keys": None}
    for a, b, h0, h1 in WINDOWS:
        tot = {f: 0.0 for f in FIELDS}
        days = sorted(x for x in H["days"] if a <= x <= b)
        for x in days:
            for i, f in enumerate(FIELDS):
                tot[f] += sum(H["days"][x][i][h0:h1 + 1])
        tot = {k: round(v, 2) for k, v in tot.items()}
        tot["atc_rate"] = round(tot["atc"] / tot["sessions"], 6) if tot["sessions"] else None
        tot["aov"] = round(tot["gmv"] / tot["orders"], 4) if tot["orders"] else None
        snap["windows"][f"{a}..{b} {h0:02d}:00-{h1:02d}:59"] = {"days": days, **tot}
    L = load(d, "live")
    if L:
        # the live page changes every run; its shape (every key it shows) must stay
        def keys(o, pre=""):
            if isinstance(o, dict):
                return sorted({k for kk, v in o.items() for k in [pre + kk] + keys(v, pre + kk + ".")})
            return []
        snap["live_keys"] = [k for k in keys(L) if not k.startswith("v2")]
        snap["live_scorecard_keys"] = [i["key"] for g in L.get("scorecard", {}).get("groups", []) for i in g["items"]]
    Path(out).write_text(json.dumps(snap, indent=1))
    print("wrote", out)


if __name__ == "__main__":
    main(*sys.argv[1:3])
