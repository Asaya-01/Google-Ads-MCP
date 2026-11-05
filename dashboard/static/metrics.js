/* The metric registry: one place for every metric's name, definition, format,
   which way is good and which tab owns it. Every KPI card, table header and
   tooltip reads from here, so a metric has one name and one format on every
   tab. Inlined into app.html inside the dashboard closure; also loadable in
   Node for the tests (module.exports at the bottom).

   format: currency | count | percent | ratio | pp
   dir:    higher (up is good) | lower (up is bad) | neutral (grey arrows)
   field:  the range engine's field for this metric, where it is one
   base:   what a change is measured against for the "base too small" rule:
           "orders" (comparison orders), "spend" (the metric's own comparison
           value), or none */
const METRICS = {
  // ---------------------------------------------------------------- sales
  total_sales: { label: "Total sales", field: "gmv", format: "currency", dir: "higher", home: "overview", base: "orders",
    def: "Shopify Total sales: gross sales minus discounts and returns, plus shipping and taxes, on valid orders (tests, ASAYASS and ASAYAINF left out). Returns count on the day they are processed, so past days can move slightly.",
    formula: "Shopify Sales report · Total sales", source: "Shopify" },
  orders: { label: "Orders", field: "orders", format: "count", dir: "higher", home: "overview", base: "orders",
    def: "Shopify's Orders: every order placed on the day, cancelled ones included, as in Shopify's Sales report. Tests, ASAYASS and ASAYAINF are left out.",
    formula: "Shopify Sales report · Orders", source: "Shopify" },
  aov: { label: "AOV", field: "aov", format: "currency", dir: "higher", home: "overview", base: "orders",
    def: "Average order value: Total sales ÷ Orders, both from Shopify's Sales report.", formula: "Total sales ÷ Orders", source: "Shopify" },
  // ---------------------------------------------------------------- spend and return
  perf_spend: { label: "Performance spend", field: "perf_all_spend", format: "currency", dir: "neutral", home: "marketing", base: "spend",
    def: "Spend on sales campaigns on every channel: Meta and Google sales campaigns, Reddit performance, CRM (flows + broadcasts) and affiliates. Awareness, Reach and Reddit traffic spend are never in it.",
    formula: "Meta perf + Google perf + Reddit + CRM + affiliates", source: "Meta API, Google Ads API, spend sheets" },
  blended_roas: { label: "Blended ROAS", field: "roas", format: "ratio", dir: "higher", home: "marketing", base: "orders",
    def: "Shopify Total sales ÷ Performance spend. One store-level return on every performance rupee; awareness and Reach spend are never in it.",
    formula: "Total sales ÷ Performance spend", source: "Shopify, spend sources" },
  meta_platform_roas: { label: "Meta Platform ROAS", field: "meta_sales_roas", format: "ratio", dir: "higher", home: "marketing", base: "spend", baseField: "meta_perf_spend", scoped: true,
    def: "Purchase value Meta attributes to its sales campaigns ÷ their spend. Platforms over-attribute, so platform totals add up to more than Shopify's.",
    formula: "Meta purchase value ÷ Meta sales-campaign spend", source: "Meta API" },
  google_platform_roas: { label: "Google Platform ROAS", field: "google_sales_roas", format: "ratio", dir: "higher", home: "marketing", base: "spend", baseField: "google_perf_spend", scoped: true,
    def: "Conversion value Google Ads attributes to its sales campaigns ÷ their spend. Brand Search, Brand PMax and Non-brand PMax are split in the tree below.",
    formula: "Google conversion value ÷ Google sales-campaign spend", source: "Google Ads API" },
  cps: { label: "CPS", field: "cps", format: "currency2", dir: "lower", home: "marketing", base: "spend", baseField: "perf_all_spend",
    def: "Cost per session: Performance spend ÷ all store sessions.", formula: "Performance spend ÷ Sessions", source: "Spend sources, Shopify" },
  cpp: { label: "Cost per purchase", format: "currency", dir: "lower", home: "marketing", base: "spend", scoped: true,
    def: "Ad spend ÷ the purchases the platforms report (Meta purchases + Google conversions), on the campaigns in view.",
    formula: "Meta + Google spend ÷ platform purchases", source: "Meta API, Google Ads API" },
  meta_spend: { label: "Meta spend", field: "meta_spend", format: "currency", dir: "neutral", home: "marketing", base: "spend", scoped: true,
    def: "Meta spend on the campaigns in view (sales campaigns in Performance).", formula: "Meta API", source: "Meta API" },
  google_spend: { label: "Google spend", field: "google_spend", format: "currency", dir: "neutral", home: "marketing", base: "spend", scoped: true,
    def: "Google Ads spend on the campaigns in view (sales campaigns in Performance).", formula: "Google Ads API", source: "Google Ads API" },
  channel_spend: { label: "Spend", format: "currency", dir: "neutral", home: "marketing", base: "spend", scoped: true,
    def: "What the channel cost on the campaigns in view: Meta and Google from their APIs, affiliate, CRM and Reddit from the spend sheets (estimated for days the sheets have not reached yet).",
    formula: "Spend per channel", source: "Meta API, Google Ads API, spend sheets" },
  lc_sessions: { label: "Sessions", format: "count", dir: "neutral", home: "marketing", base: "orders",
    def: "Shopify sessions credited to the channel by the visit's UTM.", formula: "Shopify sessions by UTM", source: "Shopify" },
  lc_orders: { label: "Orders (last click)", format: "count", dir: "higher", home: "marketing", base: "orders",
    def: "Valid orders placed (not cancelled), credited to the channel by the UTM GoKwik recorded for the visit that converted. Orders with no GoKwik record are \"Not in GoKwik\".",
    formula: "Orders placed by last-click UTM", source: "Shopify orders, GoKwik" },
  lc_sales: { label: "Sales (last click)", format: "currency", dir: "higher", home: "marketing", base: "orders",
    def: "Order value of those orders as placed. Channel rows plus cancellations, returns and edits add up to Shopify's Total sales, the headline.",
    formula: "Σ order total of orders placed, by last-click UTM", source: "Shopify orders, GoKwik" },
  platform_revenue: { label: "Platform revenue", format: "currency", dir: "higher", home: "marketing", base: "spend",
    def: "Revenue the platform credits to itself (Meta purchase value, Google conversion value, the CRM and affiliate sheets). Platforms over-attribute: their totals add up to more than Shopify's.",
    formula: "Reported by each platform", source: "Meta API, Google Ads API, sheets" },
  platform_roas: { label: "Platform ROAS", format: "ratio", dir: "higher", home: "marketing", base: "spend",
    def: "Platform revenue ÷ spend, on sales campaigns. What the platform claims, not Shopify.", formula: "Platform revenue ÷ Spend", source: "Platforms" },
  platform_purchases: { label: "Platform purchases", format: "count", dir: "higher", home: "marketing", base: "spend",
    def: "Purchases the platform credits to itself.", formula: "Reported by each platform", source: "Meta API, Google Ads API" },
  // ---------------------------------------------------------------- funnel
  sessions: { label: "Sessions", field: "sessions", format: "count", dir: "neutral", home: "funnel", base: "orders",
    def: "All Shopify store sessions.", formula: "Shopify sessions", source: "Shopify" },
  perf_sessions: { label: "Perf sessions", field: "perf_sessions", format: "count", dir: "neutral", home: "funnel", base: "orders",
    def: "Sessions from the team's performance sources: a paid, affiliate or CRM source with a UTM campaign, not awareness.", formula: "Shopify sessions by UTM, the team's rule", source: "Shopify" },
  atc: { label: "ATC", field: "atc", format: "count", dir: "higher", home: "funnel", base: "orders",
    def: "Sessions with an add to cart.", formula: "Shopify sessions with cart additions", source: "Shopify" },
  ic: { label: "Checkout started", short: "IC", field: "ic", format: "count", dir: "higher", home: "funnel", base: "orders",
    def: "Checkouts started (initiated checkout), from GoKwik.", formula: "GoKwik checkout started", source: "GoKwik" },
  atc_rate: { label: "Sessions → ATC", field: "atc_rate", format: "percent", dir: "higher", home: "funnel", base: "orders",
    def: "Share of sessions that added to cart.", formula: "ATC ÷ Sessions", source: "Shopify" },
  atc_to_ic: { label: "ATC → IC", field: "atc_to_ic", format: "percent", dir: "higher", home: "funnel", base: "orders",
    def: "Share of add-to-cart sessions that started checkout.", formula: "Checkout started ÷ ATC", source: "Shopify, GoKwik" },
  ic_to_order: { label: "IC → Order", field: "ic_to_order", format: "percent", dir: "higher", home: "funnel", base: "orders",
    def: "Orders per checkout started.", formula: "Orders ÷ Checkout started", source: "Shopify, GoKwik" },
  cvr: { label: "CVR", field: "cvr", format: "percent", dir: "higher", home: "funnel", base: "orders",
    def: "Conversion rate: Orders ÷ all Sessions.", formula: "Orders ÷ Sessions", source: "Shopify" },
  perf_cvr: { label: "Perf CVR", field: "perf_cvr", format: "percent", dir: "higher", home: "funnel", base: "orders",
    def: "Orders ÷ Perf sessions.", formula: "Orders ÷ Perf sessions", source: "Shopify" },
  // ---------------------------------------------------------------- products
  units: { label: "Units", format: "count", dir: "higher", home: "products", base: "orders",
    def: "Units bought, with freebies, merch, books and gummies left out. Valid orders only: not test, not cancelled, not ASAYASS or ASAYAINF.",
    formula: "Σ quantity of kept lines", source: "Shopify orders (BigQuery)" },
  product_revenue: { label: "Product revenue", format: "currency", dir: "higher", home: "products", base: "orders",
    def: "Item sales of the orders placed (line total sales of kept lines). Unlike Total sales it does not take off cancellations or returns, so it does not equal the headline.",
    formula: "Σ line total sales of kept lines", source: "Shopify orders (BigQuery)" },
  items_per_order: { label: "Items per order", format: "decimal", dir: "higher", home: "products", base: "orders",
    def: "Kept items ÷ valid orders: freebies, merch, books and gummies are not items; tests, cancelled orders, ASAYASS and ASAYAINF are not orders.",
    formula: "Kept units ÷ valid orders", source: "Shopify orders (BigQuery)" },
  multi_item_share: { label: "Multi-item orders", format: "percent", dir: "higher", home: "products", base: "orders",
    def: "Share of valid orders with two or more kept items.", formula: "Orders with 2+ items ÷ valid orders", source: "Shopify orders (BigQuery)" },
  landed_discount: { label: "Landed discount", format: "percent", dir: "lower", home: "products", base: "orders",
    def: "How far below MRP the units sold: 1 − revenue ÷ MRP value, on units with a Shopify compare-at price. Today's MRP is used for past dates.",
    formula: "1 − revenue ÷ (MRP × units)", source: "Shopify orders, Shopify catalog" },
  // ---------------------------------------------------------------- retention
  new_share: { label: "New-customer share", field: "new_share", format: "percent", dir: "higher", home: "retention", base: "orders",
    def: "Share of orders that were a customer's first valid order (orders with a customer ID).", formula: "New ÷ (new + repeat) orders", source: "Shopify orders (BigQuery)" },
  new_orders: { label: "New-customer orders", short: "New orders", field: "new_orders", format: "count", dir: "higher", home: "retention", base: "orders",
    def: "Orders that were a customer's first valid order.", formula: "Rank 1 of a customer's valid orders", source: "Shopify orders (BigQuery)" },
  repeat_orders: { label: "Repeat orders", field: "repeat_orders", format: "count", dir: "higher", home: "retention", base: "orders",
    def: "Orders by customers who had ordered before.", formula: "Rank 2+ of a customer's valid orders", source: "Shopify orders (BigQuery)" },
  // ---------------------------------------------------------------- Meta view (platform data)
  /* mv: how the Meta view works the metric out from summed bases at any
     level: num, or num ÷ den (× mul). Ratios are never averaged. */
  m_spend: { label: "Spend", format: "currency", dir: "neutral", home: "marketing", base: "spend", mv: { num: "spend" }, def: "Meta spend on the ads in view.", formula: "Σ spend", source: "Meta API" },
  m_impr: { label: "Impressions", format: "count", dir: "neutral", home: "marketing", base: "spend", mv: { num: "impr" }, def: "Times the ads were shown.", formula: "Σ impressions", source: "Meta API" },
  m_reach: { label: "Reach", format: "count", dir: "neutral", home: "marketing", base: "spend", def: "Unique people reached in the period. It cannot be added up from days or rows, so it is asked of Meta for each period and selection; across both accounts it is an upper bound.", formula: "Meta unique reach", source: "Meta API" },
  m_freq: { label: "Frequency", format: "decimal", dir: "neutral", home: "marketing", base: "spend", def: "Impressions per person reached. Above 3 on performance ads is a creative-fatigue risk.", formula: "Impressions ÷ Reach", source: "Meta API" },
  m_cpm: { label: "CPM", format: "currency", dir: "lower", home: "marketing", base: "spend", mv: { num: "spend", den: "impr", mul: 1000 }, def: "Cost per 1,000 impressions.", formula: "Spend ÷ Impressions × 1,000", source: "Meta API" },
  m_link: { label: "Link clicks", format: "count", dir: "higher", home: "marketing", base: "spend", mv: { num: "link" }, def: "Clicks on the ad's link (not all clicks).", formula: "Σ link clicks", source: "Meta API" },
  m_ctr: { label: "CTR (link)", format: "percent", dir: "higher", home: "marketing", base: "spend", mv: { num: "link", den: "impr" }, def: "Link clicks per impression.", formula: "Link clicks ÷ Impressions", source: "Meta API" },
  m_cpc: { label: "CPC (link)", format: "currency2", dir: "lower", home: "marketing", base: "spend", mv: { num: "spend", den: "link" }, def: "Cost per link click.", formula: "Spend ÷ Link clicks", source: "Meta API" },
  m_lpv: { label: "Landing page views", short: "LPV", format: "count", dir: "higher", home: "marketing", base: "spend", mv: { num: "lpv" }, def: "Clicks that loaded the landing page.", formula: "Σ landing page views", source: "Meta API" },
  m_lpv_rate: { label: "LPV rate", format: "percent", dir: "higher", home: "marketing", base: "spend", mv: { num: "lpv", den: "link" }, def: "Landing page views per link click: a drop means people click but the page does not load (slow page, bounce before load).", formula: "LPV ÷ Link clicks", source: "Meta API" },
  m_cplpv: { label: "Cost per LPV", format: "currency2", dir: "lower", home: "marketing", base: "spend", mv: { num: "spend", den: "lpv" }, def: "Spend per landing page view (the sheet's CPLV).", formula: "Spend ÷ LPV", source: "Meta API" },
  m_atc: { label: "Add to carts", short: "ATC", format: "count", dir: "higher", home: "marketing", base: "spend", mv: { num: "atc" }, def: "Add-to-cart events Meta attributes to the ads (one action type, so never double counted). Attributed with view-through, so it can exceed LPV.", formula: "Σ add to cart", source: "Meta API" },
  m_atc_rate: { label: "ATC rate", format: "percent", dir: "higher", home: "marketing", base: "spend", mv: { num: "atc", den: "lpv" }, def: "Add to carts per landing page view.", formula: "ATC ÷ LPV", source: "Meta API" },
  m_cpatc: { label: "Cost per ATC", format: "currency2", dir: "lower", home: "marketing", base: "spend", mv: { num: "spend", den: "atc" }, def: "Spend per add to cart.", formula: "Spend ÷ ATC", source: "Meta API" },
  m_purch: { label: "Purchases", format: "count", dir: "higher", home: "marketing", base: "spend", mv: { num: "purch" }, def: "Purchases Meta attributes to the ads (platform data, each ad set's own attribution).", formula: "Σ purchases", source: "Meta API" },
  m_purch_rate: { label: "Purchase rate", format: "percent", dir: "higher", home: "marketing", base: "spend", mv: { num: "purch", den: "link" }, def: "Purchases per link click (the sheet's Conv%).", formula: "Purchases ÷ Link clicks", source: "Meta API" },
  m_purch_from_atc: { label: "Purchase rate from ATC", format: "percent", dir: "higher", home: "marketing", base: "spend", mv: { num: "purch", den: "atc" }, def: "Purchases per add to cart.", formula: "Purchases ÷ ATC", source: "Meta API" },
  m_cpp: { label: "Cost per purchase", format: "currency", dir: "lower", home: "marketing", base: "spend", mv: { num: "spend", den: "purch" }, def: "Spend per purchase Meta reports. Not acquisition cost: Meta's purchases include repeat buyers.", formula: "Spend ÷ Purchases", source: "Meta API" },
  m_rev: { label: "Platform revenue", format: "currency", dir: "higher", home: "marketing", base: "spend", mv: { num: "rev" }, def: "Purchase value Meta credits to the ads. Platforms over-attribute: this adds up to more than Shopify.", formula: "Σ purchase value", source: "Meta API" },
  m_roas: { label: "Platform ROAS", format: "ratio", dir: "higher", home: "marketing", base: "spend", mv: { num: "rev", den: "spend" }, def: "Platform revenue ÷ spend: what Meta claims, not Shopify.", formula: "Platform revenue ÷ Spend", source: "Meta API" },
  m_aov: { label: "AOV (platform)", format: "currency", dir: "higher", home: "marketing", base: "spend", mv: { num: "rev", den: "purch" }, def: "Platform revenue per platform purchase.", formula: "Platform revenue ÷ Purchases", source: "Meta API" },
  m_v3s: { label: "3-second plays", format: "count", dir: "higher", home: "marketing", base: "spend", mv: { num: "v3s" }, def: "Video plays of at least 3 seconds.", formula: "Σ 3-second plays", source: "Meta API" },
  m_hook: { label: "Hook rate", format: "percent", dir: "higher", home: "marketing", base: "spend", mv: { num: "v3s", den: "impr" }, def: "3-second plays per impression: how often the opening stops the scroll (video ads).", formula: "3-second plays ÷ Impressions", source: "Meta API" },
};

