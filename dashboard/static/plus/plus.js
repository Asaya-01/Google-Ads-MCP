/* Dashboard Plus (Build Spec v1), Phase 1: Profit (M1), Traffic Quality (M3),
   Site · change markers (M6) and Inventory · stock snapshots (M7).
   New tabs only. They reuse the existing date picker, comparison and BAU /
   Sale switch (rgTab / rgBar / RG.eng), cards, tables and styles, and edit
   none of them. Existing pages are read, never written. A metric whose
   input is missing shows "Input needed: ..."; nothing is estimated.
   Inlined after the other tab files, inside the dashboard closure. */

(function pxStyles() {
  if (typeof document === "undefined" || document.getElementById("plus-css")) return;
  const s = document.createElement("style");
  s.id = "plus-css";
  s.textContent = `
.px-need { border: 1px dashed var(--line); border-radius: 10px; padding: 10px 12px; color: var(--ink-2); font-size: 13px; background: var(--surface); }
.px-need b { color: var(--warn); font-weight: 600; }
.kpi .px-need-v { font-size: 13px; color: var(--warn); font-weight: 600; line-height: 1.35; white-space: normal; }
.px-flag { color: var(--bad); font-weight: 600; }
.px-ok { color: var(--good); font-weight: 600; }
.px-warn { color: var(--warn); font-weight: 600; }
.px-wf td.neg { color: var(--bad); }
.px-chg { display: inline-block; min-width: 20px; text-align: center; border-radius: 4px; background: var(--accent-wash); color: var(--ink); font-size: 11px; font-weight: 700; padding: 0 4px; }
`;
  document.head.appendChild(s);
})();

