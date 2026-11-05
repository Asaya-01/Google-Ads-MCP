/* Marketing, Products and D-1 driven by the same date range and comparison as
   Overview and Daily. Inlined after range_ui.js, inside the dashboard closure. */

const MK = { phase: null };
const RG_MKT = [
  ["gmv", "GMV", "inr"], ["meta_spend", "Meta spend", "inr"], ["google_spend", "Google spend", "inr"],
  ["affiliate_spend", "Affiliate spend", "inr"], ["crm_spend", "CRM spend (flow + broadcast)", "inr"], ["reddit_spend", "Reddit spend", "inr"],
  ["all_spend", "Overall spend", "inr"], ["spend", "Meta + Google spend", "inr"],
  ["roas", "ROAS (GMV / performance spend)", "x"], ["cps", "CPS (spend / session)", "inr2"],
];
RG_NEUTRAL.add("meta_spend"); RG_NEUTRAL.add("google_spend");

// A tab with its own picker bar, its body filled once the day-by-day data is in.
function rgTab(name, pages, head, render) {
  RG.tab = name;
  $main.innerHTML = `${head}<div id="rg-slot"><p class="empty">Loading the date picker…</p></div><div id="rg-body"></div>`;
  (async () => {
    try { await rgEnsure(); for (const pg of pages) await loadPage(pg); }
    catch (err) { const m = document.getElementById("rg-body"); if (m) m.innerHTML = `<section class="card"><h2>Date ranges are unavailable</h2><p class="na">Data unavailable: ${esc(err.message)}</p></section>`; document.getElementById("rg-slot").innerHTML = ""; return; }
    if (state.tab !== name) return;
    document.getElementById("rg-slot").innerHTML = rgBar();
    rgBind();
    render();
  })();
}
function rgPhasePick(c, id) { // which phase block the tables below follow
  const have = c.groups.map((g) => g.phase);
  if (!have.includes(MK.phase)) MK.phase = have[0] || null;
  const g = c.groups.find((x) => x.phase === MK.phase);
  const ctl = c.groups.length > 1
    ? `<div class="seg" id="${id}" role="group" aria-label="Which days">${c.groups.map((x) => `<button type="button" data-ph="${x.phase}" aria-pressed="${x.phase === MK.phase}">${x.phase === "sale" ? "Sale days" : "BAU days"}</button>`).join("")}</div>` : "";
  return [g, ctl];
}
function rgPhaseBind(id, again) {
  document.getElementById(id)?.addEventListener("click", (ev) => { const b = ev.target.closest("button[data-ph]"); if (b) { MK.phase = b.dataset.ph; again(); } });
}
const rgDaysOf = (g) => ({ cur: new Set(g.cur), prev: g.prev && g.prev.length ? new Set(g.prev) : null, cd: g.w.days, pd: g.pw ? g.pw.days : 0 });
const rgAvgChange = (c, cd, p, pd) => (c == null || p == null || p === 0 || !cd || !pd ? null : c / cd / (p / pd) - 1);
const rgRatioChange = (c, p) => (c == null || p == null || p === 0 ? null : c / p - 1);