// What the colours and the "base too small" rule use (config.json "display" overrides these).
const METRIC_RULES = { flat_below: 0.02, min_orders: 20, min_spend: 5000 };

const mDef = (id) => METRICS[id] || { label: id, format: "count", dir: "neutral" };

// ------------------------------------------------------------ one formatter
const M_INT = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
function mCompactInr(v) {
  const a = Math.abs(v), s = v < 0 ? "−" : "";
  const sig = (x) => (x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(2));
  if (a >= 1e7) return `${s}₹${sig(a / 1e7)}Cr`;
  if (a >= 1e5) return `${s}₹${sig(a / 1e5)}L`;
  if (a >= 1e3) return `${s}₹${sig(a / 1e3)}K`;
  return `${s}₹${M_INT.format(a)}`;
}
/* The one number formatter. compact: cards (₹12.3L); tables use full (₹12,34,567). */
function mFormat(format, v, compact) {
  if (v === null || v === undefined || Number.isNaN(v) || !Number.isFinite(v)) return null;
  switch (format) {
    case "currency": return compact ? mCompactInr(v) : (v < 0 ? "−₹" : "₹") + M_INT.format(Math.abs(v));
    case "currency2": return (v < 0 ? "−₹" : "₹") + Math.abs(v).toFixed(2);
    case "count": return M_INT.format(v);
    case "decimal": return v.toFixed(2);
    case "percent": return (v * 100).toFixed(Math.abs(v) < 0.01 && v !== 0 ? 2 : 1) + "%"; // 0.46%, not 0.5%
    case "ratio": return v.toFixed(2) + "x";
    case "pp": return (v >= 0 ? "+" : "−") + Math.abs(v * 100).toFixed(1) + " pp";
    default: return String(v);
  }
}
const mVal = (id, v, compact) => mFormat(mDef(id).format, v, compact);