// ---------------------------------------------------------------- shared bits (this file only)
const PX = { opt: {} };
const pxNeed = (what) => `<div class="px-need"><b>Input needed:</b> ${esc(String(what || "").replace(/^Input needed:\s*/, ""))}</div>`;
const pxShort = (x) => String((x && x.na) || "").replace(/^Input needed:\s*/, "").replace(/\s*\(.*$/, "");
const pxNa = (x) => (x && x.na ? x.na : null);
/* A KPI card in the existing card style, for metrics outside the shared registry. */
function pxCard(label, value, o = {}) {
  const tip = o.tip ? `<span class="tip" tabindex="0" role="note" data-tip="${esc(o.tip)}">i</span>` : "";
  const body = o.need ? `<div class="kpi-v px-need-v">Input needed</div><div class="kpi-d"><span class="na" title="${esc(o.need)}">${esc(o.need.replace(/^Input needed:\s*/, "").slice(0, 120))}</span></div>`
    : value == null ? `<div class="kpi-v na-v">—</div><div class="kpi-d"><span class="na">${esc(o.na || "Data unavailable")}</span></div>`
      : `<div class="kpi-v">${esc(value)}</div><div class="kpi-d">${o.sub || ""}</div>`;
  return `<div class="kpi" data-metric="${esc(o.id || label)}"><div class="kpi-l"><span class="kpi-n">${esc(label)}</span>${tip}</div>${body}</div>`;
}
const pxPct = (v, d) => (v == null || !isFinite(v) ? "—" : mFormat("percent", v));
const pxInr = (v) => (v == null ? "—" : mFormat("currency", v));
const pxInrC = (v) => (v == null ? "—" : mFormat("currency", v, true));
const pxInt = (v) => (v == null ? "—" : mFormat("count", v));
const pxRatio = (v) => (v == null || !isFinite(v) ? "—" : mFormat("ratio", v));
async function pxLoad(names) { for (const n of names) { if (PX.opt[n] !== undefined) continue; try { PX.opt[n] = await loadPage(n); } catch (e) { PX.opt[n] = null; } } }
/* The days the header picked (and the comparison), as the other tabs read them. */
function pxPeriod() {
  const c = RG.eng.compare(RG.from, RG.to, RG.cmp), g = rgPick(c);
  return g ? { g, cur: new Set(g.cur), prev: g.prev && g.prev.length ? new Set(g.prev) : null, cd: g.w.days, pd: g.pw ? g.pw.days : 0 } : null;
}
const pxChange = (c, cd, p, pd) => (c == null || p == null || !p || !cd || !pd ? null : c / cd / (p / pd) - 1);
const pxRate = (a, b) => (a != null && b ? a / b : null);
const pxShift = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
function pxSumRows(rows, set, key, cols) {
  const m = new Map();
  for (const r of rows || []) { if (!set.has(r[0])) continue; const k = key(r); let a = m.get(k); if (!a) m.set(k, (a = cols.map(() => 0))); cols.forEach((c, j) => { a[j] += r[c] || 0; }); }
  return m;
}

// ================================================================ the Plus tab: one nav entry, a sub-tab per module
/* Phase 1 modules; later phases add theirs here. #plus?sub=traffic opens one. */
const PX_SUBS = [["profit", "Profit"], ["traffic", "Traffic Quality"], ["site", "Site"], ["stock", "Inventory"]];
R.plus = (page) => {
  const want = new URLSearchParams(location.hash.split("?")[1] || "").get("sub");
  const sub = PX_SUBS.some(([k]) => k === want) ? want : PX_SUBS[0][0];
  const nav = `<nav class="subtabs" aria-label="Plus modules">${PX_SUBS.map(([k, l]) => `<a href="#plus?sub=${k}" ${sub === k ? 'aria-current="page"' : ""}>${esc(l)}</a>`).join("")}</nav>`;
  const p = (page && page[sub]) || { na: "Data unavailable: built with the Plus job's next run." };
  rgTab("plus", [], nav, async () => {
    const host = document.getElementById("rg-body");
    if (p.na && Object.keys(p).length === 1) { host.innerHTML = `<section class="card"><p class="na">${esc(p.na)}</p></section>`; return; }
    host.innerHTML = '<p class="empty">Loading…</p>';
    await pxLoad(PX_NEEDS[sub] || []);
    if (state.tab !== "plus") return;
    const pr = pxPeriod();
    if (!pr) { host.innerHTML = rgNone(); return; }
    host.innerHTML = PX_DRAW[sub](p, pr);
    if (sub === "site") pxSiteChart(pxSiteChanges(p) || []);
  });
};
// the existing pages each module reads (read only)
const PX_NEEDS = { traffic: ["drill_days", "channel_days", "meta_ads", "google_ads"], profit: ["product_days"], site: [], stock: [] };
const PX_DRAW = { traffic: (p, pr) => pxTraffic(p, pr), profit: (p, pr) => pxProfit(p, pr), site: (p, pr) => pxSite(p, pr), stock: (p, pr) => pxStock(p, pr) };

// ================================================================ M3 Traffic quality
function pxTraffic(p, pr) {
  const C = p.config || {}, J = C.junk || {}, dd = PX.opt.drill_days, ga = p.ga4 || {};
  // Shopify sessions / orders by utm_source (every campaign type), from the existing drill-down data
  const src = dd && dd.source ? pxSumRows(dd.source.rows, pr.cur, (r) => r[1], [3, 5, 7]) : null;
  const srcName = (i) => ((dd.source.names[i] || {}).key || "(unknown)");
  // GA4 sessions / engaged by source (the part before " / ")
  const gaBy = new Map(), gaKeyed = new Map();
  if (ga.rows) for (const [d, ki, s, e] of ga.rows) { if (!pr.cur.has(d)) continue; const key = ga.keys[ki], so = key.split(" / ")[0]; const a = gaBy.get(so) || gaBy.set(so, [0, 0]).get(so); a[0] += s; a[1] += e; const b = gaKeyed.get(key) || gaKeyed.set(key, [0, 0]).get(key); b[0] += s; b[1] += e; }
  const days = pr.cd || 1;
  // junk sources
  const srcRows = src ? [...src.entries()].map(([i, [s, atc, o]]) => { const name = srcName(i), g = gaBy.get(String(name).toLowerCase()); const eng = g ? pxRate(g[1], g[0]) : null; const cvr = pxRate(o, s); const perDay = s / days;
    const why = perDay >= J.min_sessions_per_day ? [cvr != null && cvr < J.cvr_below ? `CVR ${pxPct(cvr)} under ${pxPct(J.cvr_below)}` : "", eng != null && eng < J.engaged_below ? `engaged ${pxPct(eng)} under ${pxPct(J.engaged_below)}` : ""].filter(Boolean) : [];
    return { name, s, atc, o, cvr, eng, perDay, flag: why.length > 0, why: why.join("; ") }; }).sort((a, b) => b.s - a.s) : [];
  const tot = srcRows.reduce((t, r) => ({ s: t.s + r.s, atc: t.atc + r.atc, o: t.o + r.o }), { s: 0, atc: 0, o: 0 });
  const junk = srcRows.filter((r) => r.flag), jt = junk.reduce((t, r) => ({ s: t.s + r.s, atc: t.atc + r.atc, o: t.o + r.o }), { s: 0, atc: 0, o: 0 });
  const clean = { s: tot.s - jt.s, atc: tot.atc - jt.atc, o: tot.o - jt.o };
  const valid = (n) => n && !/^\(no utm\)$|^\(none\)$|^\(direct\)$|^direct$|^none$|^$/i.test(String(n).trim());
  const utmS = srcRows.filter((r) => valid(r.name)).reduce((t, r) => t + r.s, 0), utmO = srcRows.filter((r) => valid(r.name)).reduce((t, r) => t + r.o, 0);
  let gaS = 0, gaE = 0; for (const [s, e] of gaBy.values()) { gaS += s; gaE += e; }
  const H = p.health || {};
  const kp = [
    pxCard("Clean sessions", src ? pxInt(clean.s) : null, { id: "px_clean_sessions", sub: src ? `<span class="kpi-vs">${pxPct(pxRate(clean.s, tot.s))} of ${pxInt(tot.s)} sessions</span>` : "", na: "the drill-down data appears after the next refresh", tip: "Sessions minus those from flagged junk sources (spec M3)." }),
    pxCard("Engaged-session rate", ga.rows ? pxPct(pxRate(gaE, gaS)) : null, { id: "px_engaged", na: ga.na || "no GA4 days in this period", sub: ga.rows ? `<span class="kpi-vs">GA4 property ${esc(ga.property || "")}</span>` : "", tip: "GA4 engaged sessions ÷ GA4 sessions." }),
    pxCard("UTM coverage · sessions", src ? pxPct(pxRate(utmS, tot.s)) : null, { id: "px_utm_s", tip: "Share of Shopify sessions with a valid utm_source." }),
    pxCard("UTM coverage · orders", src ? pxPct(pxRate(utmO, tot.o)) : null, { id: "px_utm_o", tip: "Share of orders with a valid utm_source (last click, as Shopify records it)." }),
    pxCard("Junk sources", src ? String(junk.length) : null, { id: "px_junk", sub: src ? `<span class="kpi-vs">${pxInt(jt.s)} sessions, ${pxInt(jt.o)} orders</span>` : "", tip: `Sources with ${pxInt(J.min_sessions_per_day)}+ sessions a day and CVR under ${pxPct(J.cvr_below)} or engaged-session rate under ${pxPct(J.engaged_below)}.` }),
    pxCard("Data-health score", H.score != null ? pxPct(H.score) : null, { id: "px_health", na: "no input could be scored yet", tip: H.about || "" }),
  ].join("");
  // clean vs all funnel
  const funnel = src ? table([
    { label: "Base", text: true, render: (r) => esc(r.l) }, { label: "Sessions", render: (r) => esc(pxInt(r.s)) },
    { label: "ATC rate", render: (r) => esc(pxPct(pxRate(r.atc, r.s))) }, { label: "Orders", render: (r) => esc(pxInt(r.o)) }, { label: "CVR", render: (r) => esc(pxPct(pxRate(r.o, r.s))) },
  ], [{ l: "All sessions", ...tot }, { l: "Clean sessions (junk sources removed)", ...clean }], { full: true }) : '<p class="na">Data unavailable: the drill-down data appears after the next refresh.</p>';
  const junkTbl = src ? table([
    { label: "utm_source", text: true, render: (r) => `${r.flag ? '<span class="px-flag">⚑</span> ' : ""}${esc(r.name)}` },
    { label: "Sessions a day", render: (r) => esc(pxInt(Math.round(r.perDay))) }, { label: "Orders", render: (r) => esc(pxInt(r.o)) },
    { label: "CVR", render: (r) => esc(pxPct(r.cvr)) }, { label: "Engaged (GA4)", render: (r) => (r.eng == null ? '<span class="cell-na" title="No GA4 sessions for this source">—</span>' : esc(pxPct(r.eng))) },
    { label: "Why flagged", text: true, render: (r) => esc(r.why || "") },
  ], srcRows.slice(0, 25), { full: true, maxHeight: "50vh" }) : "";
  const gaTbl = ga.rows ? table([
    { label: "GA4 source / medium", text: true, render: (r) => esc(r.k) }, { label: "Sessions", render: (r) => esc(pxInt(r.s)) },
    { label: "Engaged", render: (r) => esc(pxInt(r.e)) }, { label: "Engaged-session rate", render: (r) => `<span class="${r.rate != null && r.rate < J.engaged_below ? "px-flag" : ""}">${esc(pxPct(r.rate))}</span>` },
  ], [...gaKeyed.entries()].map(([k, [s, e]]) => ({ k, s, e, rate: pxRate(e, s) })).sort((a, b) => b.s - a.s).slice(0, 20), { full: true, maxHeight: "50vh" }) : pxNeed(ga.na || "GA4 data");
  return `
    <section class="card" data-component="plus-traffic-kpis"><div class="kpis six">${kp}</div></section>
    ${rgSec("Reconciliation", "per channel: what the platform claims, Shopify's last-click orders and GA4 purchases, with the gap to Shopify", pxRecon(p, pr), { comp: "plus-traffic-recon" })}
    <div class="cols-2">
      ${rgSec("Junk-source flag", `utm_source by sessions; ⚑ = ${pxInt(J.min_sessions_per_day)}+ sessions a day and CVR or engagement under the threshold`, junkTbl, { comp: "plus-traffic-junk" })}
      ${rgSec("Clean sessions", "the funnel on both bases", funnel, { comp: "plus-traffic-clean" })}
    </div>
    ${rgSec("Click-to-session ratio", `Shopify sessions ÷ platform link clicks per campaign; ⚑ = moved more than ${pxPct((C.click_jump || {}).move)} from its ${(C.click_jump || {}).median_days}-day median`, pxClicks(p, pr), { comp: "plus-traffic-clicks" })}
    <div class="cols-2">
      ${rgSec("Engaged-session rate", "GA4, by source / medium", gaTbl, { comp: "plus-traffic-engaged" })}
      ${rgSec("Data-health score", "inputs loaded within their refresh window, weighted by the revenue they carry", pxHealth(H), { comp: "plus-traffic-health" })}
    </div>
    ${rgSec("Event Match Quality", "Meta's match quality for Purchase, IC and ATC; share of events sent server-side", pxNeed((C.inputs_needed || {}).event_match_quality || "Meta Event Match Quality"), { comp: "plus-traffic-emq" })}
    <p class="legend-note">Traffic Quality reads the dashboard's existing data and GA4 (BigQuery) read-only. Thresholds are the spec's starting points; tune them after two weeks of data. Each tab's own numbers (Funnel, Marketing) are unchanged; where they differ, the definition is named here.</p>`;
}
function pxRecon(p, pr) {
  const ch = PX.opt.channel_days, M = PX.opt.meta_ads, G = PX.opt.google_ads, ga = p.ga4 || {}, C = p.config || {};
  const shop = ch ? pxSumRows(ch.rows, pr.cur, (r) => ch.channels[r[1]], [5, 3]) : null;
  const dateSet = (P) => new Set(P.dates.map((d, i) => (pr.cur.has(d) ? i : -1)).filter((i) => i >= 0));
  let metaP = null, googleC = null;
  if (M && M.rows) { const s = dateSet(M); metaP = 0; for (const r of M.rows) if (s.has(r[0])) metaP += r[9] || 0; }
  if (G && G.crows) { const s = dateSet(G); googleC = 0; for (const r of G.crows) if (s.has(r[0])) googleC += r[5] || 0; }
  const paid = new RegExp(C.ga4_medium_paid || "^(cpc)$", "i");
  const ga4 = {};
  if (ga.purchases) for (const [d, ki, n] of ga.purchases) { if (!pr.cur.has(d)) continue; const [so, me] = ga.keys[ki].split(" / "); for (const [chn, rx] of Object.entries(C.ga4_channels || {})) { if (chn.startsWith("_")) continue; if (new RegExp(rx, "i").test(so) && paid.test(me || "")) ga4[chn] = (ga4[chn] || 0) + n; } }
  const rows = [
    { ch: "Meta Ads", plat: metaP, platNa: M ? null : "Meta view data not built yet" },
    { ch: "Google Ads", plat: googleC, platNa: G ? null : "Google view data not built yet" },
    { ch: "Reddit Ads", plat: null, platNa: "Input needed: Reddit conversions (only Reddit spend is loaded)" },
  ].map((r) => { const s = shop && shop.get(r.ch) ? shop.get(r.ch)[0] : shop ? 0 : null; return { ...r, shop: s, ga4: ga.purchases ? ga4[r.ch] || 0 : null }; });
  const gap = (a, b) => (a == null || !b ? null : a / b - 1);
  return table([
    { label: "Channel", text: true, render: (r) => esc(r.ch) },
    { label: "Platform conversions", render: (r) => (r.plat == null ? `<span class="cell-na" title="${esc(r.platNa || "")}">—</span>` : esc(pxInt(Math.round(r.plat)))) },
    { label: "Shopify last-click orders", render: (r) => esc(pxInt(r.shop)) },
    { label: "GA4 purchases", render: (r) => (r.ga4 == null ? `<span class="cell-na" title="${esc(ga.na || "")}">—</span>` : esc(pxInt(r.ga4))) },
    { label: "Platform gap to Shopify", render: (r) => { const v = gap(r.plat, r.shop); return v == null ? "—" : `<span class="${Math.abs(v) > 0.3 ? "px-warn" : ""}">${v >= 0 ? "+" : "−"}${esc(pxPct(Math.abs(v)))}</span>`; } },
    { label: "GA4 gap to Shopify", render: (r) => { const v = gap(r.ga4, r.shop); return v == null ? "—" : `${v >= 0 ? "+" : "−"}${esc(pxPct(Math.abs(v)))}`; } },
  ], rows, { full: true }) + `<p class="legend-note">Platform conversions: Meta purchases (every campaign type, each ad set's own attribution) and Google conversions (the purchase action, click date). GA4: purchases whose session came from the channel's paid traffic. Shopify: orders whose last click was the channel. A gap over 30% is amber.</p>`;
}
function pxClicks(p, pr) {
  const dd = PX.opt.drill_days, M = PX.opt.meta_ads, G = PX.opt.google_ads, J = (p.config || {}).click_jump || { move: 0.3, median_days: 14 };
  if (!dd || !dd.campaign) return '<p class="na">Data unavailable: the drill-down data appears after the next refresh.</p>';
  // Shopify sessions per utm_campaign and day
  const sess = new Map();
  for (const r of dd.campaign.rows) { const k = String((dd.campaign.names[r[1]] || {}).key || "").toLowerCase(); const m = sess.get(k) || sess.set(k, new Map()).get(k); m.set(r[0], (m.get(r[0]) || 0) + (r[3] || 0)); }
  const rows = [];
  const add = (platform, id, name, clicksByDay) => {
    const m = sess.get(String(name).toLowerCase()) || sess.get(String(id).toLowerCase());
    let c = 0, s = 0;
    for (const d of pr.cur) { c += clicksByDay.get(d) || 0; s += m ? m.get(d) || 0 : 0; }
    if (c < 100) return;
    // the median daily ratio over the last N days of the period
    const end = [...pr.cur].sort().pop(), list = RG.eng.rangeOf(pxShift(end, -(J.median_days - 1)), end);
    const ratios = list.map((d) => { const cc = clicksByDay.get(d) || 0, ss = m ? m.get(d) || 0 : 0; return cc >= 20 ? ss / cc : null; }).filter((x) => x != null).sort((a, b) => a - b);
    const med = ratios.length ? ratios[Math.floor(ratios.length / 2)] : null, ratio = m ? pxRate(s, c) : null;
    rows.push({ platform, name, c, s: m ? s : null, ratio, med, jump: ratio != null && med ? Math.abs(ratio / med - 1) > J.move : false });
  };
  if (M && M.rows) {
    const di = M.dates, by = new Map();
    for (const r of M.rows) { const ci = M.adsets[M.ads[r[1]][2]][2]; const m = by.get(ci) || by.set(ci, new Map()).get(ci); const d = di[r[0]]; m.set(d, (m.get(d) || 0) + (r[5] || 0)); }
    for (const [ci, m] of by) add("Meta", M.campaigns[ci][0], M.campaigns[ci][1], m);
  }
  if (G && G.crows) {
    const by = new Map();
    for (const r of G.crows) { const m = by.get(r[1]) || by.set(r[1], new Map()).get(r[1]); const d = G.dates[r[0]]; m.set(d, (m.get(d) || 0) + (r[4] || 0)); }
    for (const [ci, m] of by) add("Google", G.campaigns[ci][0], G.campaigns[ci][1], m);
  }
  rows.sort((a, b) => b.c - a.c);
  if (!rows.length) return '<p class="na">No campaign with 100+ link clicks in these days.</p>';
  return table([
    { label: "Campaign", text: true, render: (r) => `${r.jump ? '<span class="px-flag" title="Moved more than the threshold from its median">⚑</span> ' : ""}<span class="sub">${esc(r.platform)}</span> <span class="trunc" title="${esc(r.name)}">${esc(r.name)}</span>` },
    { label: "Link clicks", render: (r) => esc(pxInt(r.c)) }, { label: "Shopify sessions", render: (r) => (r.s == null ? '<span class="cell-na" title="No Shopify sessions carry this campaign as utm_campaign">—</span>' : esc(pxInt(r.s))) },
    { label: "Sessions per click", render: (r) => esc(r.ratio == null ? "—" : r.ratio.toFixed(2)) }, { label: `${J.median_days}-day median`, render: (r) => esc(r.med == null ? "—" : r.med.toFixed(2)) },
  ], rows.slice(0, 30), { full: true, maxHeight: "55vh" }) + `<p class="legend-note">Campaigns with 100+ link clicks (Meta) or clicks (Google). Matched to Shopify sessions by utm_campaign = the campaign's name or ID. ${pxNeed("Reddit link clicks per campaign (only Reddit spend is loaded today)").replace(/<\/?div[^>]*>/g, "")}</p>`;
}
function pxHealth(H) {
  if (!H || !H.inputs) return '<p class="na">Data unavailable: built with the Plus job\'s next run.</p>';
  return table([
    { label: "Input", text: true, render: (r) => esc(r.name) },
    { label: "Latest data", render: (r) => esc(r.last ? dayLabel(r.last) : "—") },
    { label: "Age", render: (r) => esc(r.age_days == null ? "—" : `${r.age_days} d`) },
    { label: "State", render: (r) => (r.ok == null ? `<span class="cell-na" title="${esc(r.why || "")}">not tracked</span>` : r.ok ? '<span class="px-ok">on time</span>' : '<span class="px-flag">stale</span>') },
    { label: "Weight", render: (r) => esc(pxPct(r.weight)) },
  ], H.inputs, { full: true });
}

// ================================================================ M1 Profit
/* Landed COGS of the units sold in these days, from the COGS sheet: null
   (with the SKUs missing) unless every sold SKU has a cost. */
function pxCogs(p, pr) {
  const pd = PX.opt.product_days;
  if (!p.cogs || !p.cogs.rows) return { na: pxNa(p.cogs) };
  if (!pd || !pd.vrows) return { na: "product sales by variant are not built yet" };
  const by = new Map(); for (const [sku, cost, from] of p.cogs.rows) (by.get(sku) || by.set(sku, []).get(sku)).push([from, cost]);
  for (const l of by.values()) l.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const costOn = (sku, d) => { const l = by.get(sku); if (!l) return null; let c = null; for (const [f, v] of l) if (f <= d) c = v; return c; };
  let total = 0; const missing = new Map();
  for (const [d, vi, u] of pd.vrows) { if (!pr.cur.has(d)) continue; const sku = pd.variants[vi].sku || "(no SKU)"; const c = costOn(sku, d); if (c == null) missing.set(sku, (missing.get(sku) || 0) + u); else total += c * u; }
  if (missing.size) return { na: `landed cost for ${missing.size} sold SKU${missing.size === 1 ? "" : "s"} (${[...missing.keys()].slice(0, 8).join(", ")}${missing.size > 8 ? "…" : ""})` };
  return { value: total };
}
function pxProfit(p, pr) {
  const w = pr.g.w;
  const sales = w.gmv, perf = w.perf_all_spend, aw = w.aw_spend;
  const gst = pxGst(p, pr);
  const net = sales == null || gst.share == null ? null : sales * (1 - gst.share);
  const infR = pxInfluencer(p, pr), inf = infR.value;
  const mkt = perf != null && aw != null && inf != null ? perf + aw + inf : null;
  const cogs = pxCogs(p, pr);
  const cm1 = net != null && cogs.value != null ? net - cogs.value : null;
  const needGst = gst.share != null ? null : gst.need, needCogs = cogs.value == null ? String(cogs.na || "").replace(/^Input needed:\s*/, "").replace(/\s*\(.*$/, "") : null;
  const needInf = inf == null ? infR.need : null;
  const needMkt = mkt != null ? null : [perf == null ? "performance spend for these days" : null, aw == null ? "awareness spend for these days" : null, needInf].filter(Boolean).join(" · ");
  const needRate = p.rate_card && p.rate_card.na ? pxShort(p.rate_card) : null;
  const needCm2 = [needRate, "RTO % per channel (Module 4, Phase 2)", "COD / prepaid split (Module 4)"].filter(Boolean).join(" · ");
  const ref = p.reference || {};
  const kp = [
    pxCard("MER", mkt ? pxRatio(sales / mkt) : null, { id: "px_mer", sub: mkt ? `<span class="kpi-vs">influencer ${esc(pxInrC(inf))} of ${esc(pxInrC(mkt))}</span>` : "", need: mkt ? null : `Input needed: ${needMkt}`, tip: "Total sales ÷ total marketing spend (performance + awareness + affiliate + CRM + influencer)." }),
    pxCard("CM1 (gross margin)", cm1 != null ? pxInrC(cm1) : null, { id: "px_cm1", sub: cm1 != null && net ? `<span class="kpi-vs">${pxPct(cm1 / net)} of net revenue</span>` : "", need: cm1 != null ? null : `Input needed: ${[needGst, needCogs].filter(Boolean).join(" · ")}`, tip: "Net revenue − Σ(units × landed COGS per variant)." }),
    pxCard("CM2", null, { id: "px_cm2", need: `Input needed: ${needCm2}`, tip: "CM1 − forward shipping − RTO and reverse shipping − payment gateway fees − COD fees − packaging." }),
    pxCard("CM3", null, { id: "px_cm3", need: "Input needed: CM2 (above)", tip: "CM2 − total marketing spend." }),
    pxCard("Break-even ROAS", null, { id: "px_be", need: `Input needed: CM2 per SKU (reference until then: ${pxRatio(ref.roas)} for ${(ref.skus || []).join(", ")})`, tip: "1 ÷ CM2% for that SKU." }),
    pxCard("First-order profit", null, { id: "px_fop", need: "Input needed: CM2 (above)", tip: "CM2 of a customer's first order − blended new-customer CAC." }),
  ].join("");
  // the waterfall: each step either a number or what it is waiting on
  const step = (l, v, need, neg) => ({ l, v, need, neg });
  const wf = [
    step("Total sales", sales, sales == null ? "Total sales for these days" : null),
    step(gst.share != null ? `GST (${pxPct(gst.share)} of Total sales, as charged)` : "GST", net != null ? -(sales - net) : null, needGst, true),
    step("Net revenue", net, needGst),
    step("Landed COGS", cogs.value != null ? -cogs.value : null, [needCogs].filter(Boolean).join(""), true),
    step("CM1", cm1, cm1 == null ? "the two rows above" : null),
    step("Forward shipping, RTO and reverse shipping", null, needRate || "RTO % per channel (Module 4)", true),
    step("Payment gateway and COD fees", null, needRate || "COD / prepaid split (Module 4)", true),
    step("Packaging", null, needRate, true),
    step("CM2", null, "the rows above", false),
    step("Marketing spend (performance + awareness + influencer)", mkt != null ? -mkt : null, needMkt, true),
    step("of which influencer", inf != null ? -inf : null, needInf, true),
    step("CM3", null, "CM2", false),
  ];
  const wfTbl = `<div class="table-wrap"><table class="px-wf"><thead><tr><th class="text">Step</th><th>₹</th><th class="text">State</th></tr></thead><tbody>${wf.map((r) => `<tr class="${/^CM|^Net/.test(r.l) ? "total" : ""}"><td class="text">${esc(r.l)}</td><td class="${r.neg && r.v ? "neg" : ""}">${esc(pxInr(r.v))}</td><td class="text">${r.v != null ? "" : `<span class="na">Input needed: ${esc(String(r.need || "").replace(/^Input needed:\s*/, ""))}</span>`}</td></tr>`).join("")}</tbody></table></div>`;
  const known = `<ul class="notes"><li>Performance spend in these days: <b>${esc(pxInr(perf))}</b>; awareness spend: <b>${esc(pxInr(aw))}</b> (the dashboard's existing numbers).</li><li>Break-even reference until Module 1 calculates it per SKU: <b>${esc(pxRatio(ref.roas))}</b> for ${esc((ref.skus || []).join(", "))} (spec).</li><li>${esc(p.finance_pl_note || "")}</li></ul>`;
  return `
    <section class="card" data-component="plus-profit-kpis"><div class="kpis six">${kp}</div></section>
    <div class="cols-2">
      ${rgSec("Waterfall", `Total sales down to CM3 for ${esc(rgSpan(RG.from, RG.to))}`, wfTbl, { comp: "plus-profit-waterfall" })}
      ${rgSec("What is known today", "and what each missing number waits on", known + pxProfitInputs(p), { comp: "plus-profit-inputs" })}
    </div>
    ${rgSec("Channel contribution", "CM2 of each channel's last-click orders − the channel's spend", pxNeed("CM2 (above), then channel contribution follows from the Marketing tab's last-click orders and spend"), { comp: "plus-profit-channels" })}
    <p class="legend-note">Nothing on this tab is estimated: a number appears only when every input behind it is in. Inputs are Google Sheets read by the Plus job (formats in app/plus/config_plus.json).</p>`;
}
function pxProfitInputs(p) {
  const row = (l, x) => {
    if (x && !x.na) return `<li>${esc(l)}: <span class="px-ok">received</span></li>`;
    const detail = x && x.detail ? ` <span class="sub">(${esc(x.detail)})</span>` : "";
    const fmt = x && x.format ? `<br><span class="sub">Format: ${esc(x.format)}</span>` : "";
    return `<li>${esc(l)}: <span class="px-warn">needed</span>${detail}${fmt}</li>`;
  };
  const inf = p.influencer && p.influencer.months ? Object.keys(p.influencer.months).sort() : null;
  const infNote = inf && inf.length ? ` <span class="sub">(${esc(pxMonth(inf[0]))} – ${esc(pxMonth(inf[inf.length - 1]))}${p.influencer.pending && Object.keys(p.influencer.pending).length ? `; ${esc(Object.keys(p.influencer.pending).sort().map(pxMonth).join(", "))} not final yet` : ""})</span>` : "";
  const gstNote = p.gst && p.gst.days ? ' <span class="sub">(GST-inclusive; GST as Shopify charged it on the same orders)</span>' : "";
  return `<h3>Inputs</h3><ul class="notes">${row("Landed COGS per variant", p.cogs)}${row("Shipping, COD and gateway fee rate card", p.rate_card)}${row("GST", p.gst && (p.gst.days || p.gst.inclusive === false) ? {} : p.gst).replace("</li>", gstNote + "</li>")}${row("Influencer spend", p.influencer).replace("</li>", infNote + "</li>")}</ul>`;
}
const pxMonth = (m) => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7) - 1, 1)).toLocaleString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });
/* GST share of Total sales for these days: the tax Shopify charged on the
   same valid orders over their total. Null (with why) when it is not known. */
