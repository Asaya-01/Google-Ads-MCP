/* Marketing, Products and D-1 driven by the same date range and comparison as
   Overview and Daily. Inlined after range_ui.js, inside the dashboard closure. */

const MK = { phase: null };
const RG_MKT = [
  ["gmv", "GMV", "inr"], ["meta_spend", "Meta spend", "inr"], ["google_spend", "Google spend", "inr"],
  ["spend", "Total ad spend", "inr"], ["mer", "MER (GMV / ad spend)", "x"], ["perf_roas", "Shopify ROAS (Perf)", "x"],
  ["meta_sales_roas", "Meta ROAS", "x"], ["google_sales_roas", "Google Ads ROAS", "x"],
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
const rgTypeChip = (aware) => `<span class="phase ${aware ? "sale" : "bau"}">${aware ? "Awareness" : "Sales"}</span>`;

// ---------------------------------------------------------------- marketing
function rgCampaignTable(src, g, kind) {
  const { cur, prev, cd, pd } = rgDaysOf(g);
  const sum = (set) => {
    const m = new Map();
    if (!set) return m;
    for (const [d, i, spend, value, results, clicks] of src.rows) {
      if (!set.has(d)) continue;
      const a = m.get(i) || { spend: 0, value: 0, results: 0, clicks: 0 };
      a.spend += spend; a.value += value; a.results += results; a.clicks += clicks;
      m.set(i, a);
    }
    return m;
  };
  const C = sum(cur), P = sum(prev);
  const total = [...C.values()].reduce((s, a) => s + a.spend, 0);
  const rows = [...new Set([...C.keys(), ...P.keys()])].map((i) => {
    const n = src.names[i], c = C.get(i), p = P.get(i);
    const roas = (a) => (a && !n.awareness && a.spend > 0 ? a.value / a.spend : null);
    return {
      name: n.name, sub: kind === "meta" ? n.account : "ID " + n.id, awareness: n.awareness,
      spend: c ? c.spend : 0, share: c && total ? c.spend / total : null, value: c ? c.value : 0, results: c ? c.results : 0,
      roas: roas(c), prevRoas: roas(p), prevSpend: p ? p.spend : null,
      dSpend: p && c ? rgAvgChange(c.spend, cd, p.spend, pd) : null, dRoas: rgRatioChange(roas(c), roas(p)),
    };
  }).filter((r) => r.spend > 0).sort((a, b) => b.spend - a.spend);
  const label = kind === "meta" ? "Purchase value" : "Conv. value";
  const cols = [
    { label: "Campaign", text: true, render: (r) => `${esc(r.name)}<br><span class="sub">${esc(r.sub)}</span>` },
    { label: "Type", text: true, render: (r) => rgTypeChip(r.awareness) },
    { label: "Spend", render: (r) => `${esc(fmt(r.spend, "inr"))}<br><span class="sub">${r.share === null ? "" : (r.share * 100).toFixed(1) + "% of spend"}</span>` },
    { label: "Δ spend", render: (r) => (g.pw ? deltaHtml(r.dSpend, "spend") : '<span class="flat">–</span>') },
    { label: label, render: (r) => esc(fmt(r.value, "inr")) },
    { label: "Platform ROAS", render: (r) => (r.roas === null ? '<span class="na">–</span>' : esc(fmt(r.roas, "x")) + (r.prevRoas == null ? "" : `<br><span class="sub">vs ${esc(fmt(r.prevRoas, "x"))}</span>`)) },
    { label: "Δ ROAS", render: (r) => (g.pw && r.dRoas !== null ? deltaHtml(r.dRoas, "roas") : '<span class="flat">–</span>') },
  ];
  return rows.length ? table(cols, rows, { maxHeight: "60vh" }) : '<p class="na">No spend reported on these days.</p>';
}
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
  if (!w.some((x) => x.mer != null)) { mer.parentElement.innerHTML = '<p class="na">Data unavailable: MER needs both Meta and Google spend.</p>'; return; }
  baseChart(mer, { type: "line", data: { labels, datasets: [{ label: "MER", data: w.map((x) => x.mer), borderColor: css("--series-1"), backgroundColor: css("--series-1"), borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, spanGaps: false, tension: 0.25 }] } }, "x");
}
R.marketing = (p) => {
  const metaNA = p.unavailable?.meta;
  const chk = p.classification_check, m = chk.google_match;
  const head = metaNA ? `<div class="banner">Meta Ads: data unavailable. ${esc(metaNA)}. Meta spend, total spend, MER and Perf ROAS stay blank until it is in place.</div>` : "";
  const tail = `<section class="card">
      <div class="section-head"><h2>Session classification check</h2><span class="sub">${dayLabel(m.start)}–${dayLabel(m.end)} · the last 7 days</span></div>
      <div class="tiles">
        <div class="tile"><div class="label">Google sessions with a campaign ID that matches GOOGLEADS_CONSOLIDATED</div><div class="value">${esc(fmt(m.match_rate, "pct") ?? "n/a")}</div><div class="foot">${inGroup.format(m.matched)} of ${inGroup.format(m.with_campaign_id)} sessions</div></div>
        <div class="tile"><div class="label">Google sessions with no campaign ID</div><div class="value">${esc(fmt(m.no_id_share, "pct") ?? "n/a")}</div><div class="foot">of ${inGroup.format(m.google_sessions)} Google sessions</div></div>
        <div class="tile"><div class="label">Google sessions on Awareness IDs</div><div class="value">${inGroup.format(m.awareness)}</div><div class="foot">${chk.google_awareness_ids} awareness IDs of ${chk.google_known_ids} known</div></div>
        <div class="tile"><div class="label">Unclassified Google IDs</div><div class="value">${chk.unclassified_google_ids.length}</div><div class="foot">${chk.unclassified_google_ids.length ? "Counted as Perf until they sync. Alerts fire for IDs seen yesterday." : "None in the history window"}</div></div>
      </div>
      ${chk.unclassified_google_ids.length ? table([{ label: "Campaign", text: true, render: (r) => `${r.name ? esc(r.name) : '<span class="na" title="Google Ads has no campaign with this ID in the World of Asaya account, so it is probably an old or removed campaign from another account">Name not found in Google Ads</span>'}<br><span class="sub">ID ${esc(r.campaign_id)}</span>` }, { key: "sessions", label: "Sessions", unit: "int" }, { label: "Last seen", render: (r) => esc(r.dates.at(-1)) }], chk.unclassified_google_ids) : ""}
    </section>
    <section class="card">${notes(p)}${(p.zero_spend_days || []).length ? `<ul class="notes">${p.zero_spend_days.map((z) => `<li>Google spend on ${esc(dayLabel(z.date))} is zero: ${esc(z.reason)}.</li>`).join("")}</ul>` : ""}</section>`;
  rgTab("marketing", ["campaign_days"], head, () => {
    const draw = () => {
      const e = RG.eng, c = e.compare(RG.from, RG.to, RG.cmp), cd = state.pages.campaign_days;
      const host = document.getElementById("rg-body");
      if (!c.groups.length) { host.innerHTML = `<section class="card"><p class="na">Data unavailable: there are no days in the data for ${esc(rgSpan(RG.from, RG.to))}.</p></section>` + tail; return; }
      const [g, ctl] = rgPhasePick(c, "mk-phase");
      host.innerHTML = c.groups.map((x) => rgGroupHtml(x, c.groups.length > 1, RG_MKT, "Spend and return")).join("") + `
        <div class="grid-2">
          <section class="card"><div class="section-head"><h2>Ad spend per day</h2>${legend([["--series-1", "Meta"], ["--series-2", "Google"]])}</div><div class="chart-box"><canvas id="c-rg-spend" aria-label="Meta and Google spend per day"></canvas></div></section>
          <section class="card"><div class="section-head"><h2>MER per day</h2><span class="sub">GMV / (Meta + Google spend)</span></div><div class="chart-box"><canvas id="c-rg-mer" aria-label="MER per day"></canvas></div></section>
        </div>
        <section class="card"><div class="section-head"><h2>Meta campaigns</h2>${ctl}<span class="sub">${esc(rgVsText(g, "cur"))}${g.pw ? ` · compared with ${esc(rgVsText(g, "prev"))}` : ""}</span></div>
          ${metaNA ? `<p class="na">Data unavailable: ${esc(metaNA)}</p>` : rgCampaignTable(cd.meta, g, "meta")}</section>
        <section class="card"><div class="section-head"><h2>Google campaigns</h2><span class="sub">campaigns with spend</span></div>
          ${rgCampaignTable(cd.google, g, "google")}</section>` + tail;
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
  const pt = p.product_types, mc = p.mrp_check;
  const tail = `<div class="grid-2">
      <section class="card"><div class="section-head"><h2>Product types</h2><span class="sub">${esc(pt.review_note)}</span></div>
        ${table([{ label: "Type", text: true, render: (r) => `${esc(r.product_type)} ${r.excluded ? '<span class="chip">Excluded</span>' : ""}${r.needs_review ? '<span class="chip pending">Review</span>' : ""}` },
                 { key: "catalog_products", label: "Products in catalog", unit: "int" }, { key: "lines_mtd", label: "Order lines MTD", unit: "int" }, { key: "dropped_lines_mtd", label: "Dropped MTD", unit: "int" }], pt.rows)}</section>
      <section class="card"><div class="section-head"><h2>MRP coverage</h2><span class="sub">Kept units with a Shopify compare-at price, last 7 days</span></div>
        <div class="tiles"><div class="tile"><div class="label">Units with MRP</div><div class="value">${esc(fmt(mc.coverage, "pct") ?? "n/a")}</div><div class="foot">${inGroup.format(mc.units_with_mrp)} of ${inGroup.format(mc.units)}</div></div></div>
        ${mc.missing.length ? table([{ label: "Product", text: true, render: (r) => esc(r.product) }, { key: "units_without_mrp", label: "Units without MRP", unit: "int" }], mc.missing) : ""}</section>
    </div>
    <section class="card">${notes(p)}</section>`;
  const head = p.mrp_check.na ? `<div class="banner">MRP: data unavailable. ${esc(p.mrp_check.na)}. Landed discount stays blank.</div>` : "";
  rgTab("products", ["product_days"], head, () => {
    const draw = () => {
      const e = RG.eng, c = e.compare(RG.from, RG.to, RG.cmp), pd = state.pages.product_days;
      const host = document.getElementById("rg-body");
      if (!c.groups.length) { host.innerHTML = `<section class="card"><p class="na">Data unavailable: there are no days in the data for ${esc(rgSpan(RG.from, RG.to))}.</p></section>` + tail; return; }
      const [g, ctl] = rgPhasePick(c, "pr-phase");
      const [prodTbl, catTbl, n] = rgProductTables(pd, g);
      const all = new Set(c.all);
      host.innerHTML = `
        <section class="card"><div class="section-head"><h2>Products</h2>${ctl}<span class="sub">${n} products · ${esc(rgVsText(g, "cur"))}${g.pw ? ` · compared with ${esc(rgVsText(g, "prev"))}` : ""} · excluded product types left out</span></div>
          ${g.note ? `<div class="banner">${esc(g.note)}</div>` : ""}${prodTbl}</section>
        <section class="card"><div class="section-head"><h2>Categories</h2></div>${catTbl}</section>
        <section class="card"><div class="section-head"><h2>Excluded product types</h2><span class="sub">${esc(rgSpan(RG.from, RG.to))}, all days</span></div>${rgExcluded(pd, all)}</section>` + tail;
      rgPhaseBind("pr-phase", draw);
    };
    draw();
  });
};

// ---------------------------------------------------------------- D-1
R.d1 = (p) => {
  const F = [["sessions", "Sessions", "int"], ["perf_sessions", "Perf sessions", "int"], ["atc", "ATC", "int"], ["ic", "IC", "int"], ["orders", "Orders", "int"], ["gmv", "Revenue", "inr"], ["aov", "AOV", "inr"], ["atc_rate", "Sessions → ATC", "pct"], ["atc_to_ic", "ATC → IC", "pct"], ["cvr", "CVR", "pct"]];
  const e0 = () => RG.eng;
  const span = (s) => (s ? rgSpan(s[0], s[1]) : "no matching period");
  const dayRows = (list) => list.map((d) => { const w = e0().windowOf([d]); const na = { ...w.na }; for (const k of Object.keys(RG_DEP)) { const x = rgNa(w, k); if (x) na[k] = x; } return { ...w, date: d, phase: e0().phaseOf(d), note: e0().noteOf(d), na }; });
  const totalRow = (w, label) => { const na = { ...w.na }; for (const k of Object.keys(RG_DEP)) { const x = rgNa(w, k); if (x) na[k] = x; } return { ...w, _label: label, _class: "total", na }; };
  const funnel = (g) => {
    const head = `<tr><th class="text" scope="col">Day</th>${F.map(([, l]) => `<th scope="col">${esc(l)}</th>`).join("")}</tr>`;
    const rows = [];
    if (g.pw) {
      rows.push({ _group: `Comparison · ${g.phase === "sale" ? "sale days" : "BAU days"} · ${span(g.prevSpan)}` }, ...dayRows(g.prev), totalRow(g.pw, "Comparison total"));
    }
    rows.push({ _group: `Selected · ${g.phase === "sale" ? "sale days" : "BAU days"} · ${span(g.curSpan)}` }, ...dayRows(g.cur), totalRow(g.w, "Selected total"));
    if (g.pw) rows.push({ _label: "Δ vs comparison", _class: "delta", _delta: true });
    const body = rows.map((r) => {
      if (r._group) return `<tr class="group"><td colspan="${F.length + 1}">${esc(r._group)}</td></tr>`;
      const first = r._label ? esc(r._label) : `${esc(dayLabel(r.date))} ${phaseChip(r.phase, r.note)}`;
      return `<tr class="${r._class || ""}"><td class="text">${first}</td>${F.map(([k, , u]) => `<td>${r._delta ? deltaHtml(g.change(k), k) : cell(r[k], u, r.na?.[k])}</td>`).join("")}</tr>`;
    }).join("");
    return `<div class="table-wrap"><table><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
  };
  const DRILLS = [["channel", "Channel"], ["source", "Source"], ["campaign", "Campaign"], ["landing_page", "Landing page"], ["product", "Product"]];
  const drillCols = {
    product: [["units", "Units", "num"], ["revenue", "Revenue", "inr"]],
    landing_page: [["sessions", "Sessions", "num"], ["atc", "ATC", "num"], ["atc_rate", "Sessions → ATC", "pct"], ["ic", "IC (GoKwik)", "num"], ["converted", "Converted (GoKwik)", "num"]],
  };
  const defaultDrill = [["sessions", "Sessions", "num"], ["perf_sessions", "Perf sessions", "num"], ["atc", "ATC", "num"], ["atc_rate", "Sessions → ATC", "pct"], ["ic", "IC", "num"], ["orders", "Orders", "num"], ["gmv", "Revenue", "inr"]];
  const drillTable = () => {
    const fields = drillCols[state.drill] || defaultDrill;
    const rows = p.drilldowns[state.drill] || [];
    const cols = [{ label: DRILLS.find((d) => d[0] === state.drill)[1], text: true, render: (r) => `${esc(r.key)}${state.drill === "campaign" && r.kind === "awareness" ? ' <span class="phase sale">Awareness</span>' : ""}` },
      ...fields.map(([k, l, u]) => ({ label: l, render: (r) => `${esc(fmt(r.current[k], u, true) ?? "–")}<br><span class="sub">${esc(fmt(r.prior[k], u, true) ?? "–")} · ${deltaHtml(r.delta[k], k)}</span>` }))];
    return table(cols, rows, { maxHeight: "65vh" });
  };
  const c = p.commentary;
  const basisNote = p.basis === "per_day" ? "Windows differ in length: counts in the drill-downs are per-day averages." : "Equal windows: drill-downs compare totals.";
  const stdWin = `${p.prior.start ? `${dayLabel(p.prior.start)}–${dayLabel(p.prior.end)}` : "no prior window"} vs ${dayLabel(p.current.start)}–${dayLabel(p.current.end)}`;
  const tail = `
    <section class="card">
      <div class="section-head"><h2>What moved, and why</h2>${c?.model ? `<span class="sub">Written by Claude (${esc(c.model)}) for ${esc(stdWin)}</span>` : ""}</div>
      ${c?.text ? `<div class="commentary">${esc(c.text)}</div>` : `<p class="na">Data unavailable: ${esc(c?.na || "commentary has not been generated yet")}</p>`}
    </section>
    <section class="card">
      <div class="section-head"><h2>Drill-down</h2><span class="sub">For the standard D-1 windows (${esc(stdWin)}), not the dates picked above. Current, then prior · Δ. ${basisNote}</span></div>
      <div class="seg" role="group" aria-label="Drill-down dimension">${DRILLS.map(([k, l]) => `<button type="button" data-drill="${k}" aria-pressed="${k === state.drill}">${l}</button>`).join("")}</div>
      <div id="drill">${drillTable()}</div>
    </section>
    <section class="card">${notes(p)}</section>`;
  rgTab("d1", [], "", () => {
    const e = RG.eng, c2 = e.compare(RG.from, RG.to, RG.cmp);
    const host = document.getElementById("rg-body");
    const funnels = c2.groups.length
      ? c2.groups.map((g) => `<section class="card"><div class="section-head"><h2>Funnel ${phaseChip(g.phase)}</h2><span class="sub">${esc(rgVsText(g, "cur"))}${g.pw ? ` · compared with ${esc(rgVsText(g, "prev"))}` : ""}</span></div>${statusStrip()}${g.note ? `<div class="banner">${esc(g.note)}</div>` : ""}${funnel(g)}</section>`).join("")
      : `<section class="card"><p class="na">Data unavailable: there are no days in the data for ${esc(rgSpan(RG.from, RG.to))}.</p></section>`;
    host.innerHTML = funnels + tail;
    host.querySelectorAll("[data-drill]").forEach((b) => b.addEventListener("click", () => {
      state.drill = b.dataset.drill;
      host.querySelectorAll("[data-drill]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      document.getElementById("drill").innerHTML = drillTable();
    }));
  });
};
