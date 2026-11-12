# Dashboard Plus: Phase 1

Branch `dashboard-plus`. Not merged into the live dashboard.

## What it adds

A single **Plus** entry in the navigation, placed after *Data health*. Phase 1 gives it four sub-tabs:

| Sub-tab | Spec module | What it shows |
|---|---|---|
| Profit | M1 | MER, CM1/CM2/CM3, the break-even ROAS and a first-order view. Any card whose input is missing shows "Input needed". |
| Traffic Quality | M3 | Clean vs all sessions, engaged rate, UTM coverage, junk sources and a click-to-session check per campaign. Also the reconciliation table (Meta / Google / Shopify last click / GA4 purchases) and the data-health score. |
| Site | M6 | The "Changes vs funnel" chart, with markers from the Changes Tracker sheet and the change log. |
| Inventory | M7 | Daily stock snapshots: Shopify available units per variant and Unicommerce inventory per facility. |

Every sub-tab uses the existing date bar, comparison and BAU/Sale toggle.

**Why one entry instead of four:** with four separate entries the navigation overflowed and hid the D-1 Report button at every desktop width. The sub-tabs work the same way Marketing's do, e.g. `#plus?sub=traffic`.

## How it runs

- **Job:** `python -m app.plus.job` (Cloud Run job `asaya-d2c-plus`).
  - It reads the existing pages and status read-only.
  - It writes exactly one page, `pages/plus.json`.
  - It appends today's snapshot to two tables in BigQuery dataset `dashboard_plus`, at most once a day: `inventory_snapshots_shopify` and `inventory_snapshots_unicommerce`.
  - It never writes to any other dataset; `app/plus/bqx.py` refuses any other target.
- **SQL** in `sql/plus/` is SELECT-only, and a test enforces this.
- **Preview service:** `deploy_plus.sh` deploys a separate service, `asaya-d2c-dashboard-plus`. The live `asaya-d2c-dashboard` service is not redeployed.

## Setup (once)

1. Create the dataset:

```bash
bq mk --location=asia-south1 --dataset asaya-data-room-487110:dashboard_plus
```

2. Give the service account Data Editor on that dataset only. The easiest way is the BigQuery console:
   - open dashboard_plus → Sharing → Permissions → Add principal;
   - principal: `d2c-dashboard@asaya-data-room-487110.iam.gserviceaccount.com`;
   - role: BigQuery Data Editor.

3. Deploy from the branch:

```bash
git checkout dashboard-plus && ./dashboard/deploy_plus.sh
```

4. Add the preview URL to the OAuth client. The script prints the origin and the redirect URI to add.

5. Run the job once:

```bash
gcloud run jobs execute asaya-d2c-plus --region asia-south1 --wait
```

## Inputs still needed

Until each input arrives, its card says "Input needed". No number is estimated.

| Input | Where it goes | Format |
|---|---|---|
| Landed COGS per variant | sheet id in `PLUS_COGS_SHEET` | Tab `COGS`, columns: sku, landed_cost, effective_from |
| Shipping / COD / gateway / packaging rate card | `PLUS_RATE_CARD_SHEET` | Tab `Rate card`, columns: item, value, unit, effective_from |
| Influencer and other awareness spend | `PLUS_INFLUENCER_SHEET` | Tab `Spend`, columns: month (YYYY-MM), influencer, awareness_other |
| GST treatment of Total sales | `app/plus/config_plus.json` → `profit.gst_inclusive_total_sales`, `gst_rate` | yes/no and rate |
| Shopify Changes Tracker | `PLUS_CHANGES_SHEET` | Tab `Changes`, columns: date, change, area, owner |
| Meta Event Match Quality | approval for a new Meta API read | — |
| Reddit link clicks | Reddit export or API | — |
| Cooee test markers | Cooee export or API | — |
| One month of finance P&L | for the gate: CM2 must be within 5% of finance | — |

Share each sheet with the service account as Viewer, and put its id in `deploy.env`. Never put a sheet id in the repository.

The Shopify app may also need the `read_inventory` scope for `inventoryQuantity`. If it is missing, the Inventory sub-tab says "not taken: …".

## Regression check

The existing tabs must not change. Run this before and after each deploy:

```bash
gsutil cp gs://asaya-data-room-487110-d2c-dashboard/pages/days.json /tmp/days.json
```

```bash
node dashboard/tools/plus_regression.js /tmp/days.json
```

It prints Total sales, Orders, Sessions and Blended ROAS for 1 Jul – 30 Sep 2026, BAU days. These must match the owner's reference figures.
