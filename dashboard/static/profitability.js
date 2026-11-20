/* The Profitability tab: "How much does each rupee of D2C revenue keep, month
   by month, and what moved it?" The Website slice of finance's channel P&L,
   in the workbook's own levels: Net revenue → Gross margin → CM1 → CM2 → CM3
   (the workbook stops at CM3). Month · Trend · Unit economics · SKU.
   Numbers come from pages/profitability.json (finance's files, imported into
   the private bucket); closed months are never changed. Every summary is
   template text worked out from the numbers. Inlined in the dashboard closure. */

(function pfStyles() {
  if (typeof document === "undefined" || document.getElementById("pf-css")) return;
  const s = document.createElement("style");
  s.id = "pf-css";
  s.textContent = `
:root { --pf-cost: #b0644a; --pf-sub: #4a2c1f; --pf-est: #9a938b; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --pf-cost: #d2896d; --pf-sub: #e8c7b1; --pf-est: #8d8179; } }
:root[data-theme="dark"] { --pf-cost: #d2896d; --pf-sub: #e8c7b1; --pf-est: #8d8179; }
.pf * { font-variant-numeric: tabular-nums; }
.pf-bar { position: sticky; top: 0; z-index: 6; background: var(--bg); display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; padding: 10px 0; }
.pf-bar label { font-size: 11px; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); display: inline-flex; gap: 8px; align-items: center; }
.pf-bar select { font: inherit; font-size: 13px; padding: 5px 8px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); color: var(--ink); text-transform: none; letter-spacing: 0; }
.pf-btn { font: inherit; font-size: 12.5px; padding: 6px 12px; border: 1px solid var(--line); border-radius: 999px; background: var(--surface); color: var(--ink-2); cursor: pointer; }
.pf-btn:hover { border-color: var(--accent); color: var(--accent); }
.pf-btn.primary { background: var(--accent); border-color: var(--accent); color: var(--surface); }
.pf-kpis { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 12px; }
@media (max-width: 1100px) { .pf-kpis { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (max-width: 640px) { .pf-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.pf-k { border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; background: var(--surface); min-width: 0; }
.pf-k.hero { background: var(--accent-wash); border-color: transparent; }
.pf-k .l { font-size: 11px; letter-spacing: .07em; text-transform: uppercase; color: var(--muted); display: flex; gap: 6px; align-items: center; }
.pf-k .v { font-size: clamp(22px, 2vw, 30px); font-weight: 300; letter-spacing: -.02em; color: var(--ink); margin: 6px 0 2px; white-space: nowrap; }
.pf-k .s { font-size: 12px; color: var(--muted); display: flex; justify-content: space-between; align-items: end; gap: 6px; }
.pf-k svg { display: block; }
.pf-d.good { color: var(--good); } .pf-d.bad { color: var(--bad); } .pf-d.flat { color: var(--muted); }
.pf-est { color: var(--pf-est); font-style: italic; text-decoration: underline dotted; text-underline-offset: 3px; cursor: help; }
.pf-chip { display: inline-flex; gap: 4px; align-items: center; font-size: 10.5px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; padding: 1px 6px; border-radius: 4px; background: var(--accent-wash); color: var(--accent); white-space: nowrap; }
.pf-chip.live { background: var(--good-bg, #e3f1e6); color: var(--good); }
.pf-tbl { overflow: auto; max-height: 82vh; border: 1px solid var(--line); border-radius: 10px; }
.pf-tbl table { border-collapse: separate; border-spacing: 0; width: 100%; font-size: 13px; }
.pf-tbl th, .pf-tbl td { padding: 6px 10px; text-align: right; white-space: nowrap; border-bottom: 1px solid var(--line); background: var(--surface); transition: background .15s; }
.pf-tbl th { position: sticky; top: 0; z-index: 2; font-size: 11px; letter-spacing: .05em; text-transform: uppercase; color: var(--muted); font-weight: 600; }
.pf-tbl th:first-child, .pf-tbl td:first-child { position: sticky; left: 0; z-index: 1; text-align: left; }
.pf-tbl th:first-child { z-index: 3; }
.pf-tbl tr.pf-s td { font-weight: 600; border-top: 1.5px solid var(--ink-2); color: var(--ink); }
.pf-tbl tr.pf-g td:first-child { cursor: pointer; }
.pf-tbl tr.line td:first-child { padding-left: 26px; color: var(--ink-2); }
.pf-tbl tr.memo td { color: var(--muted); font-size: 12px; }
.pf-tbl tr.memo td:first-child { padding-left: 26px; }
.pf-tbl td.sel, .pf-tbl th.sel { background: color-mix(in srgb, var(--accent-wash) 70%, var(--surface)); }
.pf-tbl .caret { display: inline-block; width: 14px; color: var(--muted); }
.pf-receipt { max-width: 520px; margin: 0 auto; border: 1px solid var(--line); border-radius: 14px; background: var(--surface); padding: 22px 26px; font-size: 14px; }
.pf-receipt h3 { margin: 0 0 2px; font-weight: 500; letter-spacing: .02em; }
.pf-receipt .r { display: grid; grid-template-columns: 1fr auto 80px; gap: 10px; padding: 7px 0; border-bottom: 1px dashed var(--line); align-items: baseline; }
.pf-receipt .r.pf-s { border-bottom: 1.5px solid var(--ink-2); font-weight: 600; }
.pf-receipt .r .d { text-align: right; font-size: 12px; }
.pf-receipt .r .x { text-align: right; }
.pf-cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 520px), 1fr)); gap: 24px; align-items: start; }
.pf-mini { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; }
.pf-check { display: grid; grid-template-columns: 22px 1fr; gap: 4px 8px; font-size: 13px; }
.pf-check i { font-style: normal; font-size: 14px; }
.pf-empty { border: 1px dashed var(--line); border-radius: 12px; padding: 26px; text-align: center; color: var(--ink-2); }
.pf-sum { font-size: 14px; margin: 4px 0 10px; color: var(--ink); }
.pf-print { display: none; }
@media print {
  @page { size: A4 portrait; margin: 12mm; }
  body.pf-printing header, body.pf-printing nav, body.pf-printing .pf-bar, body.pf-printing .pf-noprint, body.pf-printing #ask-dock, body.pf-printing .tabs, body.pf-printing #bar-sub { display: none !important; }
  body.pf-printing .pf-print { display: block; }
  body.pf-printing .card { break-inside: avoid; box-shadow: none; }
  body.pf-printing .pf-kpis { grid-template-columns: repeat(6, 1fr); }
}
`;
  document.head.appendChild(s);
})();

