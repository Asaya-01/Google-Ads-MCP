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
| DataForSEO (Keywords Data API, Google Ads search volume, live) | The same Keyword Planner monthly searches, without Basic Google Ads API access. Only the keyword list is sent. Paid per task of up to 1,000 keywords; one task a week | `dataforseo-login`, `dataforseo-password` in Secret Manager; switch `seo.sources.dataforseo` on (and `keyword_planner` off) |
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
3. Monthly searches, either way:
   - **DataForSEO** (no change to any Google project): create an account at dataforseo.com, add a prepaid balance, and save the API login and password (DataForSEO dashboard › API Access) as the secrets `dataforseo-login` and `dataforseo-password`. Then set `seo.sources.dataforseo` to true and `seo.sources.keyword_planner` to false.
   - **Keyword Planner direct** needs **Basic** Google Ads API access (Explorer cannot call it). Basic needs brand verification, an External / In production sign-in screen and authorised domains you own, which the dashboard's own project cannot take without touching its sign-in. So Keyword Planner gets **its own Cloud project**:
   1. Create a project (for example `asaya-keyword-planner`) and enable the Google Ads API in it.
   2. Google Auth Platform: user type External, publishing status In production. Branding: app name, support email, home page `https://worldofasaya.com`, the privacy policy page, authorised domain `worldofasaya.com` only, no logo. Submit for brand verification (the person submitting must be an Owner of worldofasaya.com in Search Console).
   3. Once verified, apply for Basic on that project's Google Ads API page.
   4. Create an OAuth client (Web application, redirect URI `https://developers.google.com/oauthplayground`) and mint a refresh token in the OAuth Playground (own credentials, scope `https://www.googleapis.com/auth/adwords`), signed in as someone with read access to the Asaya Google Ads account.
   5. Save the three values as secrets in the **dashboard's** project: `keyword-planner-client-id`, `keyword-planner-client-secret`, `keyword-planner-refresh-token`.

   The job uses those three when they are all set, otherwise the dashboard's own Google Ads credentials. Until then the Search demand section explains this and shows branded impressions from Search Console instead.

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
