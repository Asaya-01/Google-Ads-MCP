/* Funnel (was Daily): "Where in the journey are we losing people?"
   KPI strip → funnel bars → checkout steps (GoKwik) with a status → funnel
   rates by channel → the daily table (funnel columns; the CSV has every
   column) → funnel by source / campaign / landing page. Follows the date
   picker and the header's BAU / Sale switch. Inlined after range_ui.js. */

const FN = { drill: "source" };
const FN_KPIS = ["sessions", "perf_sessions", "atc_rate", "atc_to_ic", "ic_to_order", "cvr", "perf_cvr"];

/* Funnel bars: each step as a share of sessions, the comparison as a marker. */
function fnBars(g) {
  const w = g.w, pw = g.pw;
  const steps = [["sessions", "Sessions"], ["atc", "Added to cart"], ["ic", "Checkout started"], ["orders", "Orders"]];
  const top = w.sessions || 0, ptop = pw ? pw.sessions || 0 : 0;
  return `<div class="fbars">${steps.map(([k, l], i) => {
    const v = w[k], pv = pw ? pw[k] : null;
    const share = top && v != null ? v / top : null, pshare = ptop && pv != null ? pv / ptop : null;
    const prevStep = i ? w[steps[i - 1][0]] : null, pPrevStep = i && pw ? pw[steps[i - 1][0]] : null;
    const rate = i && prevStep ? v / prevStep : null, prate = i && pPrevStep ? pv / pPrevStep : null;
    const width = share == null ? 0 : Math.max(2, Math.sqrt(share) * 100); // square root keeps the small steps visible
    const pwidth = pshare == null ? null : Math.max(2, Math.sqrt(pshare) * 100);
    return `<div class="fbar"><span class="lab">${esc(l)}<b>${esc(mFormat("count", v) ?? "n/a")}</b></span>
      <span class="track"><span class="fill" style="width:${width.toFixed(1)}%"></span>${pwidth == null ? "" : `<span class="prev" style="left:${pwidth.toFixed(1)}%" title="Comparison: ${esc(mFormat("count", pv))}"></span>`}</span>
      <span class="rate">${i ? esc(mFormat("percent", rate) ?? "–") : ""}<small>${i && prate != null ? `was ${esc(mFormat("percent", prate))}` : i ? "" : pw ? "was " + esc(mFormat("count", pv) ?? "–") : ""}</small></span></div>`;
  }).join("")}</div><p class="legend-note">Right: each step's rate from the step before. Bar length is the share of sessions (square-root scale, so small steps stay visible); the dark tick is the comparison.</p>`;
}

/* Checkout steps (GoKwik) for the period, with the same Healthy / Watch /
   Problem rule as the D-1 Report: a step rate that fell by watch_drop is
   Watch, by problem_drop is Problem. */
const FN_CK = [["ic", "Checkout started"], ["gk_address", "Address"], ["gk_payment", "Payment reached"], ["gk_converted", "Converted"]];
function fnCheckout(g) {
  const w = g.w, pw = g.pw, rules = state.config.checkout || {}, wd = rules.watch_drop ?? 0.12, pdp = rules.problem_drop ?? 0.2;
  if (w.ic == null) return `<p class="na">Data unavailable: ${esc(rgNa(w, "ic") || "GoKwik has no funnel for these days")}</p>`;
  let worst = "ok", why = "";
  const rows = FN_CK.map(([k, l], i) => {
    const v = w[k], pv = pw ? pw[k] : null;
    const r = i ? (w[FN_CK[i - 1][0]] ? v / w[FN_CK[i - 1][0]] : null) : null;
    const pr = i && pw ? (pw[FN_CK[i - 1][0]] ? pv / pw[FN_CK[i - 1][0]] : null) : null;
    const drop = r != null && pr ? (pr - r) / pr : null;
    let st = "ok";
    if (drop != null && i) { st = drop >= pdp ? "problem" : drop >= wd ? "watch" : "ok"; }
    const rank = { ok: 0, watch: 1, problem: 2 };
    if (rank[st] > rank[worst]) { worst = st; why = `${FN_CK[i - 1][1]} → ${l} fell to ${mFormat("percent", r)} from ${mFormat("percent", pr)}`; }
    return { l, v, pv, r, pr, st };
  });
  if (!pw) worst = "unknown";
  const word = { ok: "Healthy", watch: "Watch", problem: "Problem", unknown: "No comparison" }[worst];
  const icon = { ok: "✓", watch: "!", problem: "✕", unknown: "–" }[worst];
  const head = `<div class="ck"><span class="ck-pill ${worst}"><i aria-hidden="true">${icon}</i>${word}</span><span class="why">${worst === "ok" ? "Every checkout step is in line with the comparison period." : worst === "unknown" ? "Pick a comparison to judge the steps." : esc(why) + "."}</span></div>`;
  const cols = [
    { label: "Step", text: true, render: (r) => esc(r.l) },
    { label: "Customers", render: (r) => esc(mFormat("count", r.v) ?? "n/a") },
    ...(pw ? [{ label: "Comparison", render: (r) => esc(mFormat("count", r.pv) ?? "–") }] : []),
    { label: "Step rate", render: (r) => esc(mFormat("percent", r.r) ?? "–") },
    ...(pw ? [{ label: "Was", render: (r) => esc(mFormat("percent", r.pr) ?? "–") }, { label: "Δ rate", render: (r) => mPpHtml(r.r != null && r.pr != null ? r.r - r.pr : null, "higher") }] : []),
  ];
  return head + table(cols, rows, { full: true });
}