const PF = { sub: "month", mi: null, cmp: "prev", view: "inr", open: new Set(), openT: new Set(["revenue", "cogs", "fulfilment", "performance", "brand"]) };
const PF_SUBS = [["month", "Month"], ["trend", "Trend"], ["unit", "Unit economics"], ["sku", "SKU"]];
const PF_CMP = [["prev", "Previous month"], ["avg3", "Trailing 3-month average"], ["ly", "Same month last year"]];
const PF_VIEW = [["inr", "₹"], ["pct", "% of net revenue"], ["order", "Per order"]];
const pfMonth = (m) => new Date(m + "-01T00:00:00").toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
const pfLine = (P, k) => P.lines.find((l) => l.key === k);
const pfV = (P, k, i) => { const l = pfLine(P, k); return l && i != null && i >= 0 ? l.values[i] : null; };
const pfSt = (P, k, i) => { const l = pfLine(P, k); return l && i != null && i >= 0 ? l.status[i] : null; };
const pfInr = (v) => (v == null || !isFinite(v) ? "—" : mCompactInr(v));
const pfRs = (v) => (v == null || !isFinite(v) ? "—" : (v < 0 ? "−₹" : "₹") + inGroup.format(Math.round(Math.abs(v))));
const pfPct = (v, dp = 1) => (v == null || !isFinite(v) ? "—" : (v * 100).toFixed(dp) + "%");
const pfPp = (d) => (d == null || !isFinite(d) ? "—" : `${d > 0 ? "+" : d < 0 ? "−" : ""}${Math.abs(d * 100).toFixed(1)} pp`);
const pfParen = (v, f) => (v == null || !isFinite(v) ? "—" : v < 0 ? `(${f(-v)})` : f(v));

// the comparison: indices of the months it stands for (one, three, or the same month a year back)
function pfCmpIdx(P, i) {
  if (PF.cmp === "prev") return i > 0 ? [i - 1] : [];
  if (PF.cmp === "avg3") return i >= 3 ? [i - 3, i - 2, i - 1] : [];
  const [y, m] = P.months[i].split("-").map(Number), want = `${y - 1}-${String(m).padStart(2, "0")}`;
  const j = P.months.indexOf(want);
  return j >= 0 ? [j] : [];
}
// a value over a set of months: ₹ as the monthly average, % and per order as ratios of the sums
function pfAgg(P, k, idx, view) {
  if (!idx.length) return null;
  let a = 0, nr = 0, ord = 0;
  for (const j of idx) {
    const v = pfV(P, k, j), n = pfV(P, "net_rev", j), o = P.orders[j];
    if (v == null) return null;
    a += v; nr += n || 0; ord += o || 0;
    if (view === "order" && o == null) return null;
  }
  if (view === "pct") return nr ? a / nr : null;
  if (view === "order") return ord ? a / ord : null;
  return a / idx.length;
}
const pfCur = (P, k, view) => pfAgg(P, k, [PF.mi], view);
const pfCmpV = (P, k, view) => pfAgg(P, k, pfCmpIdx(P, PF.mi), view);
const pfFmt = (v, view, compact = true) => (view === "pct" ? pfPct(v) : view === "order" ? pfRs(v) : compact ? pfInr(v) : pfRs(v));
// Δ with the registry's direction: a cost rising is bad even though it is positive
function pfDelta(cur, prev, view, dir) {
  if (cur == null || prev == null) return '<span class="pf-d flat">no comparison</span>';
  const d = view === "pct" ? cur - prev : prev ? cur / Math.abs(prev) - 1 : null;
  if (d == null || !isFinite(d)) return '<span class="pf-d flat">—</span>';
  const cls = Math.abs(d) < 0.0005 ? "flat" : (dir === "lower" ? d < 0 : d > 0) ? "good" : "bad";
  return `<span class="pf-d ${cls}">${d > 0 ? "▲" : d < 0 ? "▼" : ""} ${view === "pct" ? pfPp(d).replace(/^[+−]/, "") : (Math.abs(d) * 100).toFixed(1) + "%"}</span>`;
}
function pfSpark(vals, w = 92, h = 26) {
  const xs = vals.map((v, i) => [i, v]).filter((p) => p[1] != null && isFinite(p[1]));
  if (xs.length < 2) return "";
  const lo = Math.min(...xs.map((p) => p[1])), hi = Math.max(...xs.map((p) => p[1])), sp = hi - lo || 1, n = vals.length - 1 || 1;
  const pts = xs.map(([i, v]) => `${((i / n) * (w - 4) + 2).toFixed(1)},${(h - 3 - ((v - lo) / sp) * (h - 6)).toFixed(1)}`).join(" ");
  const last = pts.split(" ").pop().split(",");
  return `<svg width="${w}" height="${h}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-linejoin="round"/><circle cx="${last[0]}" cy="${last[1]}" r="2.2" fill="var(--accent)"/></svg>`;
}
const pfCmpLabel = (P) => { const ix = pfCmpIdx(P, PF.mi); return !ix.length ? "no comparison" : PF.cmp === "avg3" ? `${pfMonth(P.months[ix[0]])}–${pfMonth(P.months[ix[2]])} average` : pfMonth(P.months[ix[0]]); };
const pfCell = (P, k, i, view) => {
  const v = pfAgg(P, k, [i], view), st = pfSt(P, k, i);
  const txt = view === "pct" ? pfPct(v) : view === "order" ? pfParen(v, (x) => pfRs(x)) : pfParen(v, pfInr);
  if (st === "derived") return `<span class="pf-est" title="Worked out from finance's stated figures, not a line in the source: ${esc((pfLine(P, k) || {}).definition || "")}">${txt}</span>`;
  if (st === "incomplete") return `<span class="pf-est" title="An input line is missing for this month, so this subtotal is incomplete">${txt} ·incomplete</span>`;
  return txt;
};

R.profitability = (page) => {
  const qs = new URLSearchParams(location.hash.split("?")[1] || "");
  if (qs.get("sub") && PF_SUBS.some(([k]) => k === qs.get("sub"))) PF.sub = qs.get("sub");
  if (qs.get("m") && page.months && page.months.includes(qs.get("m"))) PF.mi = page.months.indexOf(qs.get("m"));
  if (qs.get("cmp") && PF_CMP.some(([k]) => k === qs.get("cmp"))) PF.cmp = qs.get("cmp");
  if (qs.get("view") && PF_VIEW.some(([k]) => k === qs.get("view"))) PF.view = qs.get("view");
  pfDraw(page);
};
function pfUrl(P) {
  const q = new URLSearchParams({ sub: PF.sub, m: P.months[PF.mi] || "", cmp: PF.cmp, view: PF.view });
  history.replaceState(null, "", "#profitability?" + q.toString());
}

