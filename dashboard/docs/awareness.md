# Awareness tab: how it is built

**Question:** is awareness spend growing demand in the geos we spend in, and which geos can we test next?

## Data (read only)

- Sales come from Maplemonk's consolidated sales table (`sql/awareness/geo_daily.sql`). The query only reads; nothing is created, changed or written in BigQuery.
- Only channels with a customer location are used. Nykaa, Amazon 1P and B2B carry no location, so every lift is a **floor**.
- State names are cleaned with `awareness.state_aliases`. Cities are grouped with `awareness.city_clusters`. Proposed clusters (`city_clusters_proposed`) change nothing until they are moved into `city_clusters`.
- The offer calendar (Sale / BAU / Mixed weeks) is the dashboard's own sale calendar (`pages/days.json`).

## Jobs

| Job | When (IST) | Reads | Writes (dashboard bucket) |
|---|---|---|---|
| `asaya-d2c-awareness` (`python -m app.awareness.job`) | daily 07:15 | Maplemonk (read only), `pages/days.json`, GeoLift results | `pages/awareness*.json`, `cache/awareness/panel_{state,city}.csv`, `cache/awareness/r_input.json`, run log |
| `asaya-geolift-weekly` (`awareness_r/`, `weekly`) | Mon 09:00 | the panels and `r_input.json` | `cache/awareness/geolift/tests.json`, plots |
| `asaya-geolift-monthly` (`awareness_r/`, `monthly`) | 1st 09:30 | the panels | `cache/awareness/geolift/{testability,power_curves}.json` |

The GeoLift image is built by `deploy_geolift.sh`. Results reach the tab on the next Awareness job run.

## Settings

- **Structure** lives in `config.json` → `awareness`: tests, media events, regions, thresholds and GeoLift settings.
- **Business figures** live in the bucket at `private/awareness.json`, because the repository is public. The job lays this file over `config.json` when it runs. Without it, the expected lift, iROAS, leakage share and the acceptance-check verdicts show as "not set".

```json
{
  "tests": {"TN_TF_STATE_2026_11": {"weekly_spend": 0}, "TN_TF_CITY_2026_11": {"weekly_spend": 0}},
  "media_events": {"META_TF_KERALA_LEAK_2026_11": {"leak_share": 0.0}},
  "acceptance": {"website_orders": 0, "tn_weekly_sales": 0, "chennai_daily_sales": 0, "coimbatore_daily_sales": 0}
}
```

### Adding a test or a media event

1. Add the entry to `config.json` (`awareness.tests` or `awareness.media_events`). The Test Planner's **Copy config entry** button gives you a test row.
2. Put the weekly spend in `private/awareness.json`.
3. Media events have a `review_status`: only `approved` events count towards contamination.

## Reading the numbers

- **Relative index:** (geo this week ÷ geo 12-week baseline) ÷ (rest of India this week ÷ rest of India baseline). *Clean* leaves out geos where other awareness media ran that week. Never read share on its own: a geo's share can rise only because the others fell.
- **Donors:**
  - Every geo is listed, with the reason it is in or out.
  - Geos that went dark are still donors. That is the design, and **donor drift** shows how much their fall inflates the lift.
- **Verdicts are rule-based:**
  - *Too early* before 14 days.
  - An interim result is never called significant.
  - *Underpowered* when the expected lift is below the MDE at 42 days.
  - *Check validity* when donor drift is beyond −10% or an event is awaiting review.
- **Map:** state outlines are from the DataMeet India community maps (CC BY 4.0), simplified.
