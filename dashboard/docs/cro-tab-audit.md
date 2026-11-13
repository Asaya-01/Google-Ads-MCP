# CRO tab (Cooee): audit before building

Status: **audit only, waiting for review.** Nothing is built yet.

Every Cooee MCP tool was called on 13 Nov 2026 through the claude.ai Cooee connector (store `world-of-asaya`). This repository is public, so this document shows response **shapes**: real field names, with placeholder values. The real figures went to the owner separately.

---

## 1. Decisions needed

| # | Decision | Recommendation |
|---|---|---|
| D1 | How the scheduled job signs in to the Cooee MCP server (section 2) | Ask Cooee for a service token / API key; fall back to an OAuth refresh token in Secret Manager |
| D2 | Ask Cooee for the REST API behind the MCP | Yes; same sync design, simpler auth |
| D3 | Where the Cooee tables live | New BigQuery dataset `cooee` (asia-south1), created by the owner, with Data Editor for the dashboard's service account on that dataset only; Maplemonk stays read-only |
| D4 | Bounce rate in the KPI strip (section 6, finding F3) | Show it labelled "single-page sessions"; lead with ATC rate instead |
| D5 | Cooee checkout steps vs GoKwik (finding F2) | Cross-check only "checkout started" and "payment submitted"; contact and address steps are not usable |
| D6 | Questions to send Cooee (section 9) | Send as listed |

---

## 2. Signing in from a scheduled job

The claude.ai connector signs in with the owner's OAuth. A Cloud Run job has no browser, so it needs one of these:

| Option | What it needs | Notes |
|---|---|---|
| **(a) Service token / API key from Cooee** | Cooee issues a store-scoped, read-only token with the analytics, products, campaigns and experiments scopes | Simplest and most robust. Stored in Secret Manager as `cooee-mcp-token` and sent as `Authorization: Bearer …` |
| **(b) OAuth refresh token** | Cooee's authorization server must support the `refresh_token` grant, plus a client id (dynamic client registration or one issued by Cooee). One interactive consent produces the refresh token, which is stored in Secret Manager | The job refreshes the access token on every run and saves a rotated refresh token if Cooee rotates it. A refresh failure raises a Data health alert and an email, because the token then needs re-consent |
| **(c) REST API behind the MCP** | API credentials from Cooee | Same tables and schedule; only the transport changes |

**Not verified yet.** This environment's network policy blocks `cdn.mcp.api.letscooee.com`, so the server's OAuth metadata could not be read: which grant types it supports, `client_credentials`, `refresh_token`, `registration_endpoint`, scopes, token lifetimes. Run this from Cloud Shell; the output answers the question:

```bash
for p in oauth-protected-resource oauth-protected-resource/mcp oauth-authorization-server; do echo "== $p"; curl -sS "https://cdn.mcp.api.letscooee.com/.well-known/$p"; echo; done
```

If the protected-resource document names a different authorization server, also fetch `<that server>/.well-known/oauth-authorization-server`.

The job uses the official Python MCP SDK (`mcp`, streamable-HTTP client). It sends fixed `tools/call` requests and parses the JSON in the result's text content. No LLM is in the path.

---

## 3. The tools: shapes, limits and quirks

Placeholder values: `0` for numbers, `"…"` for strings.

### get_store_daily_stats (store × day)

```json
{"store":"…","currency":"INR","processedDays":[{"date":"2026-11-11","totalRevenue":0,"netRevenue":0,"totalOrders":0,"cooeeRevenue":0,"cooeeOrders":0}]}
```

- Any range in one call.
- **Today is included and live.**
- Orders match the dashboard's Shopify Orders exactly on the days checked.
- `cooeeRevenue` and `cooeeOrders` are 0 on every day checked (finding F1).

### get_store_kpis (range)

```json
{"store":"…","period":{"from":"…","to":"…"},"currency":"INR","kpis":{"totalRevenue":0,"netRevenue":0,"totalOrders":0,"cooeeRevenue":0,"cooeeOrders":0}}
```

- The same fields as daily stats, for a range.
- Adds nothing per day, so `cooee_store_kpis_daily` is dropped: daily stats carries the same fields.

### get_store (store attributes)

