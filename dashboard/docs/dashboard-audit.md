# Asaya D2C dashboard: audit before the restructure

Step 1 of the IA restructure. Nothing in the dashboard was changed to produce this document. The one change made in the same session was the Overview edit the brief asked for separately: "Yesterday at a glance" is no longer rendered on Overview (commit `8db307d`). Its data (`overview.py` `_pulse`) and its renderer (`app.html` `pulseHtml`) are kept so the D-1 Report can own it.

The repository is public, so this file holds logic, labels and file references only. It contains no business figures.

All paths are relative to `dashboard/`.

---

## 0. Summary

### What the code does today, in six lines

1. Every range tab (Overview, Daily, Marketing, Products, Region, D-1) runs on one browser engine, `static/range_engine.js`.
   - It reads the `days` page (per-day counts) and recomputes every rate for the picked dates.
   - Server pages (`app/pages/*.py`) mostly provide notes. Much of what they build is never read (§6.3).
2. Headline Orders and Revenue/GMV are Shopify's own Sales report (ShopifyQL `sh_orders`, `sh_sales`) on every tab: the D-1 logic. They stay that way, as you confirmed.
3. Breakdowns (channel, basket, products, new vs repeat) are built on a second base: valid orders and line items in BigQuery. They differ from the headline by cancellations, returns and order edits (§4).
4. The Performance / Awareness / All switch is one global state (`RG.mode`, saved in the browser). It is shown on six tabs but changes numbers on only some of them (§3.2).
5. "D-1" does not mean yesterday. The D-1 tab follows the global date picker, which defaults to month-to-date (§1.8).
6. There is no metric registry. Labels, formats and delta colours are hard-coded per component, so the same number has up to three names (§5).

### Decisions I need from you before the refactor

Listed in full in §8. The short version:

| # | Decision | My recommendation |
|---|---|---|
| D1 | GMV note says "returns not subtracted" but the headline nets them | Keep the headline as is (Shopify Total sales, as you confirmed); correct every note |
| D2 | Two order counts and AOVs (Shopify report vs valid orders) | Headline = Shopify report everywhere. Valid-order figures only inside breakdowns, with a "Reconcile to Shopify" row |
| D3 | Two "new customer" definitions (Overview/D-1 vs Retention) | One definition, owned by Retention; Overview loses the tile |
| D4 | "Not in GoKwik" and "Organic Search" orders with no sessions; D-1 drops them | Keep the bucketing; group under "Unattributed / other"; stop D-1 dropping them |
| D5 | Products roll variants up to the parent product, but the label is whichever variant came last | Keep the roll-up; take the label from the catalog parent title; variants expand underneath |
| D6 | D-1 tab follows the date picker (default month-to-date) | Make it a fixed "yesterday vs typical day" report, as the brief says. This changes what your team sees on D-1 |
| D7 | Today tiles undercount the current hour (calculation bug) | Fix it (small, tested) |
| D8 | Retention's "repeat within 90 days" figure is the horizon figure | Fix it |
| D9 | Basket on D-1 uses a different sales base from Products/Overview | One basket, on Products, with the reconcile rows |

---

## 1. Every tab today: sections, metrics, sources, calculation

Legend for **Src**:
- **SQ**: Shopify ShopifyQL. The Sales report gives Orders and Total sales (cancelled orders kept, returns netted on the day processed). There is also a sessions report.
- **BQo**: BigQuery valid Shopify orders (`Shopify_All_orders`; not test, not cancelled, not ASAYASS/ASAYAINF).
- **BQl**: BigQuery order lines plus products.
- **GK**: GoKwik funnel / orders in BigQuery.
- **Meta**: Meta Marketing API, two allowlisted accounts.
- **GAds**: Google Ads API, with the BigQuery `GOOGLEADS_CONSOLIDATED` copy as fallback.
- **Sheets**: manual spends (affiliate, CRM flow, CRM broadcast, Reddit) and the sale calendar.

The **Mode** column says whether the Performance / Awareness / All switch changes the number.

### 1.1 Overview (`R.overview`, `static/range_ui.js:485`)

| Section (as shown) | Component | Metrics / columns | Src | Calculation | Mode |
|---|---|---|---|---|---|
| Date bar | control | view switch, dates, "vs", info line | – | `rgBar` `range_ui.js:139` | – |
| Transition-day / outside-data banners | banner | – | days | `range_engine.js:249` | – |
| BAU days / Sale days (one card per phase) | 11 KPI tiles (`RG_TILES`, `range_ui.js:19-25`) | GMV, Orders, AOV, Sessions, Conversion rate, Add-to-cart rate, Performance spend (all channels), ROAS (GMV / performance spend), CPS (spend / session), New-customer orders, Meta + Google spend | SQ, BQo (new share), Meta, GAds, Sheets | `derive()` `range_engine.js:99-133`; `perf_all_spend` `common.py:661` | yes: Awareness relabels and swaps sources; Perf vs All changes only "Meta + Google spend" |
| "The whole range, for reference" | details, same tiles without deltas | same | same | same | yes |
| Where the sales came from | table | Channel (UTM, last click), Sessions, Δ sessions, Orders, GMV, Δ GMV, Share of GMV, Conversion + reconcile rows | SQ sessions, BQo+GK orders | `trChannelHtml` `range_tree.js:350-406`; `range_data.channels` `range_data.py:364` | yes |
| Basket size | table | Basket, Orders, Δ orders, Share of orders, Sales, Share of sales, AOV, Items + reconcile rows | BQo/BQl (`order_slabs.sql`) | `bkHtml` `range_basket.js:23-72` | no (whole store) |
| Spend and return: channel › stage › product | tree | Spend, Δ spend, Share, Revenue (platform), ROAS, Δ ROAS, Purchases, Cost / purchase, CTR (Perf); Impr. instead of Purchases (All); CPM/Clicks/CPC (Awareness) | Meta, GAds, Sheets | `trBuild`/`trCols` `range_tree.js:53-202` | yes |
| GMV per day, Orders per day | 2 bar charts with dashed comparison | – | SQ | `rgCharts` `range_ui.js:405-434` | yes (Awareness) |
| Notes | paragraph list | 2 notes, one of them wrong (§4, C1) | – | `overview.py:93-98` | – |