/* Funnel rates by Shopify last-click channel: rates only (spend and sales live on Marketing). */
function fnCollect(dim, days) {
  const m = new Map(), set = new Set(days || []), src = (state.pages.drill_days || {})[dim];
  for (const r of src ? src.rows : []) {
    if (!set.has(r[0]) || r[2] === 1) continue; // awareness traffic is left out, as everywhere outside Marketing
    const a = m.get(r[1]) || m.set(r[1], { sessions: 0, perf_sessions: 0, atc: 0, ic: 0, orders: 0, gmv: 0, converted: 0 }).get(r[1]);
    a.sessions += r[3]; a.perf_sessions += r[4]; a.atc += r[5]; a.ic += r[6]; a.orders += dim === "landing_page" ? r[9] : r[7]; a.gmv += r[8]; a.converted += r[9];
  }
  return m;
}
function fnRates(g, dim, label) {
  const dd = state.pages.drill_days;
  if (!dd || !dd[dim]) return '<p class="na">Data unavailable: the drill-down data appears after the next refresh.</p>';
  const C = fnCollect(dim, g.cur), P = g.prev && g.prev.length ? fnCollect(dim, g.prev) : new Map();
  // more at a step than the step before means the two are tagged differently (sessions by visit UTM, orders by GoKwik's): no rate
  const rate = (a, b) => (a && b && a <= b ? a / b : null);
  const rows = [...new Set([...C.keys(), ...P.keys()])].map((i) => {
    const c = C.get(i) || {}, p = P.get(i) || {};
    return {
      name: dd[dim].names[i].key || "(unknown)", sessions: c.sessions || 0,
      atc: rate(c.atc, c.sessions), ic: rate(c.ic, c.atc), cvr: rate(c.orders, c.sessions), pfcvr: rate(c.orders, c.perf_sessions),
      patc: rate(p.atc, p.sessions), pic: rate(p.ic, p.atc), pcvr: rate(p.orders, p.sessions), ppfcvr: rate(p.orders, p.perf_sessions),
    };
  }).filter((r) => r.sessions > 0).sort((x, y) => y.sessions - x.sessions).slice(0, 40);
  const has = g.prev && g.prev.length;
  const rc = (k, pk, id, why = "No rate: the two steps are tagged differently for this row") => ({ label: METRICS[id].label, html: true, render: (r) => (r[k] == null ? `<span class="na" title="${esc(why)}">–</span>` : `${esc(mFormat("percent", r[k]))}${has && r[pk] != null ? ` <span class="sub">${mPpHtml(r[k] - r[pk], "higher")}</span>` : ""}`) });
  const cols = [{ label, text: true, render: (r) => `<span class="trunc" title="${esc(r.name)}">${esc(r.name)}</span>` }, { label: "Sessions", render: (r) => esc(mFormat("count", r.sessions)) },
    rc("atc", "patc", "atc_rate"), rc("ic", "pic", "atc_to_ic"), rc("cvr", "pcvr", "cvr"), rc("pfcvr", "ppfcvr", "perf_cvr", "No Perf sessions on this row (not a paid, affiliate or CRM source with a UTM campaign), or more orders than Perf sessions")];
  return table(cols, rows, { full: true, maxHeight: "60vh" });
}

