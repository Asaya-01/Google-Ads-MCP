/* Marketing, Products and D-1 driven by the same date range and comparison as
   Overview and Daily. Inlined after range_ui.js, inside the dashboard closure. */

const MK = { phase: null };

// A tab with its own picker bar, its body filled once the day-by-day data is in.
function rgTab(name, pages, head, render) {
  RG.tab = name;
  $main.innerHTML = `${head}<div id="rg-body"><p class="empty">Loading…</p></div>`;
  (async () => {
    try { await rgEnsure(); for (const pg of pages) await loadPage(pg); }
    catch (err) { const m = document.getElementById("rg-body"); if (m) m.innerHTML = `<section class="card"><h2>Date ranges are unavailable</h2><p class="na">Data unavailable: ${esc(err.message)}</p></section>`; return; }
    if (state.tab !== name) return;
    rgUseMode(name === "marketing" ? RG.scope : "perf");
    setSub(rgBar());
    rgBind();
    render();
  })();
}
// which phase block the tab follows: the header's BAU / Sale switch decides
function rgPhasePick(c) { return [rgPick(c), ""]; }
function rgPhaseBind(id, again) {
  document.getElementById(id)?.addEventListener("click", (ev) => { const b = ev.target.closest("button[data-ph]"); if (b) { MK.phase = b.dataset.ph; again(); } });
}
const rgDaysOf = (g) => ({ cur: new Set(g.cur), prev: g.prev && g.prev.length ? new Set(g.prev) : null, cd: g.w.days, pd: g.pw ? g.pw.days : 0 });
const rgAvgChange = (c, cd, p, pd) => (c == null || p == null || p === 0 || !cd || !pd ? null : c / cd / (p / pd) - 1);

// ---------------------------------------------------------------- marketing
/* "Where is spend going and what is it returning?" The only tab with the
   campaign view (Performance / Awareness / All); every card it changes is
   tagged with the view. */