### 1.2 Today (`R.live`, `static/app.html:495`; data `app/live.py`, job every 15 min)

| Section | Component | Metrics / columns | Src | Calculation |
|---|---|---|---|---|
| Today · {weekday} {date} | header | stale banner, source chips, Campaigns switch, "Compare today so far with" (typical same-weekday same-phase / yesterday same time) | – | `app.html:502-510`; typical `live.py:102-124` |
| So far today: Sales | tiles | Orders, GMV, AOV | SQ hourly | `metrics_at` `live.py:84`; **cum_at bug, §7 B1** |
| So far today: Performance spends | tiles | Meta spends, Google, Reddit (est.), CRM + Affiliates (est.), Total Spends (est.), each as % of yesterday's full day | Meta, GAds, Sheets plan | `live.py:1018-1028`; estimates `live.py:158-260` |
| So far today: Returns | tiles | ROAS (hero), CPS, vs yesterday's final | – | `live.py:1086-1089`; no "est." flag although built on estimates |
| So far today: Traffic and conversion | tiles | Sessions, Perf Sessions, CVR % on overall sessions, CVR % on Perf | SQ, snapshots | `live.py:987-1106` |
| Through the day | line chart, GMV / Orders / Sessions | today vs typical / yesterday running curve | SQ | `curve` `live.py:295` |
| Spend so far (Awareness and All views only) | table | Channel, So far today, How | Meta, GAds, Sheets | `live.py:857-955` |
| Checkout (GoKwik) | table | Step, Customers, Step rate, Typical, vs typical | GK | `live.py:561-631`; "typical" = pooled last 7 full days, not like-for-like |
| Meta / Google Ads campaigns today | 2 tables | Campaign, Spend, Value, Platform ROAS (top 15 by spend) | Meta, GAds | `ads_block` `live.py:384-420` |
| Notes | list | phase assumption, partial-ad-data warning | – | `live.py:450-483, 1176` |

Notes on Today:
- The mode switch changes section layout, spend rows and the campaign filter. It never changes a scorecard number.
- The "Returns so far today" cards (`app.html:558`) are dead code, because a scorecard always exists.

### 1.3 Daily (`R.daily`, `static/range_ui.js:496`)

| Section | Component | Columns | Src | Mode |
|---|---|---|---|---|
| Daily (one card) | status chips + table (70vh) + notes | Date, Phase, Sessions, Perf sessions, ATC, IC, Orders, GMV, AOV, Sessions → ATC, ATC → IC, CVR, Meta spend, Google spend, Spends, ROAS, New orders, Repeat orders | SQ, GK, BQo, Meta, GAds, Sheets | Awareness swaps funnel fields and drops Spends/ROAS; All changes Meta/Google to totals while Spends stays performance-only |

Notes on Daily:
- The comparison picker has no effect on Daily.
- Estimated spends are not marked.
- There is no CSV download.
- 2 of the 3 notes are out of date (§6.2).
- `daily.py` builds 45 rows the browser ignores.

### 1.4 Marketing (`R.marketing`, `static/range_tabs.js:66`)

| Section | Component | Metrics / columns | Src | Mode |
|---|---|---|---|---|
| Meta / sheet unavailable banners | banner | mentions "MER and Perf ROAS", which no longer exist | – | – |
| BAU / Sale days | 10 tiles (`RG_MKT`, `range_tabs.js:5-10`) | GMV, Meta spend, Google spend, Affiliate spend, CRM spend (flow + broadcast), Reddit spend, Overall spend, Meta + Google spend, ROAS (GMV / performance spend), CPS | SQ, Meta, GAds, Sheets | yes |
| Spend and return: channel › stage › product | tree | **same component as Overview** | Meta, GAds, Sheets | yes |
| Meta: product × stage | matrix | Product × TOF / MOF / BOF / Catalog / All stages; cell = spend, Meta ROAS, Δ | Meta | hidden in Awareness. **"+Infinity%" / "NaN%" bug, §7 B3** |
| Sales by channel | table | **same component as Overview "Where the sales came from"** | SQ, BQo+GK | yes |
| Ad spend per day / ROAS per day | stacked bars / line | – | Meta, GAds, Sheets | yes; ROAS hidden in Awareness |
| Data check: are Google sessions matched to campaigns? | details: 4 tiles + table | match rate, no-ID share, sessions on awareness IDs, unclassified IDs | SQ, GAds | always the last 7 days; the unclassified table covers the whole history |
| Notes + zero-spend list | list | 3 notes (two contradict each other on the Google source) | – | – |

### 1.5 Products (`R.products`, `static/range_tabs.js:177`)

| Section | Component | Columns | Src | Calculation |
|---|---|---|---|---|
| MRP unavailable banner | banner | – | catalog | – |
| Products | table (60vh) | Product (+type), Units, Δ units, Revenue, Δ revenue, MRP / unit, Landed discount | BQl | `rgProductTables` `range_tabs.js:122-165`; grouped by `product_id`, **label is the last row's name** (§4, C5) |
| Categories | table | Category, Units, Revenue, Share, Δ revenue, Landed discount | BQl | same rows by product type |
| Basket size | table | **same component as Overview** | BQo/BQl | `bkHtml` |
| Excluded product types | table | Product type, Lines, Units, Revenue | BQl | uses all days incl. transition days, unlike the sections above |
| Product types | table with chips | Type, Products in catalog, Order lines, Dropped | catalog, BQl | type list from month-to-date and catalog only |
| MRP coverage | tile + table | Units with MRP; top 15 without | catalog, BQl | – |
| Notes | list | 3 notes; "Revenue sums to GMV" is wrong against the headline | – | `products.py:92-98` |

