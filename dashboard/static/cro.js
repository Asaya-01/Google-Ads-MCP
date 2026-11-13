/* The CRO tab: "Where is the site leaking, who is ready to buy, and what are
   our on-site tests proving?" Data: Cooee (on-site tracking, read from its
   MCP server by the Cooee sync job; never Shopify's numbers, never shown as
   a headline elsewhere). Follows Cooee's weekly routine: What changed ·
   Where it leaked · Who drove it · What's working. Uses the header's date
   range, comparison and BAU / Sale switch like every range tab; experiments
   show since launch. Inlined inside the dashboard closure. */

(function croStyles() {
  if (typeof document === "undefined" || document.getElementById("cro-css")) return;
  const s = document.createElement("style");
  s.id = "cro-css";
  s.textContent = `
.cro-nav { position: sticky; top: 0; z-index: 5; background: var(--bg); display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 0; }
.cro-nav button { font: inherit; font-size: 13px; font-weight: 600; border: 1px solid var(--line); background: var(--surface); color: var(--ink-2); border-radius: 999px; padding: 6px 14px; cursor: pointer; }
.cro-nav button:hover { border-color: var(--accent); color: var(--ink); }
.cro-src { display: inline-block; font-size: 11px; font-weight: 600; color: var(--ink-2); background: var(--accent-wash); border-radius: 4px; padding: 1px 6px; margin-left: 6px; cursor: help; vertical-align: middle; }
.cro-sum li { margin: 4px 0; }
.cro-sum a { color: var(--accent); cursor: pointer; }
.cro-funnel .bar { height: 10px; border-radius: 5px; background: var(--series-1); min-width: 2px; }
.cro-funnel td.worst { background: var(--bad-bg); }
.cro-flag { color: var(--bad); font-weight: 600; font-size: 12px; }
.cro-ok { color: var(--good); font-weight: 600; }
.cro-board { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; align-items: start; }
@media (max-width: 1100px) { .cro-board { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 640px) { .cro-board { grid-template-columns: 1fr; } }
.cro-col h3 { font-size: 13px; margin: 0 0 8px; color: var(--ink-2); }
.cro-card { border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; margin-bottom: 10px; background: var(--surface); font-size: 13px; }
.cro-card b.t { display: block; margin-bottom: 4px; color: var(--head); }
.cro-card .m { color: var(--muted); font-size: 12px; }
.cro-v { display: inline-block; font-size: 11px; font-weight: 700; border-radius: 4px; padding: 2px 6px; margin: 6px 0 2px; }
.cro-v.win { background: var(--good-bg); color: var(--good); } .cro-v.lose, .cro-v.invalid { background: var(--bad-bg); color: var(--bad); }
.cro-v.early, .cro-v.inc { background: var(--accent-wash); color: var(--ink-2); }
.cro-heat td { text-align: center; font-size: 11px; padding: 4px 2px; min-width: 26px; }
.cro-empty { border: 1px dashed var(--line); border-radius: 10px; padding: 14px; color: var(--ink-2); background: var(--surface); }
.cro-connect { display: inline-block; margin-top: 10px; padding: 10px 18px; border-radius: 999px; background: var(--accent); color: var(--surface); font-weight: 600; text-decoration: none; }
`;
  document.head.appendChild(s);
})();