- Includes `currentMonthStats` / `lastMonthStats`, with Cooee attribution by model:
  - `generalAttribution`, `orderAttribution`, `itemAttribution`, `sameSessionAttribution`, `atc24HrsAttribution`;
  - each with ROI, revenue and orders.
- The only place attributed revenue appears at store level (F1).
- Snapshot it daily as `cooee_store_snapshot`.

### get_landing_page_report (sessions; the main source)

```json
{"store":"…","period":{"from":"…","to":"…"},"dimensions":["date"],"units":{"money":"INR","rates":"percent","durations":"milliseconds"},
 "total":0,"returned":0,"truncated":false,
 "summary":{"sessionCount":0,"visitorCount":0,"sessionsWithProductView":0,"sessionsWithAddToCart":0,"sessionsWithCartOpen":0,"sessionsWithCheckoutStarted":0,
            "contactSubmittedCount":0,"addressSubmittedCount":0,"paymentSubmittedCount":0,"sessionsWithOrder":0,"orderCount":0,"revenue":0,"bouncedSessionCount":0},
 "items":[{"total":{"sessionCount":0,"…":0},"intents":{"NO":{"…":0},"LOW":{"…":0},"MEDIUM":{"…":0},"HIGH":{"…":0}},"date":"2026-11-11"}]}
```

- `summary` always totals **all** matching rows, even when `items` is truncated, so day totals are always complete.
- **The key in each row is not always the dimension name.** The sync maps them explicitly:

| Dimension requested | Key in the row |
|---|---|
| `landingPage` | `landingPath` |
| `pageType` | `page` |
| `exitPage` | `exitPath` |
| `visitorType` | `sessionType` |
| `referringChannel` | `acquisitionChannel` |
| `date`, `hour`, `deviceType`, `referringMedium`, `utmSource`, `utmCampaign`, `utmContent` | same name |

- **`[date, hour]` works in one call** (168 rows for a week), so the hour × day-of-week heatmap is possible.
- Sorting by an intent segment works: `sort: "segments.HIGH.sessionCount"`.
- Distinct rows per day seen on 11 Nov:

| Breakdown | Rows | Over the 500-row cap? |
|---|---|---|
| Landing pages | 558 | yes |
| Exit pages, non-buyers | 575 | yes |
| UTM source × campaign × content | 545 | yes |
| Referring channel × medium | 49 | no |
| Device × visitor type | 6 | no |

  - Where the cap is hit, the sync keeps the top 500 rows plus the complete `summary`.
  - The remainder is a long tail of tiny pages and UTMs, and is stored as an "Other (beyond top 500)" row computed from summary − rows.
- UTM campaign carries the **Google Ads campaign ID** for Google traffic and the **campaign name** for Meta. That allows deep links to Marketing › Google (by ID) and Marketing › Meta (by name).

### get_product_report (product or variant × range)

```json
{"store":"…","period":{"from":"…","to":"…"},"currency":"INR","returned":0,
 "totals":{"views":0,"addToCarts":0,"viewToCartRate":0,"removesFromCart":0,"purchases":0,"unitsSold":0,"revenue":0},
 "products":[{"productId":"…","variantId":"…","name":"…","views":0,"addToCarts":0,"viewToCartRate":0,"removesFromCart":0,"purchases":0,"unitsSold":0,"revenue":0}]}
```

- Capped at **100 rows**, with **no `total` or `truncated` flag**.
- The sync treats `returned == limit` as possibly truncated. It makes a second call sorted by addToCarts so freebies and widget-added items are not lost, and stores `totals` as the day total.
- Names carry HTML entities (`&amp;`) and, at product level, one variant's title. The sync decodes entities and names products from the dashboard's own product registry by Shopify product ID.
- Variants with 0 views but adds and removals exist: free gifts, add-ons.

### get_campaign_report (campaign × day with `daily: true`)

```json
{"store":"…","period":{"from":"…","to":"…"},"currency":"INR","total":0,"returned":0,"note":"…",
 "rows":[{"sequenceNumber":"…","name":"…","status":"…","objective":"…","deliveryType":"…","date":"…","impressions":0,"holdouts":0,"clicks":0,"ctr":0,"dismissals":0,"sessions":0,"visitors":0,"addToCarts":0,"orders":0,"revenue":0}]}
```

