#!/usr/bin/env bash
#
# One-time: an API key for the SEO tab's speed sections (PageSpeed Insights
# and the Chrome UX Report), limited to those two APIs, saved straight into
# Secret Manager as "google-api-key". The key is never printed.
#
# Usage (Cloud Shell, from ~/google-ads-mcp):  ./dashboard/tools/make_api_key.sh

set -euo pipefail
PROJECT="${GOOGLE_PROJECT_ID:-asaya-data-room-487110}"
NAME="Asaya dashboard - PageSpeed and CrUX (read only)"
P=(--project "$PROJECT" --quiet)

gcloud services enable apikeys.googleapis.com pagespeedonline.googleapis.com chromeuxreport.googleapis.com "${P[@]}"
KEY="$(gcloud services api-keys list --filter "displayName=\"$NAME\"" --format 'value(name)' "${P[@]}" | head -1)"
if [[ -z "$KEY" ]]; then
  gcloud services api-keys create --display-name "$NAME" \
    --api-target service=pagespeedonline.googleapis.com \
    --api-target service=chromeuxreport.googleapis.com "${P[@]}" >/dev/null
  KEY="$(gcloud services api-keys list --filter "displayName=\"$NAME\"" --format 'value(name)' "${P[@]}" | head -1)"
fi
[[ -n "$KEY" ]] || { echo "ERROR: could not create the key"; exit 1; }
gcloud secrets describe google-api-key "${P[@]}" >/dev/null 2>&1 \
  || gcloud secrets create google-api-key --replication-policy automatic "${P[@]}"
gcloud services api-keys get-key-string "$KEY" --format 'value(keyString)' "${P[@]}" \
  | tr -d '\n' | gcloud secrets versions add google-api-key --data-file - "${P[@]}" >/dev/null
echo "Saved the key in Secret Manager as google-api-key (limited to PageSpeed Insights and the Chrome UX Report)."
