# Google Ads view: audit before the redesign

Step 0 of the Google Ads View Redesign brief. Nothing has been built yet; this
note says what data we hold, what the brief needs that we do not hold, how the
current numbers are derived, and why the team's period-comparison sheet shows
the seven problems listed in the brief. The audit was read-only: no change was
made to the Google Ads account, the conversion actions, the attribution model
or the sheet.

This repository is public, so the note carries no spend, revenue or share
figures and no sheet IDs. Those were given in the review message.

## 1. The Google data we hold today

| Pull | Resource | Grain | Fields | Window | Used by |
|---|---|---|---|---|---|
| `fetch_daily` | `campaign` | campaign × day | cost_micros, impressions, clicks, conversions, conversions_value | refresh window | Every tab: spend, platform ROAS, the channel tree |
| `fetch_campaigns` | `campaign` | campaign | id, name | current | Names, awareness rule |
| `fetch_day_total` | `customer` | account × day | cost_micros | D-1 | The D-1 completeness check |
| `fetch_tree` | `ad_group`, `asset_group`, `ad_group_ad` | level × day (impressions > 0) | the same five metrics | `google_ads.tree_days` (90) | Marketing › Google tree |
| BigQuery fallback | `GOOGLEADS_CONSOLIDATED` (`sql/google_ads_daily.sql`) | campaign × day | the same five metrics | refresh window | When the API is down |

- **Conversions.** `metrics.conversions` and `metrics.conversions_value`, not
  `all_conversions`. These count only the conversion actions that are
  *primary* and *included in Conversions*.
- **Which conversion action.** Six enabled actions are primary and included.
  In practice only two record anything in the period:
  - "Purchase Google Ads" (webpage tag, data-driven attribution, every
    conversion counted). Every sales campaign uses it, and it is the only
    action that records anything on them.
  - "Add to Cart (1)". The awareness Demand Gen campaign
    (`WOA_Awareness_DemandGen_ATC_HydBlr_261026`) bids on it through a
    campaign-level goal (`campaign_conversion_goal`). All of that campaign's
    "conversions" and "conversion value" are add-to-carts. Its value is large
    next to its spend.
- **Today's figures are not affected:**
  - Google Platform ROAS uses sales campaigns only.
  - That campaign's name puts it in Awareness, so it never enters a
    performance figure.
  - It does show add-to-cart "value" anywhere a view mixes in awareness
    campaigns: the awareness rows of the tree and the "All" scope. The new
    view must split purchase from other actions (decision D1).
- **`all_conversions_value` is unusable.** It returns an absurd number because
  the secondary "Google Shopping App Add To Cart" action sends a broken value.
  We never read it; noted so nobody starts.
- **Timing basis.** `metrics.conversions` is by **interaction (click) date**:
  the conversion is booked on the day of the ad click, and recent days fill in
  as late conversions arrive. `conversions_by_conversion_date` and
  `conversions_value_by_conversion_date` are available at customer and
  campaign level and come out somewhat higher for the same window.
- **Attribution.** Data-driven on the purchase action, which is the account's
  setting. We report it and do not change it.
- **Gaps.** The account returns no rows at all for 2026-10-07. That day is
  already listed in `google_ads.zero_spend_dates` ("no budget that day"), so
  the dashboard shows zero spend with the reason rather than a data gap.
- **Lifetime budgets.** `campaign_budget.amount_micros` is 0 for campaigns on a
  custom-period (lifetime) budget. The amount is in `total_amount_micros`, with
  `period = CUSTOM_PERIOD`. `campaign.start_date` / `end_date` are not
  recognised in v23; `start_date_time` / `end_date_time` are.

## 2. The brief's levels: buildable now vs new reports

### Buildable from data we already hold

| Level / metric | From |
|---|---|
| Campaign KPIs: Cost, Impr., Clicks, CTR, CPC, CPM, Conversions, Platform conv. value, Platform ROAS, Conv. rate, CPA, AOV | `fetch_daily` |
| Ad group (Search, Demand Gen) and Asset group (PMax): the same metrics | `fetch_tree` |
| Ads (RSA, Demand Gen video): the same metrics | `fetch_tree` |
| Segment, campaign type, scope, SKU from the name | Name rules (section 3) |

Conversions here still include the awareness campaign's add-to-carts until the
split in D1 lands.

### Needs a new report (each needs your approval; all behind feature flags)