function pfDraw(P) {
  destroyCharts();
  if (!P.months || !P.months.length) { $main.innerHTML = pfEmptyAll(P); pfBindUpload(P); return; }
  if (PF.mi == null || PF.mi >= P.months.length) PF.mi = P.months.length - 1;
  const nav = `<nav class="subtabs pf-noprint" aria-label="Profitability views">${PF_SUBS.map(([k, l]) => `<a href="#profitability?sub=${k}" data-pfsub="${k}" ${PF.sub === k ? 'aria-current="page"' : ""}>${esc(l)}</a>`).join("")}</nav>`;
  const sel = (id, opts, cur, lbl, tip) => `<label ${tip ? `title="${esc(tip)}"` : ""}>${esc(lbl)}<select id="${id}">${opts.map(([k, l, dis]) => `<option value="${esc(k)}" ${k === cur ? "selected" : ""} ${dis ? "disabled" : ""}>${esc(l)}</option>`).join("")}</select></label>`;
  const months = P.months.map((m, i) => [String(i), `${pfMonth(m)} · ${P.month_status[m] === "closed" ? "closed" : P.month_status[m]}`]).reverse();
  const lyOk = P.months.some((m, i) => { const [y, mo] = m.split("-").map(Number); return P.months.includes(`${y - 1}-${String(mo).padStart(2, "0")}`); });
  const bar = `<div class="pf-bar pf-noprint" role="toolbar" aria-label="Profitability filters">
    ${sel("pf-m", months, String(PF.mi), "Month", "Monthly figures include sale periods")}
    ${sel("pf-cmp", PF_CMP.map(([k, l]) => [k, l, k === "ly" && !lyOk]), PF.cmp, "Compare")}
    ${PF.sub === "trend" || PF.sub === "month" ? sel("pf-view", PF_VIEW, PF.view, "View") : ""}
    <span style="flex:1"></span>
    <button type="button" class="pf-btn" id="pf-pdf">Download month as PDF</button>
    <button type="button" class="pf-btn" id="pf-up">Upload finance file</button><input type="file" id="pf-file" accept=".xlsx,.json" hidden>
  </div>`;
  const body = { month: pfMonthView, trend: pfTrend, unit: pfUnit, sku: pfSku }[PF.sub](P);
  $main.innerHTML = `<div class="pf">${nav}${bar}<p class="legend-note pf-noprint">Website (D2C) only, from finance's channel P&L · ${esc(pfMonth(P.months[PF.mi]))} vs ${esc(pfCmpLabel(P))} · <span class="pf-chip">🔒 Closed</span> months are finance's numbers, never changed here.</p>${body}${pfInputs(P)}<ul class="notes">${(P.notes || []).map((n) => `<li>${esc(n)}</li>`).join("")}</ul></div>`;
  pfBind(P);
  pfCharts(P);
  pfUrl(P);
}
function pfBind(P) {
  $main.querySelectorAll("[data-pfsub]").forEach((a) => a.addEventListener("click", (ev) => { ev.preventDefault(); PF.sub = a.dataset.pfsub; pfDraw(P); }));
  const on = (id, f) => { const el = document.getElementById(id); if (el) el.addEventListener("change", (ev) => { f(ev.target.value); pfDraw(P); }); };
  on("pf-m", (v) => (PF.mi = +v)); on("pf-cmp", (v) => (PF.cmp = v)); on("pf-view", (v) => (PF.view = v));
  $main.querySelectorAll("[data-pfgrp]").forEach((el) => el.addEventListener("click", () => { const g = el.dataset.pfgrp; PF.openT.has(g) ? PF.openT.delete(g) : PF.openT.add(g); pfDraw(P); }));
  $main.querySelectorAll("[data-pfcsv]").forEach((b) => b.addEventListener("click", () => pfCsv(P, b.dataset.pfcsv)));
  document.getElementById("pf-pdf")?.addEventListener("click", () => pfPrint(P));
  pfBindUpload(P);
}
function pfBindUpload(P) {
  const btn = document.getElementById("pf-up"), inp = document.getElementById("pf-file");
  if (!btn || !inp) return;
  btn.addEventListener("click", () => inp.click());
  inp.addEventListener("change", async () => {
    const f = inp.files && inp.files[0];
    if (!f) return;
    btn.disabled = true; btn.textContent = `Importing ${f.name}…`;
    try {
      const r = await fetch("/api/pnl/upload", { method: "POST", credentials: "same-origin", headers: { "X-File-Name": f.name, "Content-Type": "application/octet-stream" }, body: f });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail || `HTTP ${r.status}`);
      state.pages.profitability = null;
      await show();
    } catch (e) { btn.disabled = false; btn.textContent = "Upload finance file"; alert(`Not imported: ${e.message}`); }
  });
}
function pfEmptyAll(P) {
  return `<div class="pf"><section class="card"><div class="pf-empty"><h2 style="margin-top:0">Profitability</h2>
    <p>The Website P&L appears once finance's file is imported. Upload the <b>Investor Data Pack</b> (its Channel P&L tab), the month's <b>MIS</b> (COGS Master and Sales Dump), or the review's JSON extract. Each upload is kept as a new version; nothing is overwritten.</p>
    <button type="button" class="pf-btn primary" id="pf-up">Upload finance file</button><input type="file" id="pf-file" accept=".xlsx,.json" hidden></div></section></div>`;
}