// ------------------------------------------------------------ deltas
/* A change, coloured by the metric's direction. Grey when it barely moved or
   the metric is neutral; "n/m" (not meaningful) when the comparison base is
   too small, so "+468%" on three orders never shows. */
function mDeltaHtml(id, change, opts = {}) {
  if (opts.small) return '<span class="flat nm" title="Base too small to compare: under ' + (mDef(id).base === "spend" ? "₹" + M_INT.format(METRIC_RULES.min_spend) + " spend" : METRIC_RULES.min_orders + " orders") + ' in the comparison">n/m</span>';
  if (change === null || change === undefined || !Number.isFinite(change)) return '<span class="flat">–</span>';
  const d = Math.abs(change) < 0.0005 ? 0 : change;
  const dir = opts.dir || mDef(id).dir;
  const arrow = d > 0 ? "▲" : d < 0 ? "▼" : "";
  const txt = (d > 0 ? "+" : d < 0 ? "−" : "") + Math.abs(d * 100).toFixed(1) + "%";
  let cls = "flat";
  if (dir !== "neutral" && Math.abs(d) >= METRIC_RULES.flat_below) {
    const good = dir === "higher" ? d > 0 : d < 0;
    cls = good ? "up" : "down";
  }
  return `<span class="${cls}">${arrow} ${txt}</span>`;
}
/* A share or rate moved in percentage points (Δ mix, share of orders). */
function mPpHtml(diff, dir = "neutral") {
  if (diff === null || diff === undefined || !Number.isFinite(diff)) return '<span class="flat">–</span>';
  const d = Math.abs(diff) < 0.00005 ? 0 : diff;
  const cls = dir === "neutral" || d === 0 ? "flat" : (dir === "higher" ? d > 0 : d < 0) ? "up" : "down";
  return `<span class="${cls}">${mFormat("pp", d)}</span>`;
}
/* Is the comparison base too small for a change to mean anything? */
function mSmall(id, pw) {
  if (!pw) return false;
  const m = mDef(id);
  if (m.base === "orders") return pw.orders != null && pw.orders < METRIC_RULES.min_orders;
  if (m.base === "spend") { const v = pw[m.baseField || m.field]; return v != null && v < METRIC_RULES.min_spend; }
  return false;
}