// ---------------------------------------------------------------- marketing
// Performance / Awareness / All: which campaigns a view keeps. A campaign is
// "perf", "awareness" or "social" (the Reach campaigns, kept out of both views).
const rgKeep = (k) => {
  const kind = typeof k === "string" ? k : k ? "awareness" : "perf";
  return RG.mode === "all" || (RG.mode === "aw" ? kind === "awareness" : kind === "perf");
};
function rgSpendCharts() {
  const e = RG.eng, days = e.rangeOf(RG.from, RG.to).filter((d) => e.phaseOf(d));
  if (!days.length) return;
  const w = days.map((d) => e.windowOf([d]));
  const labels = days.map((d) => dayLabel(d));
  baseChart(document.getElementById("c-rg-spend"), {
    type: "bar",
    data: { labels, datasets: [
      { label: "Meta", data: w.map((x) => x.meta_spend), backgroundColor: css("--series-1"), ...barStyle, borderRadius: 0, borderWidth: { top: 2 }, borderColor: css("--surface"), stack: "s" },
      { label: "Google", data: w.map((x) => x.google_spend), backgroundColor: css("--series-2"), ...barStyle, borderWidth: { top: 2 }, borderColor: css("--surface"), stack: "s" },
    ] },
    options: { scales: { x: { stacked: true, grid: { display: false }, ticks: { color: css("--muted"), maxRotation: 0, autoSkipPadding: 12 } }, y: { ...axisOpts("inr"), stacked: true } } },
  }, "inr");
  const mer = document.getElementById("c-rg-mer");
  if (!mer) return; // no ROAS for awareness
  if (!w.some((x) => x.roas != null)) { mer.parentElement.innerHTML = '<p class="na">Data unavailable: ROAS needs every performance spend (Meta, Google, Reddit, CRM, affiliate) for the day.</p>'; return; }
  baseChart(mer, { type: "line", data: { labels, datasets: [{ label: "ROAS", data: w.map((x) => x.roas), borderColor: css("--series-1"), backgroundColor: css("--series-1"), borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, spanGaps: false, tension: 0.25 }] } }, "x");
}
R.marketing = (p) => {
  const metaNA = p.unavailable?.meta;
  const chk = p.classification_check, m = chk.google_match;
  const sheetNA = Object.entries(p.unavailable || {}).filter(([k]) => k.startsWith("sheet_")).map(([, v]) => v);
  const head = (metaNA ? `<div class="banner">Meta Ads: data unavailable. ${esc(metaNA)}. Meta spend, total spend, MER and Perf ROAS stay blank until it is in place.</div>` : "")
    + (sheetNA.length ? `<div class="banner">Spend sheets: ${sheetNA.map(esc).join("; ")}. Overall spend and ROAS stay blank for the days affected.</div>` : "");
  const tail = `<details class="card rg-all"><summary>Data check: are Google sessions matched to campaigns? (always the last 7 days, ${dayLabel(m.start)}–${dayLabel(m.end)}; not the dates picked above)</summary>
      <div class="section-head"><h2>Session classification check</h2></div>
      <div class="tiles">
        <div class="tile"><div class="label">Google sessions with a campaign ID that matches GOOGLEADS_CONSOLIDATED</div><div class="value">${esc(fmt(m.match_rate, "pct") ?? "n/a")}</div><div class="foot">${inGroup.format(m.matched)} of ${inGroup.format(m.with_campaign_id)} sessions</div></div>
        <div class="tile"><div class="label">Google sessions with no campaign ID</div><div class="value">${esc(fmt(m.no_id_share, "pct") ?? "n/a")}</div><div class="foot">of ${inGroup.format(m.google_sessions)} Google sessions</div></div>
        <div class="tile"><div class="label">Google sessions on Awareness IDs</div><div class="value">${inGroup.format(m.awareness)}</div><div class="foot">${chk.google_awareness_ids} awareness IDs of ${chk.google_known_ids} known</div></div>
        <div class="tile"><div class="label">Unclassified Google IDs</div><div class="value">${chk.unclassified_google_ids.length}</div><div class="foot">${chk.unclassified_google_ids.length ? "Counted as Perf until they sync. Alerts fire for IDs seen yesterday." : "None in the history window"}</div></div>
      </div>
      ${chk.unclassified_google_ids.length ? table([{ label: "Campaign", text: true, render: (r) => `${r.name ? esc(r.name) : '<span class="na" title="Google Ads has no campaign with this ID in the World of Asaya account, so it is probably an old or removed campaign from another account">Name not found in Google Ads</span>'}<br><span class="sub">ID ${esc(r.campaign_id)}</span>` }, { key: "sessions", label: "Sessions", unit: "int" }, { label: "Last seen", render: (r) => esc(r.dates.at(-1)) }], chk.unclassified_google_ids) : ""}
    </details>
    <section class="card">${notes(p)}${(p.zero_spend_days || []).length ? `<ul class="notes">${p.zero_spend_days.map((z) => `<li>Google spend on ${esc(dayLabel(z.date))} is zero: ${esc(z.reason)}.</li>`).join("")}</ul>` : ""}</section>`;
  rgTab("marketing", ["campaign_days", "meta_tree", "google_tree", "channel_days"], head, () => {
    const draw = () => {
      const e = RG.eng, c = e.compare(RG.from, RG.to, RG.cmp);
      const host = document.getElementById("rg-body");
      if (!c.groups.length) { host.innerHTML = `<section class="card"><p class="na">Data unavailable: there are no days in the data for ${esc(rgSpan(RG.from, RG.to))}.</p></section>` + tail; return; }
      const [g, ctl] = rgPhasePick(c, "mk-phase");
      const vs = `${esc(rgVsText(g, "cur"))}${g.pw ? ` · compared with ${esc(rgVsText(g, "prev"))}` : ""}`;
      host.innerHTML = c.groups.map((x) => rgGroupHtml(x, c.groups.length > 1, RG_MKT, "Spend and return")).join("") + `
        <section class="card"><div class="section-head"><h2>Spend and return: channel › stage › product</h2>${ctl}<span class="sub">${vs}</span></div>
          ${trBarHtml("mk-tree")}<div id="mk-tree">${metaNA ? `<p class="na">Meta: data unavailable. ${esc(metaNA)}</p>` : ""}</div></section>
        ${RG.mode === "aw" ? "" : `<section class="card"><div class="section-head"><h2>Meta: product × stage</h2><span class="sub">${vs}</span></div><div id="mk-matrix"></div></section>`}
        <section class="card"><div class="section-head"><h2>Sales by channel</h2><span class="sub">Shopify, last click · ${vs}</span></div>${trChannelHtml(g)}</section>
        <div class="grid-2">
          <section class="card"><div class="section-head"><h2>Ad spend per day</h2>${legend([["--series-1", "Meta"], ["--series-2", "Google"]])}</div><div class="chart-box"><canvas id="c-rg-spend" aria-label="Meta and Google spend per day"></canvas></div></section>
          ${RG.mode === "aw" ? "" : `<section class="card"><div class="section-head"><h2>ROAS per day</h2><span class="sub">Shopify GMV / performance spend on every channel</span></div><div class="chart-box"><canvas id="c-rg-mer" aria-label="ROAS per day"></canvas></div></section>`}
        </div>` + tail;
      const mx = () => { const m = document.getElementById("mk-matrix"); if (m) m.innerHTML = trMatrixHtml() || '<p class="na">Switch the table above to “Stage › product” to see this.</p>'; };
      trBind("mk-tree", g, { after: mx });
      trMatrixBind("mk-matrix", "mk-tree");
      rgPhaseBind("mk-phase", draw);
      rgSpendCharts();
    };
    draw();
  });
};

