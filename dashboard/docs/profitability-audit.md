# Profitability tab: audit of the P&L source (step 0)

Status: **reviewed; Phase 1 built** (decisions at the end). The repository is public, so this
file holds structure, definitions and findings only. The figures (every line,
month and check) are in a private file shared with the dashboard owner, not
committed here.

## Where the numbers come from

The artifact shared for this tab is a Claude "Dashboard" artifact titled
*Asaya business review, Apr–Oct 2026*. Its page holds no numbers; they sit in
two JSON data files attached to it:

| File | Built by | From |
|---|---|---|
| `asaya_pack.json` | `build_pack.py` (in the file's own metadata) | **ASAYA_Investor_Data_Pack_Apr-Oct2026_v1.xlsx** (cached values) and the D2C Tracker (Google Drive, MoM Tracker tab, exported 18 Nov 2026) |
| `extras_pack.json` | `build_extras.py` | the D2C Tracker's "MRP sales" tab |

Both were read programmatically (no retyping). Money is in ₹ crore in the
files (the pack's ₹ lakh ÷ 100).

**Important:** these files are an *extract* of the finance workbook, made by a
script that keeps only the rows it maps by name. Any row the script does not
know is dropped. That explains the gross-margin gap below, and it is why the
import for the tab should come from the workbook itself (see Questions).

The dashboard job cannot read a claude.ai artifact (it needs a person's
claude.ai sign-in). A recurring import needs a source the dashboard's service
account can read.

## 1. Structure

**Months:** Apr-26 to Oct-26 (seven months) plus an Apr–Oct total. All are
actuals from the MIS (the consolidated table also carries the FY27 base-case
plan per month).

**Channels** (table `channel_pnl`, "RPSG-format channel P&L from
MIS_WCPL_Oct26"): Website (Shopify), Amazon (the extract combines Amazon –
RK World (Vendor) and Amazon – own (Seller Central)), Nykaa, Blinkit, Zepto,
Swiggy Instamart, Other marketplaces & B2B, Consolidated (sum of channels).

**Line items per channel**, exactly as the workbook names them, with sign and
the subtotal each rolls into:

| Line item (workbook label) | Sign | Rolls into |
|---|---|---|
| GMV | + | |
| Discounts / trade margin | − | Gross sales |
| **Gross sales** | = | GMV − Discounts / trade margin |
| **Net revenue** | = | Gross sales ÷ 1.18 (GST removed at a flat 18%) |
| COGS | − | Gross margin |
| **Gross margin** | = | Net revenue − COGS − *an unlisted line* (see §4) |
| DPC / payment gateway / marketplace fees | − | CM1 |
| Packaging | − | CM1 |
| Storage | − | CM1 |
| Logistics (outward) | − | CM1 |
| **CM1** | = | Gross margin − the four lines above |
| Visibility spends (ads) | − | CM2 |
| Consumer promos | − | CM2 |
| Samples | − | CM2 |
| Total channel & performance spends | = | sum of the three above |
| **CM2** | = | CM1 − Total channel & performance spends |
| Influencer / awareness (for some channels: "combined in RPSG source") | − | CM3 |
| Agency fees | − | CM3 |
| Total brand building | = | sum of the two above |
| **CM3** | = | CM2 − Total brand building |

The channel P&L **stops at CM3**. Fixed costs and EBITDA exist only for the
company as a whole, in the consolidated MIS table (`pnl`):

| Consolidated MIS label | Rolls into |
|---|---|
| Revenue (net) | |
| COGS | Gross margin |
| Gross margin | |
| Marketplace commission; Supply chain costs | CM1 (variable margin) |
| CM1 (variable margin) | |
| Performance marketing (own website); Channel / marketplace spends | CM2 |
| CM2 | |
| Brand building (split: Influencer, Awareness – Meta, Awareness – Google, Agency fees, Sampling, timing & other) | CM3 |
| CM3 | |
| Fixed costs, one-offs and other income (balancing) | EBITDA (as per MIS) |

Note: in the extract, fixed costs are the *balancing* figure between CM3 and
the MIS EBITDA, not a list of cost lines.

## 2. Definitions (the workbook's own)

- **Revenue:** *Gross sales* = GMV − Discounts / trade margin, including GST.
  *Net revenue* = Gross sales ÷ 1.18, i.e. ex-GST. There is **no separate
  returns & cancellations line** and no shipping income: either they are
  already netted inside Gross sales, or they are not deducted. The
  reconciliation (§5) suggests revenue is booked on something narrower than
  orders placed.
- **GMV** for the Website is larger than the tracker's MRP value of *paid*
  units, so it probably includes free-gift units at MRP (to confirm).
- **CM1** in the workbook is **after** fulfilment (payment / DPC fees,
  packaging, storage, outward logistics). In the brief's default structure
  that level is CM2.
- **CM2** in the workbook is after **performance marketing** (Visibility
  spends (ads), Consumer promos, Samples). For the Website, Visibility spends
  equals the MIS line "Performance marketing (own website)" every month.
- **CM3** in the workbook is after **brand building** (Influencer / awareness
  and Agency fees), the brief's "awareness".
- No RTO, COD or freebie lines appear separately: they sit inside the lines
  above or are not in the extract.

### Mapping to the brief's default structure

| Brief default | Workbook equivalent |
|---|---|
| Net revenue (gross − discounts − returns − GST) | Net revenue (Gross sales ÷ 1.18; no returns line) |
| CM1 = Net revenue − COGS | **Gross margin** |
| CM2 = CM1 − shipping, payment, other variable | **CM1** |
| CM3 excl. awareness = CM2 − performance marketing, CRM, affiliates | **CM2** |
| CM3 incl. awareness | **CM3** |
| EBITDA = CM3 − fixed costs | company-level only; no Website figure |

The brief says to adopt the workbook's definitions and ask where they differ:
the names differ by one level (see Questions 1).

## 3. The D2C slice

- The **Website** channel rows are the D2C slice. Every month Apr–Oct is
  filled. (The extract script's comment says only Apr–Jul are filled; the
  data has all seven months.)
- **Direct to the Website:** COGS, fees, packaging, storage, logistics,
  Visibility spends (ads), Samples.
- **Allocated:** **Total brand building** (Influencer / awareness and Agency
  fees) is split to channels by **share of net revenue**: the Website's share
  of brand building equals its share of net revenue in every month, to within
  rounding.
- **Not allocated:** fixed costs and EBITDA (company level only).

## 4. Arithmetic check (Website, every month and the total)

| Check | Result |
|---|---|
| Gross sales = GMV − Discounts / trade margin | matches every month |
| Net revenue = Gross sales ÷ 1.18 | matches every month |
| **Gross margin = Net revenue − COGS** | **does not match: Gross margin is lower every month**, by about 1–2% of net revenue. A cost inside gross margin is not in the extract. |
| CM1 = Gross margin − fees − packaging − storage − logistics | matches |
| Total channel & performance spends = ads + promos + samples | matches |
| CM2, Total brand building, CM3 | match |
| Months add up to Apr–Oct | match |

**Consolidated rows vs the MIS table:** net revenue matches. COGS in the MIS
is higher every month, and CM2 / brand building differ in May and Oct. The
artifact lists the May CM2 gap as open with finance. This does not change the
Website slice, but D2C plus marketplaces will not add up to the MIS until
these are explained.

## 5. Reconciliation with the dashboard's Shopify numbers

Shopify's sales report by month: gross sales (at selling price) −
discounts − returns = **net sales (ex-GST)**; + GST + shipping = **Total
sales** (the dashboard's headline).

- The workbook's **Gross sales (incl. GST)** is below Shopify's **Total
  sales** every month.
- The workbook's **Net revenue (ex-GST)** is below Shopify's **net sales
  (ex-GST)** every month. The gap is single digits in Apr–May and widens
  from June, up to almost a fifth in July.
- Shopify's returns are small, so they do not explain it.

Likely causes, **to be confirmed by finance**, before the dashboard states
any of them as fact:
- revenue booked on dispatch or delivery, so cancellations and RTO after the
  order are out;
- free-gift and sample lines;
- B2B or test orders on the store;
- GST at a flat 18% against Shopify's actual tax.

## 6. Access

The dashboard's allowlist today has one flag per person (`active: true`) and
no roles. Proposal: a second field on the allowlist entry, `profitability:
true`, checked by the server for this tab's page. Off for everyone until set.
Admins to be named by the owner.

## 7. Storage

- No BigQuery writes, as standing rule.
- No real figures in the repository, which is public.
- So `pnl_monthly_actuals` lives in the dashboard's private bucket as
  versioned JSON: `private/pnl/actuals/<source_version>.json`, never
  overwritten.
- `pnl_line_item_map` and the empty Phase 2 cost tables are config (structure
  only) in the repository.
- Cost values, when they arrive, go in the bucket.

## Questions for the owner (decisions before building)

1. **Level names.** Adopt the workbook's names (Gross margin, CM1 after
   fulfilment, CM2 after performance marketing, CM3 after brand building)?
   Then the brief's emphasised "CM2 %" card is the workbook's **CM1 %**, and
   "CM3 incl./excl. awareness" is the workbook's **CM3 / CM2**.
2. **The unlisted line inside Gross margin.** Which workbook row is it (e.g.
   other cost of sales, freight-in, stock adjustment)? Until known, the tab
   would show it as "Other cost of sales (not itemised in the source)".
3. **Revenue basis.** Is Net revenue on dispatch or delivery, net of RTO and
   cancellations? Are free-gift lines and B2B orders on the store excluded?
   This explains the gap to Shopify.
4. **D2C EBITDA.** Fixed costs exist only at company level. Options:
   - allocate by net revenue share (as brand building is);
   - show EBITDA for the company only;
   - stop the D2C view at CM3.
5. **Import source.** The dashboard cannot read the claude.ai artifact. Share
   the **Investor Data Pack / MIS workbook** in Google Drive with the
   dashboard's service account (Viewer), or upload each month's CSV / XLSX to
   the bucket.
6. **Who gets access** to this tab.

## Decisions (owner, 20 Nov 2026) and what the MIS showed

1. **Level names:** the workbook's own: Net revenue, Gross margin, CM1, CM2,
   CM3. The emphasised card is **CM1 %** (after fulfilment, before any
   marketing).
2. **The unlisted line inside Gross margin** is **Primary Freight &
   Damages**. In the monthly MIS (WCPL_MIS_Oct-2026), the expense breakup's
   Primary Freight rows (factory to warehouse) add up to the "Expense
   Reclass: Primary Freight & Damages moved from Dist to COGS" note. That
   same amount separates the MIS COGS from item-level COGS, within rounding,
   in every month except May. Finance splits it to channels. Where a source
   does not list it, the tab shows it as a **derived** line (Gross margin's
   gap to Net revenue − COGS). It is in grey italics with the method in a
   tooltip, and listed on Data health.
3. **Revenue basis:** net-net: ex-GST, after discounts, RTO and
   cancellations. That is why it is below Shopify's net sales; the bridge is
   on Data health.
4. **EBITDA:** dropped. The tab stops at CM3, as the channel P&L does.
5. **Updates:** finance's files are uploaded on the tab ("Upload finance
   file") into the private bucket, one version per upload, never
   overwritten. Accepted: the Investor Data Pack (Channel P&L tab), the
   monthly MIS (COGS Master and Sales Dump) and the review's JSON extract.
6. **Access:** everyone on the dashboard allowlist.

### What the MIS workbook holds

The MIS is company-level: P&L history, Forecast vs Actuals, an expense
breakup by vendor and month, Marketing Sheet, COGS Master (COGS per unit by
EAN) and the month's Sales Dump (sales lines by channel, with COGS). It has
**no Channel P&L tab**, so the Website P&L comes from the investor pack.

The MIS confirms the pack:
- the Sales Dump's Shopify lines equal the Website's Net revenue and COGS
  for October;
- the payment gateway rows (EaseBuzz, GoKwik, Snapmint) equal the Website's
  payment / DPC fees line.

From the MIS the tab takes:
- COGS by SKU: the Phase 2 COGS input;
- the month's Website SKU margins.

Reading it touches only these three sheets: COGS Master, Sales Dump and
Marketing Sheet (for the month).

## What is built (Phase 1)

| Piece | Where |
|---|---|
| Import (all channels, untouched, versioned) | `app/pnl/importer.py` → `private/pnl/actuals/`, `private/pnl/mis/` |
| Line map (config) | `config.json` → `profitability.lines` |
| The Website slice, subtotals recomputed and checked, finance's figures shown as stated | `app/pnl/build.py` → `pages/profitability.json` |
| Phase 2 cost tables, created empty | `private/pnl/costs/*.json` |
| Tab: Month · Trend · Unit economics · SKU, cost-input checklist, PDF and CSV | `static/profitability.js` |
| Data health: imports, arithmetic, Shopify reconciliation, rebuild | same file, `pfHealth` |

Not built yet:
- **Phase 2 live month-to-date P&L.** It needs the rate card, payment
  rates, COD and RTO rates.
- **New vs repeat margins.** The P&L has no new / repeat split.
