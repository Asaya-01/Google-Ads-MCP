#!/usr/bin/env bash
# Before/after check that a change moved no existing number (Today, Overview,
# Funnel, Marketing). Run from Cloud Shell, in the repository folder:
#
#   ./dashboard/tools/integrity_snapshot.sh before     # before deploying
#   ./dashboard/tools/integrity_snapshot.sh after      # after deploying and one refresh + live run
#   ./dashboard/tools/integrity_snapshot.sh compare    # lists every difference; none = pass
#
# Snapshots hold business numbers and are written to ~/integrity, never to the repository.
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT="${GOOGLE_PROJECT_ID:-$(gcloud config get-value project 2>/dev/null)}"
BUCKET="${PROJECT}-d2c-dashboard"
OUT="$HOME/integrity"
label="${1:?before | after | compare}"
if [[ "$label" == compare ]]; then
  python3 - "$OUT" <<'PY'
import json, sys
out = sys.argv[1]
def diff(a, b, path=""):
    n = 0
    if isinstance(a, dict) and isinstance(b, dict):
        for k in sorted(set(a) | set(b)):
            if k not in b: print(f"only before: {path}{k}"); n += 1
            elif k not in a: print(f"only after:  {path}{k}"); n += 1
            else: n += diff(a[k], b[k], f"{path}{k}.")
    elif a != b:
        print(f"changed: {path[:-1]}: {a!r} -> {b!r}"); n += 1
    return n
n = 0
for name in ("range", "today"):
    a = json.load(open(f"{out}/before/{name}.json")); b = json.load(open(f"{out}/after/{name}.json"))
    if name == "today":  # new keys the fixes add are allowed; removed or changed ones are not
        a, b = a["windows"], b["windows"]
    n += diff(a, b, name + ".")
print("PASS: every existing number is identical" if n == 0 else f"FAIL: {n} difference(s)")
PY
  exit 0
fi
mkdir -p "$OUT/$label/pages"
for p in days channel_days slab_days product_days live_history live; do
  gcloud storage cp "gs://${BUCKET}/pages/${p}.json" "$OUT/$label/pages/" --quiet 2>/dev/null || echo "  (no pages/${p}.json)"
done
node "$DIR/tools/metric_snapshot.js" "$OUT/$label/pages" "$OUT/$label/range.json" \
  2026-11-23 2026-11-23 2026-11-16 2026-11-16 \
  2026-11-01 2026-11-04 2026-10-25 2026-10-28 \
  2026-11-24 2026-11-24 2026-11-23 2026-11-23
python3 "$DIR/tools/today_snapshot.py" "$OUT/$label/pages" "$OUT/$label/today.json"
echo "Saved to $OUT/$label"
