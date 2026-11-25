# Today tab fixes (flag `today_fixes_v2`)

Additive only. With the flag off, the Today tab and the live job behave exactly
as before: the job makes no extra calls and the page carries no new keys. With
it on, the live page gains a `v2` block, the browser reads it, and every
existing key and number stays the same (`tests/test_today_v2.py` builds the
page both ways and compares).

## Switching it on and off

Defaults live in `config.json` → `features` (both off). The bucket file
`config/flags.json` overrides them within a minute, without a deploy:

```bash
echo '{"today_fixes_v2": true}' | gcloud storage cp - gs://asaya-data-room-487110-d2c-dashboard/config/flags.json
```

Write `false` (or delete the file) to switch it off.

## Admin (GoKwik upload only)

Uploading the GoKwik CSV changes what everyone sees on the day's checkout
panel, so it needs the admin role. The role is a field on the person's
access-list document in Firestore, never an email in this repository:

```bash
python -m app.features admin name@company.com          # grant
python -m app.features admin name@company.com --off    # remove
```

## What each fix shows

| Fix | What changes | Metric (registry id) |
|---|---|---|
| A1 | The hour table lists 00:00–23:00 IST. Its header stays in view while scrolling. (The data was already bucketed correctly: see `docs/atc-drilldown-audit.md` F1.) | – |
| A2 | Δ has its own column after each Today \| Comparison pair. Counts are shown as Δ %, rates as Δ pp. Colours follow the registry's direction. | – |
| A3 | Sessions with ATC (today, comparison) and ATC rate (today, comparison, Δ pp) in the hour table. | `atc`, `atc_rate` |
| A4 | The hour under way reads "partial · N min", in grey and never coloured. It is set against the comparison hour's same minutes: yesterday's own minutes (read from Shopify), or a pro-rata share of the hour for the typical day or a picked date. | – |
| A5 | A switch for the sales headline: **Total sales** (default, unchanged) \| **Order value placed**. It changes the headline card, the running-total chart and the table's sales column. The choice is kept in the URL (`#live?sales=placed`). | `order_value_placed` = Shopify Total sales without sales reversals: the order totals of orders created in the hour, before any return, cancellation or edit processed later. Checked against the orders API to the paisa. |
| A6 | The GoKwik card shows when the last load landed, turning amber after 60 minutes and red after 180 (`today_v2.gokwik`). When the automated load has no rows for today, an admin's CSV upload is shown instead, labelled "From CSV upload, HH:MM". It never mixes with the automated load. Two uploads on one day show the increase between them ("since last snapshot"). Uploads are stored in `private/atc/gokwik_csv/`, deduplicated by SHA-256. | `gk_conv_tagged`, `gk_method_to_order`, `gk_payment_to_method` |
| A7 | A Perf ATC rate tile. "Diagnose →" links appear once `atc_drilldown` is on. | `perf_atc_rate` = Perf sessions with an add-to-cart ÷ Perf Sessions (same sessions as Perf Sessions; saved on each run for same-time comparisons) |

## Integrity check (before and after a deploy)

```bash
./dashboard/tools/integrity_snapshot.sh before
./dashboard/deploy.sh
# after one refresh and one live run:
./dashboard/tools/integrity_snapshot.sh after
./dashboard/tools/integrity_snapshot.sh compare
```

`compare` prints every difference in Overview, Funnel and Marketing (range
engine) and Today (24 Nov 10:00–12:59, 23 Nov, 1–4 Nov). "PASS" means none.
Snapshots go to `~/integrity`, never into the repository.
