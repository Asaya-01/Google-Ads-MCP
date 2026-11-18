# SEO / AEO tab: how it is built

**Question:** are more people searching for us, finding us on Google and in AI assistants, and is the site fast enough to keep them?

## Sources (all read only)

| Source | What it gives | Access |
|---|---|---|
| Search Console (Search Analytics API) | Daily clicks, impressions, position: all, branded, non-branded; queries and pages, last 28 days vs the 28 before | The service account is a user on the property (Restricted is enough) |
| GA4 (Data API, Admin API account list) | Sessions and purchases by channel; AI-assistant sessions; organic and AI landing pages | The service account is a Viewer on the property |
| Chrome UX Report (CrUX API, CrUX History API) | Real-user p75 LCP, INP, CLS, FCP, TTFB for worldofasaya.com and every competitor, 40 weeks of history, key pages | API key `google-api-key` in Secret Manager |
| PageSpeed Insights | Lab tests (Lighthouse) of the key pages, mobile and desktop, once a day: score, lab metrics, fixes, third-party scripts | Same key |
| Google Ads Keyword Planner (`GenerateKeywordHistoricalMetrics`) | Monthly searches for Asaya, competitors and category keywords; share of search | Basic API access on the Cloud project. A lookup: no keyword plan is created. Refreshed weekly |
| Shopify (ShopifyQL sessions, blog articles) | Search-engine and AI-assistant visits by day; AI landing pages; blog posts per month | The dashboard's existing Shopify app (articles need `read_content`) |
| The dashboard's own `pages/channel_days.json` | Orders from the Organic Search and AI Assistants channels (GoKwik checkout UTM) | none |

Nothing is written to BigQuery or to any source. The job writes only `pages/seo.json` and `cache/seo/*` in the dashboard's bucket. Each source has its own switch in `config.json` → `seo.sources`; when a source fails, the tab keeps its last good numbers and says from when.

## Job

`asaya-d2c-seo` (`python -m app.seo.job`), daily at 08:20 IST. To run it now:

```
gcloud run jobs execute asaya-d2c-seo --region asia-south1
```

## One-time setup

1. `./dashboard/deploy.sh` (enables the APIs and creates the job).
2. `./dashboard/tools/make_api_key.sh` (creates the PageSpeed / CrUX key, limited to those two APIs, straight into Secret Manager; the key is never printed).
3. Keyword Planner: the Cloud project needs **Basic** Google Ads API access (Explorer access cannot call Keyword Planner). Apply on the Google Ads API page in Cloud Console. Until then the Search demand section explains this and shows branded impressions from Search Console instead.

## Settings (`config.json` → `seo`)

- `brands`: Asaya and competitors, with website (for speed) and Keyword Planner keywords. `in_share: true` = counted in share of search (the 12 brands of the team's sheet).
- `category_keywords`: what Asaya solves (searched in Keyword Planner).
- `gsc.brand_regex`: what counts as a branded query (Asaya and the product names).
- `speed.pages`: the pages tested; `speed.thresholds`: Google's good / poor limits.
- `ai_platforms`: how a visit is matched to an AI assistant (UTM source, Shopify referrer name, GA4 source).
- `alerts`: the flag rules.

## Reading the numbers

- **Branded + non-branded < all** in Search Console: Google leaves rare (anonymised) queries out of any query filter.
- **Organic sessions (Shopify)** are search-engine visits with no UTM. Shopify files most Google Ads clicks under "search" too, so tagged visits are left out.
- **Orders** from Organic Search and AI Assistants use the UTM captured at checkout: a floor, because a visitor who comes back later carries no UTM.
- **CrUX** is real Chrome users over 28 days at the 75th percentile; **Pass** = LCP, INP and CLS all good. PageSpeed lab numbers vary run to run; TBT stands in for INP in the lab.
- **Not connected:** authority score, backlinks, referring domains and AI visibility / citations need Semrush or a similar tool.
