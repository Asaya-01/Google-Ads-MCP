#!/usr/bin/env bash
#
# Deploy the Asaya D2C dashboard to Google Cloud.
#
# What it creates in GOOGLE_PROJECT_ID (all idempotent, safe to re-run):
#   - service account  d2c-dashboard@   with read-only BigQuery, its own bucket,
#                                       Firestore, Secret Manager access
#   - Cloud Storage bucket for page snapshots and caches (private)
#   - Firestore database (if the project has none) for the sign-in allowlist
#   - Secret Manager secrets (empty placeholders you fill in; see README)
#   - Cloud Run service  (the dashboard)  and Cloud Run job (the refresh)
#   - Cloud Scheduler job: every 30 minutes from 07:00 to 23:30 IST
#   - log-based alert to ALERT_EMAIL when data is still missing at 10:00 IST
#
# Usage:
#   cp dashboard/deploy.env.example dashboard/deploy.env   # fill it in
#   ./dashboard/deploy.sh

set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${CONFIG_FILE:-$DIR/deploy.env}"
if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "ERROR: $CONFIG_FILE not found. Copy dashboard/deploy.env.example to dashboard/deploy.env and fill it in."
  exit 1
fi
# shellcheck disable=SC1090
source "$CONFIG_FILE"

: "${GOOGLE_PROJECT_ID:?Set GOOGLE_PROJECT_ID in $CONFIG_FILE}"
: "${GOOGLE_OAUTH_CLIENT_ID:?Set GOOGLE_OAUTH_CLIENT_ID in $CONFIG_FILE}"
REGION="${REGION:-asia-south1}"
SERVICE="${SERVICE:-asaya-d2c-dashboard}"
JOB="${JOB:-asaya-d2c-refresh}"
AR_REPO="${AR_REPO:-dashboards}"
BUCKET="${GOOGLE_PROJECT_ID}-d2c-dashboard"
SA_NAME="d2c-dashboard"
SA="${SA_NAME}@${GOOGLE_PROJECT_ID}.iam.gserviceaccount.com"
IMAGE="${REGION}-docker.pkg.dev/${GOOGLE_PROJECT_ID}/${AR_REPO}/${SERVICE}:latest"
P=(--project "$GOOGLE_PROJECT_ID" --quiet)

echo "==> Project ${GOOGLE_PROJECT_ID}, region ${REGION}"

echo "==> [1/9] Enabling APIs"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  secretmanager.googleapis.com firestore.googleapis.com cloudscheduler.googleapis.com \
  bigquery.googleapis.com storage.googleapis.com monitoring.googleapis.com logging.googleapis.com "${P[@]}"

echo "==> [2/9] Service account and roles"
gcloud iam service-accounts describe "$SA" "${P[@]}" >/dev/null 2>&1 \
  || gcloud iam service-accounts create "$SA_NAME" --display-name "Asaya D2C dashboard" "${P[@]}"
for role in roles/bigquery.dataViewer roles/bigquery.jobUser roles/datastore.user \
            roles/secretmanager.secretAccessor roles/logging.logWriter; do
  gcloud projects add-iam-policy-binding "$GOOGLE_PROJECT_ID" --member "serviceAccount:$SA" \
    --role "$role" --condition None "${P[@]}" >/dev/null
done

echo "==> [3/9] Snapshot bucket gs://${BUCKET}"
gcloud storage buckets describe "gs://${BUCKET}" "${P[@]}" >/dev/null 2>&1 \
  || gcloud storage buckets create "gs://${BUCKET}" --location "$REGION" --uniform-bucket-level-access \
       --public-access-prevention "${P[@]}"
gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" --member "serviceAccount:$SA" \
  --role roles/storage.objectAdmin "${P[@]}" >/dev/null

echo "==> [4/9] Firestore (allowlist)"
gcloud firestore databases describe --database "(default)" "${P[@]}" >/dev/null 2>&1 \
  || gcloud firestore databases create --location "$REGION" "${P[@]}"

echo "==> [5/9] Secrets"
ensure_secret() {
  gcloud secrets describe "$1" "${P[@]}" >/dev/null 2>&1 \
    || gcloud secrets create "$1" --replication-policy automatic "${P[@]}"
}
for s in shopify-client-id shopify-client-secret meta-system-user-token anthropic-api-key; do
  ensure_secret "$s"
done
ensure_secret dashboard-session-key
if ! gcloud secrets versions describe latest --secret dashboard-session-key "${P[@]}" >/dev/null 2>&1; then
  python3 -c 'import secrets; print(secrets.token_hex(32), end="")' \
    | gcloud secrets versions add dashboard-session-key --data-file - "${P[@]}"
fi
MISSING=()
for s in shopify-client-id shopify-client-secret meta-system-user-token anthropic-api-key; do
  gcloud secrets versions describe latest --secret "$s" "${P[@]}" >/dev/null 2>&1 || MISSING+=("$s")
done

echo "==> [6/9] Building the image"
gcloud artifacts repositories describe "$AR_REPO" --location "$REGION" "${P[@]}" >/dev/null 2>&1 \
  || gcloud artifacts repositories create "$AR_REPO" --repository-format docker --location "$REGION" "${P[@]}"
gcloud builds submit "$DIR" --tag "$IMAGE" "${P[@]}"