const CRO = { intent: "ALL", chart: "rpv", lpGroup: "page", lpView: "table", segDim: "device", segMetric: "cvr", pdpVar: false, pdpView: "table", campGroup: "campaign", heat: "cvr", csv: {}, live: {} };
const CRO_TIP = "Cooee on-site tracking; differs from Shopify, see Data health.";
const croSrc = () => `<span class="cro-src" title="${esc(CRO_TIP)}">Cooee</span>`;
const croR = (a, b) => (a != null && b ? a / b : null);
const croPct = (v) => (v == null || !isFinite(v) ? "—" : mFormat("percent", v));
const croInt = (v) => (v == null ? "—" : mFormat("count", v));
const croInr = (v) => (v == null || !isFinite(v) ? "—" : mFormat("currency", v));
const croInr2 = (v) => (v == null || !isFinite(v) ? "—" : mFormat("currency2", v));
const croPp = (c, p, dir) => (c == null || p == null ? '<span class="flat">–</span>' : mPpHtml(c - p, dir));
const croSec = (id, title, q, body, o = {}) => `<section class="card" id="${id}" data-component="${o.comp || id}"><div class="sec-head"><h2>${esc(title)}${croSrc()}</h2>${q ? `<span class="q">${q}</span>` : ""}${o.ctl ? `<span class="ctl">${o.ctl}</span>` : ""}</div>${body}</section>`;
const croSeg = (id, opts, cur) => `<div class="seg" id="${id}" role="group">${opts.map(([k, l]) => `<button type="button" data-k="${k}" aria-pressed="${cur === k}">${esc(l)}</button>`).join("")}</div>`;
const croCsvBtn = (id) => `<button type="button" class="rg-btn" data-csv="${id}">CSV</button>`;
function croTable(id, cols, rows, opts = {}) {
  CRO.csv[id] = { cols, rows };
  return table(cols, rows, { full: true, maxHeight: opts.maxHeight || "60vh" });
}
function croCsv(id) {
  const t = CRO.csv[id];
  if (!t) return;
  const plain = (h) => String(h).replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").trim();
  const q = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [t.cols.map((c) => q(plain(c.label))).join(",")].concat(t.rows.map((r) => t.cols.map((c) => q(plain(c.csv ? c.csv(r) : c.render ? c.render(r) : r[c.key] ?? ""))).join(",")));
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
  a.download = `asaya-cro-${id}-${RG.from}-to-${RG.to}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
}
/* sums of [date, key, ...nums] rows over a set of days, by key */
function croSum(rows, days, nk = 1) {
  const m = new Map();
  for (const r of rows || []) {
    if (!days.has(r[0])) continue;
    const k = nk === 0 ? "_" : r[1];
    let a = m.get(k);
    if (!a) m.set(k, (a = new Array(r.length - 1 - nk).fill(0)));
    for (let j = 1 + nk; j < r.length; j++) a[j - 1 - nk] += r[j] || 0;
  }
  return m;
}
/* the days as unbroken stretches [[from, to], ...] */
const croBlocks = (set) => { const out = []; for (const d of [...set].sort()) { const last = out[out.length - 1]; if (last && (Date.parse(d) - Date.parse(last[1])) / 864e5 === 1) last[1] = d; else out.push([d, d]); } return out; };
const croSegRates = (a) => a && { sessions: a[0], bounce: croR(a[1], a[0]), atc: croR(a[2], a[0]), cvr: croR(a[3], a[0]), rps: croR(a[4], a[0]), aov: croR(a[4], a[3]), high: croR(a[5], a[0]), revenue: a[4], order_sessions: a[3] };

// ================================================================ the tab
R.cro = (page) => {
  const qs = new URLSearchParams(location.hash.split("?")[1] || "");
  const err = qs.get("cooee_error"), ok = qs.get("cooee_connected");
  if (err || ok) history.replaceState(null, "", "#cro");
  const conn = page.connection || {};
  if (!page.days || !page.days.length) {
    $main.innerHTML = `<section class="card"><h2>CRO${croSrc()}</h2>
      ${err ? `<p class="na">Cooee sign-in failed: ${esc(err)}</p>` : ""}
      <div class="cro-empty">${conn.connected
        ? `<b>Cooee is connected</b>${conn.connected_by ? ` (by ${esc(conn.connected_by)})` : ""}. ${(() => { const L = page.sync?.last || {}; return L.status === "error"
          ? `The last sync failed${L.finished ? " (" + esc(new Date(L.finished).toLocaleString("en-IN")) + ")" : ""}: <span class="na">${esc(L.error || "unknown error")}</span>. The details are on <a href="#health">Data health</a>.`
          : `The first sync has not finished yet: the Cooee job back-fills from ${esc(page.sync?.data_start || "17 Jun 2026")}, a month per run, five times a day. To start it now: <code>gcloud run jobs execute asaya-d2c-cooee --region asia-south1</code>`; })()} ${conn.last_error ? `<br><span class="na">Last sign-in error: ${esc(conn.last_error)}</span>` : ""}`
        : `This tab reads Cooee's on-site data (intent, landing and exit pages, widgets, experiments) from Cooee's MCP server, read-only. Connect it once with your Cooee login; after that the sync job renews the sign-in by itself.<br><a class="cro-connect" href="/auth/cooee/start">Connect Cooee</a>`}</div></section>`;
    return;
  }
  const nav = `<nav class="cro-nav" aria-label="CRO sections">${[["cro-what", "What changed"], ["cro-leak", "Where it leaked"], ["cro-who", "Who drove it"], ["cro-work", "What's working"]].map(([id, l]) => `<button type="button" data-jump="${id}">${l}</button>`).join("")}</nav>`;
  rgTab("cro", [], "", () => croDraw(page, { err, ok, nav }));
};

function croDraw(P, extra = {}) {
  const host = document.getElementById("rg-body");
  const c = RG.eng.compare(RG.from, RG.to, RG.cmp), g = rgPick(c);
  if (!g) { host.innerHTML = rgNone(); return; }
  const have = new Set(P.days);
  const cur = new Set(g.cur.filter((d) => have.has(d))), prev = g.prev && g.prev.length ? new Set(g.prev.filter((d) => have.has(d))) : null;
  const banner = (!P.connection?.connected ? `<div class="banner">Cooee is not connected any more${P.connection?.last_error ? ": " + esc(P.connection.last_error) : ""}. <a href="/auth/cooee/start">Connect Cooee</a> again; these numbers are the last ones synced.</div>` : "")
    + (extra.err ? `<div class="banner">Cooee sign-in failed: ${esc(extra.err)}</div>` : "")
    + (cur.size < g.cur.length ? `<p class="legend-note">Cooee data covers ${esc(rgSpan(P.days[0], P.days[P.days.length - 1]))}; ${g.cur.length - cur.size} of the picked days are outside it.</p>` : "");
  if (!cur.size) { host.innerHTML = extra.nav + banner + `<section class="card"><p class="na">No Cooee data for these days. Cooee data runs ${esc(rgSpan(P.days[0], P.days[P.days.length - 1]))}.</p></section>`; return; }
  const ctx = { P, g, cur, prev, cd: cur.size, pd: prev ? prev.size : 0 };
  const F = (set) => { const m = croSum(P.funnel.rows, set || new Set(), 1); return m; };
  ctx.fc = F(cur); ctx.fp = prev ? F(prev) : null;
  host.innerHTML = extra.nav + banner + croWhat(ctx) + croLeak(ctx) + croWho(ctx) + croWork(ctx)
    + `<p class="legend-note">Every number here is Cooee's on-site tracking: it differs from Shopify's (sessions run lower; orders are counted per session), so it never replaces the Shopify headline. The Shopify-vs-Cooee check is on Data health. Synced ${esc(P.sync?.last?.finished ? new Date(P.sync.last.finished).toLocaleString("en-IN") : "—")}.</p>`;
  croBind(P, ctx);
  croCharts(ctx);
  croLive(ctx);
}

// ---------------------------------------------------------------- 1. What changed
const CRO_F = { sessions: 0, visitors: 1, pv: 2, atc: 3, cart: 4, checkout: 5, payment: 6, osess: 7, orders: 8, revenue: 9, bounced: 10 };
function croKpis(m) {
  const all = m.get(0), hi = m.get(4);
  if (!all) return null;
  return { cvr: croR(all[CRO_F.osess], all[0]), atc: croR(all[CRO_F.atc], all[0]), bounce: croR(all[CRO_F.bounced], all[0]),
    high_share: hi ? croR(hi[0], all[0]) : null, high_cvr: hi ? croR(hi[CRO_F.osess], hi[0]) : null, rps: croR(all[CRO_F.revenue], all[0]), sessions: all[0], orders: all[CRO_F.osess], revenue: all[CRO_F.revenue] };
}
function croWhat(ctx) {
  const k = croKpis(ctx.fc), kp = ctx.fp ? croKpis(ctx.fp) : null;
  ctx.k = k; ctx.kp = kp;
  const card = (id, key) => kpiCard(id, { value: k[key], prev: kp ? kp[key] ?? null : undefined, change: kp && kp[key] ? k[key] / kp[key] - 1 : null, tipExtra: CRO_TIP });
  const rpv = `<div id="cro-rpv">${kpiCard("cro_rpv", { loading: true })}</div>`;
  const cards = [rpv, card("cro_cvr", "cvr"), card("cro_atc_rate", "atc"), card("cro_bounce", "bounce"), card("cro_high_share", "high_share"), card("cro_high_cvr", "high_cvr")].join("");
  const sum = croSummary(ctx);
  const chart = `${legend([["--accent", "These days"], ["--muted", "Comparison (dashed)"]])}<div class="chart-box"><canvas id="c-cro-day" aria-label="Daily trend"></canvas></div>`;
  return `<section class="card" id="cro-what" data-component="cro-kpis"><div class="kpis six">${cards}</div></section>
    <div class="cols-2">
      ${croSec("cro-trend", "Day by day", "the comparison dashed", chart, { ctl: croSeg("cro-chart", [["rpv", "RPV"], ["cvr", "CVR"], ["atc", "ATC rate"], ["bounce", "Single-page"]], CRO.chart) })}
      ${croSec("cro-summary", "What changed", "the biggest movers, worked out the same way every time", sum)}
    </div>`;
}
function croSummary(ctx) {
  if (!ctx.kp) return '<p class="sub">Pick a comparison in the header to see what moved.</p>';
  const out = [], k = ctx.k, kp = ctx.kp;
  const names = { cvr: "CVR", atc: "ATC rate", bounce: "Single-page sessions", high_share: "High-intent share", high_cvr: "High-intent CVR" };
  const mv = Object.keys(names).filter((x) => k[x] != null && kp[x]).map((x) => [x, k[x] / kp[x] - 1]).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];
  if (mv) out.push(`<li><b>${names[mv[0]]}</b> moved most: ${croPct(kp[mv[0]])} → ${croPct(k[mv[0]])} (${mv[1] >= 0 ? "+" : ""}${(mv[1] * 100).toFixed(1)}%). <a data-jump="cro-what">See the trend</a></li>`);
  const steps = croSteps(ctx.fc.get(0)), ps = croSteps(ctx.fp.get(0));
  const worst = steps.map((s, i) => [s, ps[i]]).filter(([s, p]) => s.rate != null && p.rate != null).sort((a, b) => (a[0].rate - a[1].rate) - (b[0].rate - b[1].rate))[0];
  if (worst) out.push(`<li>Weakest funnel step: <b>${esc(worst[0].label)}</b>, ${croPct(worst[1].rate)} → ${croPct(worst[0].rate)} of sessions. <a data-jump="cro-leak">Where it leaked</a></li>`);
  const seg = (P, set) => croSum(P.channel.rows, set, 1);
  const sc = seg(ctx.P, ctx.cur), sp = seg(ctx.P, ctx.prev);
  const tc = [...sc.values()].reduce((a, v) => a + v[0], 0), tp = [...sp.values()].reduce((a, v) => a + v[0], 0);
  let best = null;
  for (const [ki, a] of sc) { const b = sp.get(ki); if (!b || !tc || !tp) continue; const contrib = a[4] / tc - b[4] / tp; if (!best || Math.abs(contrib) > Math.abs(best[1])) best = [ki, contrib]; }
  if (best) { const key = ctx.P.channel.keys[best[0]]; out.push(`<li>Channel that moved revenue per session most: <b>${esc(key.filter(Boolean).join(" · ") || "(none)")}</b> (${best[1] >= 0 ? "+" : "−"}₹${Math.abs(best[1]).toFixed(2)} per store session). <a data-jump="cro-who">Who drove it</a></li>`); }
  return `<ul class="cro-sum">${out.join("") || "<li>Nothing moved enough to call out.</li>"}</ul>`;
}

// ---------------------------------------------------------------- 2. Where it leaked
const CRO_STEPS = [["Sessions", 0], ["Product view", 2], ["Add to cart", 3], ["Cart open", 4], ["Checkout started", 5], ["Order", 7]];
const croSteps = (a) => CRO_STEPS.map(([label, i]) => ({ label, n: a ? a[i] : null, rate: a ? croR(a[i], a[0]) : null }));
function croLeak(ctx) {
  const ii = ["ALL", "NO", "LOW", "MEDIUM", "HIGH"].indexOf(CRO.intent);
  const s = croSteps(ctx.fc.get(ii)), p = ctx.fp ? croSteps(ctx.fp.get(ii)) : null;
  let worst = -1, wd = 0;
  s.forEach((x, i) => { if (i && p && x.rate != null && p[i].rate != null && x.rate - p[i].rate < wd) { wd = x.rate - p[i].rate; worst = i; } });
  const max = s[0].n || 1;
  const fun = `<div class="table-wrap"><table class="cro-funnel"><thead><tr><th class="text">Step</th><th>Sessions</th><th class="text" style="width:35%"></th><th>% of sessions</th><th>vs comparison</th></tr></thead><tbody>${s.map((x, i) => `<tr><td class="text${i === worst ? " worst" : ""}">${esc(x.label)}${i === worst ? ' <span class="cro-flag">worst vs comparison</span>' : ""}</td><td>${croInt(x.n)}</td><td class="text"><div class="bar" style="width:${Math.max(0.5, ((x.n || 0) / max) * 100)}%"></div></td><td>${croPct(x.rate)}</td><td>${i ? croPp(x.rate, p && p[i].rate, "higher") : ""}</td></tr>`).join("")}</tbody></table></div>
    <p class="legend-note">Cooee's steps are not strictly nested: GoKwik's checkout opens from the product page, so "Checkout started" can exceed "Cart open". Each step is shown as a share of sessions.</p>`;
  // high-intent shoppers who left
  const hiC = ctx.fc.get(4), hiP = ctx.fp ? ctx.fp.get(4) : null;
  const left = hiC ? hiC[0] - hiC[CRO_F.osess] : null, leftP = hiP ? hiP[0] - hiP[CRO_F.osess] : null;
  const ex = croSum(ctx.P.exits.rows, ctx.cur, 1), exP = ctx.prev ? croSum(ctx.P.exits.rows, ctx.prev, 1) : new Map();
  const topEx = [...ex.entries()].sort((a, b) => b[1][1] - a[1][1]).slice(0, 5);
  const site = "https://worldofasaya.com";
  const leftCard = `<p><b style="font-size:22px">${croInt(left)}</b> high-intent sessions ended without an order${leftP != null ? ` · ${mDeltaHtml("cro_high_share", ctx.cd && ctx.pd && leftP ? (left / ctx.cd) / (leftP / ctx.pd) - 1 : null)} per day vs comparison` : ""}</p>
    <ol>${topEx.map(([ki, a]) => `<li><a href="${site}${esc(ctx.P.exits.keys[ki])}" target="_blank" rel="noopener">${esc(ctx.P.exits.keys[ki] || "/")}</a> · ${croInt(a[1])} high-intent</li>`).join("") || "<li>No exits recorded.</li>"}</ol>
    <p class="legend-note">Counts only: no rupee "revenue at risk" is estimated.</p>`;
  return `<div id="cro-leak"></div>
    <div class="cols-2">
      ${croSec("cro-funnel", "Intent funnel", "sessions to order, by how close the visit came to buying", fun, { ctl: croSeg("cro-intent", [["ALL", "All"], ["HIGH", "High"], ["MEDIUM", "Medium"], ["LOW", "Low"], ["NO", "No intent"]], CRO.intent) })}
      ${croSec("cro-left", "High-intent shoppers who left", "and the pages they left from", leftCard)}
    </div>
    ${croLanding(ctx)}
    ${croExits(ctx, ex, exP)}`;
}
function croLanding(ctx) {
  const L = ctx.P.landing, byType = CRO.lpGroup === "type";
  const agg = (set) => { const m = new Map(); for (const r of L.rows) { if (!set || !set.has(r[0])) continue; const key = L.keys[r[1]]; const k = byType ? key[1] || "other" : r[1]; let a = m.get(k); if (!a) m.set(k, (a = [0, 0, 0, 0, 0, 0, 0])); for (let j = 0; j < 7; j++) a[j] += r[2 + j] || 0; } return m; };
  const mc = agg(ctx.cur), mp = agg(ctx.prev);
  const rows = [...mc.entries()].map(([k, a]) => ({ k, page: byType ? k : L.keys[k][0], type: byType ? "" : L.keys[k][1], r: croSegRates(a), p: croSegRates(mp.get(k)) }))
    .filter((x) => x.r.sessions > 0).sort((a, b) => b.r.sessions - a.r.sessions);
  const tot = croSegRates([...mc.values()].reduce((s, a) => s.map((v, j) => v + a[j]), [0, 0, 0, 0, 0, 0, 0]));
  ctx.lp = { rows, tot };
  const cols = [
    { label: byType ? "Page type" : "Landing page", text: true, render: (x) => `<span class="trunc" title="${esc(x.page)}">${esc(x.page || "/")}</span>`, csv: (x) => x.page },
    ...(byType ? [] : [{ label: "Type", text: true, render: (x) => esc(x.type || "") }]),
    { label: "Sessions", render: (x) => croInt(x.r.sessions) },
    { label: mHead("cro_bounce", "Single-page"), render: (x) => croPct(x.r.bounce), csv: (x) => croPct(x.r.bounce) },
    { label: mHead("cro_atc_rate"), render: (x) => `${croPct(x.r.atc)} <span class="sub">${croPp(x.r.atc, x.p && x.p.atc, "higher")}</span>`, csv: (x) => croPct(x.r.atc) },
    { label: mHead("cro_cvr"), render: (x) => `${croPct(x.r.cvr)} <span class="sub">${croPp(x.r.cvr, x.p && x.p.cvr, "higher")}</span>`, csv: (x) => croPct(x.r.cvr) },
    { label: mHead("cro_rps", "RPS"), render: (x) => croInr2(x.r.rps), csv: (x) => croInr2(x.r.rps) },
    { label: "AOV", render: (x) => croInr(x.r.aov), csv: (x) => croInr(x.r.aov) },
    { label: mHead("cro_high_share", "High-intent"), render: (x) => croPct(x.r.high), csv: (x) => croPct(x.r.high) },
  ];
  const body = CRO.lpView === "visual"
    ? `${legend([["--series-1", "Landing page (size: revenue)"], ["--muted", "Store average"]])}<div class="chart-box" style="height:360px"><canvas id="c-cro-lp" aria-label="Landing pages: sessions against CVR"></canvas></div><p class="legend-note">Top right is working; bottom right (high traffic, low conversion) is <b>Fix first</b>. Lines: store average CVR and the median page's sessions.</p>`
    : croTable("landing", cols, rows.slice(0, 300)) + (L.other && L.other.length ? '<p class="legend-note">Cooee returns the top 300 landing pages a day; the rest are a long tail of tiny pages, counted in the totals only.</p>' : "");
  return croSec("cro-lp", "Landing pages", "where sessions start, and how they convert", body,
    { ctl: croSeg("cro-lp-group", [["page", "Page"], ["type", "Page type"]], CRO.lpGroup) + croSeg("cro-lp-view", [["table", "Table"], ["visual", "Visual"]], CRO.lpView) + croCsvBtn("landing") });
}
function croExits(ctx, ex, exP) {
  const rows = [...ex.entries()].map(([k, a]) => ({ page: ctx.P.exits.keys[k], n: a[0], hi: a[1], p: exP.get(k) })).sort((a, b) => b.hi - a.hi).slice(0, 100);
  const cols = [
    { label: "Exit page", text: true, render: (x) => `<span class="trunc" title="${esc(x.page)}">${esc(x.page || "/")}</span>`, csv: (x) => x.page },
    { label: "Sessions that ended here without an order", render: (x) => croInt(x.n) },
    { label: "High-intent among them", render: (x) => `${croInt(x.hi)} ${x.p && ctx.cd && ctx.pd ? `<span class="sub">${mDeltaHtml("cro_high_share", x.p[1] ? (x.hi / ctx.cd) / (x.p[1] / ctx.pd) - 1 : null)}</span>` : ""}`, csv: (x) => x.hi },
  ];
  return croSec("cro-exits", "Exit pages", "where non-buyers left, sorted by high-intent sessions", croTable("exits", cols, rows), { ctl: croCsvBtn("exits") });
}