function pxGst(p, pr) {
  const g = p.gst;
  if (!g || g.na) return { share: null, need: pxShort(g) || "GST treatment of Total sales" };
  if (g.inclusive === false) return { share: 0 };
  const days = g.days || [];
  if (!days.length || days[0][0] > RG.from || days[days.length - 1][0] < RG.to) return { share: null, need: "GST for these days (the Plus job has not read them yet)" };
  let t = 0, x = 0;
  for (const [d, tot, tax] of days) if (pr.cur.has(d)) { t += tot; x += tax; }
  return t > 0 ? { share: x / t } : { share: null, need: "orders on these days" };
}
/* Influencer spend for these days: each ended month's actual spread evenly
   over its days; months not in the sheet (or not ended) are named. */
function pxInfluencer(p, pr) {
  const f = p.influencer;
  if (!f || !f.months) return { value: null, need: pxShort(f) || "monthly influencer spend" };
  let t = 0; const miss = new Set();
  for (const d of pr.cur) {
    const m = d.slice(0, 7), v = f.months[m];
    if (v == null) { miss.add(m); continue; }
    t += v / new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7), 0)).getUTCDate();
  }
  if (!miss.size) return { value: t };
  const list = [...miss].sort().map(pxMonth).join(", ");
  const pend = [...miss].some((m) => f.pending && f.pending[m] != null);
  return { value: null, need: `influencer spend for ${list}${pend ? " (month not over: the sheet's figure may still be the plan)" : ""}` };
}