const rgKeep = (k, mode = RG.mode) => {
  const kind = typeof k === "string" ? k : k ? "awareness" : "perf";
  return mode === "all" || (mode === "aw" ? kind === "awareness" : kind === "perf");
};
function rgSpendCharts() {
  const e = RG.eng, days = e.rangeOf(RG.from, RG.to).filter((d) => e.phaseOf(d));
  if (!days.length) return;
  const w = days.map((d) => e.windowOf([d]));
  const labels = days.map((d) => dayLabel(d));
  const stack = (label, key, col) => ({ label, data: w.map((x) => x[key]), backgroundColor: col, ...barStyle, borderRadius: 0, borderWidth: { top: 1 }, borderColor: css("--surface"), stack: "s" });
  const sets = [stack("Meta", "meta_spend", css("--series-1")), stack("Google", "google_spend", css("--series-2"))];
  if (RG.mode !== "aw") sets.push(stack("Affiliate", "affiliate_spend", "#7a8f3a"), stack("CRM", "crm_spend", "#8a5cb8"), stack("Reddit", "reddit_spend", "#c2453b"));
  baseChart(document.getElementById("c-mk-spend"), { type: "bar", data: { labels, datasets: sets },
    options: { scales: { x: { stacked: true, grid: { display: false }, ticks: { color: css("--muted"), maxRotation: 0, autoSkipPadding: 12 } }, y: { ...axisOpts("inr"), stacked: true } } } }, "inr");
  const el = document.getElementById("c-mk-roas");
  if (!el) return;
  if (!w.some((x) => x.roas != null)) { el.parentElement.innerHTML = '<p class="na">Data unavailable: Blended ROAS needs every performance spend (Meta, Google, Reddit, CRM, affiliate) for the day.</p>'; return; }
  baseChart(el, { type: "line", data: { labels, datasets: [{ label: "Blended ROAS", data: w.map((x) => x.roas), borderColor: css("--accent"), backgroundColor: css("--accent"), borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, spanGaps: false, tension: 0.25 }] } }, "x");
}
// Cost per purchase from the platforms' own purchases, on the campaigns in view
function rgCpp(g) {
  const { roots } = trBuild(g);
  let s = 0, r = 0, ps = 0, pr = 0;
  for (const k of ["meta", "google"]) {
    const n = roots.get(k);
    if (!n) continue;
    const gap = n.kids.get("gap");
    s += n.a.spend - (gap ? gap.a.spend : 0); r += n.a.results; ps += n.p.spend; pr += n.p.results;
  }
  const v = r ? s / r : null, pv = g.pw && pr ? ps / pr : null;
  return { value: v, prev: g.pw ? pv : null, change: v != null && pv ? v / pv - 1 : null, small: ps < METRIC_RULES.min_spend };
}
R.marketing = (p) => {
  const metaNA = p.unavailable?.meta;
  const sheetNA = Object.entries(p.unavailable || {}).filter(([k]) => k.startsWith("sheet_")).map(([, v]) => v);
  const chk = p.classification_check || {}, m = chk.google_match || {};
  const checkBad = (chk.unclassified_google_ids || []).length > 0 || (m.match_rate != null && m.match_rate < 0.9);
  /* Three sub-tabs: Channels (every channel, one row each, Meta and Google
     included as one row each), Meta (meta_view.js) and Google (google_view.js). */
  const sub = new URLSearchParams(location.hash.split("?")[1] || "").get("sub") || "channels";
  const nav = `<nav class="subtabs" aria-label="Marketing views">${[["channels", "Channels", "#marketing"], ["meta", "Meta", "#marketing?sub=meta"], ["google", "Google", "#marketing?sub=google"]].map(([k, l, h]) => `<a href="${h}" ${sub === k ? 'aria-current="page"' : ""}>${l}</a>`).join("")}</nav>`;
  rgTab("marketing", sub === "meta" || sub === "google" ? [] : ["campaign_days", "meta_tree", "google_tree", "channel_days"], nav, () => {
    const host = document.getElementById("rg-body");
    if (sub === "meta") { mvRender(host); return; }
    if (sub === "google") { gvRender(host); return; }
    const e = RG.eng, c = e.compare(RG.from, RG.to, RG.cmp), g = rgPick(c);
    const late = [metaNA ? `Meta: ${metaNA}` : "", ...sheetNA].filter(Boolean);
    const filters = `<div class="tab-filters"><div class="filter-row">${rgScopeSeg("mk-scope")}${late.length ? `<span class="spill late" title="${esc(late.join("\n"))}"><i></i>Source late: ${esc(late.length === 1 && metaNA ? "Meta" : late.length + " inputs")}</span>` : ""}${checkBad ? `<a class="spill late" href="#health"><i></i>Google session check needs a look</a>` : ""}</div></div>`;
    if (!g) { host.innerHTML = filters + rgNone(); rgScopeBind("mk-scope"); return; }
    const sc = RG.mode, tag = { scope: sc };
    const cpp = rgCpp(g);
    const kpis = sc === "aw"
      ? [rgKpi("channel_spend", g, { label: "Awareness spend", value: g.w.spend, prev: g.pw ? g.pw.spend ?? null : null, change: g.pw ? g.change("spend") : null, perDay: true, ...tag }),
        rgKpi("meta_spend", g, tag), rgKpi("google_spend", g, tag), rgKpi("sessions", g, { label: "Sessions from awareness", ...tag })]
      : [rgKpi("perf_spend", g, { perDay: true }), rgKpi("blended_roas", g, {}), rgKpi("meta_platform_roas", g, tag), rgKpi("google_platform_roas", g, tag), rgKpi("cps", g, {}),
        kpiCard("cpp", { ...cpp, ...tag })];
    host.innerHTML = filters + `
      <section class="card" data-component="marketing-kpis"><div class="kpis${kpis.length === 6 ? " six" : ""}">${kpis.join("")}</div></section>
      ${rgSec("Channels: spend, platform claims and Shopify", "what each channel cost, what its platform claims, and what Shopify credits it with (last click); Meta and Google open in their own sub-tabs", trReconHtml(g, { maxHeight: "70vh" }), { comp: "channel-reconciliation" })}
      <div class="cols-2">
        ${rgSec("Spend per day", "by channel", `${legend([["--series-1", "Meta"], ["--series-2", "Google"], ...(sc === "aw" ? [] : [["--good", "Affiliate"], ["--accent", "CRM"], ["--bad", "Reddit"]])])}<div class="chart-box"><canvas id="c-mk-spend" aria-label="Spend per day by channel"></canvas></div>`, { comp: "spend-per-day-chart" })}
        ${sc === "aw" ? "" : rgSec("Blended ROAS per day", "Total sales ÷ Performance spend", '<div class="chart-box"><canvas id="c-mk-roas" aria-label="Blended ROAS per day"></canvas></div>', { comp: "roas-per-day-chart" })}
      </div>`;
    rgScopeBind("mk-scope");
    rgSpendCharts();
  });
};