ENV_VARS="SNAPSHOT_BUCKET=${BUCKET},GOOGLE_OAUTH_CLIENT_ID=${GOOGLE_OAUTH_CLIENT_ID}"
[[ -n "${ALERT_WEBHOOK_URL:-}" ]] && ENV_VARS="${ENV_VARS},ALERT_WEBHOOK_URL=${ALERT_WEBHOOK_URL}"

echo "==> [7/9] Cloud Run service ${SERVICE}"
# Public endpoint on purpose: the app itself enforces Google sign-in and the
# Firestore allowlist on every page and API call.
gcloud run deploy "$SERVICE" --image "$IMAGE" --region "$REGION" --service-account "$SA" \
  --set-env-vars "$ENV_VARS" --allow-unauthenticated --memory 512Mi --max-instances 3 "${P[@]}"

echo "==> [8/9] Refresh job ${JOB} and schedule"
gcloud run jobs deploy "$JOB" --image "$IMAGE" --region "$REGION" --service-account "$SA" \
  --set-env-vars "$ENV_VARS" --command python --args=-m,app.refresh \
  --memory 2Gi --task-timeout 1800 --max-retries 0 "${P[@]}"
gcloud run jobs add-iam-policy-binding "$JOB" --region "$REGION" --member "serviceAccount:$SA" \
  --role roles/run.invoker "${P[@]}" >/dev/null
RUN_URI="https://run.googleapis.com/v2/projects/${GOOGLE_PROJECT_ID}/locations/${REGION}/jobs/${JOB}:run"
SCHED=(--location "$REGION" --schedule "0,30 7-23 * * *" --time-zone "Asia/Kolkata" --uri "$RUN_URI"
       --http-method POST --oauth-service-account-email "$SA")
if gcloud scheduler jobs describe "$JOB" --location "$REGION" "${P[@]}" >/dev/null 2>&1; then
  gcloud scheduler jobs update http "$JOB" "${SCHED[@]}" "${P[@]}"
else
  gcloud scheduler jobs create http "$JOB" "${SCHED[@]}" "${P[@]}"
fi

echo "==> [9/9] Alerts"
gcloud logging metrics describe asaya_dashboard_alert "${P[@]}" >/dev/null 2>&1 \
  || gcloud logging metrics create asaya_dashboard_alert \
       --description "Asaya D2C dashboard: data missing or unclassified Google IDs" \
       --log-filter 'jsonPayload.alert="asaya-dashboard-alert"' "${P[@]}"
if [[ -n "${ALERT_EMAIL:-}" ]]; then
  CHANNEL="$(gcloud beta monitoring channels list --filter "labels.email_address=\"${ALERT_EMAIL}\"" \
              --format 'value(name)' "${P[@]}" | head -1)"
  if [[ -z "$CHANNEL" ]]; then
    CHANNEL="$(gcloud beta monitoring channels create --display-name "Asaya dashboard alerts" --type email \
                --channel-labels "email_address=${ALERT_EMAIL}" --format 'value(name)' "${P[@]}")"
  fi
  if ! gcloud alpha monitoring policies list --filter 'display_name="Asaya D2C dashboard alert"' \
         --format 'value(name)' "${P[@]}" | grep -q .; then
    POLICY="$(mktemp)"
    cat > "$POLICY" <<JSON
{
  "displayName": "Asaya D2C dashboard alert",
  "combiner": "OR",
  "conditions": [{
    "displayName": "Dashboard alert logged",
    "conditionThreshold": {
      "filter": "metric.type=\"logging.googleapis.com/user/asaya_dashboard_alert\" AND resource.type=\"cloud_run_job\"",
      "comparison": "COMPARISON_GT", "thresholdValue": 0, "duration": "0s",
      "aggregations": [{"alignmentPeriod": "300s", "perSeriesAligner": "ALIGN_COUNT"}]
    }
  }],
  "notificationChannels": ["${CHANNEL}"],
  "documentation": {"mimeType": "text/markdown", "content": "Open the job's logs and look for entries with alert=asaya-dashboard-alert."}
}
JSON
    gcloud alpha monitoring policies create --policy-from-file "$POLICY" "${P[@]}"
    rm -f "$POLICY"
  fi
fi

if [[ -n "${FIRST_ALLOWED_EMAIL:-}" ]]; then
  EMAIL_LC="$(echo "$FIRST_ALLOWED_EMAIL" | tr '[:upper:]' '[:lower:]')"
  TOKEN="$(gcloud auth print-access-token)"
  curl -sS -X PATCH -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json" \
    "https://firestore.googleapis.com/v1/projects/${GOOGLE_PROJECT_ID}/databases/(default)/documents/dashboard_allowlist/${EMAIL_LC}" \
    -d '{"fields": {"active": {"booleanValue": true}}}' >/dev/null && echo "    allowlisted ${EMAIL_LC}"
fi

URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --format 'value(status.url)' "${P[@]}")"
cat <<EOM

Done. Dashboard: ${URL}

Next:
  1. Add ${URL} to "Authorized JavaScript origins" on OAuth client ${GOOGLE_OAUTH_CLIENT_ID}.
  2. Run the first refresh now instead of waiting for 07:00 IST:
       gcloud run jobs execute ${JOB} --region ${REGION} --project ${GOOGLE_PROJECT_ID}
EOM
if (( ${#MISSING[@]} )); then
  echo "  3. These secrets are still empty (the dashboard shows those sources as unavailable until they are set):"
  for s in "${MISSING[@]}"; do
    echo "       printf '%s' 'VALUE' | gcloud secrets versions add ${s} --data-file - --project ${GOOGLE_PROJECT_ID}"
  done
fi