// ---------------------------------------------------------------- Month
const PF_KPIS = [["net_rev", "Net revenue", "inr", "higher"], ["gm", "Gross margin", "pct", "higher"], ["cm1", "CM1", "pct", "higher", true], ["cm2", "CM2", "pct", "higher"], ["cm3", "CM3", "pct", "higher"], ["cm1", "CM1 per order", "order", "higher"]];
function pfKpis(P) {
  return `<section class="card" data-component="pf-kpis"><div class="pf-kpis">${PF_KPIS.map(([k, label, view, dir, hero]) => {
    const cur = pfCur(P, k, view), prev = pfCmpV(P, k, view);
    const series = P.months.map((_, i) => pfAgg(P, k, [i], view)).slice(-12);
    const tip = (pfLine(P, k) || {}).definition || "";
    return `<div class="pf-k${hero ? " hero" : ""}"><div class="l"><span>${esc(label)}${view === "pct" && k !== "net_rev" ? " %" : ""}</span><span class="tip" tabindex="0" role="note" data-tip="${esc(tip + (view === "order" ? " Per order uses the dashboard's headline order count." : ""))}">i</span></div>
      <div class="v">${esc(pfFmt(cur, view))}</div>
      <div class="s"><span>${pfDelta(cur, prev, view, dir)}<br><span style="font-size:11px">${view === "pct" ? esc(pfInr(pfCur(P, k, "inr"))) : "vs " + esc(pfCmpLabel(P))}</span></span>${pfSpark(series)}</div></div>`;
  }).join("")}</div></section>`;
}
function pfMonthView(P) {
  const i = PF.mi, ci = pfCmpIdx(P, i);
  const bridge = (title, levelKeys, from, to, id) => {
    if (!ci.length) return rgSec(title, "", '<p class="na">No comparison month for this choice.</p>', { comp: id });
    const prev = pfCmpV(P, to, "pct"), cur = pfCur(P, to, "pct");
    const parts = levelKeys.map((k) => ({ k, name: (pfLine(P, k) || {}).name || k, d: -((pfCur(P, k, "pct") ?? 0) - (pfCmpV(P, k, "pct") ?? 0)) })).filter((x) => pfLine(P, x.k));
    const top = parts.filter((x) => Math.abs(x.d) >= 0.0005).sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 3);
    const word = (x) => `${esc(x.name)} ${x.d < 0 ? "up" : "down"} (${pfPp(x.d)})`;
    const sum = cur == null || prev == null ? "" : `<p class="pf-sum"><b>${esc((pfLine(P, to) || {}).name)} ${pfPp(cur - prev)}</b>${top.length ? ": " + top.map(word).join(", ") : ": no line moved by 0.1 pp or more"}.</p>`;
    const disc = pfV(P, "disc", i) != null && pfV(P, "gmv", i) ? `Discount depth (Discounts ÷ GMV) ${pfPct(pfV(P, "disc", i) / pfV(P, "gmv", i))} against ${pfPct(pfAgg(P, "disc", ci, "inr") / pfAgg(P, "gmv", ci, "inr"))}: it changes net revenue itself, so it is the context of these bars, not one of them.` : "";
    return rgSec(title, `${esc(pfPct(prev))} → ${esc(pfPct(cur))}; each bar is the line's change in % of net revenue`, `${sum}<div class="chart-box" style="height:${80 + parts.length * 30}px"><canvas id="${id}" aria-label="${esc(title)}"></canvas></div><p class="legend-note">${esc(disc)}</p>`, { comp: id });
  };
  return `${pfKpis(P)}
    ${rgSec("From net revenue to CM3", `${esc(pfMonth(P.months[i]))} · click a cost to open its lines · labels: ₹ and % of net revenue`, `<div class="chart-box" style="height:380px"><canvas id="c-pf-wf" aria-label="Waterfall from net revenue to CM3"></canvas></div><p class="legend-note">Solid: subtotals. Muted: costs, hanging from the level above. Grey: worked out from finance's stated figures (hover for how).</p>`, { comp: "pf-wf" })}
    <div class="pf-cols">
      ${bridge("What moved CM1", ["cogs", "freight", "fees", "packaging", "storage", "logistics"], "net_rev", "cm1", "c-pf-b1")}
      ${bridge("What moved CM3", ["cogs", "freight", "fees", "packaging", "storage", "logistics", "ads", "promos", "samples", "influencer", "agency"], "net_rev", "cm3", "c-pf-b3")}
    </div>
    <div class="pf-print">${pfTable(P, [i, ...ci.slice(-1)], "inr", true)}</div>`;
}

// ---------------------------------------------------------------- Trend
function pfTable(P, cols, view, compact) {
  const i = PF.mi, ci = pfCmpIdx(P, i);
  const head = `<tr><th>${esc(view === "pct" ? "% of net revenue" : view === "order" ? "Per order" : "₹")}</th>${cols.map((j) => `<th class="${j === i ? "sel" : ""}">${esc(pfMonth(P.months[j]))}<br><span class="pf-chip">🔒 ${esc(P.month_status[P.months[j]] || "")}</span></th>`).join("")}${compact ? "" : `<th>Δ ${esc(pfMonth(P.months[i]))} vs ${esc(pfCmpLabel(P))}</th><th>Trend</th>`}</tr>`;
  // heat tint on % rows: distance from the row's own average, so outliers stand out without colour noise
  const tint = (k, j) => {
    if (view !== "pct") return "";
    const vals = cols.map((c) => pfAgg(P, k, [c], "pct")).filter((x) => x != null);
    if (vals.length < 3) return "";
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length, sd = Math.sqrt(vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length) || 1;
    const z = Math.min(2, Math.abs((pfAgg(P, k, [j], "pct") - mean) / sd));
    return z < 0.8 ? "" : `background: color-mix(in srgb, var(--pf-cost) ${Math.round(z * 7)}%, var(--surface))`;
  };
  const row = (l, cls) => {
    const dir = l.direction || "higher";
    return `<tr class="${cls}"><td><span title="${esc(l.definition || "")}">${esc(l.name)}</span></td>${cols.map((j) => `<td class="${j === i ? "sel" : ""}" style="${tint(l.key, j)}">${pfCell(P, l.key, j, view)}</td>`).join("")}${compact ? "" : `<td>${pfDelta(pfCur(P, l.key, view), pfCmpV(P, l.key, view), view, dir)}</td><td>${pfSpark(cols.map((j) => pfAgg(P, l.key, [j], view)), 70, 18)}</td>`}</tr>`;
  };
  let rows = "";
  for (const g of P.groups) {
    const members = P.lines.filter((l) => l.group === g.key && l.key !== g.subtotal && !(g.key === "revenue" && l.kind === "subtotal"));
    if (g.key === "revenue") {
      rows += `<tr class="pf-g" data-pfgrp="revenue"><td colspan="${cols.length + (compact ? 1 : 3)}" style="text-align:left"><span class="caret">${PF.openT.has("revenue") ? "▾" : "▸"}</span>Revenue build</td></tr>`;
      if (PF.openT.has("revenue")) for (const l of members) rows += row(l, "memo");
      const nr = pfLine(P, "net_rev"); if (nr) rows += row(nr, "pf-s");
      continue;
    }
    rows += `<tr class="pf-g" data-pfgrp="${esc(g.key)}"><td colspan="${cols.length + (compact ? 1 : 3)}" style="text-align:left"><span class="caret">${PF.openT.has(g.key) ? "▾" : "▸"}</span>${esc(g.name)}</td></tr>`;
    if (PF.openT.has(g.key)) for (const l of members) rows += row(l, l.kind === "memo" ? "memo" : "line");
    const s = pfLine(P, g.subtotal); if (s) rows += row(s, "pf-s");
  }
  return `<div class="pf-tbl"><table><thead>${head}</thead><tbody>${rows}</tbody></table></div>`;
}
function pfTrend(P) {
  const cols = P.months.map((_, j) => j);
  return `${rgSec("P&L by month", "Website, finance's lines; click a group to open or close it; negatives in brackets", pfTable(P, cols, PF.view, false), { ctl: `<button type="button" class="pf-btn" data-pfcsv="pnl">CSV</button>`, comp: "pf-pnl" })}
    ${rgSec("Margin ladder", "net revenue (bars) with each margin as % of net revenue (lines, right axis)", `<div class="chart-box" style="height:340px"><canvas id="c-pf-ladder" aria-label="Margin ladder"></canvas></div>`, { comp: "pf-ladder" })}`;
}

// ---------------------------------------------------------------- Unit economics
function pfUnit(P) {
  const i = PF.mi, ci = pfCmpIdx(P, i);
  const per = (keys, idx) => { let a = 0, o = 0; for (const j of idx) { for (const k of keys) { const v = pfV(P, k, j); if (v == null) return null; a += v; } if (P.orders[j] == null) return null; o += P.orders[j]; } return o ? a / o : null; };
  const lines = [
    ["AOV (net revenue per order)", ["net_rev"], false, "higher"],
    ["− COGS & primary freight", ["cogs", "freight"], false, "lower"],
    ["− Logistics", ["logistics"], false, "lower"],
    ["− Payment & DPC fees", ["fees"], false, "lower"],
    ["− Packaging & storage", ["packaging", "storage"], false, "lower"],
    ["= CM1 per order", ["cm1"], true, "higher"],
    ["− Performance marketing", ["ads", "promos", "samples"], false, "lower"],
    ["= CM2 per order", ["cm2"], true, "higher"],
    ["− Brand building", ["influencer", "agency"], false, "lower"],
    ["= CM3 per order", ["cm3"], true, "higher"],
  ];
  const receipt = lines.map(([l, keys, sub, dir]) => {
    const c = per(keys, [i]), p = ci.length ? per(keys, ci) : null;
    const d = c != null && p != null ? c - p : null;
    const good = d == null || Math.abs(d) < 0.5 ? "flat" : (dir === "lower" ? d < 0 : d > 0) ? "good" : "bad";
    return `<div class="r${sub ? " pf-s" : ""}"><span>${esc(l)}</span><span class="x">${esc(pfRs(c))}</span><span class="d pf-d ${good}">${d == null ? "—" : (d > 0 ? "+" : "−") + "₹" + inGroup.format(Math.abs(Math.round(d)))}</span></div>`;
  }).join("");
  const cm1p = pfCur(P, "cm1", "pct"), nr = pfV(P, "net_rev", i), ts = P.total_sales[i], sp = P.perf_spend[i];
  const be = cm1p > 0 ? 1 / cm1p : null, beTs = be != null && ts && nr ? be * (ts / nr) : null, act = ts && sp ? ts / sp : null;
  const cac = per(["cm1"], [i]);
  return `<div class="pf-cols">
    ${rgSec(`One order, ${pfMonth(P.months[i])}`, `per order, against ${esc(pfCmpLabel(P))}`, `<div class="pf-receipt"><h3>Website order</h3><p class="legend-note" style="margin-top:0">${esc(inGroup.format(P.orders[i] || 0))} orders (the dashboard's headline count) · finance's lines ÷ orders</p>${receipt}</div>`, { comp: "pf-receipt" })}
    <div>${rgSec("What marketing can afford", "", `<div class="pf-mini">
      <div class="pf-k"><div class="l">Breakeven ROAS <span class="tip" tabindex="0" role="note" data-tip="1 ÷ CM1 %: ad spend that a rupee of net revenue can pay for before CM2 turns negative. CM1 is the workbook's margin before any marketing.">i</span></div><div class="v">${be ? be.toFixed(2) + "x" : "—"}</div><div class="s">on net revenue (ex-GST)</div></div>
      <div class="pf-k"><div class="l">Breakeven, as Marketing counts it <span class="tip" tabindex="0" role="note" data-tip="The same breakeven on Shopify Total sales (incl. GST and shipping), the basis of the Marketing tab's Blended ROAS: breakeven × Total sales ÷ net revenue.">i</span></div><div class="v">${beTs ? beTs.toFixed(2) + "x" : "—"}</div><div class="s">on Shopify Total sales</div></div>
      <div class="pf-k hero"><div class="l">Actual blended ROAS <span class="tip" tabindex="0" role="note" data-tip="The Marketing tab's Blended ROAS for the month: Shopify Total sales ÷ performance spend (Meta and Google sales campaigns, Reddit, CRM, affiliates).">i</span></div><div class="v">${act ? act.toFixed(2) + "x" : "—"}</div><div class="s">${act && beTs ? (act >= beTs ? '<span class="pf-d good">above breakeven</span>' : '<span class="pf-d bad">below breakeven</span>') : ""} · <a href="#marketing">Marketing</a></div></div>
      <div class="pf-k"><div class="l">Max affordable CAC <span class="tip" tabindex="0" role="note" data-tip="CM1 per order: what one order can pay to acquire it and still break even on CM2. All orders, not first orders only: finance's P&L has no new / repeat split.">i</span></div><div class="v">${esc(pfRs(cac))}</div><div class="s">CM1 per order</div></div>
    </div><p class="legend-note">New vs repeat margins need revenue split by new and repeat customers, which finance's P&L does not carry yet.</p>`, { comp: "pf-afford" })}</div>
  </div>`;
}

// ---------------------------------------------------------------- SKU
function pfSku(P) {
  const m = P.months[PF.mi], S = (P.skus || {})[m];
  if (!S) return rgSec("SKU margins", "", `<div class="pf-empty"><p><b>SKU margins appear once the month's COGS by SKU is added.</b></p><p>Upload ${esc(pfMonth(m))}'s MIS workbook (COGS Master and Sales Dump sheets): its Shopify lines give each product's revenue and COGS.</p><p class="legend-note">Months with SKU data: ${esc(Object.keys(P.skus || {}).map(pfMonth).join(", ") || "none yet")}</p></div>`, { comp: "pf-sku-empty" });
  const ci = pfCmpIdx(P, PF.mi), cm = ci.length ? P.months[ci[ci.length - 1]] : null, C = cm ? (P.skus || {})[cm] : null;
  const prev = C ? new Map(C.rows.map((r) => [r.item, r])) : null;
  const rows = S.rows.slice().sort((a, b) => b.net_revenue - a.net_revenue);
  const t = table([{ label: "Product (MIS item)", text: true, render: (r) => `<span class="trunc" title="${esc(r.item)}">${esc(r.item)}</span>` },
    { label: "Units", render: (r) => esc(inGroup.format(r.qty)) }, { label: "Net revenue", render: (r) => esc(pfInr(r.net_revenue)) },
    { label: "Discount vs MRP", render: (r) => esc(pfPct(r.discount)) }, { label: "COGS %", render: (r) => esc(pfPct(1 - r.gm_pct)) },
    { label: "Gross margin %", render: (r) => esc(pfPct(r.gm_pct)) },
    { label: "CM1 % (allocated)", render: (r) => `<span class="pf-est" title="Gross margin % − the month's primary freight, fees, packaging, storage and logistics as % of net revenue (${esc(pfPct(S.var_pct))}), the same for every product">${esc(pfPct(r.cm1_pct))}</span>` },
    { label: `Δ GM vs ${cm ? pfMonth(cm) : "—"}`, render: (r) => { const p = prev && prev.get(r.item); return p ? pfDelta(r.gm_pct, p.gm_pct, "pct", "higher") : '<span class="pf-d flat">—</span>'; } }], rows, { full: true, maxHeight: "560px" });
  const gap = S.pnl_net_rev ? S.total_net_revenue / S.pnl_net_rev - 1 : null;
  return `${rgSec("Where margin sits", "net revenue (x) against CM1 % (y); bubble size: units; dashed lines: medians", `<div class="chart-box" style="height:420px"><canvas id="c-pf-sku" aria-label="Revenue against margin by product"></canvas></div>`, { comp: "pf-sku-scatter" })}
    ${rgSec("SKU margins", `${esc(pfMonth(m))} · Shopify lines of the MIS Sales Dump${gap != null ? ` · they add up to the P&L's net revenue ${Math.abs(gap) < 0.005 ? "exactly" : "within " + pfPct(Math.abs(gap))}` : ""}`, t, { ctl: `<button type="button" class="pf-btn" data-pfcsv="sku">CSV</button>`, comp: "pf-sku" })}
    <p class="legend-note">Bundles are shown as sold (each MIS item is one listing); exploding them into components needs the bundle registry. Units stay on Products: this view is margin only.</p>`;
}