Volumes below are for one 30-day window on this account; refresh cost is one
`searchStream` call per report per refresh unless noted. Every one fits in a
single call; none needs pagination beyond what `_search_stream` already does.

| # | Resource | Fields | Rows / day (30 d) | Refresh cost | Gives the brief |
|---|---|---|---|---|---|
| N1 | `campaign` segmented by `segments.conversion_action` | conversions, conversions_value | about 10 (about 300) | 1 call | Purchase-only Conversions/value (D1); ATC shown separately |
| N2 | `campaign` | `search_impression_share`, `search_absolute_top_impression_share`, `search_top_impression_share`, `search_rank_lost_impression_share`, `search_budget_lost_impression_share`, `search_rank_lost_absolute_top_impression_share` | about 10 (about 300) | 1 call | IS / Abs. top IS on Brand panels |
| N3 | `campaign` + `campaign_budget` | status, `serving_status`, bidding strategy type, budget `amount_micros` / `total_amount_micros` / `period`, `start_date_time`, `end_date_time` | about 12 (current) | 1 call | Status filter, budget, launch date in the drawer |
| N4 | `keyword_view` | keyword text, match type, the five metrics, `search_impression_share`, `search_rank_lost_impression_share`, `search_absolute_top_impression_share`; current `quality_info.quality_score`, `creative_quality_score`, `post_click_quality_score`, `search_predicted_ctr` | about 5 (about 150) | 1 call (metrics) + 1 (QS, current only) | Keywords tab, QS components in the drawer |
| N5 | `search_term_view` | search term, status, matched keyword, the five metrics | about 8 (about 245) | 1 call | Search terms tab, matched terms in keyword drawer |
| N6 | `campaign_search_term_insight` | `category_label`, impressions, clicks, conversions, conversions_value (no cost) | about 125–2,250 rows per campaign for a 30-day aggregate | 1 call **per campaign** (about 7 today) | PMax "Search insights" tab, brand leakage in PMax |
| N7 | `shopping_performance_view` | `segments.product_item_id`, `product_title`, cost, clicks, conversions, conversions_value | about 100 (about 3,000) | 1 call | Products tab; item-level SKU (the "N" marker in the matrix) |
| N8 | `asset_group_asset` + `asset` | asset type, field type, text / image / video id, the five metrics (filter `impressions > 0`) | about 190 (about 5,700) | 1 call | PMax Assets tab |
| N9 | `campaign` / `ad_group_ad` video metrics | `video_trueview_views`, `video_trueview_view_rate`, `trueview_average_cpv`, `video_quartile_p25/50/75/100_rate` | about 10 / about 6 | 1 call | View rate, CPV |
| N10 | `campaign` reach | `metrics.unique_users` | on demand | 1 call per request | Reach (on demand, like Meta: it is not additive over days) |

Notes on these:
- **N4 Quality Score is current only.** The API holds no QS history, so the
  drawer shows today's QS and its three components, not a QS trend.
- **N4 budget-lost IS.** `search_budget_lost_impression_share` is not
  available on `keyword_view`, only at campaign level (N2).
- **N6 needs a campaign filter.** It returns a 30-day aggregate per campaign.
  It covers only the Search part of PMax and has no cost. About a third of
  every metric sits in a blank category label; that becomes the brief's
  "Other / hidden terms" gap row.
- **N7 product IDs.** Product item IDs are `shopify_zz_<product id>_<variant id>`
  and map straight onto the existing `product_map` (keyed on Shopify product
  ID). One sample was checked against Shopify. Product-level impressions are
  not additive (one product can show in many slots): show cost, clicks,
  conversions and value only. The cost attributed to products is less than the
  campaign's cost; the remainder is a gap row "Not attributed to a product".
- **N8 performance label.** `asset_group_asset.performance_label` is not
  recognised in v23, and `ad_group_ad_asset_view.performance_label` returns
  `NOT_APPLICABLE` on every row. There are no Best/Good/Low labels; the Assets
  tab ranks on metrics.
- **N9 video.** `metrics.video_views` and `metrics.average_cpv` are not
  recognised in v23; the TrueView fields are. Quartiles are non-zero for
  Demand Gen video only. CPLV cannot be built from either and is dropped, as
  the brief says.