Notes on Products:
- The mode switch is replaced by a "Whole store" chip.
- Products and Categories hide rows with zero current units. A product that stopped selling disappears instead of showing −100%.

### 1.6 Region (`R.region`, `static/range_region.js:213`)

| Section | Component | Metrics | Src | Notes |
|---|---|---|---|---|
| Date bar + "Whole store" | control | – | – | – |
| Hero: breadcrumbs, colour-by switch (Revenue / Orders / AOV / Items / Basket size), India map, scope header | map + controls | – | SQ by shipping state/city | quantile colours; places under 20 orders are not coloured |
| KPI tiles | 5 tiles | Revenue, Orders, AOV, Items (gifts & merch left out), Basket size (items per order) | SQ | All-India tiles equal the headline |
| Top states/cities | ranked bars | top 8 | SQ | – |
| States / Cities in {state} | sortable table + insights | Revenue, Δ, Share, Orders, AOV, Items, Basket size | SQ | Δ has no minimum base |
| Products · {scope} | sortable table + insights | Revenue, Δ, Share, Orders, AOV, Quantity, Basket size | SQ by `product_title` | different basis from the Products tab (net of returns, cancelled kept) |
| Notes | list | 5 notes + backfill notes | – | `pages/region.py:142-153` |

Notes on Region:
- "Basket size" here means items per order, which differs from the Products slab table.
- Rows with zero orders and negative revenue (returns only) can appear.

### 1.7 Retention (`R.retention`, `static/retention_ui.js:614`; census job daily at 09:30 IST)

Retention has **its own date controls**: acquisition window presets, from/to, horizon, product and variant. It does not follow the global picker or the mode switch.

| View | Content | Src |
|---|---|---|
| Controls | window, horizon, product, variant/pack | – |
| Hero | All buyers, New to Asaya, New to this product; "Bought it again within {hz} days"; "within 90 days" (**bug, §7 B4**); median and average gap | census (BQo/BQl + catalog) |
| Brand-wide | {hz}-day repeat rate, repeat curve, 1st→4th order funnel, first-order basket vs repeat; insight box with **hard-coded targets** | census |
| Revenue & LTV | first/repeat order value, value per customer at 90 days and 12 months, monthly cohorts, value by acquisition product. One subtitle has a **hard-coded month-specific claim** | census |
| Products compared | repeat by horizon per acquisition product (≥1,000 acquisitions). **Possible crash** when no 90-day runway exists | census |
| Product journey | come-back rate, orders a year, 2nd/3rd order products | census |
| Buys it again / Switches to / Variants & packs | timing buckets, next product, variant mix, stay or swap, pack of 1 vs 2 | census |
| Data & method | pipeline counts, checks against Shopify, definitions, unmapped products | census |

Notes on Retention:
- There is no new-vs-repeat-per-day view and no CRM outcome view. Those numbers live on Overview (tile), Daily (columns) and D-1 (section).
- "Calendar 2025" is a hard-coded preset.

### 1.8 D-1 (`R.d1`, `static/range_d1.js:520`)

**It follows the global date picker** (`range_d1.js:523`, `e.compare(RG.from, RG.to, RG.cmp)`), which defaults to month-to-date. It is not a fixed yesterday report. The header still reads "D-1 {date}".

| Section | Component | Content | Duplicates |
|---|---|---|---|
| Lead row | controls | Sale/BAU switch, transition note, source chips | chips also on Daily |
| Overview | 7 tiles + 15-row metric table + "What this says" | Overall sessions, Perf. sessions, ATC, IC, Orders, Revenue, AOV, 3 step rates, 2 CVRs, Spends, RoAS, CPS | Overview tiles, Daily columns |
| Traffic by channel | table + insights | sessions by channel, share, orders, CVR | `trChannelHtml`, on a different source page. **Drops order-only channels** |
| Checkout funnel | table + insights | ATC → IC → Address → Payment → Orders, step rates | unique (Today has a live version) |
| Revenue & AOV (basket mix) | table + insights | revenue and AOV by basket size | `bkHtml`, on a **different sales base** |
| Products | table + insights | top 12 by revenue, units | Products tab |
| New vs repeat customers | table + insights | 8 rows | Overview tile, Daily columns |
| Spend & ROAS | table + insights | spend and platform ROAS per channel; total = Shopify ROAS | Marketing tiles, tree, ROAS chart |
| Day by day | details table | every D-1 metric per day | Daily tab |
| Drill-down | switch + table | Channel, Source, Campaign, Landing page, Product | Source, Campaign (by sessions) and Landing page are unique to D-1 |

`app/pages/d1.py` builds phase-matched server windows that the browser does not use (§6.3).

### 1.9 Data health (`R.health`, `static/app.html:427`; built only by the D-1 refresh)

| Section | Content |
|---|---|
| Sources for D-1 | Source, Status, Latest day, D-1 rows (for Shopify sessions this column actually holds the session count), Arrived (IST) |
| Cross-checks | Orders BigQuery vs Shopify; Meta rows vs account total; Google rows vs account total |
| Last days | arrival time per source, last 8 days |
| Notes | what "complete" means |

Notes on Data health:
- **Not on it:** the sheet, calendar and API unavailability flags (only in chips), the Google session matching check (on Marketing), GoKwik load age (on Today), the phase calendar and overrides, zero-spend dates (on Marketing), a metric dictionary, and which days carry estimated spends.

