#!/usr/bin/env bash
# weekly : power, market selection and the interim / final readout of every
#          planned or active test (Mondays 09:00 IST)
# monthly: the testability scan of every eligible state and city (1st, 09:30)
set -euo pipefail
MODE="${1:-weekly}"
export WORK=/work
mkdir -p "$WORK/out/plots"
python3 /app/gcs_io.py download
STATUS=ok; ERR=""
START=$(date +%s)
if ! Rscript /app/geolift.R "$MODE"; then STATUS=error; ERR="GeoLift R script failed (see the job's logs)"; fi
python3 /app/gcs_io.py upload "$MODE" "$STATUS" "$(( $(date +%s) - START ))" "$ERR"
[ "$STATUS" = ok ]
