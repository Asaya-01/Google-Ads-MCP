# Asaya D2C dashboard

A live D2C dashboard for Asaya (worldofasaya.com), built from the kickoff brief
of 29 Oct 2026. Phase 1 is in place: **Overview, Daily, Marketing, Products
and D-1**. Retailers is removed; Inventory is hidden, and nothing on the
dashboard depends on stock data.

```
Cloud Scheduler  every 30 min from 07:00 IST
      │
      ▼
Cloud Run job  python -m app.refresh
      │  1. refresh_check: is D-1 in every source?
      │  2. BigQuery (sql/*.sql) · Shopify ShopifyQL sessions + MRP · Meta Marketing API
      │  3. builds every tab with the same daily facts → pages/<tab>.json
      │  4. D-1 commentary from Claude · alerts from 10:00 IST if data is still missing
      ▼
Cloud Storage  pages/, cache/, status/          (nothing is written to BigQuery)
      │
      ▼
Cloud Run service  /api/page/<tab>  ← Google sign-in + Firestore allowlist
```

The refresh rebuilds the pages on every run with whatever is present, and
marks the day complete once every required source has D-1; later runs that day
exit straight away. Anything missing shows as **"Data unavailable: <reason>"**,
never as zero.

## Layout

| Path | What it is |
|---|---|
| `config.json` | Every rule from the brief: tabs, valid-order filter, freebie rules, Perf vs Awareness, Meta account allowlist, channel mapping, sale detection, D-1 windows, schedule |
| `sql/` | `refresh_check`, `orders_daily`, `order_attribution`, `product_daily`, `funnel_daily`, `google_ads_daily`, `google_campaigns` |
| `app/rules.py` | Pure rule functions (channel, session kind, sale vs BAU, D-1 windows), unit-tested |
| `app/pages/` | One builder per tab; `common.py` builds the shared per-day facts |
| `app/refresh.py` | The scheduled job |
| `app/main.py` | The web service and sign-in |
| `app/shopify.py`, `app/meta.py`, `app/bq.py` | Source adapters |
| `app/commentary.py` | D-1 root-cause commentary via the Claude API |
| `app/preview.py` | Offline preview from saved inputs |
| `static/app.html` | The front end (one file; also used by the preview) |

## Metric rules (as implemented)

- **Valid order**: `test = FALSE`, `cancelled_at IS NULL`, name not matching
  `ASAYASS|ASAYAINF`, on the latest version of each order. Date = IST date of
  `created_at`. Used for every order metric.
- **GMV** = `total_price` on valid orders. Refunds and returns are not subtracted.
- **Product revenue** = line `TOTAL_SALES`, which sums to GMV exactly.
- **Excluded lines**: lines whose product type is `freebie`, `merch`, `book`,
  `gummies` or blank are left out of units and product tables
  (`freebies.exclude_product_types`). GMV and orders are not affected. Lines
  whose product no longer exists show as `(no product match)` and are kept.
  New product types are flagged for review on the Products tab.
- **Sessions**: Shopify ShopifyQL. **Awareness** = any campaign whose name
  contains "awareness" (any case, Meta or Google). Google sessions carry a
  campaign ID, so they are matched to names in `GOOGLEADS_CONSOLIDATED` (set
  rebuilt every run, paused campaigns included). The same rule splits Meta
  and Google spend into Awareness and Performance. **Perf sessions** = all sessions minus Awareness.
  Google IDs missing from `GOOGLEADS_CONSOLIDATED` count as Perf, are listed on
  the Marketing tab and raise an alert when seen on D-1.
- **IC** = GoKwik checkouts started (historical S3 report before 27 Oct, mail
  CSV from 27 Oct; a day is never assembled from both).
- **Order attribution** (D-1 drill-downs): the UTM GoKwik captured for the order
  (`Shopify_Order_Name` join). The UTM fields on `Shopify_All_orders` read
  DIRECT for almost every recent order, so they are not used.
- **AOV** = GMV / orders. **CVR** = orders / sessions. **ATC rate** = ATC /
  sessions. **MER** = GMV / (Meta + Google spend). **Perf ROAS** = GMV / spend on
  non-awareness campaigns. **Landed discount** = 1 − revenue / (units × MRP),
  MRP = today's Shopify compare-at price.