### 1.10 Shell

- **Header** (`app.html:155`): sticky, opaque, z-index 5. Meta line shows "D-1 {date} · refreshed …".
  - On Today the "refreshed" time stops updating, because `liveRefresh` does not call `renderMeta`.
- **Date bar** (`#rg-slot`, `range.css`): sticky, z 6.
  - The card is **translucent with a backdrop blur**, and there is an 8px gap above it. That is the "content shows through" problem.
  - The backdrop filter likely also traps the phone date popover, which is meant to be fixed to the screen.
- **Ask Claude** (`ask.js`, `ask.css`): fixed bottom-right, z 40, about 130×44px.
  - Only `main` gets 88px bottom padding. Mid-page it **covers the right-most table column**.
  - On phones it can cover the date popover's Apply button.
- **Freshness chips** (`statusStrip`, `app.html:337`): rendered on Daily and D-1.
  - Today has its own chips. The header has a "Waiting on N sources" chip. Retention and Health have their own.

---

## 2. Data sources and where they land

| Source | Pulled by | Cadence | Feeds |
|---|---|---|---|
| Shopify Sales report (Orders, Total sales) | ShopifyQL `shopify.py:92-115` | refresh every 30 min 07:00–23:00 IST until D-1 is complete; whole window each run | headline Orders / GMV / AOV / CVR / ROAS on every range tab; reconcile rows |
| Shopify sessions (by UTM / referrer, by landing page) | ShopifyQL `shopify.py:231-279` | refresh, cached per day, recent days re-pulled | sessions, ATC, perf and awareness sessions, channel sessions, landing-page drill |
| Shopify catalog | Admin GraphQL `shopify.py:338` | refresh | MRP, product types |
| Shopify Sales report by state/city/product | ShopifyQL `shopify.py:149-213` | refresh, product detail backfilled | Region |
| BigQuery valid orders | `sql/orders_daily.sql`, `orders_hourly.sql` | refresh | new/repeat, phase detection |
| BigQuery orders + GoKwik UTMs | `sql/order_attribution.sql` | refresh | channel / source / campaign orders and GMV, awareness orders |
| BigQuery order lines + products | `sql/product_daily.sql`, `order_slabs.sql` | refresh | Products, basket |
| GoKwik funnel | `sql/funnel_daily.sql`; live `gokwik_live.sql` | refresh; live every 15 min | IC, address, payment, converted |
| Google Ads | API `google_ads.py`, BigQuery fallback | refresh; live | Google spend / value / tree / awareness IDs |
| Meta | Marketing API `meta.py` | refresh (ad level, cached); live (campaign level) | Meta spend / value / tree |
| Google Sheets | `sheets.py` | refresh, last good copy kept | affiliate, CRM, Reddit spend (+ Reddit daily plan), sale calendar |
| Retention census | `sql/retention_lines.sql` + catalog | daily 09:30 IST | Retention tab |

**Exclusions:**
- ASAYASS / ASAYAINF are excluded in every SQL and ShopifyQL query (`config.json:133`).
- Freebie / merch / book / gummies / blank-type lines are excluded from items, units, products and basket.
- Neither exclusion touches headline Orders or GMV, which match Shopify's report as agreed.
- Retention has a wider exclusion set of its own (minis, travel kits, gift emoji, zero-revenue lines).

---

## 3. Overlap matrix

✔ = rendered on that tab. **Same fn** = the identical component.

| Metric / breakdown | Overview | Today | Daily | Marketing | Products | Region | D-1 | Retention | Health |
|---|---|---|---|---|---|---|---|---|---|
| GMV / Revenue (headline) | ✔ tile + chart | ✔ (today) | ✔ col | ✔ tile | | ✔ all-India tile | ✔ tile + table | | |
| Orders, AOV | ✔ | ✔ | ✔ | | | ✔ | ✔ | | |
| Sessions, ATC rate, CVR | ✔ | ✔ | ✔ | | | | ✔ | | |
| Perf sessions, IC, step rates | | ✔ (perf sess.) | ✔ | | | | ✔ | | |
| Checkout steps (GoKwik) | (pulse, removed) | ✔ live | | | | | ✔ | | |
| Performance spend / Overall spend | ✔ "Performance spend (all channels)" | ✔ "Total Spends" | ✔ "Spends" | ✔ "Overall spend" | | | ✔ "Spends" | | |
| Meta / Google / Affiliate / CRM / Reddit spend | Meta+Google only | ✔ | Meta, Google | ✔ all | | | ✔ table | | |
| Blended ROAS (Shopify GMV ÷ perf spend) | ✔ "ROAS (GMV / performance spend)" | ✔ "ROAS" | ✔ "ROAS" | ✔ tile + chart | | | ✔ "RoAS" | | |
| CPS | ✔ | ✔ | | ✔ | | | ✔ | | |
| Platform ROAS / revenue / purchases | in tree ("ROAS") | ✔ "Platform ROAS" | | in tree + matrix ("ROAS") | | | ✔ per channel ("ROAS") | | |
| Spend and return tree | ✔ **same fn** | | | ✔ **same fn** | | | | | |
| Meta product × stage | | | | ✔ | | | | | |
| Channel table (Shopify last click) | ✔ **same fn** | | | ✔ **same fn** | | | ✔ own version | | |
| Basket size | ✔ **same fn** | | | | ✔ **same fn** | ✔ items/order (other definition) | ✔ own version | ✔ first-order basket vs repeat | |
| Products (revenue, units) | | | | | ✔ | ✔ other basis | ✔ top 12 + drill | ✔ by product (census) | |
| New vs repeat | ✔ % tile | | ✔ counts | | | | ✔ section | ✔ own definition | |
| Day-by-day table | | | ✔ | | | | ✔ details | | |
| Freshness chips | (pulse, removed) | ✔ own | ✔ | banners | banner | | ✔ | own checks | ✔ table |
| Methodology notes | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | in panels | ✔ |
| Google session-match check | | | | ✔ | | | | | |
| Zero-spend dates | | | | ✔ | | | | | |