/* The daily table, funnel columns only; the CSV carries every column. */
const FN_COLS = ["date", "phase", "sessions", "perf_sessions", "atc", "ic", "orders", "atc_rate", "atc_to_ic", "cvr", "perf_cvr"];
/* The daily page's columns plus Perf CVR (worked out here from the same days) after CVR. */
function fnColumns(p) {
  const c = p.columns.slice();
  if (!c.some((x) => x.key === "perf_cvr")) { const i = c.findIndex((x) => x.key === "cvr"); c.splice(i < 0 ? c.length : i + 1, 0, { key: "perf_cvr", label: "Perf CVR", unit: "pct" }); }
  return c;
}
function fnDays() {
  const e = RG.eng, days = e.rangeOf(RG.from, RG.to).filter((d) => e.phaseOf(d)).reverse();
  return days.map((d) => {
    const w = e.windowOf([d]), na = {};
    for (const k of Object.keys(RG_DEP)) { const r = rgNa(w, k); if (r) na[k] = r; }
    return { ...w, date: d, phase: e.phaseOf(d), note: e.noteOf(d), na: { ...w.na, ...na } };
  });
}
function fnCsv(p, rows) {
  const cols = fnColumns(p);
  const q = (v) => (v == null ? "" : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const lines = [cols.map((c) => q(c.label)).join(",")].concat(rows.map((r) => cols.map((c) => q(c.key === "date" ? r.date : c.key === "phase" ? r.phase : r[c.key] == null ? "" : Math.round(r[c.key] * 1e4) / 1e4)).join(",")));
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = `asaya-daily-${RG.from}-to-${RG.to}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

R.funnel = (p) => {
  RG.tab = "funnel";
  $main.innerHTML = `<div id="rg-body"><p class="empty">Loading…</p></div>`;
  rgShell(async () => {
    setSub(rgBar()); rgBind();
    try { await loadPage("drill_days"); } catch (err) { /* the channel and drill tables say so */ }
    if (state.tab !== "funnel") return;
    const e = RG.eng, c = e.compare(RG.from, RG.to, RG.cmp), g = rgPick(c);
    const host = document.getElementById("rg-body");
    if (!g) { host.innerHTML = rgNone(); return; }
    const rows = fnDays();
    const cols = fnColumns(p).filter((x) => FN_COLS.includes(x.key)).map((x) => (x.key === "date" ? { label: "Date", text: true, render: (r) => esc(dayLabel(r.date)) }
      : x.key === "phase" ? { label: "Phase", text: true, render: (r) => phaseChip(r.phase, r.note) }
      : { key: x.key, label: (METRICS[x.key === "perf_sessions" ? "perf_sessions" : x.key] || {}).label || x.label, unit: x.unit }));
    const drills = [["source", "Source"], ["campaign", "Campaign"], ["landing_page", "Landing page"]];
    const dseg = `<div class="seg" id="fn-drill" role="group" aria-label="Funnel by">${drills.map(([k, l]) => `<button type="button" data-d="${k}" aria-pressed="${FN.drill === k}">${l}</button>`).join("")}</div>`;
    host.innerHTML = `
      <section class="card" data-component="funnel-kpis"><div class="kpis seven">${FN_KPIS.map((id) => rgKpi(id, g)).join("")}</div></section>
      <div class="cols-2">
        ${rgSec("The funnel", "how many sessions reach each step", fnBars(g), { comp: "funnel-bars" })}
        ${rgSec("Checkout steps", "GoKwik's checkout, step by step, against the comparison", fnCheckout(g), { comp: "checkout-steps" })}
      </div>
      ${rgSec("Funnel rates by channel", "Shopify last click; rates only (spend and sales are on Marketing)", fnRates(g, "channel", "Channel"), { link: rgLink("marketing", "Spend and sales by channel"), comp: "funnel-rates-by-channel" })}
      ${rgSec("Funnel by source, campaign or landing page", "sessions through to orders; pick which", `<div id="fn-drill-body">${fnRates(g, FN.drill, drills.find((d) => d[0] === FN.drill)[1])}</div>`, { ctl: dseg, comp: "funnel-drill" })}
      ${rgSec("Day by day", `${rows.length} day${rows.length === 1 ? "" : "s"}, newest first; hover “n/a” for the reason`, table(cols, rows, { maxHeight: "60vh", full: true }), { ctl: '<button type="button" class="rg-btn" id="fn-csv">Download full daily CSV</button>', comp: "daily-table" })}`;
    document.getElementById("fn-csv").addEventListener("click", () => fnCsv(p, rows));
    document.getElementById("fn-drill").addEventListener("click", (ev) => {
      const b = ev.target.closest("button[data-d]"); if (!b) return;
      FN.drill = b.dataset.d;
      ev.currentTarget.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      document.getElementById("fn-drill-body").innerHTML = fnRates(g, FN.drill, drills.find((d) => d[0] === FN.drill)[1]);
    });
  });
};
