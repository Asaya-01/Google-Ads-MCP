# Today fixes + Hourly ATC drill-down: audit (step 0, for review)

Status: **audit only.** Nothing is built yet: no code, config, job, table or flag
has changed. Every probe below was a read: ShopifyQL, Shopify Admin GraphQL
(queries only), the Meta activity log and insights, Google Ads `change_event`,
the Cooee landing-page report, and read-only `SELECT`s on the GoKwik tables.

The repository is public, so this file holds **no business figures**. The
reproduction numbers for the acceptance cases (C1–C9) are in a private
appendix outside the repository, and in the review reply.

---

## 0. Findings that change the brief

| # | Finding | Effect on the plan |
|---|---|---|
| F1 | **A1 does not reproduce.** Shopify returns hour buckets as IST hours expressed in UTC (`…T18:30:00Z` = 00:00 IST), and `live.py` converts them correctly. The hour-by-hour table builds rows 0–23 and renders "12 am" first (checked in a local render). | No bucketing bug, so no hourly number changes. The screen where the 12 AM row was missing is needed (section 9). |
| F2 | **Today rebuilds every 15 minutes, 06:00–23:45 IST** (`asaya-d2c-live`, `*/15 6-23 * * *`). The browser re-reads the page every 3 minutes (`refresh_seconds: 180`); the data underneath does not change that often. | "Refresh every 3 minutes to match Today" would make the drill-down five times fresher than Today. Proposal: a 5-minute job running 24 hours (section 3). |
| F3 | **GoKwik reaches BigQuery once a day, the next morning.** 23 Nov landed at 07:41 IST on 24 Nov; 24 Nov had no rows during the day. | By the 60/180-minute rule, today's GoKwik card would always be red. Intraday GoKwik exists only through the CSV upload (A6). Lateness should be measured against the expected daily load (section 6). |
| F4 | **Shopify cannot attribute orders to sessions.** Checkout runs on GoKwik: `sessions_that_completed_checkout` is ~0 on every cut, and orders have no `customerJourneySummary` visit. | "Orders by session attribution" needs another source: the order's own UTM attributes written by GoKwik, intraday (decision D4), or GoKwik's orders report, next morning. |
| F5 | **Every landing-page handle in the brief already resolves to the product registry through its product ID.** `itb-uas` is TFDUO (Target & Fade Duo), `itb-kne` is ESDUO (Even Skin Duo), `sunscreen-spray-spf65` is SSM (Sheerscreen Mist), `glow-forward-radiance-serum` is GFS, `even-tone-body-trio` is TRIO. | No `handles[]` column is needed: handle → product ID → code is derived from the catalog on every run, so renamed handles never go stale. Codes stay the registry's (section 8). |
| F6 | **The brief's new tables conflict with the standing rule "nothing new created in BigQuery".** | Proposal: the three tables live as versioned objects in the dashboard's private bucket, the same pattern as Profitability and SEO (decision D1). |
| F7 | **Instagram vs Facebook has two meanings.** The Meta UTM is `utm_source=facebook` for every placement. Placement shows in `referrer_name` (`instagram` / `facebook` / blank); the in-app browser shows in `session_device_browser` (`Instagram` / `Facebook`). The two disagree, and a large share of Meta sessions has a blank referrer. | C2 matches the brief only with `referrer_name` (decision D5). The blank-referrer share gets its own row, "Meta · placement unknown". |
| F8 | **A "Sales" name alone is not a Sales campaign.** `WOA_Awareness_TOF_Sales_*_ATC_*` (Top Funnel account) contains "Sales", and its ad sets (`utm_term`) read `TOF_Sales_ATC_*`. | Scope uses the existing awareness classification (`sessions.awareness_name_regex`, `awareness_utm_campaigns`, Google awareness ids), never a "contains Sales" filter. |

---

## 1. ShopifyQL: what the `sessions` and `sales` schemas give

All checked live against the store (API 2026-10).

### 1.1 Dimensions (exact names)