- Limits:
  - capped at **200 rows**;
  - 92 days with `daily: true`;
  - 1 Aug – 31 Oct had **415** campaign-days.
- Backfill chunking:
  - chunks of ≤ 14 days;
  - split again whenever `total > returned`.
- Each row carries the campaign's status, objective and delivery type.
- Names can have leading spaces; the sync trims them.

### list_campaigns / get_campaign

- `list_campaigns` returns at most **100 of 185** campaigns, with no paging.
  - The sync lists by status (`active`, `paused`, `draft`, `stopped`).
  - It splits a status by objective if that status passes 100.
- `get_campaign` adds:
  - lifetime `stats`: impressions, interactions, dismissals, uniqueVisitors, influenced and same-session orders/revenue, lastImpressionAt;
  - `content` (widget kind, placement);
  - `dashboardUrl`.
  - Called only for campaigns that are live or ran in the last 92 days.

### list_experiments / get_experiment

- `list_experiments`:
  - all 49, with no truncation;
  - 3 published, 9 paused, 12 drafts, 25 stopped.
- `get_experiment` returns two shapes:
  - **NATIVE_AB / theme / template / split-URL / price** have per-arm `visitors, sessions, orders, revenue, conversionRate, revenuePerVisitor, avgOrderValue, addToCartRate, checkoutRate, bounceRate`. Each non-control arm has `liftVsControl {conversionRate, revenuePerVisitor, conversionRatePValue}`. Refreshed hourly.
  - **AB_TEST (widget vs exclusion)** has per-arm `impressions, interactions, dismissals, uniqueVisitors, cartAdditions, productViews, collectionViews, influenced/direct/atc/sameSession orders and revenue`, with no lift and no p-value.
- Both shapes carry `split` per arm, `isControl`, `config.pageType` and `dashboardUrl`.
- Lifetime only, so daily snapshots give the over-time view.

### get_impact_report

```json
{"store":"…","period":{"from":"…","to":"…"},"currency":"INR","note":"A comparison needs visitors in both groups of a Cooee impact test in this period; found 0 exposed and 0 controlled"}
```

- No holdout is running: only `note`, no groups.
- The shape with groups (exposed and controlled; visitors, sessions, orders, revenue, conversionRate, revenuePerVisitor; controlShare, lift, p-value, incrementalRevenue) is taken from the tool's own description. It will be validated when a holdout starts.

---

## 4. Data lag

| Data | Lag observed |
|---|---|
| Store daily stats | Today's orders present and current at 12:12 IST |
| Sessions by hour (landing-page report) | At 12:12 IST, hours 0–11 present, hour 11 partly filled: **under 1 hour** |
| Experiments, campaigns | `updatedAt` within minutes; experiment stats "refreshed hourly" (tool description) |

The hourly light run for today is therefore worth having: store daily stats plus the date-level funnel for today, 2–3 calls.

---

## 5. Validation of the verdict rules

| Experiment | Split check | Orders per visitor | Verdict |
|---|---|---|---|
| **#152** (AB_TEST, 50/50) | Visitors split far from 50/50 (chi-square ≈ 2,900, p ≈ 0) | — | **Invalid: split mismatch**, as expected |
| **#245** (NATIVE_AB) | Passes | Our two-proportion z-test gives p = 0.791; Cooee's own `conversionRatePValue` is 0.7913 | Inconclusive |
| **#266** (AB_TEST, sitewide) | Passes | p = 0.54 | Inconclusive |

- **#245:** our computation reproduces Cooee's. The z-test can therefore be used for AB_TEST experiments, which lack a p-value, with the source shown ("computed" vs "Cooee").
- **#266:** only about **2% of each arm's visitors ever saw the widget**: impressions are a tiny share of uniqueVisitors, because the population is every site visitor. A real effect on that 2% is diluted about 50 times, so this test can almost never reach significance.
  - The card will show **exposure = impressions ÷ visitors**.
  - A "diluted" flag is raised below 20%.

---

## 6. Data-quality findings