// ------------------------------------------------------------ tooltips and cards
const mEsc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
/* The (i) next to a label: the registry's definition on hover or focus. */
function mTip(id, extra) {
  const m = mDef(id);
  const text = [m.def, m.formula ? `Formula: ${m.formula}.` : "", extra || ""].filter(Boolean).join(" ");
  return text ? `<span class="tip" tabindex="0" role="note" aria-label="${mEsc(text)}" data-tip="${mEsc(text)}">i</span>` : "";
}
/* A column header with the metric's name and its (i). */
const mHead = (id, label) => `${mEsc(label || mDef(id).label)} ${mTip(id)}`;
const M_SCOPE = { perf: "Performance", aw: "Awareness", all: "All campaigns" };
/* The KPI card: label (i) · value · change · "vs" the comparison · per day.
   Fixed height; the label never wraps. href: the tab that owns the metric. */
function kpiCard(id, o = {}) {
  const m = mDef(id), label = o.label || m.label;
  const scope = (o.est ? `<span class="chip pending" title="${mEsc(o.est)}">est.</span>` : "")
    + (o.scope ? `<span class="kpi-tag" title="Changes with the campaign view">${mEsc(M_SCOPE[o.scope] || o.scope)}</span>` : "");
  const head = `<div class="kpi-l"><span class="kpi-n">${mEsc(label)}</span>${mTip(id, o.tipExtra)}</div>`;
  let body;
  if (o.loading) body = '<div class="kpi-v na-v">…</div><div class="kpi-d"><span class="kpi-vs">asking Meta</span></div>';
  else if (o.value === null || o.value === undefined) {
    body = `<div class="kpi-v na-v" title="${mEsc(o.na || "not available")}">—</div><div class="kpi-d"><span class="na" title="${mEsc(o.na || "")}">Data unavailable${o.na ? ": " + mEsc(o.na) : ""}</span></div>`;
  } else if (!o.loading) {
    const vs = o.prev === undefined ? "" : o.prev === null ? '<span class="kpi-vs">no comparison</span>'
      : `${mDeltaHtml(id, o.change, { small: o.small })}<span class="kpi-vs">vs ${mEsc(mVal(id, o.prev, true) ?? "n/a")}${o.vsLabel ? " " + mEsc(o.vsLabel) : ""}</span>`;
    body = `<div class="kpi-v">${mEsc(mVal(id, o.value, true))}</div><div class="kpi-d">${vs}</div>${o.sub || scope ? `<div class="kpi-s">${o.sub ? mEsc(o.sub) : ""}${scope}</div>` : ""}`;
  }
  if (o.spark) body += `<div class="kpi-spark">${o.spark}</div>`;
  const tag = o.href ? "a" : "div";
  return `<${tag} class="kpi${o.hero ? " hero" : ""}" ${o.href ? `href="${o.href}" title="Open ${mEsc(o.hrefLabel || "its tab")}"` : ""} data-metric="${mEsc(id)}">${head}${body}</${tag}>`;
}

if (typeof module !== "undefined" && module.exports) module.exports = { METRICS, METRIC_RULES, mFormat, mDeltaHtml, mPpHtml, mSmall, kpiCard };
