#!/usr/bin/env bash
#
# Deploy Dashboard Plus (branch dashboard-plus) WITHOUT touching the live
# dashboard. Run it from a checkout of the dashboard-plus branch:
#
#   git checkout dashboard-plus && ./dashboard/deploy_plus.sh
#
# What it creates (idempotent, safe to re-run):
#   - image   .../dashboards/asaya-d2c-dashboard:plus   (its own tag; the live
#             service keeps running :latest)
#   - Cloud Run service  asaya-d2c-dashboard-plus  a preview copy of the
#             dashboard with the "Plus" tab, reading the same page snapshots
#   - Cloud Run job      asaya-d2c-plus   builds pages/plus.json and takes the
#             daily stock snapshots into BigQuery dataset dashboard_plus
#   - Cloud Scheduler    asaya-d2c-plus   four times a day (snapshots at most
#             once a day; the pages are rebuilt each run)
#
# It never redeploys the live service, the refresh, retention or live jobs.
#
# Before the first run (once):
#   bq mk --location=asia-south1 --dataset asaya-data-room-487110:dashboard_plus
#   then grant the dashboard's service account BigQuery Data Editor on that
#   dataset only (see docs/plus/phase1.md).
#
# Optional input sheets (share each with the service account as Viewer and put
# the sheet id in deploy.env; the tabs show "Input needed" until then):
#   PLUS_COGS_SHEET, PLUS_RATE_CARD_SHEET, PLUS_INFLUENCER_SHEET, PLUS_CHANGES_SHEET

set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${CONFIG_FILE:-$DIR/deploy.env}"
if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "ERROR: $CONFIG_FILE not found (the same file deploy.sh uses)."
  exit 1
fi
# shellcheck disable=SC1090
source "$CONFIG_FILE"

: "${GOOGLE_PROJECT_ID:?Set GOOGLE_PROJECT_ID in $CONFIG_FILE}"
: "${GOOGLE_OAUTH_CLIENT_ID:?Set GOOGLE_OAUTH_CLIENT_ID in $CONFIG_FILE}"
REGION="${REGION:-asia-south1}"
LIVE_SERVICE="${SERVICE:-asaya-d2c-dashboard}"
PLUS_SERVICE="${PLUS_SERVICE:-asaya-d2c-dashboard-plus}"
PLUS_JOB="${PLUS_JOB:-asaya-d2c-plus}"
AR_REPO="${AR_REPO:-dashboards}"
BUCKET="${GOOGLE_PROJECT_ID}-d2c-dashboard"
SA="d2c-dashboard@${GOOGLE_PROJECT_ID}.iam.gserviceaccount.com"
IMAGE="${REGION}-docker.pkg.dev/${GOOGLE_PROJECT_ID}/${AR_REPO}/${LIVE_SERVICE}:plus"
P=(--project "$GOOGLE_PROJECT_ID" --quiet)

BUILD_SHA="$(git -C "$DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)"
BUILD_BRANCH="$(git -C "$DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
if [[ "$BUILD_BRANCH" != "dashboard-plus" ]]; then
  echo "ERROR: this checkout is on '${BUILD_BRANCH}'. Run: git checkout dashboard-plus && git pull origin dashboard-plus"
  exit 1
fi
echo "==> Dashboard Plus: commit ${BUILD_SHA} on ${BUILD_BRANCH}, project ${GOOGLE_PROJECT_ID}"

if ! bq --project_id "$GOOGLE_PROJECT_ID" show --format none "${GOOGLE_PROJECT_ID}:dashboard_plus" >/dev/null 2>&1; then
  echo "WARNING: dataset dashboard_plus not found. Stock snapshots will say 'not taken' until it exists:"
  echo "  bq mk --location=${REGION} --dataset ${GOOGLE_PROJECT_ID}:dashboard_plus"
fi

echo "==> [1/4] Building the image (tag :plus)"
gcloud builds submit "$DIR" --tag "$IMAGE" "${P[@]}"

ENV_VARS="SNAPSHOT_BUCKET=${BUCKET}@@GOOGLE_OAUTH_CLIENT_ID=${GOOGLE_OAUTH_CLIENT_ID}@@RUNTIME_SA_EMAIL=${SA}"
ENV_VARS="${ENV_VARS}@@BUILD_SHA=${BUILD_SHA}@@BUILD_BRANCH=${BUILD_BRANCH}@@BUILD_AT=$(date -u +%Y-%m-%dT%H:%MZ)"
for v in SPEND_SHEET_AFFILIATE SPEND_SHEET_CRM_FLOW SPEND_SHEET_CRM_BROADCAST SPEND_SHEET_REDDIT \
         PLUS_COGS_SHEET PLUS_RATE_CARD_SHEET PLUS_INFLUENCER_SHEET PLUS_CHANGES_SHEET; do
  [[ -n "${!v:-}" ]] && ENV_VARS="${ENV_VARS}@@${v}=${!v}"
done

echo "==> [2/4] Preview service ${PLUS_SERVICE} (the live ${LIVE_SERVICE} is not touched)"
gcloud run deploy "$PLUS_SERVICE" --image "$IMAGE" --region "$REGION" --service-account "$SA" \
  --set-env-vars "^@@^$ENV_VARS" --allow-unauthenticated --memory 1Gi --timeout 900 --max-instances 2 "${P[@]}"

echo "==> [3/4] Job ${PLUS_JOB}"
gcloud run jobs deploy "$PLUS_JOB" --image "$IMAGE" --region "$REGION" --service-account "$SA" \
  --set-env-vars "^@@^$ENV_VARS" --command python --args=-m,app.plus.job \
  --memory 1Gi --task-timeout 1200 --max-retries 0 "${P[@]}"
gcloud run jobs add-iam-policy-binding "$PLUS_JOB" --region "$REGION" --member "serviceAccount:$SA" \
  --role roles/run.invoker "${P[@]}" >/dev/null

echo "==> [4/4] Schedule (09:50, 13:50, 17:50, 21:50 IST)"
RUN_URI="https://run.googleapis.com/v2/projects/${GOOGLE_PROJECT_ID}/locations/${REGION}/jobs/${PLUS_JOB}:run"
SCHED=(--location "$REGION" --schedule "50 9,13,17,21 * * *" --time-zone "Asia/Kolkata" --uri "$RUN_URI"
       --http-method POST --oauth-service-account-email "$SA")
if gcloud scheduler jobs describe "$PLUS_JOB" --location "$REGION" "${P[@]}" >/dev/null 2>&1; then
  gcloud scheduler jobs update http "$PLUS_JOB" "${SCHED[@]}" "${P[@]}"
else
  gcloud scheduler jobs create http "$PLUS_JOB" "${SCHED[@]}" "${P[@]}"
fi

URL="$(gcloud run services describe "$PLUS_SERVICE" --region "$REGION" --format 'value(status.url)' "${P[@]}")"
cat <<EOM

Done. Dashboard Plus preview: ${URL}   (open the "Plus" tab)

Next:
  1. On OAuth client ${GOOGLE_OAUTH_CLIENT_ID} add
       Authorized JavaScript origin:  ${URL}
       Authorized redirect URI:       ${URL}/auth/google/redirect
  2. Build the Plus page and take today's snapshot now:
       gcloud run jobs execute ${PLUS_JOB} --region ${REGION} --project ${GOOGLE_PROJECT_ID} --wait
EOM