// ---------------------------------------------------------------- the product map
/* Shopify product ID → house code, short name and the listing's variant name
   (config.json product_map). Every tab names products through this. */
let PM = null;
function pmIndex() {
  if (PM) return PM;
  PM = new Map();
  for (const x of state.config.product_map || []) for (const [id, v] of Object.entries(x.ids || {})) PM.set(String(id), { code: x.code, name: x.name, variant: v });
  return PM;
}
const pmProduct = (id) => pmIndex().get(String(id)) || null;
const pmLabel = (code, name) => `<span class="code">${esc(code)}</span> · ${esc(name)}`;

// ---------------------------------------------------------------- products
/* "What are we selling and how are baskets built?" Parent products by house
   code with their variants underneath; categories; the one basket table. */
function prAgg(pd, set) {
  const m = new Map();
  if (!set) return m;
  for (const [d, i, units, rev, mrpv, uwm, rwm] of pd.rows) {
    if (!set.has(d)) continue;
    const a = m.get(i) || m.set(i, { units: 0, rev: 0, mrpv: 0, uwm: 0, rwm: 0 }).get(i);
    a.units += units; a.rev += rev; a.mrpv += mrpv; a.uwm += uwm; a.rwm += rwm;
  }
  return m;
}
const prLanded = (a) => (a && a.mrpv ? 1 - a.rwm / a.mrpv : null);
const PR = { showZero: false };
function prKpis(pd, sl, g) {
  const { cur, prev, cd, pd: pdays } = rgDaysOf(g);
  const tot = (m) => [...m.values()].reduce((t, a) => ({ units: t.units + a.units, rev: t.rev + a.rev, mrpv: t.mrpv + a.mrpv, rwm: t.rwm + a.rwm }), { units: 0, rev: 0, mrpv: 0, rwm: 0 });
  const A = tot(prAgg(pd, cur)), B = prev ? tot(prAgg(pd, prev)) : null;
  const slabs = (set) => { const t = { orders: 0, units: 0, multi: 0 }; if (sl && set) for (const r of sl.rows) if (set.has(r[0])) { t.orders += r[2]; t.units += r[3]; if (r[1] >= 2) t.multi += r[2]; } return t; };
  const S = slabs(cur), SP = prev ? slabs(prev) : null;
  const small = SP ? SP.orders < METRIC_RULES.min_orders : false;
  const k = (id, v, pv, change) => kpiCard(id, { value: v, prev: prev ? (pv ?? null) : null, change, small });
  const avg = (a, b) => rgAvgChange(a, cd, b, pdays), rel = (a, b) => (a != null && b ? a / b - 1 : null);
  const ipo = S.orders ? S.units / S.orders : null, pipo = SP && SP.orders ? SP.units / SP.orders : null;
  const mis = S.orders ? S.multi / S.orders : null, pmis = SP && SP.orders ? SP.multi / SP.orders : null;
  const ld = A.mrpv ? 1 - A.rwm / A.mrpv : null, pld = B && B.mrpv ? 1 - B.rwm / B.mrpv : null;
  return [k("units", A.units, B && B.units, B ? avg(A.units, B.units) : null), k("product_revenue", A.rev, B && B.rev, B ? avg(A.rev, B.rev) : null),
    k("items_per_order", ipo, pipo, rel(ipo, pipo)), k("multi_item_share", mis, pmis, rel(mis, pmis)),
    kpiCard("landed_discount", { value: ld, prev: prev ? pld : null, change: rel(ld, pld), small, na: pd.mrp_available ? "no MRP for these units" : "Shopify product MRPs were not pulled" })].join("");
}
function prTables(pd, g) {
  const { cur, prev, cd, pd: pdays } = rgDaysOf(g);
  const has = !!prev;
  const vmap = (pd.variants || []);
  // product rows grouped by house code; unmapped products each their own row under "Unmapped"
  const groupOf = (i) => { const n = pd.names[i], pm = pmProduct(n.id); return pm ? { key: "c:" + pm.code, code: pm.code, name: pm.name, variant: pm.variant } : { key: "u:" + n.id, code: null, name: n.label, variant: "", unmapped: true }; };
  const C = prAgg(pd, cur), P = prAgg(pd, prev);
  const groups = new Map();
  const into = (m, which) => { for (const [i, a] of m) { const gi = groupOf(i), x = groups.get(gi.key) || groups.set(gi.key, { ...gi, a: { units: 0, rev: 0, mrpv: 0, uwm: 0, rwm: 0 }, b: { units: 0, rev: 0, mrpv: 0, uwm: 0, rwm: 0 }, idx: new Set() }).get(gi.key); x.idx.add(i); for (const f in a) x[which][f] += a[f]; } };
  into(C, "a"); into(P, "b");
  const totalRev = [...C.values()].reduce((t, a) => t + a.rev, 0);
  // variants: the listing's variant (pack, size) and the SKU's own (shade, scent)
  const vagg = (set) => { const m = new Map(); if (!set || !pd.vrows) return m; for (const [d, vi, u, r] of pd.vrows) { if (!set.has(d)) continue; const v = vmap[vi], gi = groupOf(v.p); const lab = [gi.variant, v.label].filter(Boolean).join(" · ") || "Main listing"; const k = gi.key + "|" + lab; const a = m.get(k) || m.set(k, { gk: gi.key, lab, units: 0, rev: 0 }).get(k); a.units += u; a.rev += r; } return m; };
  const VC = vagg(cur), VP = vagg(prev);
  const row = (x) => ({ ...x, units: x.a.units, rev: x.a.rev, share: totalRev ? x.a.rev / totalRev : null, mrpUnit: x.a.uwm ? x.a.mrpv / x.a.uwm : null, landed: prLanded(x.a),
    dUnits: has && x.b.units ? rgAvgChange(x.a.units, cd, x.b.units, pdays) : null, dRev: has && x.b.rev ? rgAvgChange(x.a.rev, cd, x.b.rev, pdays) : null });
  const all = [...groups.values()].map(row).sort((x, y) => y.rev - x.rev);
  const live = all.filter((r) => r.units > 0), gone = all.filter((r) => r.units <= 0);
  const mapped = live.filter((r) => !r.unmapped), unm = live.filter((r) => r.unmapped);
  const na = pd.mrp_available ? null : "Shopify product MRPs were not pulled";
  const cols = [
    { label: "Product", text: true, render: (r) => (r.code ? pmLabel(r.code, r.name) : `<span class="trunc" title="${esc(r.name)}">${esc(r.name)}</span>`) },
    { label: mHead("units"), render: (r) => esc(mFormat("count", r.units)) },
    ...(has ? [{ label: "Δ units", render: (r) => deltaHtml(r.dUnits, "units", r.b && r.b.units < METRIC_RULES.min_orders) }] : []),
    { label: mHead("product_revenue", "Revenue"), render: (r) => esc(mFormat("currency", r.rev)) },
    ...(has ? [{ label: "Δ revenue", render: (r) => deltaHtml(r.dRev, "revenue", r.b && r.b.units < METRIC_RULES.min_orders) }] : []),
    { label: "Share", render: (r) => esc(mFormat("percent", r.share) ?? "–") },
    { label: "MRP / unit", render: (r) => (r.child ? "" : cell(r.mrpUnit, "inr", na || "No MRP for this product")) },
    { label: mHead("landed_discount"), render: (r) => (r.child ? "" : cell(r.landed, "pct", na || "No MRP for this product")) },
  ];
  const tr = (r, cls, attrs = "") => `<tr class="${cls}" ${attrs}>${cols.map((c) => `<td class="${c.text ? "text" : ""}">${c.render(r)}</td>`).join("")}</tr>`;
  const body = [];
  let n = 0;
  for (const r of mapped) {
    const kids = [...VC.values()].filter((v) => v.gk === r.key).sort((x, y) => y.rev - x.rev);
    const id = "pv" + ++n;
    if (kids.length > 1) {
      body.push(tr(r, "grp", `data-grp="${id}" tabindex="0" role="button" aria-expanded="false"`));
      for (const v of kids) { const pv = VP.get(r.key + "|" + v.lab); body.push(tr({ child: true, name: v.lab, units: v.units, rev: v.rev, share: totalRev ? v.rev / totalRev : null, b: pv, dUnits: has && pv && pv.units ? rgAvgChange(v.units, cd, pv.units, pdays) : null, dRev: has && pv && pv.rev ? rgAvgChange(v.rev, cd, pv.rev, pdays) : null }, "child", `data-parent="${id}" hidden`)); }
    } else body.push(tr(r, ""));
  }
  if (unm.length) {
    const t = unm.reduce((s, r) => ({ units: s.units + r.units, rev: s.rev + r.rev }), { units: 0, rev: 0 });
    body.push(tr({ name: `Unmapped (${unm.length})`, units: t.units, rev: t.rev, share: totalRev ? t.rev / totalRev : null, child: true }, "grp", `data-grp="pu" tabindex="0" role="button" aria-expanded="false" title="Products not in config.json product_map: add them there"`));
    for (const r of unm) body.push(tr(r, "child", 'data-parent="pu" hidden'));
  }
  if (PR.showZero) for (const r of gone) body.push(tr(r, ""));
  const head = `<tr>${cols.map((c) => `<th class="${c.text ? "text" : ""}" scope="col">${c.label}</th>`).join("")}</tr>`;
  const prodTbl = `<div class="table-wrap" style="max-height:70vh"><table><thead>${head}</thead><tbody>${body.join("") || `<tr><td class="text na" colspan="${cols.length}">No product sales on these days.</td></tr>`}</tbody></table></div>`
    + (gone.length ? `<button type="button" class="more-link" id="pr-zero">${PR.showZero ? "Hide" : "Show"} ${gone.length} product${gone.length === 1 ? "" : "s"} with no sales on these days</button>` : "");
  // categories (Shopify product type)
  const cats = new Map();
  for (const [which, m] of [["a", C], ["b", P]]) for (const [i, a] of m) { const t = pd.names[i].type || "(blank type)"; const x = cats.get(t) || cats.set(t, { label: t, a: { units: 0, rev: 0, mrpv: 0, uwm: 0, rwm: 0 }, b: { units: 0, rev: 0, mrpv: 0, uwm: 0, rwm: 0 } }).get(t); for (const f in a) x[which][f] += a[f]; }
  const catRows = [...cats.values()].map(row).filter((r) => r.units > 0).sort((x, y) => y.rev - x.rev);
  const catCols = [{ label: "Category (product type)", text: true, render: (r) => esc(r.label) }, ...cols.slice(1).filter((c) => !/MRP/.test(c.label))];
  return [prodTbl, table(catCols, catRows, { full: true }), unm];
}
function prExcluded(pd, set) {
  const zero = () => ({ lines: 0, units: 0, revenue: 0 });
  const kept = zero(), drop = new Map();
  for (const [d, ti, dropped, lines, units, rev] of pd.type_rows) {
    if (!set.has(d)) continue;
    const b = dropped ? (drop.get(ti) || drop.set(ti, zero()).get(ti)) : kept;
    b.lines += lines; b.units += units; b.revenue += rev;
  }
  const rows = [{ label: "Kept", ...kept }, ...[...drop].map(([ti, v]) => ({ label: `Excluded: ${pd.types[ti] || "(blank)"}`, ...v }))];
  return table([{ label: "Product type", text: true, render: (r) => esc(r.label) }, { label: "Lines", render: (r) => esc(fmt(r.lines, "int")) }, { label: "Units", render: (r) => esc(fmt(r.units, "int")) }, { label: "Revenue", render: (r) => esc(fmt(r.revenue, "inr")) }], rows);
}
R.products = (p) => {
  const pt = p.product_types;
  const typeTable = (days) => {
    const pd = state.pages.product_days, set = new Set(days), by = new Map();
    for (const [d, ti, dropped, lines] of pd.type_rows) {
      if (!set.has(d)) continue;
      const t = pd.types[ti] || "";
      const a = by.get(t) || by.set(t, { lines: 0, dropped: 0 }).get(t);
      a.lines += lines; if (dropped) a.dropped += lines;
    }
    const rows = pt.rows.map((r) => ({ ...r, lines: (by.get(r.product_type) || {}).lines || 0, dropped: (by.get(r.product_type) || {}).dropped || 0 }));
    return table([{ label: "Type", text: true, render: (r) => `${esc(r.product_type)} ${r.excluded ? '<span class="chip">Excluded</span>' : ""}${r.needs_review ? '<span class="chip pending">Review</span>' : ""}` },
      { key: "catalog_products", label: "Products in catalog", unit: "int" }, { key: "lines", label: "Order lines", unit: "int" }, { key: "dropped", label: "Dropped", unit: "int" }], rows);
  };
  const mrpCard = (days) => {
    const pd = state.pages.product_days, set = new Set(days), per = new Map();
    let units = 0, withMrp = 0;
    for (const [d, i, u, , , uwm] of pd.rows) { if (!set.has(d)) continue; units += u; withMrp += uwm; if (u > uwm) per.set(i, (per.get(i) || 0) + (u - uwm)); }
    if (!pd.mrp_available) return '<p class="na">Data unavailable: Shopify product MRPs were not pulled.</p>';
    const missing = [...per.entries()].sort((x, y) => y[1] - x[1]).slice(0, 15).map(([i, n]) => ({ product: productName(i), units_without_mrp: n }));
    return `<p>Units with an MRP: <b>${esc(mFormat("percent", units ? withMrp / units : null) ?? "n/a")}</b> <span class="sub">(${inGroup.format(withMrp)} of ${inGroup.format(units)})</span></p>
      ${missing.length ? table([{ label: "Product", text: true, render: (r) => esc(r.product) }, { key: "units_without_mrp", label: "Units without MRP", unit: "int" }], missing) : ""}`;
  };
  rgTab("products", ["product_days", "slab_days"], "", () => {
    const draw = () => {
      const e = RG.eng, c = e.compare(RG.from, RG.to, RG.cmp), pd = state.pages.product_days, g = rgPick(c);
      const host = document.getElementById("rg-body");
      if (!g) { host.innerHTML = rgNone(); return; }
      const [prodTbl, catTbl] = prTables(pd, g);
      const days = RG.eng.rangeOf(RG.from, RG.to);
      host.innerHTML = `
        <section class="card" data-component="product-kpis"><div class="kpis">${prKpis(pd, state.pages.slab_days, g)}</div>${p.mrp_check && p.mrp_check.na ? `<p class="legend-note">Landed discount: data unavailable. ${esc(p.mrp_check.na)}.</p>` : ""}</section>
        ${rgSec("Products", "parent products by house code; open one for its variants (shade, scent, size, pack)", prodTbl, { comp: "products-table" })}
        ${rgSec("Basket size", "orders by number of items bought (freebies, merch, books and gummies are not items)", bkHtml(g), { comp: "basket-size" })}
        ${rgSec("Categories", "Shopify product type", catTbl, { comp: "categories" })}
        ${rgFold("Excluded product types", "freebies, merch, books, gummies and blank types: never counted as items", prExcluded(pd, new Set(c.all)), { comp: "excluded-types" })}
        ${rgFold("Product types and MRP coverage", "the catalog's types, and units sold with a Shopify compare-at price", `<div class="cols-2"><div>${typeTable(days)}<p class="legend-note">${esc(pt.review_note || "")}</p></div><div>${mrpCard(days)}</div></div>`)}`;
      document.getElementById("pr-zero")?.addEventListener("click", () => { PR.showZero = !PR.showZero; draw(); });
    };
    draw();
  });
};