// ---------------------------------------------------------------- 3. Who drove it
const CRO_DIMS = [["device", "Device · new or returning"], ["channel", "Referring channel"], ["utm_campaign", "UTM campaign"], ["utm_content", "UTM content (creative)"], ["hour", "Hour of day"]];
const CRO_MET = [["sessions", "Sessions"], ["bounce", "Single-page"], ["atc", "ATC rate"], ["cvr", "CVR"], ["rps", "RPS"], ["aov", "AOV"], ["high", "High-intent share"]];
function croSegments(ctx, set) {
  const P = ctx.P, dim = CRO.segDim, m = new Map();
  const add = (k, a) => { let x = m.get(k); if (!x) m.set(k, (x = [0, 0, 0, 0, 0, 0, 0])); for (let j = 0; j < 7; j++) x[j] += a[j] || 0; };
  if (dim === "hour") { for (const r of P.hour || []) if (set && set.has(r[0])) add(`${String(r[1]).padStart(2, "0")}:00`, [r[2], 0, r[3], r[4], r[5], 0, 0]); return m; }
  const src = dim === "device" ? P.device : dim === "channel" ? P.channel : P.utm;
  for (const r of src.rows) {
    if (!set || !set.has(r[0])) continue;
    const key = src.keys[r[1]];
    const label = dim === "utm_campaign" ? `${key[0] || "(no source)"} · ${key[1] || "(no campaign)"}` : dim === "utm_content" ? `${key[1] || "(no campaign)"} · ${key[2] || "(no content)"}` : key.filter(Boolean).join(" · ") || "(none)";
    add(label, r.slice(2));
  }
  return m;
}
function croWho(ctx) {
  const min = ctx.P.rules?.min_segment_sessions ?? 300;
  const mc = croSegments(ctx, ctx.cur), mp = croSegments(ctx, ctx.prev);
  const other = [0, 0, 0, 0, 0, 0, 0];
  let rows = [];
  for (const [k, a] of mc) { if (CRO.segDim !== "hour" && a[0] < min) { for (let j = 0; j < 7; j++) other[j] += a[j]; continue; } rows.push({ name: k, r: croSegRates(a), p: croSegRates(mp.get(k)) }); }
  if (other[0]) rows.push({ name: `Other (under ${min} sessions each)`, r: croSegRates(other), p: null, _class: "sub" });
  const met = CRO.segMetric, isRate = met !== "sessions";
  rows.sort((a, b) => (CRO.segDim === "hour" ? a.name.localeCompare(b.name) : (b.r.sessions || 0) - (a.r.sessions || 0)));
  const fmtM = (v) => (met === "rps" ? croInr2(v) : met === "aov" ? croInr(v) : met === "sessions" ? croInt(v) : croPct(v));
  const dirOf = { bounce: "lower", high: "neutral", sessions: "neutral" };
  const cols = [
    { label: CRO_DIMS.find((d) => d[0] === CRO.segDim)[1], text: true, render: (x) => `<span class="trunc" title="${esc(x.name)}">${esc(x.name)}</span>`, csv: (x) => x.name },
    { label: "Sessions", render: (x) => croInt(x.r.sessions) },
    { label: CRO_MET.find((m) => m[0] === met)[1], render: (x) => `${fmtM(x.r[met])} ${x.p ? `<span class="sub">${isRate && met !== "rps" && met !== "aov" ? croPp(x.r[met], x.p[met], dirOf[met] || "higher") : mDeltaHtml("cro_rps", x.p[met] ? x.r[met] / x.p[met] - 1 : null)}</span>` : ""}`, csv: (x) => fmtM(x.r[met]) },
    ...(met !== "cvr" ? [{ label: "CVR", render: (x) => croPct(x.r.cvr) }] : []),
    ...(met !== "rps" ? [{ label: "RPS", render: (x) => croInr2(x.r.rps) }] : []),
  ];
  const explorer = croSec("cro-seg", "Segment explorer", "pick a dimension and a metric", `<div class="filter-row" style="margin-bottom:10px"><span class="lbl">By</span><select id="cro-dim">${CRO_DIMS.map(([k, l]) => `<option value="${k}" ${k === CRO.segDim ? "selected" : ""}>${esc(l)}</option>`).join("")}</select><span class="lbl">Metric</span><select id="cro-met">${CRO_MET.map(([k, l]) => `<option value="${k}" ${k === met ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></div>` + croTable("segments", cols, rows.slice(0, 120)), { ctl: croCsvBtn("segments") });
  return `<div id="cro-who"></div>${explorer}${croAds(ctx)}
    ${croHeat(ctx)}${croPdp(ctx)}`;
}
function croAds(ctx) {
  const U = ctx.P.utm, fl = ctx.P.rules?.flags || {};
  const sum = (set) => { const m = new Map(); for (const r of U.rows) { if (!set || !set.has(r[0])) continue; let a = m.get(r[1]); if (!a) m.set(r[1], (a = [0, 0, 0, 0, 0, 0, 0])); for (let j = 0; j < 7; j++) a[j] += r[2 + j] || 0; } return m; };
  const mc = sum(ctx.cur), mp = sum(ctx.prev);
  const rows = [...mc.entries()].filter(([k]) => U.keys[k][1] || U.keys[k][2]).map(([k, a]) => ({ key: U.keys[k], r: croSegRates(a), p: croSegRates(mp.get(k)) }))
    .filter((x) => x.r.sessions >= (ctx.P.rules?.min_segment_sessions ?? 300) / 3).sort((a, b) => b.r.sessions - a.r.sessions).slice(0, 80);
  const flag = (x) => x.r.sessions >= (fl.creative_min_sessions ?? 300) && x.r.bounce >= (fl.creative_bounce_over ?? 0.95) && (x.r.high ?? 0) < 0.02;
  const link = (src) => (/^(facebook|fb|ig|instagram|meta)$/i.test(src || "") ? "#marketing?sub=meta" : /^(google|youtube)$/i.test(src || "") ? "#marketing?sub=google" : null);
  const cols = [
    { label: "Source · campaign · content (creative)", text: true, render: (x) => { const l = link(x.key[0]); const t = `${x.key[0] || "(none)"} · ${x.key[1] || "(none)"} · ${x.key[2] || "(none)"}`; return `<span class="trunc" title="${esc(t)}">${l ? `<a href="${l}">${esc(t)}</a>` : esc(t)}</span>${flag(x) ? ' <span class="cro-flag" title="Single-page sessions very high and almost no high-intent sessions: the ad sends people who leave at once">⚑ low-intent traffic</span>' : ""}`; }, csv: (x) => x.key.join(" · ") },
    { label: "Sessions", render: (x) => croInt(x.r.sessions) },
    { label: "Single-page", render: (x) => croPct(x.r.bounce) },
    { label: "ATC rate", render: (x) => croPct(x.r.atc) },
    { label: "CVR", render: (x) => `${croPct(x.r.cvr)} <span class="sub">${croPp(x.r.cvr, x.p && x.p.cvr, "higher")}</span>`, csv: (x) => croPct(x.r.cvr) },
    { label: "RPS", render: (x) => croInr2(x.r.rps) },
    { label: "High-intent", render: (x) => croPct(x.r.high) },
  ];
  return croSec("cro-ads", "Traffic quality by ad", "on-site quality of each UTM campaign and creative; spend and ROAS stay on Marketing", croTable("ads", cols, rows), { ctl: croCsvBtn("ads") });
}
function croHeat(ctx) {
  const grid = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => [0, 0, 0]));
  for (const r of ctx.P.hour || []) { if (!ctx.cur.has(r[0])) continue; const wd = new Date(r[0] + "T00:00:00Z").getUTCDay(); const c = grid[wd][r[1]]; c[0] += r[2]; c[1] += r[4]; c[2] += r[5]; }
  const val = (c) => (CRO.heat === "rps" ? croR(c[2], c[0]) : croR(c[1], c[0]));
  const vals = grid.flat().map(val).filter((v) => v != null);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const cell = (c) => { const v = val(c); if (v == null) return '<td class="na">·</td>'; const t = hi > lo ? (v - lo) / (hi - lo) : 0.5; return `<td style="background:color-mix(in srgb, var(--series-1) ${Math.round(8 + t * 72)}%, transparent)" title="${esc(CRO.heat === "rps" ? croInr2(v) : croPct(v))} · ${croInt(c[0])} sessions">${CRO.heat === "rps" ? Math.round(v) : (v * 100).toFixed(1)}</td>`; };
  const tbl = `<div class="table-wrap"><table class="cro-heat"><thead><tr><th></th>${Array.from({ length: 24 }, (_, h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${[1, 2, 3, 4, 5, 6, 0].map((d) => `<tr><th class="text">${days[d]}</th>${grid[d].map(cell).join("")}</tr>`).join("")}</tbody></table></div><p class="legend-note">${CRO.heat === "rps" ? "Revenue per session, ₹" : "CVR, %"} by hour (IST) and day of week, over the picked days. Darker is higher.</p>`;
  return croSec("cro-heat", "When shoppers convert", "hour × day of week", tbl, { ctl: croSeg("cro-heat-m", [["cvr", "CVR"], ["rps", "RPS"]], CRO.heat) });
}
function croPdp(ctx) {
  const src = CRO.pdpVar ? ctx.P.variants : ctx.P.products, nk = CRO.pdpVar ? 4 : 3;
  const sum = (set) => { const m = new Map(); for (const r of src.rows) { if (!set || !set.has(r[0])) continue; let a = m.get(r[1]); if (!a) m.set(r[1], (a = [0, 0, 0, 0, 0, 0])); for (let j = 0; j < 6; j++) a[j] += r[2 + j] || 0; } return m; };
  const mc = sum(ctx.cur), mp = sum(ctx.prev);
  const tot = croSum(ctx.P.products.totals || [], ctx.cur, 0).get("_");
  const avg = tot ? croR(tot[1], tot[0]) : null;
  const minV = ctx.P.rules?.flags?.pdp_min_views ?? 500;
  const nameOf = (k) => { const key = src.keys[k]; const nm = key[nk - 2] || key[0]; const code = key[nk - 1]; return code ? `${code} · ${nm}` : nm; };
  const rows = [...mc.entries()].map(([k, a]) => ({ name: nameOf(k), views: a[0], atc: a[1], rem: a[2], buys: a[3], v2c: croR(a[1], a[0]), rr: croR(a[2], a[1]), p: mp.get(k) }))
    .filter((x) => x.views > 0 || x.atc > 0).sort((a, b) => b.views - a.views).slice(0, 60);
  ctx.pdp = { rows, avg, minV };
  const cols = [
    { label: CRO.pdpVar ? "Variant" : "Product", text: true, render: (x) => `<span class="trunc" title="${esc(x.name)}">${esc(x.name)}</span>${x.views >= minV && avg != null && x.v2c < avg ? ' <span class="cro-flag" title="Below the store view→cart rate with 500+ views">⚑</span>' : ""}`, csv: (x) => x.name },
    { label: "Views", render: (x) => croInt(x.views) },
    { label: "ATC", render: (x) => croInt(x.atc) },
    { label: mHead("cro_view_to_cart"), render: (x) => `${croPct(x.v2c)} <span class="sub">${croPp(x.v2c, x.p && croR(x.p[1], x.p[0]), "higher")}</span>`, csv: (x) => croPct(x.v2c) },
    { label: mHead("cro_removal_rate", "Removals"), render: (x) => `${croInt(x.rem)} <span class="sub">${croPct(x.rr)}</span>`, csv: (x) => x.rem },
    { label: "Purchases", render: (x) => croInt(x.buys) },
  ];
  const body = CRO.pdpView === "visual"
    ? `${legend([["--series-1", "Product"], ["--muted", "Store view→cart"]])}<div class="chart-box" style="height:320px"><canvas id="c-cro-pdp" aria-label="Product views against view to cart rate"></canvas></div>`
    : croTable("pdp", cols, rows);
  return croSec("cro-pdp", "Product pages", `views and adds; store view→cart ${croPct(avg)}. Units and revenue are on <a href="#products">Products</a>`, body,
    { ctl: croSeg("cro-pdp-var", [["p", "Products"], ["v", "Variants"]], CRO.pdpVar ? "v" : "p") + croSeg("cro-pdp-view", [["table", "Table"], ["visual", "Visual"]], CRO.pdpView) + croCsvBtn("pdp") });
}

// ---------------------------------------------------------------- 4. What's working
function croWork(ctx) {
  return `<div id="cro-work"></div>${croExperiments(ctx)}${croCampaigns(ctx)}${croImpact(ctx)}${croBacklog(ctx)}`;
}
function croCampaigns(ctx) {
  const C = ctx.P.campaigns, fl = ctx.P.rules?.flags || {};
  const grp = CRO.campGroup;
  const keyOf = (ci) => { const k = C.keys[ci]; return grp === "objective" ? k.objective || "—" : grp === "delivery" ? k.delivery || "—" : ci; };
  const sum = (set) => { const m = new Map(); for (const r of C.rows) { if (!set || !set.has(r[0])) continue; const k = keyOf(r[1]); let a = m.get(k); if (!a) m.set(k, (a = [0, 0, 0, 0, 0, 0, 0, 0, 0, []])); for (let j = 0; j < 9; j++) a[j] += r[2 + j] || 0; a[9].push([r[0], r[10]]); } return m; };
  const mc = sum(ctx.cur);
  const rows = [...mc.entries()].map(([k, a]) => ({ k, key: grp === "campaign" ? C.keys[k] : null, impr: a[0], clicks: a[1], dis: a[2], hold: a[3], atc: a[6], orders: a[7], rev: a[8], ctr: croR(a[1], a[0]), dr: croR(a[2], a[0]), days: a[9] }))
    .sort((a, b) => b.impr - a.impr);
  const name = (x) => (grp === "campaign" ? `#${x.key.seq} ${x.key.name}` : String(x.k));
  const zero = (x) => x.orders === 0 && x.impr >= (fl.min_impressions ?? 1000) && ctx.cd >= (fl.zero_order_days ?? 7);
  const cols = [
    { label: grp === "campaign" ? "Campaign" : grp === "objective" ? "Objective" : "Delivery type", text: true, render: (x) => `${grp === "campaign" ? `<a href="${esc(x.key.url)}" target="_blank" rel="noopener">${esc(name(x))}</a>` : esc(name(x))}${x.dr != null && x.dr > (fl.dismissal_rate ?? 0.4) ? ' <span class="cro-flag">⚑ dismissed often</span>' : ""}${zero(x) ? ' <span class="cro-flag">⚑ no orders</span>' : ""}`, csv: (x) => name(x) },
    ...(grp === "campaign" ? [{ label: "Objective · delivery", text: true, render: (x) => esc(`${x.key.objective || ""} · ${x.key.delivery || ""}`.replace(/_/g, " ").toLowerCase()) }, { label: "Status", text: true, render: (x) => esc((x.key.status || "").toLowerCase()) }] : []),
    { label: "Impressions", render: (x) => croInt(x.impr) },
    { label: mHead("cro_widget_ctr", "CTR"), render: (x) => croPct(x.ctr), csv: (x) => croPct(x.ctr) },
    { label: mHead("cro_dismissal", "Dismissal"), render: (x) => croPct(x.dr), csv: (x) => croPct(x.dr) },
    { label: "Holdouts", render: (x) => croInt(x.hold) },
    { label: "ATC", render: (x) => croInt(x.atc) },
    { label: "Orders", render: (x) => croInt(x.orders) },
    { label: "Revenue (last touch)", render: (x) => croInr(x.rev), csv: (x) => Math.round(x.rev) },
  ];
  const note = `<p class="legend-note">Revenue here is last-touch attributed by Cooee, not incremental: it is what the widget touched, not what it added. ${C.all ? `${C.all} campaigns in Cooee; rows are those shown in these days.` : ""}</p>`;
  return croSec("cro-camp", "Cooee widgets", "campaigns shown on the site in these days", croTable("campaigns", cols, rows) + note,
    { ctl: croSeg("cro-camp-grp", [["campaign", "Campaign"], ["objective", "Objective"], ["delivery", "Delivery type"]], grp) + croCsvBtn("campaigns") });
}
const CRO_VCLS = { Winner: "win", Loser: "lose", "Invalid: split mismatch": "invalid", "Too early": "early", Inconclusive: "inc" };
function croExpCard(e, ctx) {
  const ctrl = (e.arms || []).find((a) => a.control), vars = (e.arms || []).filter((a) => !a.control);
  const opv = (a) => croR(a.orders, a.visitors);
  const fl = ctx.P.rules?.flags || {};
  const arms = (e.arms || []).map((a) => `${esc(a.name || a.key)}${a.control ? " (control)" : ""}: ${croInt(a.visitors)} visitors · ${croPct(opv(a))} orders/visitor · ${croInr2(croR(a.revenue, a.visitors))} RPV`).join("<br>");
  const hist = (e.history || []).filter((h) => h[1] != null);
  return `<div class="cro-card"><b class="t">#${esc(e.seq)} ${esc(e.name)}</b>
    <span class="m">${esc((e.type || "").replace(/_/g, " ").toLowerCase())}${e.page_type ? " · " + esc(e.page_type.toLowerCase()) : ""}${e.days_live != null ? ` · ${e.days_live} days live` : ""}</span><br>
    <span class="cro-v ${CRO_VCLS[e.verdict] || "inc"}">${esc(e.verdict)}</span> <span class="m">${esc(e.why || "")}</span><br>
    ${e.lift_opv != null ? `Orders per visitor ${e.lift_opv >= 0 ? "+" : ""}${(e.lift_opv * 100).toFixed(1)}% · p ${e.p != null ? e.p.toFixed(3) : "—"} <span class="m">(${esc(e.source || "")})</span><br>RPV ${e.lift_rpv != null ? (e.lift_rpv >= 0 ? "+" : "") + (e.lift_rpv * 100).toFixed(1) + "%" : "—"} <span class="m">directional</span><br>` : ""}
    ${e.exposure != null && e.exposure < (fl.exposure_below ?? 0.2) ? `<span class="cro-flag" title="Impressions are a small share of the visitors in each arm, so any effect is diluted">⚑ only about ${croPct(e.exposure)} of visitors saw it</span><br>` : ""}
    <details><summary class="m">Arms, split check and lift over time</summary><p class="m">${arms}</p>
      ${e.srm && e.srm.p != null ? `<p class="m">Split check: chi-square ${e.srm.chi2}, p ${e.srm.p < 0.001 ? "< 0.001" : e.srm.p.toFixed(3)}</p>` : ""}
      ${hist.length > 1 ? `<div class="chart-box" style="height:140px"><canvas data-exp-hist="${esc(e.seq)}" aria-label="Lift over time"></canvas></div>` : '<p class="m">Lift over time builds up from the daily snapshots.</p>'}
    </details>
    <a href="${esc(e.url)}" target="_blank" rel="noopener">View in Cooee →</a></div>`;
}
function croExperiments(ctx) {
  const E = ctx.P.experiments || [], cut = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10), fl = ctx.P.rules?.flags || {};
  const col = (t, list) => `<div class="cro-col"><h3>${esc(t)} (${list.length})</h3>${list.map((e) => croExpCard(e, ctx)).join("") || '<p class="m">None</p>'}</div>`;
  const drafts = E.filter((e) => e.status === "DRAFT");
  const ageCut = new Date(Date.now() - (fl.draft_age_days ?? 30) * 864e5).toISOString().slice(0, 10);
  const hyg = drafts.filter((e) => e.created < ageCut || /^new (split url )?experiment$/i.test(e.name) || /^campaign \d/i.test(e.name));
  const dcol = `<div class="cro-col"><h3>Drafts (${drafts.length})</h3><div class="cro-card"><span class="m">${hyg.length} need tidying: drafts older than ${fl.draft_age_days ?? 30} days or untitled.</span><details><summary class="m">List</summary><p class="m">${hyg.map((e) => `#${esc(e.seq)} ${esc(e.name)} · created ${esc(e.created)}`).join("<br>") || "—"}</p></details></div></div>`;
  ctx.exps = E;
  return `${croSec("cro-exp", "Experiments", "since launch; verdicts by fixed rules (split check, sample size, two-proportion test)",
    `<div class="cro-board">${col("Running", E.filter((e) => e.status === "PUBLISHED"))}${col("Paused", E.filter((e) => e.status === "PAUSED"))}${col("Stopped, last 90 days", E.filter((e) => ["STOPPED", "COMPLETED"].includes(e.status) && e.updated >= cut))}${dcol}</div>`)}`;
}
function croImpact(ctx) {
  const I = ctx.P.impact || {};
  const body = I.running ? `<p>An impact test is running. Exposed vs held-out visitors, per visitor: ${esc(JSON.stringify(I.latest).slice(0, 400))}</p>`
    : `<div class="cro-empty"><b>No holdout running</b>, so Cooee's incremental revenue can't be measured. Attributed revenue above is last-touch, not proof of lift. Ask Cooee to switch on a store-wide holdout (e.g. 5–10% of visitors).</div>`;
  return croSec("cro-impact", "Incremental impact", "what Cooee adds, measured against visitors held out of it", body);
}
function croBacklog(ctx) {
  const B = ctx.P.backlog || [];
  if (!B.length) return "";
  const ex = new Map((ctx.exps || []).map((e) => [String(e.seq), e]));
  return croSec("cro-backlog", "CRO backlog", "fixes from the CRO audit and the tests behind them", table([
    { label: "Fix", text: true, render: (b) => esc(`${b.id} ${b.title}`) }, { label: "Page", text: true, render: (b) => esc(b.page || "") },
    { label: "Priority", text: true, render: (b) => esc(b.priority || "") }, { label: "Status", text: true, render: (b) => esc(b.status || "") },
    { label: "Test", text: true, render: (b) => { const e = b.experiment && ex.get(String(b.experiment)); return e ? `#${esc(e.seq)} · <span class="cro-v ${CRO_VCLS[e.verdict] || "inc"}">${esc(e.verdict)}</span>` : "—"; } },
  ], B, { full: true }));
}

// ---------------------------------------------------------------- events, charts, live RPV
function croBind(P, ctx) {
  const host = document.getElementById("rg-body");
  CRO.P = P;
  const again = () => { destroyCharts(); croDraw(CRO.P, { nav: host.querySelector(".cro-nav")?.outerHTML || "" }); };
  for (const [id, key] of [["cro-dim", "segDim"], ["cro-met", "segMetric"]]) document.getElementById(id)?.addEventListener("change", (ev) => { CRO[key] = ev.target.value; const y = window.scrollY; again(); window.scrollTo(0, y); });
  if (host.dataset.croBound) return; // the body is redrawn in place; one click handler
  host.dataset.croBound = "1";
  host.addEventListener("click", (ev) => {
    const j = ev.target.closest("[data-jump]");
    if (j) { document.getElementById(j.dataset.jump)?.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
    const csv = ev.target.closest("[data-csv]");
    if (csv) { croCsv(csv.dataset.csv); return; }
    const b = ev.target.closest(".seg button[data-k]");
    if (!b) return;
    const id = b.parentElement.id, k = b.dataset.k;
    const set = { "cro-chart": "chart", "cro-intent": "intent", "cro-lp-group": "lpGroup", "cro-lp-view": "lpView", "cro-heat-m": "heat", "cro-pdp-view": "pdpView", "cro-camp-grp": "campGroup" }[id];
    if (set) CRO[set] = k; else if (id === "cro-pdp-var") CRO.pdpVar = k === "v"; else return;
    const y = window.scrollY; again(); window.scrollTo(0, y);
  });
}
function croCharts(ctx) {
  const P = ctx.P, all = (set) => [...set].sort();
  const daily = (d) => { const r = P.funnel.rows.find((x) => x[0] === d && x[1] === 0); if (!r) return null; const a = r.slice(2);
    return CRO.chart === "rpv" ? croR(a[CRO_F.revenue], a[CRO_F.visitors]) : CRO.chart === "cvr" ? croR(a[CRO_F.osess], a[0]) : CRO.chart === "atc" ? croR(a[CRO_F.atc], a[0]) : croR(a[CRO_F.bounced], a[0]); };
  const cd = all(ctx.cur), pd = ctx.prev ? all(ctx.prev) : [];
  const cv = document.getElementById("c-cro-day");
  if (cv) {
    const unit = CRO.chart === "rpv" ? "inr" : "pct";
    baseChart(cv, { type: "line", data: { labels: cd.map((d) => dayLabel(d)), datasets: [
      { label: "These days", data: cd.map(daily), borderColor: css("--accent"), borderWidth: 2.5, pointRadius: 2, tension: 0.25 },
      ...(pd.length ? [{ label: "Comparison", data: cd.map((_, i) => (pd[i] ? daily(pd[i]) : null)), borderColor: css("--muted"), borderDash: [5, 4], borderWidth: 2, pointRadius: 0, tension: 0.25 }] : []),
    ] } }, unit);
  }
  const lp = document.getElementById("c-cro-lp");
  if (lp && ctx.lp && window.Chart) {
    const pts = ctx.lp.rows.slice(0, 80).filter((x) => x.r.cvr != null);
    const maxRev = Math.max(...pts.map((x) => x.r.revenue || 0), 1);
    const sess = pts.map((x) => x.r.sessions).sort((a, b) => a - b), med = sess[Math.floor(sess.length / 2)] || 0;
    const avg = ctx.lp.tot.cvr;
    state.charts.push(new Chart(lp, { type: "bubble", data: { datasets: [
      { label: "Landing page", data: pts.map((x) => ({ x: x.r.sessions, y: (x.r.cvr || 0) * 100, r: 3 + 14 * Math.sqrt((x.r.revenue || 0) / maxRev), page: x.page })), backgroundColor: "color-mix(in srgb, " + css("--series-1") + " 55%, transparent)" },
      { type: "line", label: "Store CVR", data: [{ x: 0, y: avg * 100 }, { x: Math.max(...sess, 1), y: avg * 100 }], borderColor: css("--muted"), borderDash: [4, 4], pointRadius: 0 },
      { type: "line", label: "Median sessions", data: [{ x: med, y: 0 }, { x: med, y: Math.max(...pts.map((x) => (x.r.cvr || 0) * 100), 1) }], borderColor: css("--muted"), borderDash: [4, 4], pointRadius: 0 },
    ] }, options: { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => c.raw.page ? ` ${c.raw.page}: ${mFormat("count", c.raw.x)} sessions · CVR ${c.raw.y.toFixed(2)}%` : "" } } },
      scales: { x: { type: "logarithmic", title: { display: true, text: "Sessions (log)" } }, y: { title: { display: true, text: "CVR %" } } } } }));
  }
  const pdp = document.getElementById("c-cro-pdp");
  if (pdp && ctx.pdp && window.Chart) {
    const pts = ctx.pdp.rows.filter((x) => x.v2c != null && x.views > 0);
    state.charts.push(new Chart(pdp, { type: "scatter", data: { datasets: [
      { label: "Product", data: pts.map((x) => ({ x: x.views, y: x.v2c * 100, name: x.name })), backgroundColor: pts.map((x) => (x.views >= ctx.pdp.minV && ctx.pdp.avg != null && x.v2c < ctx.pdp.avg ? css("--bad") : css("--series-1"))) },
      { type: "line", label: "Store", data: [{ x: Math.min(...pts.map((x) => x.views), 1), y: (ctx.pdp.avg || 0) * 100 }, { x: Math.max(...pts.map((x) => x.views), 1), y: (ctx.pdp.avg || 0) * 100 }], borderColor: css("--muted"), borderDash: [4, 4], pointRadius: 0 },
    ] }, options: { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => c.raw.name ? ` ${c.raw.name}: ${mFormat("count", c.raw.x)} views · ${c.raw.y.toFixed(1)}% to cart` : "" } } },
      scales: { x: { type: "logarithmic", title: { display: true, text: "Views (log)" } }, y: { title: { display: true, text: "View → cart %" } } } } }));
  }
  for (const cv2 of document.querySelectorAll("canvas[data-exp-hist]")) {
    const e = (ctx.exps || []).find((x) => String(x.seq) === cv2.dataset.expHist);
    const h = (e?.history || []).filter((x) => x[1] != null);
    baseChart(cv2, { type: "line", data: { labels: h.map((x) => dayLabel(x[0])), datasets: [{ label: "Orders per visitor lift", data: h.map((x) => x[1]), borderColor: css("--accent"), borderWidth: 2, pointRadius: 0 }] } }, "pct");
  }
}
async function croLive(ctx) {
  const el = document.getElementById("cro-rpv");
  if (!el) return;
  const get = async (r) => { const k = r.join("_"); if (CRO.live[k]) return CRO.live[k]; const v = await getJSON(`/api/cro/live?start=${r[0]}&end=${r[1]}`); CRO.live[k] = v; return v; };
  /* visitors are distinct within a stretch of days; days split by the
     BAU / Sale rule are asked of Cooee stretch by stretch and added up, so a
     visitor who came back in two stretches counts twice (said in the tip) */
  const range = async (set) => { const bl = croBlocks(set); if (!bl.length || bl.length > 8) return null; const parts = await Promise.all(bl.map(get));
    return { visitors: parts.reduce((s, x) => s + (x.visitors || 0), 0), revenue: parts.reduce((s, x) => s + (x.revenue || 0), 0), n: bl.length }; };
  try {
    const a = await range(ctx.cur), b = ctx.prev ? await range(ctx.prev).catch(() => null) : null;
    if (!a) throw new Error("these days are split into too many stretches to ask Cooee for visitors");
    const v = croR(a.revenue, a.visitors), pv = b ? croR(b.revenue, b.visitors) : null;
    const tip = `${CRO_TIP} ${croInt(a.visitors)} unique visitors${a.n > 1 ? `, counted in ${a.n} stretches of days (a visitor who came back in two stretches counts twice)` : ""}.`;
    if (document.getElementById("cro-rpv")) el.innerHTML = kpiCard("cro_rpv", { value: v, prev: ctx.prev ? pv : undefined, change: pv ? v / pv - 1 : null, tipExtra: tip, sub: a.n > 1 ? `visitors from ${a.n} stretches` : "" });
  } catch (e) {
    if (document.getElementById("cro-rpv")) el.innerHTML = kpiCard("cro_rpv", { value: null, na: e.message || "Cooee did not answer" });
  }
}