---

## 4. Definition conflicts (your §6.2), with what the code does

**C1. GMV vs returns**
- **Today:** the headline is Shopify Total sales (`sh_sales`), which keeps cancelled orders and nets returns on the day processed. That matches D-1, as you confirmed.
- **Text that says otherwise:**
  - Overview note `overview.py:94-95`: "Refunds and returns are not subtracted". Wrong for the headline.
  - Products note `products.py:93-96`: "Revenue … sums to GMV". It sums to valid-order line sales, not the headline.
  - `README.md:61` and `sql/orders_daily.sql:1-2`: true for the BigQuery `gmv` field, which is no longer the headline.
  - D-1 note `d1.py:92-93`: true for the drill-downs only.
- **Recommendation:** no number changes. Rewrite these texts from the registry, and say in one place (Data health) that breakdowns use placed orders.

**C2. Two order counts, two AOVs**
- Headline = Shopify report.
- Breakdowns (channel, basket, products, new vs repeat) = BigQuery valid orders. These exclude cancelled orders, take no returns off, and use `total_price` or line sales.
- The gap is shown as a "Cancelled orders and returns (Shopify's report)" row on the channel and basket tables.
  - That row also absorbs order edits and copy lag, so the label is too narrow and the value can be negative.
- D-1's basket and traffic sections have no reconcile row.
- **Recommendation:**
  - The one headline is the Shopify report.
  - The valid-order figures appear only in the breakdowns, each with a collapsible "Reconcile to Shopify" row labelled "Cancellations, returns and edits".

**C3. New-customer orders**
- Overview/Daily/D-1 use `orders_daily.sql`: first valid order per customer id, any contents, guest orders excluded.
- Retention uses its census: first order with a counted product line, orders within 24h merged.
- Their counts will not agree.
- **Recommendation:** home in Retention. Show per-period new vs repeat there. Choose one definition, and say which.
  - Option (a): keep the `orders_daily` rule for the period view and label it.
  - Option (b): move it onto the census.
  - (a) changes no number.

**C4. Channels with orders but no sessions**
- Sessions are classified on Shopify's UTM only; the referrer is ignored. Orders are classified on GoKwik's UTM.
  - An order with no GoKwik record is forced to "Not in GoKwik" (`common.py:255`). It can never have sessions.
  - Organic Google visits usually carry no UTM, so their sessions land in "No UTM (direct / organic)", while GoKwik can tag the order `google` with a blank medium. That gives "Organic Search" orders with few or no sessions.
- The channel table keeps these rows. **D-1 drops them** (`range_d1.js:145, 354`), so their orders vanish from D-1's channel tables.
- **Recommendation:**
  - Keep the bucketing (no number changes).
  - Put the two rows in a collapsed "Unattributed / other" group with a tooltip.
  - Stop D-1 dropping them.

**C5. Product roll-up**
- SQL returns one row per variant SKU per day.
- The browser sums them by `product_id` (`range_data.py:161-168`), so **rows are parent products**.
- But the row label (and product type) is overwritten by every SQL row, so it ends up as the name on whichever variant row came last. The SQL has no ORDER BY.
- A label like "<product> - <shade> / 100 ml" is therefore **one variant's name on a parent roll-up**: the units and revenue are the whole product.
- **Recommendation:**
  - Keep the roll-up.
  - Label from the catalog's parent title, mapped to the house code.
  - Expand variants underneath.
  - Label-only change: no number changes.

**Others found in the audit**

- **C6. Product naming has four schemes.**
  - Marketing: taxonomy codes from ad names, `config.json` `taxonomy`.
  - Products / D-1: BigQuery names.
  - Region: ShopifyQL titles.
  - Retention: its own catalog, `retention_catalog.json`, with different codes for 6 products (e.g. SLS vs SLSS, ASG vs SPOTGEL). GFS has no Retention entry.
  - Nothing links codes to Shopify product IDs.
  - **Recommendation:** one product map (code, short name, Shopify product IDs / title patterns) in config, used by every tab.
- **C7. Basket has three definitions.**
  - Products/Overview: Sales = order `total_price`.
  - D-1 and Ask Claude: Sales = kept-line sales.
  - Region: "basket size" = items per order, cancelled orders included.
  - **Recommendation:** one basket table (Products), keep `total_price` with the reconcile rows, and rename Region's metric "Items per order".
- **C8. Same spend, three names.** "Performance spend (all channels)" (Overview) = "Overall spend" (Marketing, Performance view) = "Spends" (Daily, D-1) = "Total Spends" (Today).
  - In the All view, "Overall spend" includes awareness and Reach, while ROAS beside it does not.
  - "Meta + Google spend" changes meaning by view under one label.
  - **Recommendation:** registry names "Performance spend" and "Total spend (incl. awareness)", both always shown under their own name.
- **C9. "ROAS" means two things under one label.**
  - Tree rows and the matrix use platform value ÷ spend. Tiles, chart and the tree total use Shopify GMV ÷ performance spend.
  - Today already says "Platform ROAS"; D-1 writes "RoAS".
  - **Recommendation:** "Blended ROAS" and "Platform ROAS" everywhere.

---

## 5. Labels, formats and colours

