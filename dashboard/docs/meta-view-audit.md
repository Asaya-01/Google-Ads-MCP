# Meta Ads view: audit before the redesign

This is step 0 of the Meta view brief. Nothing in the dashboard, the Meta accounts or the team's sheet was changed to write it. Every Meta read was read-only, on the two allowlisted accounts only.

The repository is public. This file therefore holds logic, field names and counts of ads, never spend or revenue. The figures behind the decisions in §8 were shared in the review message, not here.

All paths are relative to `dashboard/`.

---

## 1. The Meta data we hold today

| | Today |
|---|---|
| Pull | Meta Marketing API Insights, `level=ad`, `time_increment=1` (`app/meta.py`) |
| Accounts | Asaya Sales (`act_666565859450360`) and Asaya Top Funnel (`act_1040064540569018`), allowlisted in `config.json` → `meta.accounts`; any other ID is refused |
| Grain | date × ad (with account, campaign id/name, ad set id/name, ad id/name) |
| Where it is stored | **Not in BigQuery.** One JSON file per day in the snapshot bucket: `cache/meta/<date>.json` |
| History | The last `lookback_days` are re-read every run. Ad-level detail is backfilled to `ad_history_days` (90). Older days hold campaign-level rows only, from the one-off campaign backfill |
| Fields requested | `spend, impressions, clicks, actions, action_values` |
| Fields kept | `spend`, `impressions`, `clicks` (**all clicks**, not link clicks), `purchases` and `purchase_value` (the first of `omni_purchase`, `offsite_conversion.fb_pixel_purchase`, `purchase`) |
| Everything else in `actions` | **Dropped** when the row is cached |
| Attribution | No `action_attribution_windows` is sent, so every number uses **each ad set's own attribution setting** (§3) |
| Built into pages | `campaign_days.meta` (campaign × day) and `meta_tree` (ad × day, last 90 days), used by the Marketing tree and the product × stage matrix |
| Checks | Data health compares the sum of Meta rows with each account's own daily total ("Meta spend, rows vs account total") |

**Implications**
- The "pre-aggregate at date × ad_id" the brief asks for already exists, as per-day ad-level files rather than a warehouse table.
- Any metric we do not cache today needs those 90 days pulled again once the pipeline keeps it.

## 2. Which brief metrics exist

Legend:
- **have**: cached today.
- **actions**: in the `actions` array we already request, but dropped. Keeping it changes the parsing and cache only, with no new API field, but it is still a pipeline change.
- **new field**: needs an extra Insights field.
- **object read**: needs reading the ad / ad set / campaign / creative objects, not Insights.