| Need | Dimension | Notes |
|---|---|---|
| Hour | `hour` (TIMESERIES, `HOUR_TIMESTAMP`), `hour_of_day` (0–23, usable in `WHERE` and `GROUP BY`) | Buckets are shop-timezone (IST) hours, returned in UTC (`…T18:30:00Z`). |
| Channel | `referrer_source`, `referrer_name`, `marketing_channel`, `marketing_campaign` | `referrer_name` carries the Meta placement (instagram / facebook / threads / blank). |
| UTM | `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content` | Meta: `utm_term` = ad set name, `utm_content` = ad. Google: `utm_campaign` = numeric campaign id. |
| Landing page | `landing_page_path`, `landing_page_type`, `landing_page_url` | |
| Device | `session_device_type` (mobile / desktop / tablet), `session_device_os` (Android / iOS / Windows …), `session_device_browser` | **In-app browsers are distinguishable**: `Instagram`, `Facebook`, `Chrome Mobile`, `Chrome Mobile WebView`, `Mobile Safari`, `Mobile Safari UI/WKWebView`, `Samsung Internet`, `Google` (the Google app), `VivoBrowser`, `HeyTap Browser` … |
| Visitor | `visitor_type` is not a sessions dimension; `human_or_bot_session` is (Human / Bot) | |
| Time on site | metric `average_session_duration` (seconds) | Available per row and in `COMPARE TO`, so Cooee is not needed for it. |
| Funnel | `sessions`, `sessions_with_cart_additions`, `sessions_that_reached_checkout`, `sessions_that_completed_checkout` | `sessions_that_completed_checkout` is ~0 (F4). |

### 1.2 Time windows and comparison

| Feature | Works | Syntax that works |
|---|---|---|
| Hour window | yes | `WHERE hour_of_day >= 10 AND hour_of_day <= 12` |
| Minute window (partial hour, A4) | yes, with **local IST date-times without an offset** | `SINCE 2026-11-24T10:00:00 UNTIL 2026-11-24T10:34:00`. `…+05:30` and `…Z` are parse errors. |
| Relative minutes | yes | `SINCE startOfMinute(-30min) UNTIL now` |
| Compare with a fixed day, same clock window | yes, in **one** query | `… SINCE 2026-11-24 UNTIL 2026-11-24 COMPARE TO 2026-11-23`. This adds `comparison_<metric>__20261123` columns, with the same `WHERE` (hours, filters) applied to both days. |
| Row limit | `LIMIT 5000` accepted | 1,000 is not a ceiling. |
| `HAVING` | yes | `HAVING sessions >= 3` cuts the long tail. |

### 1.3 Sample queries (response shape; real values in the private appendix)

```
FROM sessions SHOW sessions, sessions_with_cart_additions
TIMESERIES hour SINCE 2026-11-23 UNTIL 2026-11-23
→ columns: hour HOUR_TIMESTAMP | sessions INTEGER | sessions_with_cart_additions INTEGER
→ 24 rows, first "2026-11-22T18:30:00Z" (= 00:00 IST), last "2026-11-23T17:30:00Z" (= 23:00 IST)

FROM sessions SHOW sessions, sessions_with_cart_additions, sessions_that_completed_checkout
GROUP BY session_device_type, session_device_os, session_device_browser
SINCE 2026-11-23 UNTIL 2026-11-23 ORDER BY sessions DESC LIMIT 25
→ rows like ["mobile","iOS","Instagram", n, n, 0]

FROM sessions SHOW sessions, sessions_with_cart_additions, average_session_duration
WHERE hour_of_day >= 10 AND hour_of_day <= 12 AND utm_source = 'facebook'
GROUP BY utm_campaign, referrer_name
SINCE 2026-11-24 UNTIL 2026-11-24 COMPARE TO 2026-11-23 ORDER BY sessions DESC LIMIT 40
→ columns: utm_campaign | referrer_name | sessions | sessions_with_cart_additions |
           average_session_duration SECOND_DURATION |
           comparison_sessions__20261123 | comparison_sessions_with_cart_additions__20261123 | …

FROM sessions SHOW sessions, sessions_with_cart_additions
WHERE landing_page_path = '/products/underarm-spray' AND session_device_browser = 'Instagram'
TIMESERIES hour SINCE 2026-11-24 UNTIL 2026-11-24
→ 24 hourly rows (future hours return 0, not null: the job must cut at "now")

FROM sales SHOW orders, total_sales, gross_sales TIMESERIES hour SINCE … UNTIL …
→ same IST hour buckets as sessions
```

### 1.4 Size of the pre-aggregate (B6)

One day, so far, at **hour × utm_source × utm_medium × utm_campaign × landing_page_path × session_device_os**:

- Without a floor, the six-way cut with the browser added passed 1,000 rows by mid-afternoon.
- With `HAVING sessions >= 3` the five-way cut plus OS was ~1,200 rows, covering ~90% of the day's sessions.

Plan:

- `hourly_session_agg` stores that cut, with `HAVING sessions >= 2` and `LIMIT 5000`.
- The remainder (day total − sum of rows, per hour) is kept as an explicit **"Long tail (rows under 2 sessions)"** row, so totals always add up and nothing hides in Other.
- Browser and `utm_content` (ad) are **lazy cuts**: queried on expand for one parent row and window, cached 5 minutes, as B6 asks.

---

## 2. Shopify API limits and the query budget

- The store is on **Shopify Plus**. The Admin GraphQL limit is a cost-based leaky bucket per app per store; Plus has the higher restore rate.
- The current jobs (`live`, `refresh`, `seo`, `retention`) use the same custom app (`d1-dashboard-reader`), so they share one bucket.
- `shopifyqlQuery` is a GraphQL field: each query costs points (the exact cost is read from `extensions.cost` on the first build run and logged).

Per drill-down run (every 5 minutes, section 3):

| Query | Count | Note |
|---|---|---|
| Pre-aggregate today with `COMPARE TO` yesterday (same hours) | 1 | One query gives both days. |
| Pre-aggregate against the same weekday last week / typical BAU days | 0–4 | Past days don't change: read once a day and cached. |
| Partial hour, minute window, today and comparison | 2 | Small. |
| Sales by hour (orders, Total sales) | 0 | Reused from `pages/live.json`, never re-queried. |
| Order value placed (A5) | 1 | Orders since the last run only (incremental, `created_at` cursor). |
| Change-log poller (theme files, events, discounts) | 3 | Every 10 minutes, so on every other run. |
| Lazy cuts | ≤ 6 per user expand | Cached 5 minutes, shared by every viewer. |

**Yielding.**

- Every Shopify response carries `extensions.cost.throttleStatus.currentlyAvailable`.
- The new job keeps its own token bucket and **stops for this run** whenever the shared bucket is below 50% of its maximum, or after its own spend reaches 20% of the maximum.
- The existing jobs are not touched, so they never wait.
- A skipped run leaves the last good copy, marked "data as of HH:MM".

---

## 3. Refresh cadence (proposal)

- Today's data is rebuilt every 15 minutes (F2). The drill-down job (`asaya-d2c-hourly`, a new Cloud Run job) runs **every 5 minutes, 24 hours a day**, so the overnight hours (00–06, where the Today job does not run) are covered too.
- A 3-minute schedule is possible within the budget above if you want it; it buys little, because Meta reports 15–60 minutes late.
- Each panel shows "data as of HH:MM · source".

---

## 4. Meta: hourly limits and call plan

Accounts, checked against the dashboard's config (`meta.accounts`):

- **Asaya Sales = act_666565859450360**
- **Asaya Top Funnel = act_1040064540569018**

Both match the brief's corrected IDs.

What the Insights API accepts:

| Breakdown | With others? | Checked |
|---|---|---|
| `hourly_stats_aggregated_by_advertiser_time_zone` | **No.** Combined with `publisher_platform` it returns no data (every row null). It works on its own. | live probe |
| `publisher_platform × impression_device` | Yes (also with `platform_position`) | live probe: rows such as facebook × android_smartphone with spend, clicks, ATC |
| Hourly × device or placement | Not available | – |

Call plan per run, for each of the two accounts:

1. **Hourly, ad level, no other breakdown, today:** spend, impressions, link clicks, CPM, CTR, adds to cart. 1–3 pages.
2. **Placement × device, ad level, today (cumulative):** the same fields. 1–3 pages.
   - The API cannot split by hour here, so **each run's cumulative totals are kept and differenced**. The split for a window = snapshot at the window's end − snapshot at its start.
   - Shown with the note "placement × device for a window is built from 5-minute snapshots; Meta reports 15–60 minutes late."
   - It exists from go-live onward; earlier days show "—".
3. **Activity log**, both accounts, since the last run (status, budget and creative categories).

That is ≤ 12 calls per run. The job reads `X-Business-Use-Case-Usage` and skips Meta for the run when any usage percentage is above 50%. The existing Meta pulls never wait.

UI notes (inline, per B4-5):