**Delta colours** (`deltaHtml`, `app.html:245`):
- Only green-up / red-down or grey exist. There is **no inverted colour**, so a cost going up never shows red.
- Neutral keys are in two lists that disagree (`NEUTRAL_DELTA` `app.html:244`, `RG_NEUTRAL` `range_ui.js:34`). As a result:
  - "Performance spend (all channels)" on Overview is green when up, while every other spend is grey.
  - CPS is grey (should be red when up).
  - Sessions down is grey.
  - D-1 uses its own regex rule.

**Tiny bases:**
- Every percentage change guards only against a zero base. None has a minimum base, so small bases print large percentages.
- The one place that prints "+Infinity%" / "NaN%" is the Meta product × stage matrix (§7 B3).
- `deltaHtml` itself has no clamp.

**Number formats:**
- Tiles use compact form (Rs x.xx L / Cr).
- The tree, channel and basket tables use full Indian grouping.
- The matrix uses compact form directly under the full-format tree.
- Percentages have 2 decimals everywhere; shares have 1.
- The "Rs" prefix is used rather than "₹".

**Zero rows:**
- The tree and the matrix show zero-spend products.
- Basket shows zero slabs that only exist in the comparison.
- Products hides zero-unit rows, the opposite of the others.

---

## 6. Gaps and stale code

### 6.1 Things the brief asks for that do not exist yet (not to be invented)

| Brief item | Status |
|---|---|
| Meta stage ROAS benchmarks (TOF / MOF / BOF) | none in code or config. Adding them is config only (values you gave) |
| Target vs achieved (GMV, spend) | only Reddit's daily spend plan is pulled from the media-plan workbook (`sheets.locate_target`). No GMV or other channel targets. **Gap:** placeholder behind a flag, unless the workbook's other target columns are added to the pull (a pipeline change, needs your OK) |
| PDP sessions → ATC → orders per product | **not available.** Closest: sessions that *landed* on a product page (ShopifyQL landing page, top 300 a day), and GoKwik checkouts by landing page. Neither is product-page views |
| "Download full daily CSV" | none today (only Retention exports). Front-end only, no data change |
| CRM outcomes (repeat revenue from CRM) | only the sheet's CRM revenue (used for CRM's own ROAS). No order-level CRM attribution beyond the UTM channel "CRM" in the channel table |
| Metric dictionary | none |

### 6.2 Stale or wrong text on screen today

- Overview: GMV note (C1).
- Products: "sums to GMV" (C1).
- Daily:
  - "Perf sessions = all sessions minus Awareness". The column actually uses the team's UTM-source rule.
  - "Phase inferred from GMV spike". Phases now come from hourly detection plus the team calendar.
- Marketing:
  - The banner mentions "MER and Perf ROAS".
  - The two Google-source notes contradict each other.
  - The channel note says "(the next table)", which is the wrong table on both tabs.
- D-1: mentions a written commentary that is switched off.
- Health: the "D-1 rows" column for Shopify sessions is the session count.

### 6.3 Built but never shown

- `overview.py`: tiles, phase_panel, trend, pulse. Pulse moves to the D-1 Report.
- `marketing.py`: periods, spend_trend, meta_campaigns, google_campaigns.
- `daily.py`: 45 rows.
- `d1.py`: prior / current / delta / drilldowns.
- `products.py`: products, categories, freebie_check, coverage.
- Front end: `pulseHtml` (kept for the D-1 Report), `spark`, `STATUS`, `phaseBars`, `RG_MODE_NOTE`, `rgRatioChange`, Today's "Returns so far today" block.

---

## 7. Bugs found

Calculation bugs need your OK (§8). Display bugs are fixed as part of the refactor.

| # | Where | What | Kind |
|---|---|---|---|
| B1 | Today, `live.py:54-60` `cum_at` | Today's current-hour bucket is already partial but is multiplied by the fraction of the hour again. Orders, GMV, sessions and ATC on the tiles undercount by up to about a quarter of an hour's worth. The chart is right, so tiles and chart disagree | calculation: needs OK |
| B2 | Today | ROAS and CPS rest on estimated spends but carry no "est." tag. Reference values can themselves be estimates | display |
| B3 | Marketing, `range_tree.js:327` | Matrix Δ ROAS divides by a prior ROAS of 0, giving "+Infinity%" (green) or "NaN%" (red) | display |
| B4 | Retention, `retention_engine.js:215` | "Bought it again within 90 days" is set to the selected horizon's figure, so it is wrong whenever the horizon is not 90 | calculation: needs OK |
| B5 | Retention, `retention_ui.js:416-420` | "Products compared" can throw when no product has 90 days of runway | display / crash |
| B6 | D-1 | Order-only channels dropped (C4) | display |
| B7 | Daily | Estimated spends unmarked | display |
| B8 | Today | Campaign tables cut to top 15 *before* the view filter, so the Awareness view can miss campaigns | display |
| B9 | Shell | translucent date bar; Ask Claude covers table columns and, on phones, the date popover's Apply | display |
| B10 | Header on Today | "refreshed" time not updated by the live poll | display |

---

## 8. Decisions for you

1. **D1 (C1):** keep the headline as Shopify Total sales (confirmed) and correct the notes. Yes / no?
2. **D2 (C2):** headline = Shopify report; valid-order figures only in breakdowns, with a "Reconcile to Shopify: cancellations, returns and edits" row. Yes / no?
3. **D3 (C3):** new vs repeat moves to Retention. Keep today's `orders_daily` definition for the period view (no number change) or switch to the census definition?
4. **D4 (C4):** keep the bucketing; group "Not in GoKwik" and "Organic Search" as "Unattributed / other"; stop D-1 dropping them. Yes / no?
5. **D5 (C5, C6):** one product map in config (code, short name, Shopify product IDs). Parent rows labelled "CODE · Short name", variants expandable. Yes / no?
6. **D6 (D-1):** today the D-1 tab follows the picker (default month-to-date) and is your management report. The brief makes it fixed "yesterday vs typical day". Options:
   - (a) fixed yesterday;
   - (b) fixed yesterday, with a switch to "this month so far";
   - (c) keep it on the picker.
   - I recommend (b): it keeps the month view your team uses.
