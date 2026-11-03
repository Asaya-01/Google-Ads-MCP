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
   gcloud run jobs execute asaya-d2c-refresh --region asia-south1 --args="-m,app.refresh,--force,--meta-backfill-days,400"
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

## Performance and Awareness views, and the ad drill-down

A toggle at the top of Overview, Daily, Marketing, D-1 and Today switches
between **Performance**, **Awareness** and **All campaigns** (default
Performance). Awareness is a campaign whose name contains "awareness" (Meta,
or Google by campaign id, as everywhere else); Performance is everything else.
The Reach campaigns (`sessions.social_name_regex`, e.g.
`WOA_Awareness_TOF_Reach`) are the social team's spend: they count in total
spend and the All view, and are kept out of both Performance and Awareness.
Each view reads only its own data: spend, sessions, add-to-carts, GoKwik
checkouts and the orders and GMV credited to it by UTM. Fields that cannot be
split (new vs repeat; affiliate and CRM for Awareness) say so instead of
showing a number. The Today tab cannot split live Shopify sessions and orders,
so in the Awareness view it shows spend and delivery only. Awareness is judged
on impressions, CPM, CTR and cost of reach, so the Awareness tables lead with
those and not ROAS.

## Every tab, top down: overview › channel › stage › product › campaign

Overview and Marketing read the same way: the headline tiles for the picked
dates against the comparison, then **Sales by channel** (Shopify orders and GMV
by the UTM of the converting visit, organic and direct included), then
**Spend and return** as one table where every row opens the level below:

- **Meta** › **TOF / MOF / BOF / Catalog** › **product** › campaign › ad set › ad
- **Google Ads** › **Brand Search / Brand PMax / Non-brand PMax** (› product) /
  Demand Gen / YouTube › campaign › ad group or asset group › ad
- **Affiliate**, **Reddit** (sales campaigns, spend only) and **CRM**
  (› flows / broadcasts), from the spend sheets
- a last row with Shopify GMV over all spend

In the Awareness view Meta opens by goal (ATC, LPV, Amazon) instead of stage.
A "Campaigns" switch drops the stage and product levels. Marketing adds a
**product × stage** grid for Meta; a click on a cell opens those campaigns,
ad sets and ads in the table.

How names are read (`app/taxonomy.py`, codes and words in `config.json`
`taxonomy`):

- **Stage** comes from the ad name first, the same as the daily Meta report:
  `MOF_…` and `BOF_…` ads are MOF and BOF even inside a TOF-named offer
  campaign (they run during a sale). "Catalog", "Catalogue" or "AllFunnels"
  anywhere wins. Otherwise TOF / MOF / BOF in the campaign name, else TOF.
- **Product** comes from the ad name, then the ad set, then the campaign: UAS,
  ITB, ASS, HOT, EEC, KNE, SLSS, Spot Gel, Peel, GFS, Scrub, and the sets as
  their own rows (Target & Fade Duo, Even Skin Duo, Even-tone Body Trio, Head
  to Toe Set). An ad naming two products (`UAS+ITB`) counts half to each. An
  ad with no product is a site-wide offer ad (B2@749, Buy2@849, "Offer"), the
  catalog, or "Unmapped", so the rows always add up. On the last 90 days of
  real ad names nothing was Unmapped.
- A new product code is a line in `taxonomy.products`, not a code change.

Campaign rows come from every day we have. Stage and product by ad name, and
what is below a campaign, come from `meta_tree` and `google_tree`, which cover
the last 90 days (`meta.ad_history_days`, `google_ads.tree_days`); on older
days the campaign name decides, and the table says so. Meta's older ad-level
days are filled in 21 days per refresh, newest first. Performance Max has asset
groups and nothing below them, because Google reports no spend per asset.

## What counts as awareness, and "Perf. sessions"

- **Meta**: a campaign name containing "awareness". **Google**: the campaign id
  is one of the awareness campaigns (looked up by name through the API, plus
  the ids the team listed in `sessions.google_awareness_extra_ids`, which
  covers old campaigns the API no longer returns). **Reddit**: a campaign name
  containing "traffic" is awareness **from 1 Nov 2026** (`sessions.dated_awareness`);
  before that every Reddit campaign counted as performance. Reddit sales
  campaigns are always performance. Reach campaigns are social.
- The Top Funnel campaign `WOA_Awareness_TOF_Sales_Skincare_ATC_UAS` reaches
  Shopify as `WOA_TOF_Sales_Skincare_ATC_UAS` or as its bare id, so
  `sessions.awareness_utm_campaigns` lists those as awareness too.