// ---------------------------------------------------------------- inputs, CSV, print
function pfInputs(P) {
  const ic = { provided: ["✓", "good"], estimated: ["◐", "warn"], missing: ["○", "muted"] };
  const items = (P.cost_inputs || []).map((c) => { const [s, cls] = ic[c.state] || ["○", "muted"]; return `<i style="color:var(--${cls})" title="${esc(c.state)}">${s}</i><span><b>${esc(c.name)}</b>${c.detail ? ` <span class="sub">${esc(c.detail)}</span>` : ""}</span>`; }).join("");
  return `<section class="card pf-noprint" data-component="pf-inputs"><div class="sec-head"><h2>Cost inputs</h2><span class="q">what a live (month-to-date) P&L will need; closed months use finance's lines · details on <a href="#health">Data health</a></span></div><div class="pf-check">${items}</div></section>`;
}
function pfCsv(P, what) {
  let rows = [];
  if (what === "pnl") {
    rows.push(["Line", ...P.months.map(pfMonth)]);
    for (const l of P.lines) rows.push([l.name, ...P.months.map((_, j) => { const v = pfAgg(P, l.key, [j], PF.view); return v == null ? "" : PF.view === "pct" ? (v * 100).toFixed(2) : Math.round(v); })]);
  } else {
    const S = (P.skus || {})[P.months[PF.mi]] || { rows: [] };
    rows.push(["Item", "Units", "Net revenue", "COGS", "Gross margin %", "CM1 % (allocated)"]);
    for (const r of S.rows) rows.push([r.item, r.qty, Math.round(r.net_revenue), Math.round(r.cogs), (r.gm_pct * 100).toFixed(2), r.cm1_pct == null ? "" : (r.cm1_pct * 100).toFixed(2)]);
  }
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = `asaya-profitability-${what}-${P.months[PF.mi]}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function pfPrint(P) {
  if (PF.sub !== "month") { PF.sub = "month"; pfDraw(P); }
  document.body.classList.add("pf-printing");
  const done = () => { document.body.classList.remove("pf-printing"); window.removeEventListener("afterprint", done); };
  window.addEventListener("afterprint", done);
  setTimeout(() => window.print(), 250);
}

// ---------------------------------------------------------------- charts
const pfLabels = {
  id: "pfLabels",
  afterDatasetsDraw(chart, _a, opts) {
    const { ctx } = chart, labels = opts && opts.text;
    if (!labels) return;
    ctx.save();
    ctx.font = `11px ${css("--font-body") || "system-ui"}`;
    ctx.fillStyle = css("--ink-2"); ctx.textAlign = opts.align || "center";
    chart.getDatasetMeta(0).data.forEach((bar, j) => {
      const t = labels[j]; if (!t) return;
      const [a, b] = t;
      if (opts.horizontal) { ctx.textBaseline = "middle"; ctx.fillText(a, Math.max(bar.x, bar.base) + 6, bar.y); return; }
      const top = Math.min(bar.y, bar.base);
      ctx.textBaseline = "bottom";
      ctx.fillText(a, bar.x, top - 14); ctx.fillStyle = css("--muted"); ctx.fillText(b, bar.x, top - 2); ctx.fillStyle = css("--ink-2");
    });
    ctx.restore();
  },
};
function pfCharts(P) {
  if (!window.Chart) return;
  const i = PF.mi, el = (id) => document.getElementById(id);
  const sub = css("--pf-sub") || css("--accent"), cost = css("--pf-cost"), est = css("--pf-est");
  const xAxis = { grid: { display: false }, ticks: { color: css("--muted"), font: { size: 11 }, maxRotation: 0, autoSkip: false } };
  if (el("c-pf-wf")) {
    const nr = pfV(P, "net_rev", i) || 0, steps = [], labels = [];
    const push = (name, from, to, kind, st) => { steps.push({ name, from, to, kind, st }); };
    let level = nr;
    push("Net revenue", 0, nr, "sub");
    const groups = [["cogs", ["cogs", "freight"], "gm"], ["fulfilment", ["fees", "packaging", "storage", "logistics"], "cm1"], ["performance", ["ads", "promos", "samples"], "cm2"], ["brand", ["influencer", "agency"], "cm3"]];
    for (const [g, keys, s] of groups) {
      const gname = (P.groups.find((x) => x.key === g) || {}).name || g;
      if (PF.open.has(g)) {
        for (const k of keys) { const v = pfV(P, k, i); if (v == null || Math.abs(v) < 1) continue; push((pfLine(P, k) || {}).name || k, level, level - v, "cost", pfSt(P, k, i)); steps[steps.length - 1].group = g; level -= v; }
      } else {
        const v = keys.reduce((a, k) => a + (pfV(P, k, i) || 0), 0), anyDer = keys.some((k) => pfSt(P, k, i) === "derived");
        push(gname, level, level - v, "cost", anyDer && keys.every((k) => pfSt(P, k, i) === "derived") ? "derived" : null); steps[steps.length - 1].group = g; level -= v;
      }
      const sv = pfV(P, s, i); push((pfLine(P, s) || {}).name || s, 0, sv, "sub"); level = sv;
    }
    for (const s of steps) { const amt = s.kind === "sub" ? s.to : s.from - s.to; labels.push([pfInr(s.kind === "sub" ? amt : -amt), nr ? pfPct(amt / nr) : ""]); }
    baseChart(el("c-pf-wf"), { type: "bar", data: { labels: steps.map((s) => s.name), datasets: [{ label: "₹", data: steps.map((s) => [s.from, s.to]),
      backgroundColor: steps.map((s) => (s.kind === "sub" ? sub : s.st === "derived" ? est : pfColor(cost, 0.55))), borderRadius: 2, borderSkipped: false, maxBarThickness: 46 }] },
      options: { layout: { padding: { top: 32 } }, onClick: (_e, els) => { const s = els[0] && steps[els[0].index]; if (s && s.group) { PF.open.has(s.group) ? PF.open.delete(s.group) : PF.open.add(s.group); pfDraw(P); } },
        plugins: { legend: { display: false }, pfLabels: { text: labels }, tooltip: { callbacks: { label: (c) => { const s = steps[c.dataIndex], amt = s.kind === "sub" ? s.to : s.to - s.from; const lines = [` ${pfInr(amt)} · ${pfPct(amt / nr)} of net revenue`]; if (s.group && !PF.open.has(s.group)) lines.push(" click to open its lines"); if (s.st === "derived") lines.push(" derived from finance's stated figures"); return lines; } } } },
        scales: { x: xAxis, y: { ...axisOpts("inr") } } }, plugins: [pfLabels] }, "inr");
  }
  const bridgeChart = (id, keys, to) => {
    if (!el(id)) return;
    const ci = pfCmpIdx(P, i); if (!ci.length) return;
    const start = pfCmpV(P, to, "pct"), end = pfCur(P, to, "pct");
    const parts = keys.filter((k) => pfLine(P, k)).map((k) => ({ name: (pfLine(P, k) || {}).name, d: -((pfCur(P, k, "pct") ?? 0) - (pfCmpV(P, k, "pct") ?? 0)) }));
    let lv = start; const bars = [{ name: pfCmpLabel(P), from: 0, to: start, sub: true }];
    for (const p of parts) { bars.push({ name: p.name, from: lv, to: lv + p.d, d: p.d }); lv += p.d; }
    bars.push({ name: pfMonth(P.months[i]), from: 0, to: end, sub: true });
    baseChart(el(id), { type: "bar", data: { labels: bars.map((b) => b.name), datasets: [{ label: "pp", data: bars.map((b) => [b.from, b.to]),
      backgroundColor: bars.map((b) => (b.sub ? sub : b.d >= 0 ? pfColor(css("--good"), 0.7) : pfColor(cost, 0.75))), borderRadius: 2, borderSkipped: false, maxBarThickness: 18 }] },
      options: { indexAxis: "y", layout: { padding: { right: 56 } }, plugins: { legend: { display: false }, pfLabels: { horizontal: true, align: "left", text: bars.map((b) => [b.sub ? pfPct(b.to) : pfPp(b.d), ""]) }, tooltip: { callbacks: { label: (c) => { const b = bars[c.dataIndex]; return b.sub ? ` ${pfPct(b.to)}` : ` ${pfPp(b.d)} of net revenue`; } } } },
        scales: { y: { grid: { display: false }, ticks: { color: css("--ink-2"), font: { size: 11.5 } } }, x: { ...axisOpts("pct"), grid: { color: css("--line") } } } }, plugins: [pfLabels] }, "pct");
  };
  bridgeChart("c-pf-b1", ["cogs", "freight", "fees", "packaging", "storage", "logistics"], "cm1");
  bridgeChart("c-pf-b3", ["cogs", "freight", "fees", "packaging", "storage", "logistics", "ads", "promos", "samples", "influencer", "agency"], "cm3");
  if (el("c-pf-ladder")) {
    const labels = P.months.map(pfMonth), lines = [["gm", "Gross margin"], ["cm1", "CM1"], ["cm2", "CM2"], ["cm3", "CM3"]];
    const shades = [css("--pf-sub"), css("--accent"), cost, est];
    const endLabels = { id: "pfEnd", afterDatasetsDraw(chart) { const { ctx } = chart; ctx.save(); ctx.font = "11px system-ui"; ctx.textBaseline = "middle";
      chart.data.datasets.forEach((ds, di) => { if (ds.type !== "line") return; const meta = chart.getDatasetMeta(di), pt = meta.data[meta.data.length - 1]; if (!pt) return; ctx.fillStyle = ds.borderColor; ctx.fillText(`${ds.label} ${pfPct(ds.data[ds.data.length - 1])}`, pt.x + 6, pt.y); }); ctx.restore(); } };
    baseChart(el("c-pf-ladder"), { type: "bar", data: { labels, datasets: [
      { type: "bar", label: "Net revenue", data: P.months.map((_, j) => pfV(P, "net_rev", j)), backgroundColor: pfColor(css("--accent"), 0.18), borderRadius: 2, maxBarThickness: 40, yAxisID: "y" },
      ...lines.map(([k, n], di) => ({ type: "line", label: n, data: P.months.map((_, j) => pfAgg(P, k, [j], "pct")), borderColor: shades[di], backgroundColor: shades[di], pointRadius: 2.5, borderWidth: 2, tension: 0.2, yAxisID: "y1" }))] },
      options: { layout: { padding: { right: 110 } }, plugins: { legend: { display: false } }, scales: { x: xAxis, y: { ...axisOpts("inr"), position: "left" }, y1: { ...axisOpts("pct"), position: "right", grid: { display: false } } } }, plugins: [endLabels] }, "inr");
  }
  if (el("c-pf-sku")) {
    const S = P.skus[P.months[i]], rows = S.rows.filter((r) => r.net_revenue > 0 && r.cm1_pct != null);
    const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };
    const mx = med(rows.map((r) => r.net_revenue)), my = med(rows.map((r) => r.cm1_pct)), umax = Math.max(...rows.map((r) => r.qty), 1);
    const quad = { id: "pfQuad", beforeDatasetsDraw(chart) { const { ctx, chartArea: a, scales: { x, y } } = chart; ctx.save(); ctx.strokeStyle = css("--line"); ctx.setLineDash([4, 4]);
      const px = x.getPixelForValue(mx), py = y.getPixelForValue(my); ctx.beginPath(); ctx.moveTo(px, a.top); ctx.lineTo(px, a.bottom); ctx.moveTo(a.left, py); ctx.lineTo(a.right, py); ctx.stroke();
      ctx.setLineDash([]); ctx.fillStyle = css("--muted"); ctx.font = "11px system-ui"; ctx.textAlign = "right"; ctx.fillText("Scale", a.right - 6, a.top + 12); ctx.fillText("Fix margin", a.right - 6, a.bottom - 6); ctx.textAlign = "left"; ctx.fillText("Grow", a.left + 6, a.top + 12); ctx.fillText("Review", a.left + 6, a.bottom - 6); ctx.restore(); } };
    baseChart(el("c-pf-sku"), { type: "bubble", data: { datasets: [{ label: "Products", data: rows.map((r) => ({ x: r.net_revenue, y: r.cm1_pct, r: 4 + 14 * Math.sqrt(r.qty / umax), item: r.item })), backgroundColor: pfColor(css("--accent"), 0.35), borderColor: css("--accent"), borderWidth: 1 }] },
      options: { interaction: { mode: "nearest", intersect: true }, plugins: { legend: { display: false }, tooltip: { callbacks: { title: (c) => c[0].raw.item, label: (c) => ` ${pfInr(c.raw.x)} · CM1 ${pfPct(c.raw.y)} (allocated)` } } },
        scales: { x: { ...axisOpts("inr"), type: "logarithmic", grid: { color: css("--line") }, ticks: { color: css("--muted"), font: { size: 11 }, autoSkip: false, maxRotation: 0, callback: (v) => { const e = Math.pow(10, Math.floor(Math.log10(v))), m = Math.round(v / e); return [1, 2, 5].includes(m) && Math.abs(v - m * e) < 1e-6 * v ? mCompactInr(v) : ""; } } }, y: { ...axisOpts("pct") } } }, plugins: [quad] }, "inr");
  }
}
function pfColor(c, a) {
  const m = /^#?([0-9a-f]{6})$/i.exec((c || "").trim());
  if (!m) return c;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

// ---------------------------------------------------------------- Data health
function pfHealth(P) {
  if (!P || !(P.versions || []).length) return '<p class="na">Nothing imported yet: upload finance\'s file on the Profitability tab.</p>';
  const v = table([{ label: "Imported", text: true, render: (r) => esc(new Date(r.imported_at).toLocaleString("en-IN")) }, { label: "File", text: true, render: (r) => esc(r.source_name) },
    { label: "Kind", text: true, render: (r) => esc(r.kind === "actuals" ? "channel P&L" : "MIS (COGS, sales dump)") }, { label: "Months", text: true, render: (r) => esc((r.months || []).map(pfMonth).join(", ")) },
    { label: "By", text: true, render: (r) => esc(r.imported_by || "") }], P.versions, { full: true });
  const a = (P.checks.arithmetic || []).length ? table([{ label: "Month", text: true, render: (r) => esc(pfMonth(r.month)) }, { label: "Line", text: true, render: (r) => esc((pfLine(P, r.line) || {}).name || r.line) },
    { label: "Stated", render: (r) => esc(pfRs(r.stated)) }, { label: "Recomputed", render: (r) => esc(pfRs(r.recomputed)) }, { label: "Note", text: true, render: (r) => esc(r.note) }], P.checks.arithmetic, { full: true }) : '<p class="sub">Every subtotal recomputes from its lines.</p>';
  const rc = P.checks.recon || [];
  const r = rc.length ? table([{ label: "Month", text: true, render: (x) => esc(pfMonth(x.month)) }, { label: "Shopify Total sales", render: (x) => esc(pfInr(x.shopify.total_sales)) },
    { label: "− GST", render: (x) => esc(pfInr(x.shopify.taxes)) }, { label: "− Shipping", render: (x) => esc(pfInr(x.shopify.shipping_charges)) }, { label: "= Shopify net sales", render: (x) => esc(pfInr(x.shopify.net_sales)) },
    { label: "Finance net revenue", render: (x) => esc(pfInr(x.pnl_net_rev)) }, { label: "Gap", render: (x) => esc(`${pfInr(x.gap)} (${pfPct(x.gap_pct)})`) }], rc, { full: true }) : `<p class="na">${esc(P.checks.recon_error || "No Shopify comparison yet.")}</p>`;
  const um = (P.checks.unmapped || []).length ? `<p class="na">Website lines the map does not know (kept, not shown on the tab): ${esc(P.checks.unmapped.map((u) => u.line_item).join("; "))}</p>` : "";
  return `<h4>Imports</h4>${v}<h4>Arithmetic: subtotals recomputed from their lines</h4>${a}${um}
    <h4>Finance's net revenue against Shopify</h4>${r}<p class="legend-note">Shopify net sales = gross sales − discounts − returns, ex-GST; Total sales adds GST and shipping. Finance's revenue is net-net: RTO and cancellations are out, so it is lower.</p>
    <p><button type="button" class="pf-btn" id="pf-rebuild">Rebuild the tab</button> <span class="sub">built ${esc(P.built_at ? new Date(P.built_at).toLocaleString("en-IN") : "—")}</span></p>`;
}
document.addEventListener("click", async (ev) => {
  const b = ev.target.closest && ev.target.closest("#pf-rebuild");
  if (!b) return;
  b.disabled = true; b.textContent = "Rebuilding…";
  try { const r = await fetch("/api/pnl/rebuild", { method: "POST", credentials: "same-origin" }); if (!r.ok) throw new Error(`HTTP ${r.status}`); state.pages.profitability = null; b.textContent = "Rebuilt"; }
  catch (e) { b.textContent = `Failed: ${e.message}`; }
});