Proposed windows:
- N1–N3 and N9 ride the daily pull for the refresh window.
- N4, N5, N7 and N8 use the 90-day `tree_days` window, like the current tree.
- N6 is pulled as 7-, 30- and 90-day aggregates.
- N10 is pulled on demand with a 6-hour cache, as Meta reach is.

## 3. How segment, SKU and scope are derived today

Everything comes from the **campaign name**; nothing reads item IDs yet.

- **Group / segment** (`taxonomy.google_group`, config `taxonomy.google_groups`,
  first match wins on the upper-cased name with punctuation removed):
  1. Brand Search: SEARCH and BRAND.
  2. Brand PMax: PMAX and BRAND.
  3. Non-brand PMax: PMAX.
  4. Demand Gen: DEMANDGEN.
  5. YouTube: YT, YOUTUBE or VV.
  6. Non-brand Search: SEARCH.
  7. Other: anything else.

  The name rule agrees with `advertising_channel_type` for every campaign in
  the window.
- **Scope** (`rules.google_awareness_ids`): Awareness when the name matches
  `sessions.awareness_name_regex` ("awareness") or the ID is listed in
  `sessions.google_awareness_extra_ids` (old campaigns); everything else is
  Performance. There is no Reach/Amazon exception on Google (none exists).
- **SKU** (`taxonomy.product_of`, only for the groups in
  `taxonomy.google_sku_groups` = Non-brand PMax):
  - Product codes are matched on whole name tokens. A set code wins over
    single products, and generic set words give SETS.
  - With no code, an offer name (for example a price offer like B2@749) gives
    OFFER; anything else gives UNMAPPED.
  - Brand Search, Brand PMax and Demand Gen get no SKU.

Every campaign with spend in the window, and what the rules give it today:

| Campaign | Channel | Group | Scope | SKU today |
|---|---|---|---|---|
| WOA_Search_Brand_Topkey_120825 | SEARCH | Brand Search | Performance | none |
| WOA_Pmax_Brand_AllProducts_130825 | PMAX | Brand PMax | Performance | none |
| WOA_Pmax_ITB_110526 | PMAX | Non-brand PMax | Performance | ITB |
| WOA_Pmax_UAS_101025 | PMAX | Non-brand PMax | Performance | UAS |
| WOA_Pmax_ASS_141025 | PMAX | Non-brand PMax | Performance | ASS |
| WOA_Pmax_Sets_130126 | PMAX | Non-brand PMax | Performance | SETS |
| WOA_Pmax_Lifetime_Oct_B2@749_Phase1_131026 | PMAX | Non-brand PMax | Performance | OFFER |
| WOA_DemandGen_Rem_021225 | DEMAND_GEN | Demand Gen | Performance | none |
| WOA_Awareness_DemandGen_ATC_HydBlr_261026 | DEMAND_GEN | Demand Gen | Awareness | none |

Three more campaigns are enabled but did not spend: two YouTube awareness
campaigns that have ended and an ended September offer PMax. **No Non-brand
Search campaign ran in the window.**

What the brief's classification adds on top:
- `campaign_type` is the channel type.
- `sub_type` is the group above.
- `segment` is Brand / Non-brand / n/a for Demand Gen and video.
- `objective_scope` is as today.
- `sku` comes from the name, plus item-level from N7 marked "N" (the name
  gives "P"). The two can disagree: an ITB PMax campaign serves other products
  too, and the matrix shows both.

## 4. The team sheet's seven problems

The sheet is the "Google Ads Dashboard" workbook, tab "Dashboard — Filtered".
Its DATA tab is a pasted API dump of date, campaign name, campaign type,
impressions, clicks, cost, orders (fractional conversions) and revenue
(conversion value). Column I is blank. Every dashboard cell is a SUMIFS over
DATA with a date window, a campaign-type wildcard and a campaign-name
wildcard. None of the seven is a data problem; all are formula or format
problems.

1. **Unequal periods.** Period A and Period B are typed date constants of
   different lengths (one day against fifteen). Δ is (A − B) ÷ B on raw totals
   with no per-day normalisation. Period B also contains an offer campaign, so
   the comparison is sale against BAU.
   **Fix in the view:** per-day averages, and the phase rule: sale compares
   with sale, BAU with BAU.
