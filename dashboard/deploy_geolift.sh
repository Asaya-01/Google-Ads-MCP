#!/usr/bin/env bash
#
# The GeoLift (R) jobs for the Awareness tab. Run after deploy.sh, from the
# same checkout:  ./dashboard/deploy_geolift.sh
#
#   asaya-geolift-weekly   power, market selection and the interim / final
#                          readout of every planned or active test (Mon 09:00 IST)
#   asaya-geolift-monthly  the testability scan of every eligible state and
#                          city cluster (1st of the month, 09:30 IST)
#
# The image (R + GeoLift from GitHub) takes 20-30 minutes to build the first
# time. The jobs read the panels the Awareness job wrote to the bucket and
# write their results back there; they have no BigQuery access and need none.

set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${CONFIG_FILE:-$DIR/deploy.env}"
: "${GOOGLE_PROJECT_ID:?Set GOOGLE_PROJECT_ID in deploy.env}"
REGION="${REGION:-asia-south1}"
AR_REPO="${AR_REPO:-dashboards}"
BUCKET="${GOOGLE_PROJECT_ID}-d2c-dashboard"
SA="d2c-dashboard@${GOOGLE_PROJECT_ID}.iam.gserviceaccount.com"
IMAGE="${REGION}-docker.pkg.dev/${GOOGLE_PROJECT_ID}/${AR_REPO}/asaya-geolift:latest"
P=(--project "$GOOGLE_PROJECT_ID" --quiet)

echo "==> Building the GeoLift image (first build: 20-30 min)"
gcloud builds submit "$DIR/awareness_r" --tag "$IMAGE" --timeout 3600s --machine-type e2-highcpu-8 "${P[@]}"

for MODE in weekly monthly; do
  JOB="asaya-geolift-${MODE}"
  # the monthly scan runs GeoLiftPower for every eligible geo: give it time and cores
  if [[ "$MODE" == monthly ]]; then RES=(--cpu 8 --memory 16Gi --task-timeout 86400); SCHED="30 9 1 * *";
  else RES=(--cpu 4 --memory 8Gi --task-timeout 21600); SCHED="0 9 * * 1"; fi
  gcloud run jobs deploy "$JOB" --image "$IMAGE" --region "$REGION" --service-account "$SA" \
    --set-env-vars "SNAPSHOT_BUCKET=${BUCKET}" --args="$MODE" "${RES[@]}" --max-retries 0 "${P[@]}"
  gcloud run jobs add-iam-policy-binding "$JOB" --region "$REGION" --member "serviceAccount:$SA" \
    --role roles/run.invoker "${P[@]}" >/dev/null
  URI="https://run.googleapis.com/v2/projects/${GOOGLE_PROJECT_ID}/locations/${REGION}/jobs/${JOB}:run"
  ARGS=(--location "$REGION" --schedule "$SCHED" --time-zone "Asia/Kolkata" --uri "$URI" --http-method POST --oauth-service-account-email "$SA")
  if gcloud scheduler jobs describe "$JOB" --location "$REGION" "${P[@]}" >/dev/null 2>&1; then
    gcloud scheduler jobs update http "$JOB" "${ARGS[@]}" "${P[@]}"
  else
    gcloud scheduler jobs create http "$JOB" "${ARGS[@]}" "${P[@]}"
  fi
done

cat <<EOM

Done. First runs, in this order:
  gcloud run jobs execute asaya-d2c-awareness --region ${REGION} --project ${GOOGLE_PROJECT_ID} --wait
  gcloud run jobs execute asaya-geolift-weekly --region ${REGION} --project ${GOOGLE_PROJECT_ID} --wait
  gcloud run jobs execute asaya-geolift-monthly --region ${REGION} --project ${GOOGLE_PROJECT_ID}
then the Awareness job again (or wait for 07:15) to fold the GeoLift results into the tab.
EOM