- **Sale vs BAU** (used for comparisons): a day is a sale when GMV is at least
  1.6× the median of the previous 28 BAU days; between 1.3× and 1.6× it is a
  sale when Meta spend is also at least 1.3× its BAU median, or when it sits
  within 2 days of a sale day (a sale's opening or tail). Every day carries
  its reason. Days listed in `phases.overrides` win and also feed later days'
  baselines. Sep and Oct 2026 are set from the media-plan calendars and the
  confirmed actuals: sale 10-14 Sep, 25-28 Sep, 13-18 Oct, 22-26 Oct; all
  other days in those months BAU. Add new months there as sales are confirmed;
  detection covers days with no override.
- **D-1 windows**: current = the run of same-phase days ending yesterday (up
  to 7). Prior = BAU days of the previous month closest by day of month (BAU),
  or the first days of the previous sale at least 20 days earlier (sale).
  Override in `d1.window_overrides`.

## Deploy

Needs `gcloud` signed in with Owner (or equivalent) on `asaya-data-room-487110`.

1. Create an OAuth client of type **Web application** (APIs & Services →
   Credentials). Leave origins empty for now.
2. `cp dashboard/deploy.env.example dashboard/deploy.env` and fill it in.
3. `./dashboard/deploy.sh`
4. Add the printed URL to the OAuth client's **Authorized JavaScript origins**.
5. Fill in the secrets the script lists as empty (Secret Manager):
   - `shopify-client-id`, `shopify-client-secret`: app `d1-dashboard-reader`
   - `meta-system-user-token`: the non-expiring Meta system-user token
   - `anthropic-api-key`: for the D-1 commentary
6. Run the first refresh, then (once the Meta token is in) backfill Meta
   history so sale detection and month-to-date spend have it:
   ```
   gcloud run jobs execute asaya-d2c-refresh --region asia-south1
   gcloud run jobs execute asaya-d2c-refresh --region asia-south1 --args="-m,app.refresh,--force,--meta-backfill-days,100"
   ```
7. Allowlist people: `python -m app.allowlist add name@company.com` (removal
   takes effect within 5 minutes).

## Google Ads straight from the API

Yesterday's Google spend is read from the Google Ads API at the start of the
day. `GOOGLEADS_CONSOLIDATED` (BigQuery) lands around 12:15 IST and is the
automatic fallback while the credentials are not in Secret Manager, or if the
API call fails. The Marketing tab says which source it used.

Google retired developer tokens on 9 Sep 2026: API access levels now belong to
the Google Cloud project that owns the OAuth client, and are requested from the
Google Ads API page in Cloud Console. The code sends no developer token.

Secrets (Secret Manager, never in code or chat):

| Secret | What it is |
|---|---|
| `google-ads-client-id`, `google-ads-client-secret` | An OAuth client of type Web application, with `https://developers.google.com/oauthplayground` as an authorised redirect URI. Its Cloud project (asaya-data-room-487110) must hold a Google Ads API access level (Explorer or Basic). |
| `google-ads-refresh-token` | Minted once in the OAuth Playground (gear icon, own credentials, scope `https://www.googleapis.com/auth/adwords`), signed in as a user with read access to the Google Ads account. |

`config.json` (`google_ads`): `account_id` (the World of Asaya account),
`login_customer_id` (the manager account), `api_version`. If Google retires the
version, change `api_version`; the Marketing tab then shows the API error and
falls back to BigQuery in the meantime.

## Data health and alerts

- **Data health tab** (`pages/health.json`): each source's latest day, D-1
  rows, state and arrival time, the cross-checks, and the last week's arrival
  times. Arrival times are recorded in `status/<day>.json`.
- **Cross-checks** (`refresh.reconcile` in `config.json`): D-1 orders in
  BigQuery against Shopify's own count (`ordersCount`, test orders excluded),
  and Meta and Google spend rows against each account's own total. A check
  marked `block` keeps the day open until it agrees (orders only today); the
  others show on the Data health tab. A check that cannot run never blocks.
- **Alerts** (all through the same `ALERT_EMAIL` channel):
  data still missing at 10:00 IST (names the source and the reason in the log),
  new Google campaign IDs, the refresh job crashing (the app emails once every
  3 hours), and a failed Cloud Run execution (a Cloud Monitoring policy, created
  best-effort by `deploy.sh`).

## Local development

```
pip install -r dashboard/requirements.txt pytest
cd dashboard && python -m pytest -q
```

Preview from saved inputs (no cloud access needed). The inputs and the preview
hold real business numbers; both are gitignored, keep them private:

```
python -m app.refresh --dump-inputs inputs/      # on a machine with GCP access
python -m app.preview --inputs inputs/ --d1 2026-10-28 --out preview.html
```

Run the web service against a local store, sign-in skipped:

```
STORE_DIR=/path/to/store DEV_USER_EMAIL=you@example.com uvicorn app.main:app --port 8080
```

## Checks run on 29 Oct 2026 (Phase 1, steps 1–2)

- Valid-order totals for 1–28 Oct reproduce the brief's figures exactly; the
  excluded figure in the brief is sample + influencer orders only (cancelled
  orders are excluded separately).
- Daily orders and GMV for 22–28 Oct agree with Shopify's own sales report once
  influencer orders and cancellations are accounted for.
- `Shopify_All_orders_items` exists, covers every valid order, and its line
  revenue sums to GMV exactly. It stays in sync with orders.
- Google campaign IDs on Google-sourced sessions (25–28 Oct): every numeric ID
  matched `GOOGLEADS_CONSOLIDATED`; 0.05% of Google sessions carry no ID.
- Order attribution through GoKwik covers about 99% of valid orders.
- GoKwik funnel and orders reports are continuous across the 26/27 Oct switch.
- Shopify session totals from the per-UTM breakdown equal Shopify's day totals.
- Meta campaign-level spend for 22–28 Oct adds up to each account's daily total;
  every Asaya Top Funnel campaign is an Awareness campaign.

## Open items

- Meta system-user token (Marketing tab Meta figures, MER, Perf ROAS, sale
  detection's spend signal).
- Anthropic API key for the D-1 commentary.
- `GOOGLEADS_CONSOLIDATED` has no rows for 7 Oct because the Google Ads account
  had no budget that day. It is recorded as a real zero in
  `google_ads.zero_spend_dates`. Any other day with no rows in the synced range
  still shows as a sync gap (unavailable, with a labelled partial total).
- GoKwik daily S3 drop (the mail CSV is still manual).
- Phase 2 (Traffic, Web & App, Calendar, Monthly, Search) and Phase 3 (Cohorts).