2. **Type rows copy Period A.** In the Search, PMax, Demand Gen and Video
   rows, the Period B cells for cost, revenue, clicks and orders still use
   Period A's dates. Only impressions use Period B's. Period B's CPM and CTR
   therefore divide Period A cost and clicks by Period B impressions, which
   gives the four-digit swings, and the type rows no longer sum to the
   overall row. A related slip: several cells apply the awareness exclusion
   to the blank column I instead of the campaign name, so it excludes
   nothing there.
   **Fix:** one date window for every cell; children must sum to the parent
   (validation).
3. **Δ colours ignore the sign.** No conditional-format rules exist on any
   tab. Each Δ cell carries a fixed green or red fill painted by column, so a
   large fall can show green.
   **Fix:** colour from the metric's direction in the registry (`dir`), grey
   under 2%.
4. **PMax non-brand shows ₹0 while products have cost.**
   - The Non-brand row matches the name text `_Non-brand_`, which no campaign
     name contains.
   - The Non-brand impressions cell is a SUM of only some product rows.
   - The Spot Gel row looks for "Spot Gel" (the name says "SpotGel").
   - No row matches the offer PMax campaign.

   **Fix:** non-brand is "PMax and not Brand" by rule, plus an Unmapped / Offer
   row so the products sum to the parent.
5. **ROAS on awareness video.** The Video row matches the campaign type only,
   with no awareness filter, so a YouTube awareness campaign's non-purchase
   conversions show as revenue and ROAS. Its Orders cells were copied from
   another row and show 0. The awareness Demand Gen campaign is excluded from
   every row.
   **Fix:** awareness rows never show ROAS or CPA. Conversions are
   purchase-only (D1); add-to-cart is its own metric.
6. **CPLV is empty.** The header exists but no formula does, and DATA has no
   video-views column.
   **Fix:** CPLV is dropped as briefed; View rate and CPV come from N9.
7. **"CAC" is cost per conversion.** It is Cost ÷ fractional conversions (one
   action, data-driven), not customer acquisition cost.
   **Fix:** rename it CPA, with that definition in the tooltip.

## 5. Other findings

- **Ad strength.** All Brand Search RSAs are rated POOR; the Demand Gen video
  ads are rated AVERAGE. `ad_group_ad.ad_strength` can join N3 at no cost.
- **Brand terms in Brand Search.** Brand Search matched a handful of
  competitor and generic terms on one day, with tiny impressions. The search
  terms tab (N5) and the "Add as negative" copy tag cover this.
- **Brand leakage into non-brand PMax** is material: brand terms carry a large
  share of the non-brand PMax conversion value that has a search category. It
  is highest on the offer PMax campaign and UAS, lowest on ASS. This is the
  brief's brand-leakage check; it needs N6 and a brand term list (D3).
- **Brand Search impression share is high**, with nothing lost to budget.
- **Product impressions.** `shopping_performance_view` product impressions
  add up to more than the campaign's impressions, so they are never summed.

## 6. Decisions for you

- **D1 Conversions = purchase only.** Pull N1 and show Conversions and
  Platform conv. value for the "Purchase Google Ads" action only.
  - Add-to-cart from the awareness Demand Gen campaign shows as its own
    metric on awareness rows.
  - Sales-campaign numbers do not change, because they already count
    purchases only.
  - Recommended.
- **D2 Timing basis.** Keep the interaction (click) date, which is the
  default in the Google Ads UI and what the dashboard uses today. The footer
  says "Conversions by click date, data-driven attribution". The
  conversion-date figures are available as an alternative.
- **D3 Brand terms for leakage.** Proposed list: "asaya", "world of asaya",
  "worldofasaya" and common misspellings. Should product names (for example
  "fade forward") count as brand? Today they would count as non-brand.
- **D4 Offer PMax campaigns.** Price-offer PMax campaigns (B2@749,
  "Lifetime") are Non-brand PMax with SKU = OFFER today. Keep that, or give
  them their own sub_type "Offer PMax"?
- **D5 Pipeline additions N1–N10.** Approve all, or pick. Each is behind a
  flag in `google_ads.reports`, off until you say so.
  - Recommended minimum for the brief: N1, N2, N3, N4, N5, N6, N7.
  - N8 and N9 give the PMax Assets tab and View rate / CPV.
  - N10 is reach on demand.
- **D6 Non-brand Search.** No campaign exists today. The Non-brand panel shows
  Non-brand PMax and says so, and fills in when one launches.
- **D7 Targets.** Per-sub_type ROAS / CPA targets are unset by default as
  briefed; enter them later in config.