7. **D-1 contents:** sections that repeat other tabs. For each, keep it in the fixed report or link out?
   - Day by day (= Funnel's daily table): **link out**.
   - Drill-down Channel and Product: **link out**. Keep Source, Campaign and Landing page: unique to D-1.
   - Products top 12, New vs repeat, Spend & ROAS: **keep as a short summary**, since they are part of the management report, with a link to the owner tab.
8. **D7 (B1):** fix the Today running-total undercount. Yes / no?
9. **D8 (B4):** fix Retention's 90-day figure. Yes / no?
10. **D9 (C7):** one basket (Products, `total_price`, reconcile rows); Region's metric renamed "Items per order". Yes / no?
11. **Targets:** leave "Target vs achieved" as a flagged placeholder, or extend the sheet pull to the media plan's GMV and spend targets? The second is a pipeline change.
12. **Benchmarks:** add Meta TOF 1.0x, MOF 2.7x, BOF 3.5x to config; amber band 15% below. Catalog stays unset. Yes / no?

---

## 9. How the current sections map into the new structure

| Today | New home |
|---|---|
| Overview tiles GMV, Orders, AOV | **Overview** (home) |
| Overview tiles Performance spend, ROAS | **Marketing** (home); headline on Overview as "Performance spend", "Blended ROAS" |
| Overview tile Conversion rate | **Funnel** (home); headline on Overview as "CVR" |
| Overview tiles Sessions, Add-to-cart rate | **Funnel** |
| Overview tiles CPS, Meta + Google spend | **Marketing** |
| Overview tile New-customer orders | **Retention** |
| Overview "whole range" details | removed (the transition-day note stays in the header tooltip) |
| Overview "Where the sales came from" + Marketing "Sales by channel" | merged into **Marketing** "Channel reconciliation" |
| Overview Basket size | **Products** (only home) |
| Overview + Marketing tree | **Marketing** (only home) |
| Overview GMV per day + Orders per day | one chart on **Overview** (GMV / Orders toggle) |
| Overview notes, all tab notes | **Data health**, metric dictionary and tooltips |
| "Yesterday at a glance" (pulse) | **D-1 Report** |
| Today (all) | **Today**: add Blended ROAS and CVR to the strip; flag spend-without-return campaigns; "Source late" state for GoKwik |
| Daily table | **Funnel** daily table, funnel columns only; CSV keeps every column |
| D-1 checkout funnel + pulse checkout health | **Funnel** checkout steps (period); D-1 keeps the yesterday verdict |
| Marketing tiles | **Marketing** strip: Performance spend, Blended ROAS, Meta Platform ROAS, Google Platform ROAS, CPS, Cost per purchase |
| Marketing matrix, spend chart, ROAS chart | **Marketing** |
| Marketing "Data check" + zero-spend list | **Data health**; status pill on Marketing if failing |
| Products tables, Categories, Excluded types, Product types, MRP coverage | **Products** (types and MRP coverage collapsed) |
| Region (all) | **Region**; "Products · {scope}" stays (region-owned cut) |
| Retention (all) + per-period new vs repeat | **Retention** |
| D-1 sections | **D-1 Report** per decision 7 |
| Status chips (Daily, D-1, Today, header) | one **status pill** in the header → **Data health** |
| Health tables | **Data health** + source status for sheets / calendar / APIs, data checks, phase calendar, known exceptions, metric dictionary |

---

## 10. Proving the numbers did not change (step 5)

- A script will snapshot every registry metric ID for two fixed ranges:
  - 1–4 Nov 2026 vs 1–4 Oct 2026;
  - one sale window vs the matching sale window.
- It covers the range engine (run in Node against the built `days` and range pages) and the server pages.
- Run it before and after the refactor and diff the two snapshots. Any difference fails, unless it is one of the changes approved in §8.
- The snapshot needs the production pages, so it runs where the pages live (Cloud Run or a machine with bucket access).
- Snapshot values are business data, so they are written outside the repository, never committed.

---

## 11. Decisions taken (answers to §8)

| # | Decision |
|---|---|
| 1 | Headline revenue stays Shopify Total sales. Label "GMV" becomes **"Total sales"**. Tooltip: "Shopify Total sales: gross sales minus discounts and returns, plus shipping and taxes, on valid orders. Returns count on the day they are processed, so past days can move slightly." Blended ROAS keeps this number. Notes are corrected. |
| 2 | Headline Orders and AOV stay on Shopify's report; AOV = Total sales ÷ Shopify orders everywhere. "Reconcile to Shopify: cancellations, returns and edits" is a collapsed row, in breakdown tables only, never in KPI cards. |
| 3 | New-customer definition unchanged in this refactor (see §12). |
| 4 | "Unattributed / other" is an expandable group with "Not in GoKwik" and "Organic Search" visible on expand. D-1 stops dropping them. Channel rows must sum to headline Orders and Total sales on every tab, D-1 included. |
| 5 | Product map in config keyed on Shopify product ID, bundles / duos / sets with their own codes. Rows "CODE · Short name", variants underneath. Products not in the map show under "Unmapped" with a Data health warning. |
| 6 | D-1 defaults to fixed yesterday with a "This month so far" switch. The switch view keeps the phase rule (BAU vs BAU, sale vs sale, per-day averages). |
| 7 | D-1 keeps only the morning read (§13). Drill-downs become links. |
| 8 | Today undercount fixed (§14). |
| 9 | Retention 90-day figure fixed (§15). |
| 10 | Products owns the one basket definition. Exclusions everywhere: freebies, merch, books, gummies, tests, cancelled, ASAYASS and ASAYAINF. Region's metric becomes "Items per order" on the same definition and must match Products for the whole store. |
| 11 | Target vs achieved is a placeholder in this refactor, built against the follow-up's shape: monthly Total sales, spend and ROAS targets ("Target vs Achieved") and daily pacing ("Day wise Budget"). |
| 12 | No ROAS benchmarks. |

## 12. The two new-customer definitions

**Overview tile, Daily columns and D-1 section** (`sql/orders_daily.sql`):
- A customer's first valid order is "new"; every later valid order is "repeat".
- Valid orders: not test, not cancelled, not ASAYASS / ASAYAINF, with a Shopify customer ID.
- Ranked by created time over all history.
- Any order counts, whatever it contains.

**Retention census** (`app/retention/build.py`, `sql/retention_lines.sql`). Same valid-order rule, plus:
1. **Only orders with a counted product line enter a customer's timeline.** These do not count:
   - lines of type freebie, merch, book or gummies;
   - zero-revenue lines and gift lines;
   - test, free or "pay remaining amount" lines;
   - minis and travel kits with no product type;
   - merch words unless the title is a named product;
   - blank-type lines that are not a named product.

   An order of only such lines is skipped, so the customer's "first order" is their first order with a paid product.
2. **Orders by one customer less than 24 hours apart are merged into one** (payment retries, split checkouts).
3. **The day is the IST date of the first order in a merged group.**

**Where they disagree.** I rebuilt both rules in BigQuery for 6 Oct to 4 Nov 2026, comparing new customers per day:
- They agree on 25 of the 30 days.
- They differ on 10, 12, 17 and 31 Oct and 2 Nov 2026, by one or two customers on each day.
- The cause is a first order that held only uncounted lines, e.g. gift-only or zero-value.
- The overall gap is a few hundredths of a percent.
- Switching to the census rule would barely move the numbers; that decision is for a separate change.

## 13. D-1 Report: the final contents

Default view: **yesterday vs a typical day of the same kind** (BAU or sale). "Typical" is the median of the same-kind days in the last N days (the existing `pulse` baseline).

Switch: **This month so far**, with sale days compared to sale days and BAU to BAU, using per-day averages.

**Kept on D-1**

| # | Section | Contents |
|---|---|---|
| 1 | Headline | Total sales, Orders, AOV, Blended ROAS, Performance spend, CVR, each vs the typical day |
| 2 | Checkout status | Healthy / Watch / Problem, with the three GoKwik steps behind "See the steps" |
| 3 | Funnel summary | Sessions → ATC → Checkout started → Orders, with Sessions→ATC, ATC→IC, IC→Order |
| 4 | Channel summary | One row per channel: Spend, Platform ROAS, Shopify sessions, orders, Total sales, CVR. "Unattributed / other" group. Collapsed reconcile row, so it sums to the headline |
| 5 | Meta stage ROAS | TOF / MOF / BOF / Catalog spend and Platform ROAS vs the typical day. No benchmark colouring, per decision 12 |
| 6 | Target vs achieved | Placeholder, hidden until targets are pulled |
| 7 | What changed | 3–5 rule-based bullets, each linking to its evidence |

**Removed from D-1, with links to their home**

| Removed | Home |
|---|---|
| 15-row metric table; Day by day | Funnel |
| Revenue & AOV (basket) | Products |
| Products top 12; Product drill-down | Products |
| New vs repeat | Retention |
| Spend & ROAS table (per channel) | folded into the channel summary; full tree on Marketing |
| Channel drill-down | Marketing (channel reconciliation) |
| Source, Campaign and Landing-page drill-downs | Funnel ("Funnel by source / campaign / landing page"); they are session funnels and had no other home |
| Campaign / ad tree, product × stage matrix | Marketing |
| Region cuts, cohort tables | Region, Retention |

## 14. Today undercount: root cause

- `live.py` read today with `cum_at(hourly, t)`. That function spreads the current hour: it adds `(t − h) × bucket[h]`.
- This is correct for the baseline days (yesterday, typical days), whose hourly buckets are complete.
- **Today's bucket for the current hour is not complete**: it holds only the minutes so far. Multiplying it by the fraction of the hour counted it short a second time.
- Effect: at 14:30 only half of the 14:00–14:30 orders, sales, sessions and add-to-carts were counted. The worst case is about a quarter of an hour's worth, around half past.
- The chart was always right, so tiles and chart disagreed.
- **Fix**: today is read in full (its data already stops at "now"); baselines keep the spreading.
- Test: `tests/test_live.py::test_todays_current_hour_is_not_cut_twice`.
- Checked on 2, 3 and 4 Nov at 11:20, 15:40 and 20:30 IST (figures shared in chat, not here). The tiles were short by 1–6% of orders and sales at those times, most in the morning.

## 15. Retention 90-day figure: root cause

- In `retention_engine.js` `compute()`, `m90_base` and `m90_rate` were assigned the **horizon's** base and rate: `base[s]` and `rep[s] / base[s]`.
- So "Bought it again within 90 days" showed the 30-day figure when the horizon was 30 days, the 180-day figure at 180, and so on. It was right only at 90.
- **Fix**: a separate count of buyers whose first purchase of the product falls in the window with at least 90 days of runway (`≤ NDAYS − 90`), and of those who bought the same product again within 90 days. The horizon no longer affects it. Nothing else in the census changes.
- Test: `tests/test_retention.py::test_the_90_day_figure_is_90_days_whatever_horizon_is_picked`. It fails on the old code and passes on the new.
- Old vs new for three windows was checked in BigQuery (figures in chat, not here). At a 30-day horizon the old figure was 2–4 times lower than the true 90-day rate; at 180 days, 2–3 times higher.