| Metric | Status | Notes |
|---|---|---|
| Spend, Impressions | have | |
| Purchases, Platform revenue | have | first matching purchase type only, so no double counting |
| Link clicks | actions (`link_click`) | we cache **all clicks** today; the brief's link-based metrics need this |
| Landing page views | actions (`landing_page_view`) | `omni_landing_page_view` is identical: keep one |
| Add to carts | actions (`omni_add_to_cart`) | `add_to_cart`, `offsite_conversion.fb_pixel_add_to_cart` and `omni_add_to_cart` are the same number: keep **one** (omni, which the team's export uses) |
| 3-second video plays | actions (`video_view`) | at ad level only through `actions` |
| CTR, CPC, LPV rate, Cost per LPV, ATC rate, Cost per ATC, Purchase rate, Cost per purchase, AOV, Platform ROAS, CPM | derived | once the bases above are kept; every ratio from summed bases |
| Reach, Frequency | new field | `reach` does not add across days or rows: rollups and periods need their own query (see P2) |
| ThruPlays, Cost per ThruPlay | new field | `video_thruplay_watched_actions` (cost can be derived) |
| Hold rate | new field | ThruPlays ÷ 3-second plays |
| Hook rate | actions + impressions | 3-second plays ÷ impressions; no new field |
| Video p25–p100, plays started | new field | not in the brief's views; listed for completeness |
| Status (active / paused / learning) | object read | `effective_status` on ad, ad set and campaign |
| Budget (daily / lifetime) | object read | on the campaign (campaign budget) **or** the ad set, depending on the campaign; `lifetime_budget` reads 0 when unset, so read both levels |
| Creative thumbnail and primary text | object read | via the ad's creative. Thumbnails are 64×64 by default. A few creatives return `PRIVACY_CHECK_FAIL` with empty fields |
| Budget / status history | activity log | a separate API, the brief says to list only |
| Launch date ("Since launch") | object read | `created_time` on the object |

## 3. Attribution window

**Ad sets do not share one setting.**
- **Sales account:** most ad sets use **7-day click + 1-day view + 1-day engaged-view**. A few (value-optimised ones and one MOF ad set) use 7-day click + 1-day view.
- **Incrementality:** three ad sets, including two MOF Sales ad sets, use Meta's **incrementality** attribution.
- **Top Funnel:** the ATC ad sets use 7-day click + 1-day view + 1-day engaged-view. For the LPV and Reach ad sets, the `attribution_spec` says 1-day click while `attribution_setting` says 7-day click + 1-day view.
- **Default behaviour, confirmed on two ad sets:** with no window passed, Insights returns each ad set's own setting. An incrementality ad set therefore reports incrementality-attributed purchases.

**Footer text, proposed:**

> "Meta platform data · each ad set's own attribution: mostly 7-day click, 1-day view, 1-day engaged-view; a few ad sets use incrementality."

Forcing one window (`action_attribution_windows`) would change purchase and revenue values, which the brief rules out. It is listed as decision D6.

## 4. Stage, product (SKU) and offer today

All from names, in `app/taxonomy.py` with rules in `config.json` → `taxonomy`. They are computed when the pages are built (`range_data.py`), and the browser reads them from the pages.

| Tag | Rule today |
|---|---|
| Scope | `rules.campaign_kind`: Reach regex → social; "awareness" in the campaign name → awareness; else performance |
| Stage | "Catalog", "Catalogue" or "AllFunnels" in the campaign or ad name → Catalog. Else an ad name starting `MOF_` / `BOF_` (optionally `MG_`) → that stage. Else a BOF / MOF / TOF token in the campaign name. Else TOF |
| Product | First name with a code wins: ad → ad set → campaign. Sets are matched by **substring** of the flattened name (TFDUO, ESDUO, TRIO, H2T, HPRANGE). Single products are matched by **whole token**, also accepting a digit or `PACK` / `S` suffix (`UAS2`, `UASPACK`). No code → CATALOG, OFFER (site-wide offer creative), a generic "SETS" bucket, or UNMAPPED |
| Multi-SKU ads | **Equal split** (option b): each named product gets 1/n of the ad's spend and results |
| Offer | Only used to label ads with no product as OFFER (`offer_regex`). There is **no Offer / Non-offer tag** today |

What the 30-day classification run found, using the brief's ordered code list and token rule:

1. **Substring vs token.**
   - No false positives exist in the current names: no HOT in PHOTO or HOTSTAR, no ASS in CLASS or ASSET, no PEEL in PEELOFF.
   - The real risk runs the other way. Codes glued to a number (`…_ITB1`, `…_ASS2`, `…_UAS1`) are **missed** by a pure whole-token rule.
   - **Proposal:** whole token, plus an optional numeric or `PACK` suffix, as `taxonomy.py` already does.
2. **Set codes** only ever appear joined as one word (`HEADTOTOESET`, `3STEPSPOTDIMISHINGSET`, `SPOTGEL`, `HPRANGE`), never split. Whole-token matching works for them.
3. **The brief's list misses names that carry real spend.**
   - `EvenSkinDuo`, `TargetAndFadeDuo`, `EvenToneTrio` / `BodyTrio`, generic `Duo` / `Trio` / `Sets`, `GFS` (Glow Forward), and the B2@749 / B3@999 offer creatives with no product.
   - **Proposal:** keep the current set codes (TFDUO, ESDUO, TRIO) and add GFS to the ordered list.
   - Offer creatives with no product, and generic set names, get their own visible rows instead of "Other".
4. **Multi-SKU ads** name 2 or 3 single products and no set. The combinations seen are UAS+ASS+ITB, UAS+ITB, ASS+ITB and ASS+HOT. Decision D1.
5. **Other** (no code anywhere) is dominated by:
   - the two catalog campaigns, which have their own Catalog stage;
   - offer creatives with no product;
   - Duo, Trio and Sets names;
   - the Awareness Reach ads;
   - a small tail (Open_GFS_*, Amazon_GreatIndianSale_* ads).
6. **Offer flag.**
   - From the **campaign name alone**, only about half of spend can be tagged: `NON-OFFER` and a standalone `OFFER` are rare, and `B2@749` catches four OpenAdvantageOffer campaigns where OFFER is glued to other words.
   - With precedence **ad → ad set → campaign** (like SKU), most of the rest resolves.
   - About a third of spend has no signal at any level: Catalog, the Top Funnel campaigns named "Awareness", Sets_Duos, AdvantageSales_ASS.
   - Decision D2.
7. **Scope by name vs objective.**
   - Nine campaigns contain "awareness" (eight in Top Funnel, one Amazon campaign in Sales).
   - Only one of them (the Reach campaign) has an awareness objective; the others are **OUTCOME_SALES** optimising for ATC / LPV.
   - The name rule calls them all Awareness, so they lose Platform ROAS and purchase metrics in the brief's Awareness view.
   - Decision D3.
8. **Stage.** Every ad gets a stage from a token or prefix; none falls back to TOF by default. One BOF_-prefixed ad sits in a MOF campaign. Catalog is a material share of spend.

## 5. The team sheet's four anomalies

**Sheet:** "Meta Dashboard - Perf Only", tab "Dashboard — Filtered". Its inputs:
- Raw_Data is a **pasted Ads Manager ad-level export of the Asaya Sales account only**, with no connector. Its totals match the API: LPV exactly, ATC within two.
- Dashboard cells are SUMIFS over Raw_Data, matched on helper columns:
  - Funnel: SEARCH on the campaign name.
  - Offer: SEARCH "Offer" on the **ad** name.
  - Product: first-match `IFS(REGEXMATCH(...))` on the **ad** name.

**All four anomalies are sheet formula errors. The source data is fine.** Several SUMIFS point at the wrong Raw_Data column:

| Anomaly | Cell(s) | Sums | Should sum | Effect |
|---|---|---|---|---|
| LPV > clicks (ASS BOF, ASS Overall) | AV31, AW31 | L (revenue) | S (LPV) | ASS BOF "LPV" is its revenue; ASS Overall adds it in |
| ATC = LPV (UAS Overall B) | AT24:AT26 | S (LPV) | R (ATC) | UAS ATC shows its LPV; UAS Cost per ATC reads about a quarter of the true value |
| Implausible ATC (Meta BOF Non-offer B) | AT21 | L (revenue) | R (ATC) | "ATC" is revenue |
| (same pattern) | AW20 (Meta BOF Offer LPV B) | L | S | "LPV" is revenue |
| (latent, shows 0 today) | AV49:AV51 (Spot Gel LPV A), AT76:AT78 (Peel ATC B) | L / S | S / R | wrong once these products spend |
| ₹0 Cost per LPV / ATC | AQ20, AN21, AP31 | — | — | real spend ÷ a denominator inflated by revenue gives under ₹0.50, and `₹#,##0` shows ₹0. Not a separate bug |

Other notes on the sheet:
- **Clicks** are link clicks; clicks (all) is not used. This is correct.
- **First match wins** in the sheet's product rule, so a UAS+ASS+ITB ad counts only as UAS and an ASS+HOT ad only as ASS. This hides multi-SKU ads.
- **Offer is read from the ad name**, so ads in an offer ad set without "Offer" in their own name count as Non-offer.
- **Account:** the sheet covers the Sales account only. The new view defaults to All accounts, so its totals will be larger than the sheet's unless the Account filter is set to Sales.

**The source itself (API, 30 days, row level):**
- **LPV above link clicks × 1.05:** a few hundred ad-days. Most have zero clicks or zero spend; the rest cluster in a few ITB video ads. Overall LPV ÷ link clicks is well below 1 in both accounts. Rule: **warn at row level, never fail**.
- **ATC above LPV × 1.5:** many ad-days.
  - Most have zero LPV or zero spend: conversions reported after the ad stopped.
  - The rest are bundle-offer creatives, where people add several products, and ATC is attributed 7-day click + 1-day view while LPV is click-only.
  - Amazon-traffic ads send people to Amazon (no LPV) but still collect site-pixel ATCs.
  - Rule: **warn** (as the brief says).
- **Purchases on zero spend** happen for the same reason (conversions land after delivery stops). Flag, but expect some.

## 6. Pipeline additions (each needs your approval)

| # | Change | What it unlocks | Cost |
|---|---|---|---|
| P1 | Keep `link_click`, `landing_page_view`, `omni_add_to_cart` (+ value) and `video_view` from the `actions` we already receive; re-pull the 90 days of ad-level cache once | Link clicks, LPV, ATC, every funnel and cost metric in §3 of the brief, Hook rate | No new field; one 90-day re-pull |
| P2 | Add `reach` (and `frequency`) to the daily pull, plus an **on-demand period query** for unique reach of a selected entity or period, cached | Reach and Frequency on rows and periods; "n/a" never shown for a row the user selects | New field; extra API calls when a drawer or period is opened |
| P3 | Add `video_thruplay_watched_actions` (and optionally `video_play_actions`, p25–p100) | ThruPlays, Cost per ThruPlay, Hold rate; the Awareness metric set | New fields |
| P4 | Read ad, ad set and campaign objects once a run: `effective_status`, `daily_budget` / `lifetime_budget` at both levels, `created_time` | Status filter and dot, budget in the drawer, "Since launch" | Object reads, about one call per 100 objects |
| P5 | Read creatives for ads with spend: `thumbnail_url` (ask for a larger size), `body` | Thumbnail and primary text in the ad drawer | Object reads; some creatives return nothing (privacy check) |
| P6 | Activity log (budget and status edits) | Annotations on the trend chart | Separate API; brief says list only |
| P7 | Confirm `action_report_time` (impression vs conversion date) and make it explicit | Stable day-level numbers; explains ATC on zero-spend days | No value change if we pin today's behaviour |

**Without P1 the Performance view is spend, impressions, all clicks, purchases and revenue only.** No LPV, ATC, link-based CTR / CPC or funnel strip.

## 7. Other findings

- **The pipeline already reconciles to account totals:** Data health's cross-check compares row sums with each account's own total, so archived ads are not silently lost by the pipeline (the Meta Ads MCP listing skips them by default, which matters only for ad-hoc pulls).
- **Benchmarks:** the brief says TOF 1.0x / MOF 2.7x / BOF 3.5x are "already agreed". In the restructure decisions they were declined ("not needed", twice). Decision D4.
- **First paint:** the meta_tree page (90 days, ad × day) is the biggest page today. Adding P1's four bases roughly doubles it. The plan is a dedicated `meta_ads` page with compact numeric rows and per-day series sliced in the browser (the brief's 30-day first paint), and on-demand reach queries (P2).

