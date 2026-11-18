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
KEY="$(gcloud services api-keys list --filter "displayName=\"$NAME\"" --format 'value(name)' "${P[@]}" 2>/dev/null | head -1)"
if [[ -z "$KEY" ]]; then
  if ! gcloud services api-keys create --display-name "$NAME" \
    --api-target service=pagespeedonline.googleapis.com \
    --api-target service=chromeuxreport.googleapis.com "${P[@]}" >/dev/null 2>/tmp/apikey_err.txt; then
    if grep -q "apikeys.keys.create\|apiKeys.create" /tmp/apikey_err.txt; then
      ME="$(gcloud config get-value account 2>/dev/null)"
      echo "ERROR: ${ME} may not create API keys in ${PROJECT} (it needs the role API Keys Admin)."
      echo "A project Owner can grant it with:"
      echo "  gcloud projects add-iam-policy-binding ${PROJECT} --member user:${ME} --role roles/serviceusage.apiKeysAdmin --condition None"
      echo "then run this script again."
    else
      cat /tmp/apikey_err.txt
    fi
    rm -f /tmp/apikey_err.txt
    exit 1
  fi
  rm -f /tmp/apikey_err.txt
  KEY="$(gcloud services api-keys list --filter "displayName=\"$NAME\"" --format 'value(name)' "${P[@]}" 2>/dev/null | head -1)"
fi
[[ -n "$KEY" ]] || { echo "ERROR: could not create the key"; exit 1; }
gcloud secrets describe google-api-key "${P[@]}" >/dev/null 2>&1 \
  || gcloud secrets create google-api-key --replication-policy automatic "${P[@]}"
gcloud services api-keys get-key-string "$KEY" --format 'value(keyString)' "${P[@]}" \
  | tr -d '\n' | gcloud secrets versions add google-api-key --data-file - "${P[@]}" >/dev/null
echo "Saved the key in Secret Manager as google-api-key (limited to PageSpeed Insights and the Chrome UX Report)."
