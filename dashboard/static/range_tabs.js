/* Marketing, Products and D-1 driven by the same date range and comparison as
   Overview and Daily. Inlined after range_ui.js, inside the dashboard closure. */

const MK = { phase: null };
const RG_MKT = [
  ["gmv", "GMV", "inr"], ["meta_spend", "Meta spend", "inr"], ["google_spend", "Google spend", "inr"],
  ["affiliate_spend", "Affiliate spend", "inr"], ["crm_spend", "CRM spend (flow + broadcast)", "inr"],
  ["all_spend", "Overall spend", "inr"], ["spend", "Meta + Google spend", "inr"],
  ["overall_roas", "Overall ROAS (GMV / all spend)", "x"], ["mer", "MER (GMV / Meta + Google)", "x"], ["perf_roas", "Shopify ROAS (Perf)", "x"],
  ["meta_sales_roas", "Meta ROAS", "x"], ["google_sales_roas", "Google Ads ROAS", "x"],
  ["affiliate_roas", "Affiliate ROAS", "x"], ["crm_roas", "CRM ROAS", "x"],
];
const RG_CHANNELS = [
  ["Meta", "meta_spend", "meta_perf_value", "meta_sales_roas", "Meta-reported purchase value, sales campaigns"],
  ["Google Ads", "google_spend", "google_perf_value", "google_sales_roas", "Google-reported conversion value, sales campaigns"],
  ["Affiliate", "affiliate_spend", "affiliate_revenue", "affiliate_roas", "sales the affiliates are credited with"],
  ["CRM flow", "crm_flow_spend", "crm_flow_revenue", "crm_flow_roas", "revenue the flows are credited with"],
  ["CRM broadcast", "crm_broadcast_spend", "crm_broadcast_revenue", "crm_broadcast_roas", "revenue the broadcasts are credited with"],
];
// spend and return, channel by channel, for one block of days
function rgChannelTable(g) {
  const w = g.w, pw = g.pw;
  const channels = RG.mode === "aw" ? RG_CHANNELS.slice(0, 2) : RG_CHANNELS; // affiliate and CRM are not awareness channels
  const all = w.all_spend, nums = (k, who) => (who ? who[k] : null);
  const share = (v) => (v == null || all == null || all === 0 ? null : v / all);
  const rows = channels.map(([label, sk, rk, roas, what]) => {
    // a channel whose newest days are not in its sheet yet still gets its ROAS, over the days that are
    const part = w[roas] == null ? rgPartial(roas, g.cur) : null;
    const pprev = pw && pw[roas] == null ? rgPartial(roas, g.prev) : null;
    const rv = part ? part.v : w[roas], pv = pw ? (pw[roas] != null ? pw[roas] : pprev ? pprev.v : null) : null;
    return {
      label, what, spend: w[sk], share: share(w[sk]), rev: w[rk], roas: rv, prevRoas: pv,
      partial: part ? `${part.ok} of ${part.of} days` : null,
      dSpend: pw && w[sk] != null && pw[sk] != null ? rgAvgChange(w[sk], w.days, pw[sk], pw.days) : null,
      dRoas: pw && rv != null && pv ? rv / pv - 1 : null, na: w.na[sk] || w.na[rk] || null,
    };
  });
  const cell = (v, unit, na) => (v == null ? `<span class="cell-na" title="Data unavailable: ${esc(na || "not available")}">n/a</span>` : esc(fmt(v, unit)));
  const cols = [
    { label: "Channel", text: true, render: (r) => `${esc(r.label)}<br><span class="sub">${esc(r.what)}</span>` },
    { label: "Spend", render: (r) => cell(r.spend, "inr", r.na) },
    { label: "Δ spend", render: (r) => (pw ? deltaHtml(r.dSpend, "spend") : '<span class="flat">–</span>') },
    { label: "Share of all spend", render: (r) => (r.share == null ? '<span class="na">–</span>' : esc((r.share * 100).toFixed(1) + "%")) },
    { label: "Channel revenue", render: (r) => cell(r.rev, "inr", r.na) },
    { label: "Channel ROAS", render: (r) => cell(r.roas, "x", r.na) + (r.partial ? `<br><span class="sub">${esc(r.partial)}</span>` : "") + (r.prevRoas == null ? "" : `<br><span class="sub">vs ${esc(fmt(r.prevRoas, "x"))}</span>`) },
    { label: "Δ ROAS", render: (r) => (pw ? deltaHtml(r.dRoas, "roas") : '<span class="flat">–</span>') },
  ];
  const op = w.overall_roas == null ? rgPartial("overall_roas", g.cur) : null;
  const opp = pw && pw.overall_roas == null ? rgPartial("overall_roas", g.prev) : null;
  const orv = op ? op.v : w.overall_roas, opv = pw ? (pw.overall_roas != null ? pw.overall_roas : opp ? opp.v : null) : null;
  const total = { label: RG.mode === "aw" ? "Awareness total" : "All channels", what: RG.mode === "aw" ? "GMV credited to awareness over awareness spend" : "GMV from Shopify, all spend", spend: all, share: all == null ? null : 1, rev: w.gmv, roas: orv, prevRoas: opv, partial: op ? `${op.ok} of ${op.of} days` : null, dSpend: pw && all != null && pw.all_spend != null ? rgAvgChange(all, w.days, pw.all_spend, pw.days) : null, dRoas: pw && orv != null && opv ? orv / opv - 1 : null, na: w.na.all_spend || w.na.gmv, _class: "total" };
  return table(cols, [...rows, total]);
}
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
// ------------------------------------------------ campaign > ad set > ad, click to open
// Rows are [date, index, spend, value, results, clicks, impressions]. Campaigns always come from the
// campaign-by-day page (every day we have); what is under them comes from the ad-level page, which
// covers the most recent days only, and says so when the range reaches further back.
const RGX = { open: new Set(), g: null };
const rgZero = () => ({ spend: 0, value: 0, results: 0, clicks: 0, impr: 0 });
function rgSum(rows, set, key) {
  const m = new Map();
  if (!set) return m;
  for (const r of rows) {
    if (!set.has(r[0])) continue;
    const k = key ? key(r[1]) : r[1];
    const a = m.get(k) || rgZero();
    a.spend += r[2]; a.value += r[3]; a.results += r[4]; a.clicks += r[5]; a.impr += r[6] || 0;
    m.set(k, a);
  }
  return m;
}
function rgAddInto(m, k, a) {
  const x = m.get(k) || rgZero();
  x.spend += a.spend; x.value += a.value; x.results += a.results; x.clicks += a.clicks; x.impr += a.impr;
  m.set(k, x);
}
const rgKeep = (awareness) => RG.mode === "all" || (RG.mode === "aw" ? !!awareness : !awareness);
function rgDrillCols() {
  const spend = ["Spend", (n) => fmt(n.a.spend, "inr")];
  const dsp = ["Δ spend", null, "dspend"];
  const impr = ["Impr.", (n) => fmt(n.a.impr, "int")];
  const ctr = ["CTR", (n) => (n.a.impr ? fmt(n.a.clicks / n.a.impr, "pct") : null)];
  const cpm = ["CPM", (n) => (n.a.impr ? fmt((n.a.spend / n.a.impr) * 1000, "inr") : null)];
  const cpc = ["CPC", (n) => (n.a.clicks ? fmt(n.a.spend / n.a.clicks, "inr") : null)];
  const clicks = ["Clicks", (n) => fmt(n.a.clicks, "int")];
  const val = ["Value", (n) => fmt(n.a.value, "inr")];
  const roas = ["ROAS", (n) => (n.awareness || !n.a.spend ? null : fmt(n.a.value / n.a.spend, "x")), "roas"];
  const dr = ["Δ ROAS", null, "droas"];
  const res = ["Results", (n) => fmt(Math.round(n.a.results), "int")];
  if (RG.mode === "aw") return [spend, dsp, impr, cpm, clicks, ctr, cpc];
  if (RG.mode === "perf") return [spend, dsp, val, roas, dr, res, impr, ctr];
  return [spend, dsp, impr, ctr, val, roas, dr];
}
function rgDrillHtml(kind) {
  const g = RGX.g, cd = state.pages.campaign_days, tree = state.pages[kind === "meta" ? "meta_tree" : "google_tree"];
  const src = cd[kind], cur = new Set(g.cur), prev = g.prev && g.prev.length ? new Set(g.prev) : null, ndays = g.w.days, pdays = g.pw ? g.pw.days : 0;
  const C = rgSum(src.rows, cur), P = rgSum(src.rows, prev);
  const total = [...C.entries()].reduce((t, [i, a]) => t + (rgKeep(src.names[i].awareness) ? a.spend : 0), 0);
  // ---- what sits under a campaign
  const covered = tree && tree.from ? g.cur.filter((d) => d >= tree.from && d <= tree.to).length : 0;
  const coveredPrev = tree && tree.from && prev ? g.prev.filter((d) => d >= tree.from && d <= tree.to).length : 0;
  const kids = new Map(); // campaign index (campaign page) -> children
  const campKey = (n) => (kind === "meta" ? `${n.account}|${n.id}` : String(n.id));
  const toCamp = new Map(src.names.map((n, i) => [campKey(n), i]));
  const treeCampOf = (ti) => toCamp.get(kind === "meta" ? `${tree.campaigns[ti].account}|${tree.campaigns[ti].id}` : String(tree.campaigns[ti].id));
  if (tree && tree.from) {
    if (kind === "meta") {
      const adC = rgSum(tree.rows, cur), adP = rgSum(tree.rows, prev), setC = new Map(), setP = new Map();
      for (const [ai, a] of adC) rgAddInto(setC, tree.ads[ai].s, a);
      for (const [ai, a] of adP) rgAddInto(setP, tree.ads[ai].s, a);
      const adsOf = new Map();
      for (const ai of new Set([...adC.keys(), ...adP.keys()])) { const si = tree.ads[ai].s; (adsOf.get(si) || adsOf.set(si, []).get(si)).push(ai); }
      for (const si of new Set([...setC.keys(), ...setP.keys()])) {
        const ci = treeCampOf(tree.adsets[si].c);
        if (ci === undefined) continue;
        const node = {
          key: `s:${si}`, name: tree.adsets[si].name, level: 1, a: setC.get(si) || rgZero(), p: setP.get(si) || null, chip: "Ad set",
          kids: (adsOf.get(si) || []).map((ai) => ({ key: `a:${ai}`, name: tree.ads[ai].name, level: 2, a: adC.get(ai) || rgZero(), p: adP.get(ai) || null, chip: "Ad" })),
        };
        (kids.get(ci) || kids.set(ci, []).get(ci)).push(node);
      }
    } else {
      const gC = rgSum(tree.group_rows, cur), gP = rgSum(tree.group_rows, prev), aC = rgSum(tree.ad_rows, cur), aP = rgSum(tree.ad_rows, prev);
      const adsOf = new Map();
      for (const ai of new Set([...aC.keys(), ...aP.keys()])) { const gi = tree.ads[ai].g; (adsOf.get(gi) || adsOf.set(gi, []).get(gi)).push(ai); }
      for (const gi of new Set([...gC.keys(), ...gP.keys()])) {
        const grp = tree.groups[gi], ci = treeCampOf(grp.c);
        if (ci === undefined) continue;
        const node = {
          key: `g:${gi}`, name: grp.name, level: 1, a: gC.get(gi) || rgZero(), p: gP.get(gi) || null, chip: grp.kind === "asset_group" ? "Asset group" : "Ad group",
          note: grp.kind === "asset_group" ? "Performance Max reports spend per asset group, not per ad or asset, so there is nothing below this level." : null,
          kids: (adsOf.get(gi) || []).map((ai) => ({ key: `a:${ai}`, name: tree.ads[ai].name, level: 2, a: aC.get(ai) || rgZero(), p: aP.get(ai) || null, chip: tree.ads[ai].type || "Ad" })),
        };
        (kids.get(ci) || kids.set(ci, []).get(ci)).push(node);
      }
    }
  }
  // ---- the campaign rows, in this view only
  const camps = [...new Set([...C.keys(), ...P.keys()])]
    .filter((i) => rgKeep(src.names[i].awareness) && ((C.get(i) || {}).spend || 0) > 0)
    .sort((x, y) => C.get(y).spend - C.get(x).spend)
    .map((i) => ({ key: `c:${i}`, name: src.names[i].name, sub: kind === "meta" ? src.names[i].account : "ID " + src.names[i].id, awareness: src.names[i].awareness, level: 0, a: C.get(i), p: P.get(i) || null, chip: null, kids: (kids.get(i) || []).sort((x, y) => y.a.spend - x.a.spend) }));
  if (!camps.length) return `<p class="na">No ${RG.mode === "aw" ? "awareness" : RG.mode === "perf" ? "performance" : ""} campaign spend on these days.</p>`;
  const cols = rgDrillCols();
  const cell = (n, col, parentAwareness) => {
    const [, f, special] = col;
    const aw = n.awareness !== undefined ? n.awareness : parentAwareness;
    const node = { ...n, awareness: aw };
    if (special === "dspend") {
      return n.p && g.pw ? deltaHtml(n.a.spend && n.p.spend ? rgAvgChange(n.a.spend, ndays, n.p.spend, pdays) : null, "spend") : '<span class="flat">–</span>';
    }
    if (special === "droas") {
      if (aw || !g.pw || !n.p || !n.p.spend || !n.a.spend) return '<span class="flat">–</span>';
      return deltaHtml(n.a.value / n.a.spend / (n.p.value / n.p.spend) - 1, "roas");
    }
    const v = f(node);
    return v == null ? '<span class="na">–</span>' : esc(v) + (special === "roas" && n.p && !aw && n.p.spend ? `<br><span class="sub">vs ${esc(fmt(n.p.value / n.p.spend, "x"))}</span>` : "");
  };
  const rowsHtml = [];
  const emit = (n, awareness) => {
    const expandable = n.kids && n.kids.length > 0, open = RGX.open.has(n.key);
    const share = n.level === 0 && total ? `<br><span class="sub">${((n.a.spend / total) * 100).toFixed(1)}% of spend</span>` : "";
    const name = `<span class="tw" aria-hidden="true">${expandable || n.note ? (open ? "▾" : "▸") : "·"}</span>${n.chip ? `<span class="chip">${esc(n.chip)}</span> ` : ""}${esc(n.name)}${n.awareness && RG.mode === "all" ? ' <span class="phase sale">Awareness</span>' : ""}${n.sub ? `<br><span class="sub tsub">${esc(n.sub)}</span>` : ""}`;
    rowsHtml.push(`<tr class="tr-l${n.level} ${open ? "open" : ""}" ${expandable || n.note ? `data-k="${esc(n.key)}" data-kind="${kind}" tabindex="0" role="button" aria-expanded="${open}"` : ""}><td class="text">${name}</td>${cols.map((c) => `<td>${cell(n, c, awareness)}${c[2] === undefined && c[0] === "Spend" ? share : ""}</td>`).join("")}</tr>`);
    if (open && n.note) rowsHtml.push(`<tr class="tr-note"><td class="text" colspan="${cols.length + 1}">${esc(n.note)}</td></tr>`);
    if (open && expandable) n.kids.forEach((k) => emit(k, awareness));
    if (open && n.level === 0) {
      const gap = [];
      if (!tree || !tree.from) gap.push("Ad-level detail has not been loaded yet.");
      else if (!covered) gap.push(`Ad-level detail is kept from ${rgFmtDay(tree.from, true)}; this period is earlier.`);
      else if (covered < g.cur.length) gap.push(`Ad-level detail covers ${covered} of the ${g.cur.length} days here (from ${rgFmtDay(tree.from, true)}), so what is below adds up to less than the campaign.`);
      if (g.prev && coveredPrev < g.prev.length) gap.push("Comparison figures below this level only count days the detail covers.");
      if (!n.kids.length || gap.length) rowsHtml.push(`<tr class="tr-note"><td class="text" colspan="${cols.length + 1}">${esc(gap.join(" ") || "Nothing below this campaign in these days.")}</td></tr>`);
    }
  };
  camps.forEach((n) => emit(n, n.awareness));
  const head = `<tr><th class="text" scope="col">${kind === "meta" ? "Campaign · ad set · ad" : "Campaign · ad group or asset group · ad"}</th>${cols.map((c) => `<th scope="col">${c[0]}</th>`).join("")}</tr>`;
  return `<div class="table-wrap" style="max-height:72vh"><table class="tree"><thead>${head}</thead><tbody>${rowsHtml.join("")}</tbody></table></div><p class="legend-note">Click a row to open what is under it.</p>`;
}
function rgDrillRepaint(kind) {
  const el = document.getElementById("tree-" + kind);
  if (el) el.innerHTML = rgDrillHtml(kind);
}
function rgDrillBind(host) {
  const toggle = (row) => {
    const k = row.dataset.k, kind = row.dataset.kind;
    if (RGX.open.has(k)) RGX.open.delete(k); else RGX.open.add(k);
    rgDrillRepaint(kind);
    const again = document.querySelector(`#tree-${kind} tr[data-k="${CSS.escape(k)}"]`);
    if (again) again.focus();
  };
  host.addEventListener("click", (ev) => { const r = ev.target.closest("tr[data-k]"); if (r) toggle(r); });
  host.addEventListener("keydown", (ev) => { if ((ev.key === "Enter" || ev.key === " ") && ev.target.matches("tr[data-k]")) { ev.preventDefault(); toggle(ev.target); } });
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
  const sheetNA = Object.entries(p.unavailable || {}).filter(([k]) => k.startsWith("sheet_")).map(([, v]) => v);
  const head = (metaNA ? `<div class="banner">Meta Ads: data unavailable. ${esc(metaNA)}. Meta spend, total spend, MER and Perf ROAS stay blank until it is in place.</div>` : "")
    + (sheetNA.length ? `<div class="banner">Spend sheets: ${sheetNA.map(esc).join("; ")}. Overall spend and ROAS stay blank for the days affected.</div>` : "");
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
  rgTab("marketing", ["campaign_days", "meta_tree", "google_tree"], head, () => {
    const draw = () => {
      const e = RG.eng, c = e.compare(RG.from, RG.to, RG.cmp), cd = state.pages.campaign_days;
      const host = document.getElementById("rg-body");
      if (!c.groups.length) { host.innerHTML = `<section class="card"><p class="na">Data unavailable: there are no days in the data for ${esc(rgSpan(RG.from, RG.to))}.</p></section>` + tail; return; }
      const [g, ctl] = rgPhasePick(c, "mk-phase");
      host.innerHTML = c.groups.map((x) => rgGroupHtml(x, c.groups.length > 1, RG_MKT, "Spend and return") + `<section class="card"><div class="section-head"><h2>${phaseChip(x.phase)} Spend and return by channel</h2><span class="sub">each channel's own revenue and ROAS; the last row is Shopify GMV over all spend</span></div>${rgChannelTable(x)}</section>`).join("") + `
        <div class="grid-2">
          <section class="card"><div class="section-head"><h2>Ad spend per day</h2>${legend([["--series-1", "Meta"], ["--series-2", "Google"]])}</div><div class="chart-box"><canvas id="c-rg-spend" aria-label="Meta and Google spend per day"></canvas></div></section>
          <section class="card"><div class="section-head"><h2>${RG.mode === "aw" ? "Attributed ROAS per day" : "MER per day"}</h2><span class="sub">${RG.mode === "aw" ? "GMV credited to awareness / awareness spend" : "GMV / (Meta + Google spend)"}</span></div><div class="chart-box"><canvas id="c-rg-mer" aria-label="MER per day"></canvas></div></section>
        </div>
        <section class="card"><div class="section-head"><h2>Meta · campaign, ad set, ad</h2>${ctl}<span class="sub">${esc(rgVsText(g, "cur"))}${g.pw ? ` · compared with ${esc(rgVsText(g, "prev"))}` : ""}</span></div>
          <div id="tree-meta">${metaNA ? `<p class="na">Data unavailable: ${esc(metaNA)}</p>` : ""}</div></section>
        <section class="card"><div class="section-head"><h2>Google Ads · campaign, ad group, ad</h2><span class="sub">${esc(rgVsText(g, "cur"))}</span></div>
          <div id="tree-google"></div></section>` + tail;
      RGX.g = g;
      if (!metaNA) rgDrillRepaint("meta");
      rgDrillRepaint("google");
      rgDrillBind(host);
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