// ---------------------------------------------------------------- Data health: Cooee
/* The sign-in, the last sync runs and calls, and the daily reconciliation:
   Cooee sessions vs Shopify sessions, Cooee orders and revenue vs Shopify
   Orders and Total sales, and Cooee's checkout steps vs GoKwik. */
function croHealth(P, D) {
  if (!P) return '<p class="na">Data unavailable: the CRO page is not built yet.</p>';
  const c = P.connection || {}, L = (P.sync || {}).last || {}, warn = P.rules?.recon_warn ?? 0.10;
  const conn = c.connected
    ? `<div class="ck"><span class="spill ok"><i></i>Connected</span><span class="why">by ${esc(c.connected_by || "—")}${c.connected_at ? ", " + esc(new Date(c.connected_at).toLocaleDateString("en-IN")) : ""}${c.last_error ? ` · last renewal failed: ${esc(c.last_error)}` : ""}</span></div>`
    : `<div class="ck"><span class="spill late"><i></i>Not connected</span><span class="why"><a href="/auth/cooee/start">Connect Cooee</a>: one sign-in with your Cooee login; the sync renews it by itself.</span></div>`;
  const run = L.started ? `<p>Last sync ${esc(new Date(L.finished || L.started).toLocaleString("en-IN"))}: <b>${esc(L.status || "")}</b>, ${(L.days || []).length} days pulled, ${L.backfill_left ?? "—"} days left to back-fill${L.error ? ` · <span class="na">${esc(L.error)}</span>` : ""}.</p>` : '<p class="na">No sync has run yet.</p>';
  const calls = (P.sync || {}).calls || [];
  const callTbl = calls.length ? rgFold("Last run's calls", `${calls.length} calls`, table([
    { label: "Tool", text: true, render: (r) => esc(r.tool) }, { label: "Arguments", text: true, render: (r) => `<code>${esc(JSON.stringify(r.args).slice(0, 140))}</code>` },
    { label: "Rows", render: (r) => esc(r.rows ?? "–") }, { label: "ms", render: (r) => esc(r.ms) }, { label: "Status", text: true, render: (r) => (r.status === "ok" ? '<span class="chip ok">ok</span>' : `<span class="chip missing" title="${esc(r.error || "")}">error</span>`) },
  ], calls.slice().reverse(), { maxHeight: "40vh", full: true })) : "";
  let rec = '<p class="na">No days to reconcile yet.</p>';
  if (D && D.dates && (P.recon || []).length) {
    const ix = new Map(D.dates.map((d, i) => [d, i])), v = (f, d) => (D.values[f] ? D.values[f][ix.get(d)] : null);
    const st = new Map((P.store || []).map((r) => [r[0], r]));
    const gap = (a, b) => (a != null && b ? a / b - 1 : null);
    const g = (x) => (x == null ? "–" : `<span class="${Math.abs(x) > warn ? "na" : ""}">${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%</span>`);
    const rows = P.recon.slice(-14).reverse().filter((r) => ix.has(r[0])).map((r) => ({ d: r[0], cs: r[1], ss: v("sessions", r[0]), co: (st.get(r[0]) || [])[2], so: v("sh_orders", r[0]) ?? v("orders", r[0]),
      cr: (st.get(r[0]) || [])[1], sr: v("sh_sales", r[0]) ?? v("gmv", r[0]), cc: r[4], gi: v("ic", r[0]), cp: r[5], gp: v("gk_payment", r[0]) }));
    rec = table([
      { label: "Day", text: true, render: (r) => esc(dayLabel(r.d)) },
      { label: "Sessions Cooee / Shopify", render: (r) => `${croInt(r.cs)} / ${croInt(r.ss)} ${g(gap(r.cs, r.ss))}` },
      { label: "Orders Cooee / Shopify", render: (r) => `${croInt(r.co)} / ${croInt(r.so)} ${g(gap(r.co, r.so))}` },
      { label: "Revenue Cooee / Total sales", render: (r) => `${croInr(r.cr)} / ${croInr(r.sr)} ${g(gap(r.cr, r.sr))}` },
      { label: "Checkout started Cooee / GoKwik", render: (r) => `${croInt(r.cc)} / ${croInt(r.gi)} ${g(gap(r.cc, r.gi))}` },
      { label: "Payment step Cooee / GoKwik", render: (r) => `${croInt(r.cp)} / ${croInt(r.gp)} ${g(gap(r.cp, r.gp))}` },
    ], rows, { full: true, maxHeight: "50vh" }) + `<p class="legend-note">Cooee counts with its own on-site tracking, so it never equals Shopify: its sessions run below Shopify's, and its store-level orders come from Shopify. A gap beyond ±${Math.round(warn * 100)}% is shown in red; watch for a gap that moves, not one that is steady. Cooee's contact and address steps are left out: GoKwik's checkout is not tracked step by step.</p>`;
  }
  return conn + run + rec + callTbl;
}