**F1. Daily `cooeeRevenue`/`cooeeOrders` are always 0**
- `get_store` shows non-zero attributed revenue for the month.
- So Cooee-attributed revenue per day is not available from daily stats.
- Use campaign-report revenue (last touch) per day, and `get_store` monthly attribution as a snapshot. Ask Cooee.

**F2. Checkout steps**
- `contactSubmittedCount` and `addressSubmittedCount` are a tiny fraction of `paymentSubmittedCount`, which itself slightly exceeds `sessionsWithCheckoutStarted`.
- The GoKwik checkout is not tracked step by step, so the contact and address steps are unusable.
- For the GoKwik cross-check, use checkout started and payment submitted only.

**F3. Bounce = single-page session**
- About 9 in 10 sessions are "bounced" store-wide.
- On the hero PDP landing pages, bounced sessions outnumber the sessions *without* an add-to-cart.
- So a visitor who lands on a PDP, adds to cart and checks out through the GoKwik pop-up still counts as bounced.
- Bounce is shown labelled "single-page sessions", with this note, and it is not used to flag pages on its own (D4).

**F4. Attribution fields on AB_TEST are identical**
- Influenced, direct, ATC and same-session orders and revenue are the same number on every arm checked.
- They are one attribution model, or the others are not populated. Ask Cooee.
- The board uses `influencedOrders` and labels it.

**F5. Cooee sessions vs Shopify sessions**
- Cooee sessions run materially **below** Shopify sessions: about 12% lower on the day checked.
- Store-daily orders match Shopify exactly. Session-attributed orders (`sessionsWithOrder`) are a little lower.
- This is what the Data health reconciliation (A3) tracks; the ±10% warning threshold may need to sit at the observed baseline gap.

**F6. Field renames and names**
- The renames are listed in section 3.
- HTML entities and leading spaces in names are cleaned at ingestion.

**F7. Rates**
- Rates arrive as percentages (`ctr`, `conversionRate`, `addToCartRate`, `viewToCartRate`, …).
- They are stored as fractions, normalised once at ingestion, and the registry formats them.

---

## 7. Proposed tables (BigQuery dataset `cooee`, asia-south1)

**Rules for every table:**
- Date-partitioned on `date` or `snapshot_date`.
- Each run **overwrites whole day partitions** it re-pulls (`table$YYYYMMDD`, WRITE_TRUNCATE), which makes re-pulls idempotent without MERGE.
- Every table carries `loaded_at` and `sync_run_id`.
- Rates are not stored; they are derived from counts.

| Table | Grain | Columns (beyond date, loaded_at, sync_run_id) |
|---|---|---|
| `cooee_store_daily` | date | total_revenue, net_revenue, total_orders, cooee_revenue, cooee_orders |
| `cooee_store_snapshot` | snapshot_date | mau, month totals, attribution model × {roi, revenue, orders} (JSON) |
| `cooee_lp_funnel_daily` | date × intent (ALL, NO, LOW, MEDIUM, HIGH) | sessions, visitors (distinct, not additive), sessions_with_product_view, _add_to_cart, _cart_open, _checkout_started, contact_submitted, address_submitted, payment_submitted, sessions_with_order, orders, revenue, bounced_sessions |
| `cooee_lp_landing_daily` | date × landing_path × page_type × intent | sessions, bounced_sessions, sessions_with_add_to_cart, sessions_with_order, orders, revenue, product_view_sessions; plus an "(other)" row from summary − rows |
| `cooee_lp_exit_daily` | date × exit_path × intent (non-buyers) | sessions |
| `cooee_lp_segment_daily` | date × dim_set × dim1 × dim2 × dim3 × intent | the funnel set above. dim_set ∈ {device_visitor, channel_medium, utm, geo, hour, os_browser, purchased, network} |
| `cooee_lp_hour_daily` | date × hour | sessions, sessions_with_order, revenue, sessions_with_add_to_cart (heatmap) |
| `cooee_product_daily` | date × product_id × variant_id (variant_id '' for product rows) | views, add_to_carts, removes_from_cart, purchases, units_sold, revenue; plus totals rows |
| `cooee_campaign_daily` | date × sequence_number | impressions, clicks, dismissals, holdouts, sessions, visitors, add_to_carts, orders, revenue |
| `cooee_campaign_dim` | snapshot_date × sequence_number | name, status, objective, delivery_type, created/published/updated at, widget kind, placement, lifetime stats (JSON), dashboard_url |
| `cooee_experiment_dim` | snapshot_date × sequence_number | name, type, status, page_type, created/published/updated at, dashboard_url |
| `cooee_experiment_snapshot` | snapshot_date × sequence_number × arm_key | arm name, is_control, split, visitors, sessions, orders, revenue, impressions, interactions, cart_additions, influenced_orders/revenue, liftVsControl (cvr, rpv, p) as given, raw stats (JSON) |
| `cooee_impact_daily` | date | exposed and controlled × {visitors, sessions, orders, revenue}, control_share, lift, p_value, incremental_revenue, note |
| `cooee_sync_log` | run × call | run_id, tool, arguments (JSON), rows, truncated, duration_ms, status, error |