- Landing page views exceed link clicks on iPhone, so the LPV rate is not used.
- Meta ATC includes view-through and any product, so it is shown beside Shopify's figure, labelled **"Meta-attributed"** vs **"Site (Shopify)"**, and never used for site ATC rate.

---

## 5. Change history: what exists and what doesn't

| Source | History available? | What the poller does |
|---|---|---|
| **Meta activity log** | **Yes**, 3 months back, with actor, old and new values, account-timezone time. 24 Nov's events are all there (C7). | Read each run since the last event. Actor names are kept: the brief asks for them, and they are staff, not customers. |
| **Google Ads `change_event`** | **Yes**, last 30 days, resource type, operation, client type, changed fields. | Read each run. `user_email` is not requested. |
| **Shopify theme files** | **No save history.** `theme.files` returns only the latest `updatedAt` and `checksumMd5` per file. A file saved twice keeps only the second time (custom.css's 10:31 save is gone; 13:22 remains). No Admin API, REST or GraphQL, exposes theme version history. | Every 10 minutes: record `filename, updatedAt, checksumMd5` of the live (MAIN) theme into `site_change_log` when the checksum changes. For `layout/theme.liquid`, read the body and diff its `<head>` script tags (src host and inline `env`), recording added or removed third-party scripts with first-seen time. |
| **Theme published / switched** | `themes(roles: MAIN)` gives the live theme id and `updatedAt`. | A change of MAIN theme id is a marker. |
| **Product changes** | **Yes, through `events`** (`subject_type:PRODUCT`): status changed, published, unpublished, created, destroyed, with time and app. **Not through `product.updatedAt`**: Uniware inventory syncs bump it every few minutes, so it is noise. | Read `events` since the last run, filtered to product and collection subjects and to the actions listed. |
| **Discounts** | **Yes, through `events`** (`subject_type:PRICE_RULE`): create, update, expire, with app (GoKwik, Nector) or staff. `discountNodes` gives title, status and `updatedAt`. | Read both; join for titles. Loyalty-app codes (Nector) are grouped into one marker per hour so they don't flood the lane. |
| **App events** | `events` carries `appTitle` and `attributeToApp`. | Kept as their own lane. |

Seed rows:

- 24 Nov's theme saves predate the poller, so they go in as **manual seed rows (`source = 'manual'`)**: custom.css 10:31 and 13:22, product.liquid 12:04, product.uas.json 13:17.
- The poller's first run independently finds the latest of these (custom.css 13:22, product.liquid 12:04, product.uas.json 13:17), so the seed rows can be checked against it.

Shopify event messages name the staff member who made a change, for example "<name> edited this discount". The log keeps the action and object. It drops the person's name for Shopify events unless you want it kept (decision D6).

---

## 6. GoKwik

**Source table.** `Asaya_Gokwik_Analytics_Funnel_Report_csv_from_mail` has:

- Date, UTM Source, Medium, Campaign, Term, Content, Landing Page;
- Checkout Started, Address Landed, Payment Step Reached, **Payment Method Selected**, Sessions Converted;
- `_airbyte_emitted_at`.

These are the same columns as the CSV export, so the CSV parser and the BigQuery reader share one row shape.

**Freshness (F3).** The table is loaded once a day, the next morning. So:

- **The "last successful load" chip** shows the load time of the newest day.
- **Late is measured against the expected schedule.** D-1 should be loaded by a configured time (default 09:00 IST). Amber is more than 60 minutes after that, red more than 180 minutes after it.
- **Today's checkout panel is CSV-only.** With no upload yet, it says "No GoKwik data for today yet: upload the GoKwik export (admin)". With uploads, it says "From CSV upload, HH:MM".

**"Tagged traffic"** = UTM Source present and not `direct`. With that rule Monday 23 Nov reproduces the brief's conversion and method → order rates exactly (C6).

**CSV upload (A6):**

- Strict header check against the 14 columns.
- The file's hash is the dedupe key.
- Every upload is kept untouched.
- Uploads never mix with the automated load: a day uses the automated load when one exists, else the newest upload.
- "Since last snapshot" = newest upload − previous upload of the same day, per row key (all UTM fields + landing page), summed over the cut.

---

## 7. Cooee as a fallback

`get_landing_page_report` supports `hour × os × browser` (also `deviceType`, `utmCampaign`, `utmContent`, landing path), plus `avgSessionDurationMs`, and today is live.

**It is not needed for the device × browser cut**: Shopify has the in-app browsers (section 1.1) and session duration.

Cooee also **counts sessions differently**: on the UAS page on 24 Nov, Cooee counted far more sessions than Shopify.

Proposal:

- Keep Cooee out of the drill-down by default.
- Offer it only as a source-tagged "Cooee" toggle in the device drawer, with the tooltip on the definition gap, if you still want it (decision D7).

---

## 8. Reuse instead of new config

| Need | Reuse | Change |
|---|---|---|
| Channel groups | `channels` (UTM rules) and `sessions` (awareness regex, awareness UTM campaigns, Google awareness ids, `report_perf_sources`) | Add a `drilldown.channel_groups` block that **refers to** these lists rather than copying them, adding only the splits the brief asks for: Meta Sales vs Meta Awareness (by the awareness rule), Google performance vs awareness (by campaign id through `pages/campaign_days.json` names), Reddit, Affiliate, CRM, Direct, Organic / Other, and **"Broken URL macro"** for `utm_campaign = "{{campaign.name}}"` (also listed in Data health as a tracking fix). |
| Funnel stage | `taxonomy.meta_stage` (TOF / MOF / BOF / Catalog / Awareness / Open, ad-name prefix rule) | None. Called, not re-implemented. |
| Product / SKU | `product_map` (registry keyed on product id) + the Shopify catalog (handle per id) | **No `handles[]` column** (F5): handle → id → code at run time. Page-level rules go in config: `/collections/offers` → Offers, `/` → Home, `/collections/*` → Collection, anything else → "Unmapped: /path". The proposed mapping for every active handle is generated on the first run and shown in Data health for confirmation. |
| Phase calendar | `pages/days.json` phases and `live.pick_typical` (the "4 recent days" logic) | None. |
| Metric registry | `static/metrics.js`: `atc_rate` exists (label "Sessions → ATC", ATC ÷ Sessions, Shopify) | Reused for the Today table. New ids: `perf_atc_rate`, `aw_atc_rate`, `lost_atc`, `atc_rate_effect`, `atc_mix_effect`, `atc_volume_effect`, `order_value_placed`, `gk_conv_tagged`, `gk_method_to_order`. |
| Components | KPI strip, explorer, drawer, watchlist, Visual/Table toggle, CSV, URL state | New: heatmap (hour columns) and lane timeline; both read the same filter state. |

---

## 9. The Today tab, today

- **A1, 12 AM row:** see F1. Not reproduced: the data and the table are right in the current code. If you saw it on the deployed tab, the likely cause is the table scrolling inside its 60vh box with no sticky header, or a different table. A screenshot of where it's missing settles it. In any case, A1 will add a sticky header and keep 00–23 always listed. **No hourly number changes**, so there is no approval to ask for.
- **A2–A4:** the hour table already sets the current hour against the same minutes of the comparison hour (prorated). With the minute window (section 1.2) the comparison can use the comparison day's real minutes instead. Proposal: real minutes for "Yesterday" and "a picked date", prorated for "Typical" (a median of days).
- **A5:** "Order value placed" = Σ `totalPriceSet` of valid orders created in the hour (same exclusion rule as D-1). It is already read by `live.order_hours` as a fallback, so it is one incremental orders query. The registry name is `order_value_placed`, label "Order value placed"; it is never called "gross sales".
- **A7, Perf ATC rate:** Perf sessions come from `sessions_day` grouped by UTM. Adding `sessions_with_cart_additions` to the same query (it is already selected) gives Perf ATCs with no new call. The comparison follows the same snapshot rule as Perf Sessions (yesterday and typical exist only for days the live job saved).

---

## 10. Storage, flags and the integrity test

**Storage (no BigQuery writes; decision D1).**

| Brief's table | Proposed location (dashboard private bucket) |
|---|---|
| `gokwik_csv_snapshots` | `private/atc/gokwik_csv/<upload_id>.json` (upload_id, uploaded_at, uploaded_by, file_name, file_sha256, rows) + `private/atc/gokwik_csv/index.json` |
| `site_change_log` | `private/atc/change_log/<YYYY-MM-DD>.json` (append-only per day: ts, lane, source, object, action, detail, actor, `source='poller'|'manual'`) |
| `hourly_session_agg` | `cache/atc/agg/<YYYY-MM-DD>.json` (one file per day; past days frozen) |

**Flags.**

- `today_fixes_v2` and `atc_drilldown` go in `config.json` → `features`, both **false** by default.
- They can be overridden at runtime by `config/flags.json` in the bucket, so either can be switched off in seconds without a deploy.
- Off means the Today tab renders exactly as now and the Funnel tab has no sub-tab.

**Integrity test.**

- **Before deploying:** run `tools/metric_snapshot.js` (Overview, Funnel, Marketing) and a new `tools/today_snapshot.py` (Today scorecard, tiles and hourly arrays from `pages/live.json` / `live_history.json`) for the three windows: 24 Nov 10:00–12:59, 23 Nov, 1–4 Nov. Run from Cloud Shell, output outside the repo.
- **After deploying:** run both again, then diff.
- **Locally:** a test builds `live.build` from fixed inputs with the flags off and on, and asserts every existing key is identical.

---

## 11. Acceptance cases: what the probes already show

| Case | Status from the audit probes |
|---|---|
| C1 site ATC by hour | 9 AM and 12 PM reproduce on both days; 3 PM Monday reproduces; 3 PM Tuesday reads lower than the brief (the hour was still settling when the brief's number was taken, or a later read). |
| C2 segments 10:00–12:59 | "Meta Sales on Instagram" Tuesday reproduces with `referrer_name = instagram` and the awareness rule. Monday and the Facebook split do not yet match the brief's numbers; reconcile once the definition is confirmed (D5). |
| C3 UAS × Instagram × Sales by hour | Depends on D5. With the in-app-browser reading and "contains Sales" (wrong, F8) the numbers are lower than the brief's. |
| C4 MOF × Instagram × UAS | To run in Part C with the confirmed definitions. |
| C5 hourly orders 12:00–14:59 | Sales by hour come from the same report as Today; to run in Part C. |
| C6 GoKwik | **Monday reproduces exactly** (tagged = UTM not `direct`). Tuesday's increment needs the two CSV snapshots. |
| C7 change log | **Meta reproduces exactly**: the KeshabMandal ad paused 11:07–11:08 and the Priyanshee ad 11:45, actor as stated; EEC Non-offer daily budget change at 12:48, old and new values as stated. **Theme**: latest saves reproduce (custom.css 13:22, product.liquid 12:04, product.uas.json 13:17); custom.css 10:31 needs the manual seed (no save history exists). |
| C8 integrity | Section 10. |
| C9 decomposition | Unit test in Part B. |

---

## 12. Decisions for review

| # | Question | Recommendation |
|---|---|---|
| D1 | Where do `gokwik_csv_snapshots`, `site_change_log` and `hourly_session_agg` live? | The dashboard's private bucket (section 10), not BigQuery, per the standing rule. |
| D2 | Who may upload the GoKwik CSV ("admin")? The allowlist has no roles today. | Add `role: "admin"` on the Firestore allowlist document for the chosen emails (one command each, as when access was granted). No emails in the repository. |
| D3 | Drill-down cadence. | Every 5 minutes, 24 hours (section 3); 3 minutes if you prefer. |
| D4 | Orders by attribution, intraday. GoKwik writes `utm_source/medium/campaign`, `full_url` and `user_agent` onto each order's attributes; the same list also holds `customer_ip`, GSTIN and payment ids. | Read the attributes, keep **only** the UTM fields, the landing **path** (no query string) and browser/OS parsed from the user agent, and drop the rest in memory (never stored or logged). If you'd rather not touch that list at all, orders by attribution show "—" intraday and fill the next morning from GoKwik's orders report. |
| D5 | "On Instagram" / "on Facebook": placement (`referrer_name`) or in-app browser (`session_device_browser`)? | Placement (`referrer_name`) for the channel rows, as it reproduces C2 Tuesday; the in-app browser in the device drawer (B4-4). The blank-referrer share shows as "Meta · placement unknown". |
| D6 | Staff names in Shopify change events. | Drop them (keep action, object, app); keep Meta actors as the brief asks. |
| D7 | Cooee in the device drawer. | Off; Shopify covers it. |
| D8 | Product labels: the brief's ("ITB+UAS", "SSS SPF65", "Glow Forward", "Trio") or the registry's (TFDUO Target & Fade Duo, SSM Sheerscreen Mist, GFS, TRIO)? | The registry's, so each product has one name on every tab. |
| D9 | GoKwik lateness: against the expected next-morning load (section 6) rather than "> 60 min since the last load". | Yes. |