// ================================================================ M6 Site: changes vs funnel
const pxSiteChanges = (p) => (p.changes && p.changes.rows ? p.changes.rows.filter((r) => r[0] >= RG.from && r[0] <= RG.to) : null);
function pxSite(p, pr) {
  const chg = pxSiteChanges(p);
  const list = chg == null ? pxNeed(pxNa(p.changes)) : chg.length ? table([
    { label: "#", render: (r) => `<span class="px-chg">${r.n}</span>` }, { label: "Date", text: true, render: (r) => esc(dayLabel(r[0])) },
    { label: "Change", text: true, render: (r) => esc(r[1]) }, { label: "Details", text: true, render: (r) => esc(r[2]) }, { label: "Owner", text: true, render: (r) => esc(r[3]) },
  ], chg.map((r, i) => Object.assign([...r], { n: i + 1 })), { full: true }) : '<p class="sub">No change logged in these days.</p>';
  return `
    ${rgSec("Changes vs funnel", "sessions, CVR and IC → Order per day, with every logged change and the sale days marked", `${legend([["--series-1", "Sessions"], ["--accent", "CVR"], ["--series-2", "IC → Order"]])}<div class="chart-box"><canvas id="c-px-site" aria-label="Sessions, CVR and IC to order per day"></canvas></div>${chg == null ? `<p class="legend-note">Change markers appear once the Changes Tracker sheet is connected. Shaded: sale days.</p>` : '<p class="legend-note">Numbered lines: logged changes (listed below). Shaded: sale days.</p>'}`, { comp: "plus-site-changes-chart" })}
    <div class="cols-2">
      ${rgSec("Change log", "Shopify Changes Tracker: changes that went live in these days", list + (p.changes && p.changes.open ? `<p class="legend-note">${esc(String(p.changes.open))} tracker ${p.changes.open === 1 ? "entry is" : "entries are"} not done yet (not marked).</p>` : "") + (p.changes && p.changes.format ? `<p class="legend-note">Sheet format: ${esc(p.changes.format)}</p>` : ""), { comp: "plus-site-changes" })}
      ${rgSec("A/B tests (Cooee)", "test start / stop markers and the test register", pxNeed(pxNa(p.cooee)), { comp: "plus-site-cooee" })}
    </div>
    <p class="legend-note">Sessions, CVR and IC → Order are the Funnel tab's own numbers for the same days (shown here, not changed there).</p>`;
}
function pxSiteChart(chg) {
  const e = RG.eng, el = document.getElementById("c-px-site");
  if (!el) return;
  if (!window.Chart) { el.parentElement.innerHTML = '<p class="na">Charts could not load.</p>'; return; }
  const days = e.rangeOf(RG.from, RG.to).filter((d) => e.phaseOf(d));
  const pts = days.map((d) => e.windowOf([d]));
  const sale = days.map((d) => e.phaseOf(d) === "sale");
  const marks = chg.map((r, i) => ({ i: days.indexOf(r[0]), n: i + 1 })).filter((m) => m.i >= 0);
  const plug = { id: "pxMarks", beforeDatasetsDraw(ch) { const { ctx: c, chartArea: a, scales: { x } } = ch; c.save(); c.fillStyle = css("--warn-bg"); sale.forEach((s, i) => { if (!s) return; const w = (a.right - a.left) / Math.max(1, sale.length); c.fillRect(x.getPixelForValue(i) - w / 2, a.top, w, a.bottom - a.top); }); c.strokeStyle = css("--bad"); c.fillStyle = css("--bad"); c.font = "bold 10px sans-serif"; for (const m of marks) { const px = x.getPixelForValue(m.i); c.beginPath(); c.setLineDash([3, 3]); c.moveTo(px, a.top); c.lineTo(px, a.bottom); c.stroke(); c.setLineDash([]); c.fillText(String(m.n), px + 3, a.top + 10); } c.restore(); } };
  const ch = new Chart(el, { type: "bar", plugins: [plug], data: { labels: days.map((d) => dayLabel(d)), datasets: [
    { type: "bar", label: "Sessions", data: pts.map((w) => w.sessions), backgroundColor: css("--series-1"), yAxisID: "y", order: 2 },
    { type: "line", label: "CVR", data: pts.map((w) => w.cvr), borderColor: css("--accent"), backgroundColor: css("--accent"), pointRadius: 0, borderWidth: 2, yAxisID: "y2", order: 1 },
    { type: "line", label: "IC → Order", data: pts.map((w) => w.ic_to_order), borderColor: css("--series-2"), backgroundColor: css("--series-2"), pointRadius: 0, borderWidth: 2, yAxisID: "y2", order: 1 },
  ] }, options: { responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: "index", intersect: false }, plugins: { legend: { display: false } },
    scales: { x: { ticks: { color: css("--muted"), maxRotation: 0, autoSkipPadding: 12, font: { size: 11 } }, grid: { display: false } }, y: axisOpts("int"), y2: { ...axisOpts("pct"), position: "right", grid: { display: false } } } } });
  state.charts.push(ch);
}