**Notes on the tables:**
- `cro_experiment_notes` (hypothesis and decision notes) lives in **Firestore**, beside the sign-in allowlist, because it is edited from the dashboard. It is not a warehouse table.
- The dashboard reads these tables through the existing refresh pattern: a nightly page build into GCS, served at `/api/page/cro`. Pages stay fast without querying BigQuery on every view.
- **RPV and visitor totals for any range** come from a backend endpoint, `/api/cro/live`. It calls `get_landing_page_report` with the date dimension off, for exactly that range, and caches the result for 1 hour, keyed on range and filters.

---

## 8. Run plan, cost and run time

| Run | Calls | Run time (est.) |
|---|---|---|
| **Daily, 06:00 IST** (re-pulls the last 7 days) | About 130: <br>• per day × 7: 1 funnel, 1 landing, 1 exit, 6 segment sets, 1 hour grid, 2 product, 1 impact; <br>• once: store daily, store snapshot, campaign daily, 4–5 campaign lists, a few get_campaign, list_experiments, about 37 get_experiment | 3–6 min sequential, 1–2 min with 4 calls in parallel (Cloud Run job, 1 vCPU / 1 GiB) |
| **Hourly light** (today) | 2–3 | Under 30 s |
| **Backfill**, 17 Jun → yesterday, about 150 days | About 2,000 per-day calls + about 12 campaign chunks | 1–2 h; run as 5–6 resumable chunks of 30 days |

- **Cost:**
  - Cloud Run job time is a few cents a day.
  - BigQuery storage for all tables is tens of MB a year: a few thousand rows a day, dominated by landing, exit and UTM rows.
  - Queries are negligible.
  - **No LLM tokens.**
- **Load on Cooee:** about 130 read calls a day. Ask Cooee for their rate limit; calls back off on 429 and 5xx.

---

## 9. Questions for Cooee

1. Can you issue a read-only service token or API key for the MCP server, for a scheduled job? If not, does your OAuth server support `refresh_token`, how long do refresh tokens live, and are they rotated? Is a REST API available?
2. Why are `cooeeRevenue`/`cooeeOrders` 0 in daily stats while the store's month attribution is non-zero?
3. On AB_TEST experiments, are influenced, direct, ATC and same-session orders separate attribution models? They are identical on every arm checked.
4. Why is the visitor split of #152 V3 A/B Exclusion Cart Upsell far from its configured 50/50? Is assignment sticky per visitor, and are both arms counted the same way?
5. Bounce: is it "one page view"? The PDP-to-GoKwik-checkout path makes most buying sessions single-page.
6. Can the store-wide impact holdout be switched on (5–10% of visitors) so incremental revenue can be measured?
7. API rate limits, and whether `list_campaigns` can page beyond 100.

---

## 10. What gets built after review

- **Part A:** the sync job (`app/cooee/`), tables, backfill and `cooee_sync_log` in Data health, behind `CRO_SYNC_ENABLED`.
- **A3:** the reconciliation in Data health.
- **Part B:** the CRO tab behind the `cro` tab flag in config.json, following the brief. The changes from the brief are those set out above:
  - bounce labelled as single-page sessions;
  - Cooee-attributed revenue from campaigns, not store daily stats;
  - experiment exposure shown;
  - `cooee_store_kpis_daily` dropped.