- **Perf. sessions** (the D-1 column, `report_perf_sessions`) follow the team's
  Shopify report: the UTM source is on the team's list
  (`sessions.report_perf_sources`: Meta, Google, Reddit, YouTube, the
  affiliates and the CRM sources), the visit carries a UTM campaign, and it is
  not awareness or social. Direct and organic visits, ig, wishlink, chatgpt,
  criteo and any source not on the list are not in it. CVR % (on perf) is
  orders divided by it. On 1 and 2 Nov it matches the report's add-to-carts
  and is within 0.3% on sessions. A new source is one word in the list.
  On D-1, **Orders** and **Revenue** are Shopify's own Sales report (Orders and
  Total sales per day, with only ASAYAINF and ASAYASS orders left out), pulled
  with ShopifyQL on every refresh. Cancelled orders still count as orders there
  and returns come off Total sales, so D-1 differs from the Overview's GMV on
  purpose; it matches the team's sheet exactly (1 Nov: 804 orders, Rs 631,947).
  The AOV, IC → orders %, CVR % and RoAS on D-1 use these two numbers.
  **Spends** is all channels on sales campaigns (Meta, Google, Reddit,
  affiliate, CRM; awareness and social left out), **RoAS** is revenue ÷ Spends
  and **CPS** is Spends ÷ overall sessions. For 1 Nov this reproduces the
  team's sheet to within Rs 53 (521,170 against 521,117).

## Affiliate and CRM spends

Affiliate, CRM flow and CRM broadcast spends come from the team's Google
Sheets, read on every refresh (`app/sheets.py`, configured under
`manual_spends` in `config.json`; the sheet ids come from the `SPEND_SHEET_*`
variables in `deploy.env`). Each sheet is shared with the dashboard's service
account as Viewer; `deploy.sh` enables the Sheets API and lets the service
account request a Sheets-scoped token for itself.

- **Affiliate**: spend and affiliate-credited sales from the "Daily - report"
  tab. **CRM**: flow spend and revenue ("Daily Flow Spends") plus broadcast
  spend and revenue ("Broadcast Daily Spends"), added together.