// ================================================================ M7 Inventory: stock snapshots
function pxStock(p) {
  const sec = (key, title, qtyLabel, colB) => {
    const S = p[key] || {};
    const daysIn = (S.days || []).filter((d) => d[0] >= RG.from && d[0] <= RG.to);
    const first = S.days && S.days.length ? S.days[0][0] : null, last = S.days && S.days.length ? S.days[S.days.length - 1][0] : null;
    const head = `<div class="kpis">${pxCard("Snapshot days collected", S.days ? String(S.days.length) : null, { id: `px_${key}_n`, na: S.na || "no snapshot yet", sub: first ? `<span class="kpi-vs">since ${esc(dayLabel(first))}</span>` : "" })}${pxCard("In these dates", S.days ? String(daysIn.length) : null, { id: `px_${key}_in`, na: S.na || "no snapshot yet" })}${pxCard(`Units in the latest (${last ? dayLabel(last) : "—"})`, last ? pxInt(S.days[S.days.length - 1][2]) : null, { id: `px_${key}_units`, na: S.na || "no snapshot yet" })}</div>`;
    const latest = S.latest ? table([{ label: "SKU", text: true, render: (r) => esc(r[0] || "") }, { label: "Product", text: true, render: (r) => `<span class="trunc" title="${esc(r[1] || "")}">${esc(r[1] || "")}</span>` }, { label: colB, text: true, render: (r) => esc(r[2] || "") }, { label: qtyLabel, render: (r) => esc(pxInt(r[3])) }], [...S.latest].sort((a, b) => (b[3] || 0) - (a[3] || 0)), { full: true, maxHeight: "45vh" }) : S.na ? `<p class="na">${esc(S.na)}</p>` : "";
    return rgSec(title, `taken once a day into BigQuery dashboard_plus${(p.taken || {})[key] ? "; last run: " + esc(p.taken[key]) : ""}`, head + latest, { comp: `plus-stock-${key}` });
  };
  return `
    ${sec("shopify", "Shopify stock snapshot", "Available", "Variant")}
    ${sec("unicommerce", "Warehouse stock snapshot (Unicommerce)", "Inventory", "Facility")}
    <p class="legend-note">${esc(p.about || "")} Days of cover, projected stockout dates, stockout days and spend on low-stock SKUs are built in Phase 3 (Module 7 views), from this history.</p>`;
}