## 8. Decisions for you

| # | Decision | Recommendation |
|---|---|---|
| D1 | Multi-SKU ads: (a) a combined "UAS + ITB" row under "Duos & multi-SKU", or (b) the current equal split | (a), as you prefer: the combos are few and stable, and spend stays where it was spent |
| D2 | Offer flag: campaign name only, or ad → ad set → campaign precedence; what to call spend with no signal | Precedence ad → ad set → campaign, recognising `NON-OFFER`, `OFFER`, `B\d@\d`, `BUY\d@`. No signal → "Not tagged" (a visible value of the Offer filter, shown in Data health coverage) |
| D3 | Awareness scope: by name (today) or by campaign objective | By name as today (it is the agreed rule and drives Marketing's Performance numbers), but show the objective in the drawer and list the eight sales-objective "Awareness" campaigns in Data health for you to rename or reclassify |
| D4 | ROAS benchmarks in this view (previously declined) | Your call. Without them, matrix cells in ROAS mode are coloured by Δ like every other mode |
| D5 | SKU code list: the brief's list plus TFDUO / ESDUO / TRIO / GFS and visible rows for "Offer creative (no product)" and "Sets (not named)"; whole token + numeric/PACK suffix | Yes |
| D6 | Attribution: keep each ad set's own setting (no value change), footer as in §3 | Yes; forcing one window changes reported purchases and is out of scope |
| D7 | Approve P1 (needed for the Performance view as briefed) | Yes |
| D8 | Approve P2–P5 now, later, or not at all (P6 list only) | P2 and P4 now (reach, status, budget are core to the drawer and filters); P3 with P2 if the Awareness view matters; P5 later |
| D9 | Fix the team sheet's formula cells listed in §5 | Fix them (seven ranges), even though the dashboard view replaces the sheet |

---

## 9. Decisions taken

| # | Decision |
|---|---|
| D1 | Multi-SKU ads are one combined row ("UAS + ITB", in config order) under "Duos & multi-SKU". Every multi-SKU ad in the audit window is an offer ad (Offer in the ad name), so nothing is split |
| D2 | Offer: **Offer** only when the ad name says so (or a price offer such as B2@749); **Non-offer** when the ad, ad set or campaign says Non-offer; otherwise **Not tagged**, a visible value of the Offer filter, with the ads listed in Data health for renaming |
| D3 | Awareness: the campaign name says "awareness", except Reach and Amazon campaigns, which are in neither scope (as Reach already was). This moves the Amazon campaign out of Marketing's Awareness numbers |
| D4 | No benchmarks: matrix and explorer colour by change only |
| D5 | Code list: the brief's ordered list plus TargetAndFadeDuo, EvenSkinDuo, TRIO and GFS; whole tokens with a number or PACK suffix for single products; named rows for Catalog, offer creatives (no product) and unnamed sets; Other for the rest |
| D6 | Attribution: each ad set's own setting, stated in the view's footer |
| D7 | Link clicks, LPV, ATC and 3-second plays are kept from the actions already received. The history did not have them (they were dropped when cached), so the ad-level backfill reads each cached day once more; the view shows them for the days already re-read |
| D8 | Reach and frequency (daily field plus on-demand unique reach for any period and selection), and status, budget and launch date (object reads) added. ThruPlays and video quartiles, creative thumbnails and the activity log not added: Cost per ThruPlay and Hold rate are left out of the Awareness set and logged here |

## 10. What was built

- **Pipeline** (`app/meta.py`, `app/refresh.py`):
  - The new fields are kept: link clicks, LPV, ATC, 3-second plays, reach and frequency.
  - Each action list is in priority order and only the first type found is kept, so ATC and LPV are never double counted.
  - `fetch_objects` reads status, budget and launch date for campaigns, ad sets and ads, cached in `cache/meta_objects.json`.
  - `reach_for` asks Meta for unique reach, cached six hours behind `/api/meta/reach`.
- **Classification** (`app/meta_model.py`, `config.json` → `meta_view`): scope, offer, stage and SKU for every ad, computed once when the pages are built.
- **Data** (`app/pages/meta_view.py` → `meta_ads` page): ad × day rows with the tags. A test ties its daily spend to the Meta spend every other tab uses.
- **View** (`static/meta_view.js`), Marketing › Meta:
  - Sub-tabs Channels | Meta | Google. Channels keeps Meta as one row; Google keeps its tree. The old Meta product × stage matrix and the Meta branch of the tree are gone.
  - A sticky filter bar: Scope, Offer (with Not tagged), Account, Status, Min spend, Search.
  - KPI strip with 14-day sparklines.
  - Funnel efficiency strip, which follows the cross-filters and the selected row and names the step that moved most.
  - Watchlist built from config thresholds. "ROAS under half the stage's average in view" replaces the benchmark rule. Frequency uses daily reach, a lower bound for the period.
  - SKU × Stage matrix with a metric switcher, cross-filter chips and an "N more" fold.
  - Explorer with four group-by presets, six column presets (Custom up to 8), Δ under each value or the comparison values, a 14-day trend, tags, status dot, sorting within levels, validation warnings, a pinned total equal to the KPI strip, and keyboard control.
  - Detail drawer:
    - breadcrumb, status, budget, tags and an Ads Manager link;
    - mini KPIs;
    - a 2-metric chart with daily or weekly steps, range presets, the comparison dashed, the parent's value dotted and sale days shaded;
    - for an ad: its funnel and sibling ranks;
    - for an ad set or campaign: its children with shares of spend and of purchases.
  - All view state is in the URL.
- **Data health › Meta classification:** the tie-out, tag coverage, validation counts, and the Not tagged and Other ads to rename.