- **Not entered vs zero**: these sheets are pre-filled with zeros for days that
  have not been entered. The latest day with a number is the day a source is
  "filled through"; later days are unavailable ("not entered in the sheet
  yet"), never zero. The broadcast sheet is filled through the day the flow
  sheet is, because its real no-broadcast days are zeros too. A date written
  twice keeps the row with the larger spend.
- **Reddit (temporary)**: sales-campaign spend from the Reddit block of the
  monthly media-plan workbook ("Target vs Achieved" tab, the Reddit "Actual
  Spend" column, id in `SPEND_SHEET_REDDIT`), until the Reddit bot loads
  BigQuery. The sheet has no Reddit revenue, so Reddit has a spend and no ROAS.
  Reddit traffic campaigns belong to the Awareness bucket, which will come from
  BigQuery; they are not in this sheet. The workbook is monthly, so Reddit is
  in the totals only from the day the sheet starts (1 Nov 2026): earlier days
  leave it out of overall spend rather than blanking it (about 2% of spend),
  and the Reddit row says "n of m days" for a range that straddles the start.
  Put one workbook id per month in `SPEND_SHEET_REDDIT`, comma separated
  (`oct_id,nov_id`): the days of all of them are put together, and without
  October's the Reddit spend for October is simply missing from overall spend.
  Add December's id when the month starts.
- **Overall ROAS** = GMV / (Meta + Google + affiliate + CRM + Reddit). It stays
  blank for a day until every part is in. The existing MER and Shopify ROAS (Perf) are
  unchanged. Channel ROAS (affiliate, CRM flow, CRM broadcast) is each
  channel's own revenue / its spend.
- **Today (live)**: Meta and Google are real. Affiliate and CRM are estimates
  from the latest filled days of the same kind (sale or BAU): CRM = a typical
  day's spend x hours so far / 24; affiliate = its share of GMV x today's GMV so
  far. Reddit = a typical day's spend x hours so far / 24, and is left out of
  the total when the sheet has fewer than two filled days.
- If a sheet cannot be read, the last good copy is used and the dashboard says
  so; a sheet never read stays unavailable with the reason.

## Sale and BAU days

Sales are found from the hour-by-hour order counts (`orders_hourly.sql`), not
from daily totals, the way a person reads them: a sale goes live at some hour
(usually 6 to 9 pm) and orders jump to several times their normal level for that
hour, then fall back when it ends. `rules.detect_sales_hourly` builds the usual
shape of a day, scales it to the BAU level around each date (a second pass that
ignores sale days, so a long sale cannot lift its own yardstick), and calls a
sale from the hour the 3-hour average passes `on_ratio` until it stays under
`off_ratio`. Bumps shorter than `min_hours` (a one-day push) are not sales.
A day is **sale** when at least 85% of its orders came while a sale was live,
**BAU** when at most 10%, and **transition** in between (the sale went live or
ended that day, with the hour shown); transition days sit out of both sides of
every comparison. The Today tab reads today's last three hours the same way, so
it notices a sale going live. Sessions are not used: they move with ad spend and
did not step up at launch. A date can still be forced in `phases.overrides`
(empty by default). Without enough hourly history the older daily rule is used.

## Date ranges

Overview, Daily, Marketing, Products and D-1 share one date picker and one
comparison menu (Shopify style). Sale days are only ever compared with sale
days, and BAU days with BAU days: a mixed range is split into a BAU block and a
sale block, each against the same kind of days in the comparison period. The
browser does the sums (`range_engine.js`) from three compact pages the refresh
writes: `days` (per-day counts), `campaign_days` and `product_days`. D-1's
drill-downs (channel, source, campaign, landing page, product) and commentary
still cover the standard D-1 windows; they need per-day session breakdowns that
are too large to ship to the browser.

## Today (live)

The Today tab shows today so far, next to yesterday and a typical day, and
refreshes itself every 3 minutes in the browser. D-1 is untouched: the live job
(`python -m app.live`, Cloud Run job `asaya-d2c-live`, every 15 minutes from
06:00 to 23:45 IST) only writes `pages/live.json`.

- **Shopify**: today's orders from the Admin API (same valid-order rule as D-1)
  and hourly sessions from ShopifyQL. Near real time.
- **Meta and Google Ads**: campaign-level spend and value for today and
  yesterday. Platforms report 15 to 60 minutes late and attribute purchases
  later, so today's ROAS reads low; spend is shown as a share of yesterday's.
  Awareness campaigns stay out of ROAS, as everywhere else.
- **GoKwik checkout**: the newest BigQuery load of today's rows, with its age
  on screen. For this to be useful the load must run through the day (planned
  every 30 minutes) and each load must hold the whole day so far; rows of one
  load are told apart by `_airbyte_emitted_at` within 10 minutes of the newest.
  Rates are compared, not counts.
- **Comparisons**: the same time yesterday, and the median of the last four
  same-weekday days of the same phase (sale with sale, BAU with BAU). Today's
  phase is taken from yesterday's unless `phases.overrides` names today.
- Baselines (hourly orders from BigQuery, hourly sessions from Shopify) are
  cached once a day in `cache/live/baseline.json`.
- Every source shows its own freshness chip; a failed source says why instead
  of showing zero, and a view older than 30 minutes warns on screen.

## Retention

The Retention tab is a rebuild of the retention artifact, on all-time data.

- **Census** (`python -m app.retention.job`, daily 09:30 IST, Cloud Run job
  `asaya-d2c-retention`): reads every valid order and line from the BigQuery
  copy of Shopify (back to Sep 2023), maps each line to a product with
  `retention_catalog.json`, merges orders under 24 hours apart, and stores
  per-customer purchase timelines (IDs only: no names, emails or phones) as
  `retention/census.json`. Customers with one order are kept as daily counts.
- **Rules** carried over from the artifact: freebies, merch, minis, gifts,
  travel kits, books and gummies never count; combos stay whole; each customer
  counts once per product; a customer is followed for the chosen horizon from
  their own first order, with the window end trimmed so everyone had the full
  time. Unmapped paid products go to an "Other" bucket, listed on the tab.
- **Engine** (`static/retention_engine.js`): the artifact's engine, ported
  without changes to the logic. On the artifact's own data it returns
  identical output across 240 comparisons (8 windows x 6 horizons x 5
  calculations). `tests/test_retention.py` also checks that the Python census
  and the engine agree on an independent count.
- **Checks** shown on the tab: BigQuery's order count against Shopify's own
  all-time count, and the census customers against BigQuery.
- **Editing the catalogue**: change `retention_catalog.json` (rules are plain
  regexes that also work in BigQuery) and rebuild; the Data and method panel
  lists what is left out and what is unmapped.

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