// ---------------------------------------------------------------- products
function rgProdAgg(rows, set) {
  const m = new Map();
  if (!set) return m;
  for (const [d, i, units, rev, mrpv, uwm, rwm] of rows) {
    if (!set.has(d)) continue;
    const a = m.get(i) || { units: 0, rev: 0, mrpv: 0, uwm: 0, rwm: 0 };
    a.units += units; a.rev += rev; a.mrpv += mrpv; a.uwm += uwm; a.rwm += rwm;
    m.set(i, a);
  }
  return m;
}
const rgLanded = (a) => (a && a.mrpv ? 1 - a.rwm / a.mrpv : null);
function rgProductTables(pd, g) {
  const { cur, prev, cd, pd: prevDays } = rgDaysOf(g);
  const C = rgProdAgg(pd.rows, cur), P = rgProdAgg(pd.rows, prev);
  const totalRev = [...C.values()].reduce((s, a) => s + a.rev, 0);
  const build = (keyOf, labelOf, typeOf) => {
    const merge = (m) => {
      const out = new Map();
      for (const [i, a] of m) {
        const k = keyOf(i), x = out.get(k) || { units: 0, rev: 0, mrpv: 0, uwm: 0, rwm: 0 };
        x.units += a.units; x.rev += a.rev; x.mrpv += a.mrpv; x.uwm += a.uwm; x.rwm += a.rwm;
        out.set(k, x);
      }
      return out;
    };
    const c = merge(C), p = merge(P);
    return [...new Set([...c.keys(), ...p.keys()])].map((k) => {
      const a = c.get(k), b = p.get(k);
      return {
        key: k, label: labelOf(k), type: typeOf(k), units: a ? a.units : 0, rev: a ? a.rev : 0,
        share: a && totalRev ? a.rev / totalRev : null, mrpUnit: a && a.uwm ? a.mrpv / a.uwm : null,
        landed: rgLanded(a), landedPrev: rgLanded(b),
        dUnits: b && a ? rgAvgChange(a.units, cd, b.units, prevDays) : null, dRev: b && a ? rgAvgChange(a.rev, cd, b.rev, prevDays) : null,
      };
    }).filter((r) => r.units > 0).sort((x, y) => y.rev - x.rev);
  };
  const na = pd.mrp_available ? null : "Shopify product MRPs were not pulled";
  const prodCols = [
    { label: "Product", text: true, render: (r) => `${esc(r.label)}<br><span class="sub">${esc(r.type || "(blank type)")}</span>` },
    { label: "Units", render: (r) => esc(fmt(r.units, "int")) }, { label: "Δ units", render: (r) => (g.pw ? deltaHtml(r.dUnits, "units") : '<span class="flat">–</span>') },
    { label: "Revenue", render: (r) => esc(fmt(r.rev, "inr")) }, { label: "Δ revenue", render: (r) => (g.pw ? deltaHtml(r.dRev, "revenue") : '<span class="flat">–</span>') },
    { label: "MRP / unit", render: (r) => cell(r.mrpUnit, "inr", na || "No MRP for this product") },
    { label: "Landed discount", render: (r) => cell(r.landed, "pct", na || "No MRP for this product") },
  ];
  const prods = build((i) => i, (i) => pd.names[i].label, (i) => pd.names[i].type);
  const typeOf = (i) => pd.names[i].type || "";
  const cats = build(typeOf, (k) => k || "(blank type)", (k) => k);
  const catCols = [
    { label: "Category (product type)", text: true, render: (r) => esc(r.label) },
    { label: "Units", render: (r) => esc(fmt(r.units, "int")) }, { label: "Revenue", render: (r) => esc(fmt(r.rev, "inr")) },
    { label: "Share", render: (r) => esc(fmt(r.share, "pct") ?? "–") }, { label: "Δ revenue", render: (r) => (g.pw ? deltaHtml(r.dRev, "revenue") : '<span class="flat">–</span>') },
    { label: "Landed discount", render: (r) => cell(r.landed, "pct", na || "No MRP") },
  ];
  return [table(prodCols, prods, { maxHeight: "60vh" }), table(catCols, cats), prods.length];
}
function rgExcluded(pd, set) {
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
  // product types and MRP coverage for the picked dates, from the per-day product page
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
    for (const [d, i, u, , , uwm] of pd.rows) {
      if (!set.has(d)) continue;
      units += u; withMrp += uwm;
      if (u > uwm) per.set(i, (per.get(i) || 0) + (u - uwm));
    }
    if (!pd.mrp_available) return '<p class="na">Data unavailable: Shopify product MRPs were not pulled.</p>';
    const missing = [...per.entries()].sort((x, y) => y[1] - x[1]).slice(0, 15).map(([i, n]) => ({ product: pd.names[i].label, units_without_mrp: n }));
    return `<div class="tiles"><div class="tile"><div class="label">Units with MRP</div><div class="value">${esc(fmt(units ? withMrp / units : null, "pct") ?? "n/a")}</div><div class="foot">${inGroup.format(withMrp)} of ${inGroup.format(units)}</div></div></div>
      ${missing.length ? table([{ label: "Product", text: true, render: (r) => esc(r.product) }, { key: "units_without_mrp", label: "Units without MRP", unit: "int" }], missing) : ""}`;
  };
  const tailFor = (days) => `<div class="grid-2">
      <section class="card"><div class="section-head"><h2>Product types</h2><span class="sub">${esc(rgSpan(RG.from, RG.to))} · ${esc(pt.review_note)}</span></div>${typeTable(days)}</section>
      <section class="card"><div class="section-head"><h2>MRP coverage</h2><span class="sub">kept units with a Shopify compare-at price · ${esc(rgSpan(RG.from, RG.to))}</span></div>${mrpCard(days)}</section>
    </div>
    <section class="card">${notes(p)}</section>`;
  const tail = "";
  const head = p.mrp_check.na ? `<div class="banner">MRP: data unavailable. ${esc(p.mrp_check.na)}. Landed discount stays blank.</div>` : "";
  rgTab("products", ["product_days", "slab_days"], head, () => {
    const draw = () => {
      const e = RG.eng, c = e.compare(RG.from, RG.to, RG.cmp), pd = state.pages.product_days;
      const host = document.getElementById("rg-body");
      if (!c.groups.length) { host.innerHTML = `<section class="card"><p class="na">Data unavailable: there are no days in the data for ${esc(rgSpan(RG.from, RG.to))}.</p></section>` + tailFor(RG.eng.rangeOf(RG.from, RG.to)); return; }
      const [g, ctl] = rgPhasePick(c, "pr-phase");
      const [prodTbl, catTbl, n] = rgProductTables(pd, g);
      const all = new Set(c.all);
      host.innerHTML = `
        <section class="card"><div class="section-head"><h2>Products</h2>${ctl}<span class="sub">${n} products · ${esc(rgVsText(g, "cur"))}${g.pw ? ` · compared with ${esc(rgVsText(g, "prev"))}` : ""} · excluded product types left out · product revenue is item sales of the orders placed; the headline Total sales also counts cancellations and returns, as on D-1</span></div>
          ${g.note ? `<div class="banner">${esc(g.note)}</div>` : ""}${prodTbl}</section>
        <section class="card"><div class="section-head"><h2>Categories</h2></div>${catTbl}</section>
        <section class="card"><div class="section-head"><h2>Basket size</h2><span class="sub">orders by number of items · ${esc(rgVsText(g, "cur"))}${g.pw ? ` · compared with ${esc(rgVsText(g, "prev"))}` : ""}</span></div>${bkHtml(g)}</section>
        <section class="card"><div class="section-head"><h2>Excluded product types</h2><span class="sub">${esc(rgSpan(RG.from, RG.to))}, all days</span></div>${rgExcluded(pd, all)}</section>` + tailFor(RG.eng.rangeOf(RG.from, RG.to));
      rgPhaseBind("pr-phase", draw);
    };
    draw();
  });
};

// D-1 lives in range_d1.js
