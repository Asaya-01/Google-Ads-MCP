/* The D-1 Report: what management reads every morning. Always yesterday
   against a typical day of the same kind (BAU or sale), with a "This month so
   far" view that keeps the phase rule. Headline → checkout status → funnel →
   channels → Meta stages → what changed; every drill-down is a link to its
   home tab. Inlined after range_basket.js, inside the dashboard closure. */

const D1 = { view: "day" };
const D1_KPIS = ["total_sales", "orders", "aov", "blended_roas", "perf_spend", "cvr"];
const d1Median = (xs) => { const a = xs.filter((v) => v != null && Number.isFinite(v)).sort((x, y) => x - y); if (!a.length) return null; const h = a.length >> 1; return a.length % 2 ? a[h] : (a[h - 1] + a[h]) / 2; };

/* Yesterday, and the same-kind days it is judged against (the D-1 checkout
   status uses the same baseline: same-kind days in the last baseline_days). */
function d1Day(d1) {
  const e = RG.eng, raw = RG.raw, cfg = state.config.checkout || {};
  const i = raw.dates.indexOf(d1);
  let kind = e.phaseOf(d1);
  if (kind === "mixed") kind = (raw.phase_eff && raw.phase_eff[i]) || "bau";
  const N = cfg.baseline_days || 28, minN = cfg.min_baseline_days || 5;
  const base = e.rangeOf(e.addDays(d1, -N), e.addDays(d1, -1)).filter((d) => e.phaseOf(d) === kind);
  const w = e.windowOf([d1]);
  const ok = base.length >= minN;
  const typ = {};
  if (ok) { const per = base.map((d) => e.windowOf([d])); for (const k of Object.keys(w)) if (typeof w[k] === "number" || w[k] === null) typ[k] = d1Median(per.map((x) => x[k])); }
  return { d1, kind, base, ok, w, typ, pooled: ok ? e.windowOf(base) : null };
}
function d1Kpi(id, D) {
  const k = METRICS[id].field, v = D.w[k], t = D.ok ? D.typ[k] : null;
  return kpiCard(id, { value: v, prev: D.ok ? t : null, change: v != null && t ? v / t - 1 : null, small: D.ok && (D.typ.orders ?? 0) < METRIC_RULES.min_orders,
    na: v == null ? rgNa(D.w, k) : null, est: rgEstFor(k, D.w), href: id === "blended_roas" || id === "perf_spend" ? "#marketing" : id === "cvr" ? "#funnel" : null });
}
const D1_CK = { ok: ["Healthy", "✓"], watch: ["Watch", "!"], problem: ["Problem", "✕"], unknown: ["No data", "–"] };
function d1Checkout(pl) {
  if (!pl || !pl.checkout) return '<p class="na">Data unavailable: the checkout status is built with the next refresh.</p>';
  const co = pl.checkout, [word, icon] = D1_CK[co.status] || D1_CK.unknown;
  const steps = table([
    { label: "Step", text: true, render: (r) => `${esc(r.label)}${r.counts ? "" : ' <span class="sub">(context, not in the verdict)</span>'}` },
    { label: "Yesterday", render: (r) => esc(mFormat("percent", r.value) ?? "n/a") },
    { label: "Typical", render: (r) => esc(mFormat("percent", r.baseline) ?? "–") },
    { label: "Change", render: (r) => deltaHtml(r.delta, "rate") },
  ], co.steps);
  return `<div class="ck"><span class="ck-pill ${esc(co.status)}"><i aria-hidden="true">${icon}</i>${word}</span><span class="why">${esc(co.reason)}</span></div>
    <details class="steps"><summary>See the steps</summary>${steps}</details>`;
}
/* Meta by stage: spend and Platform ROAS, against the typical day (or the comparison). */
function d1Stages(gCur, gBase, nBase) {
  const keep = TR.group; TR.group = "funnel";
  let a, b;
  try { a = trBuild(gCur).roots.get("meta"); b = gBase ? trBuild(gBase).roots.get("meta") : null; } finally { TR.group = keep; }
  if (!a) return '<p class="na">Data unavailable: no Meta spend on these days.</p>';
  const nCur = gCur.cur.length || 1;
  const rows = TR_STAGES.map((s) => {
    const n = a.kids.get("st:" + s), m = b ? b.kids.get("st:" + s) : null;
    const spend = n ? n.a.spend : 0, roas = n ? trRoas(n.a) : null;
    const bs = gBase ? (m ? m.a.spend / nBase : 0) : n && n.hasPrev ? n.p.spend : null;
    const br = gBase ? (m ? trRoas(m.a) : null) : n && n.hasPrev ? trRoas(n.p) : null;
    return { s, spend: spend / (gBase ? nCur : 1), bs, roas, br, small: (gBase ? (m ? m.a.pspend : 0) : n ? n.p.pspend : 0) < METRIC_RULES.min_spend };
  }).filter((r) => r.spend > 0 || r.bs);
  const vs = gBase ? "Typical day" : "Comparison";
  return table([
    { label: "Stage", text: true, render: (r) => `<b>${esc(r.s)}</b>` },
    { label: gBase ? "Spend" : "Spend", render: (r) => esc(mFormat("currency", r.spend)) },
    { label: `${vs} spend`, render: (r) => esc(mFormat("currency", r.bs) ?? "–") },
    { label: mHead("meta_platform_roas", "Platform ROAS"), render: (r) => esc(mFormat("ratio", r.roas) ?? "–") },
    { label: `${vs} ROAS`, render: (r) => esc(mFormat("ratio", r.br) ?? "–") },
    { label: "Δ ROAS", render: (r) => (r.roas != null && r.br ? deltaHtml(r.roas / r.br - 1, "roas", r.small) : '<span class="flat">–</span>') },
  ], rows, { full: true }) + `<p class="legend-note">${gBase ? `Typical: the average day across the ${nBase} same-kind days. ` : ""}Platform ROAS is what Meta credits itself; the stage comes from each ad's name.</p>`;
}
function d1Links() {
  const L = [["funnel", "Day by day and funnel drill-downs"], ["products", "Products and basket size"], ["marketing?sub=meta", "Meta: SKU × stage and campaigns"], ["retention", "New vs repeat and cohorts"], ["region", "States and cities"]];
  return `<div class="filter-row"><span class="lbl">More detail</span>${L.map(([t, l]) => `<a class="chip" href="#${t}">${esc(l)} →</a>`).join("")}</div>`;
}
function d1Copy(title, kpis, changed) {
  const lines = [title, ...kpis.map(([l, v, d]) => `• ${l}: ${v}${d ? ` (${d})` : ""}`), ...(changed.length ? ["What changed:", ...changed.map((x) => `• ${x}`)] : [])];
  const text = lines.join("\n");
  const done = () => { const b = document.getElementById("d1-copy"); if (b) { b.textContent = "Copied"; setTimeout(() => { b.textContent = "Copy summary"; }, 1500); } };
  if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, () => window.prompt("Copy the summary:", text)); else window.prompt("Copy the summary:", text);
}
const d1Plain = (html) => { const t = document.createElement("div"); t.innerHTML = html; return t.textContent.replace(/\s+/g, " ").trim(); };

R.d1 = (p) => {
  RG.tab = "d1";
  $main.innerHTML = `<div id="rg-body"><p class="empty">Loading…</p></div>`;
  rgShell(async () => {
    try { for (const pg of ["channel_days", "product_days", "campaign_days", "meta_tree", "google_tree"]) await loadPage(pg); } catch (err) { /* sections say what is missing */ }
    if (state.tab !== "d1") return;
    const e = RG.eng, d1 = p.as_of && e.inData([p.as_of]).length ? p.as_of : e.last;
    const D = d1Day(d1), kw = D.kind === "sale" ? "sale" : "BAU";
    const host = document.getElementById("rg-body");
    let g, sub, kpis, funnelG, stages, changed, recon, ck;
    if (D1.view === "day") {
      g = { cur: [d1], prev: D.ok ? D.base : null, w: D.w, pw: D.ok ? D.pooled : null, phase: D.kind };
      sub = `<b>Report for ${esc(rgFmtDay(d1, true))}</b> <span class="phase-badge" title="${esc(RG_PHASE_RULE)}">${kw} day</span> <span class="rg-dim">${D.ok ? `vs a typical ${kw} day: the median of ${D.base.length} ${kw} days, ${esc(rgListDays(D.base))}` : `too few ${kw} days in the last weeks for a typical day`}</span>`;
      kpis = D1_KPIS.map((id) => d1Kpi(id, D)).join("");
      funnelG = { w: D.w, pw: D.ok ? D.typ : null };
      stages = d1Stages({ cur: [d1], prev: null, w: D.w, pw: null }, D.ok ? { cur: D.base, prev: null, w: D.pooled, pw: null } : null, D.base.length);
      ck = d1Checkout(p.pulse);
    } else {
      const from = e.monthStart(d1), c = e.compare(from, d1, { mode: "month" });
      g = rgPick(c);
      if (!g) { host.innerHTML = rgNone(); return; }
      const seg = c.groups.length > 1 ? `<div class="seg" id="d1-phase" role="group" aria-label="Which days">${c.groups.map((x) => `<button type="button" data-ph="${x.phase}" aria-pressed="${x.phase === MK.phase}">${x.phase === "sale" ? "Sale" : "BAU"} days</button>`).join("")}</div>` : `<span class="phase-badge" title="${esc(RG_PHASE_RULE)}">${g.phase === "sale" ? "Sale vs Sale" : "BAU vs BAU"}</span>`;
      sub = `<b>${esc(rgSpan(from, d1))}</b> ${seg} <span class="rg-dim">${rgVsLine(g)}</span>`;
      kpis = D1_KPIS.map((id) => rgKpi(id, g, { href: id === "blended_roas" || id === "perf_spend" ? "#marketing" : id === "cvr" ? "#funnel" : null })).join("");
      funnelG = g;
      stages = d1Stages(g, null, 0);
      ck = fnCheckout(g);
    }
    changed = rgWhatChanged(g);
    recon = trReconHtml({ cur: g.cur, prev: null, w: g.w, pw: null }, { compact: true, mode: "perf" });
    const viewSeg = `<div class="seg" id="d1-view" role="group" aria-label="Report period"><button type="button" data-v="day" aria-pressed="${D1.view === "day"}">Yesterday</button><button type="button" data-v="mtd" aria-pressed="${D1.view === "mtd"}">This month so far</button></div>`;
    setSub(`<div class="sub-line">${viewSeg} ${sub} <button type="button" class="rg-btn" id="d1-copy" style="margin-left:auto">Copy summary</button></div>`);
    const chHtml = changed.length ? `<ul class="changed">${changed.map((x) => `<li><span class="ic ${x.dir}">${x.dir === "up" ? "▲" : x.dir === "down" ? "▼" : "!"}</span><span>${x.html}</span><a href="${x.link}">${esc(x.lab)} →</a></li>`).join("")}</ul>` : `<p class="na">${g.pw ? "Nothing moved enough to call out." : "No typical day to compare with."}</p>`;
    host.innerHTML = `
      <section class="card" data-component="d1-headline"><div class="kpis six">${kpis}</div></section>
      ${rgSec("What changed", D1.view === "day" ? `yesterday against a typical ${kw} day, biggest movers first` : "against the same dates last month", chHtml, { comp: "d1-what-changed" })}
      <div class="cols-2">
        ${rgSec("Checkout", "GoKwik's checkout steps", ck, { comp: "d1-checkout-status" })}
        ${rgSec("Funnel", "sessions to orders, with step rates", fnBars(funnelG), { comp: "d1-funnel-summary" })}
      </div>
      ${rgSec("Channels", "spend, Platform ROAS and Shopify last-click results, one row per channel", recon, { link: rgLink("marketing", "Full channel table"), comp: "d1-channel-summary" })}
      ${rgSec("Meta by stage", "TOF, MOF, BOF and Catalog: spend and Platform ROAS", stages, { link: rgLink("marketing?sub=meta", "Meta view"), comp: "d1-meta-stages" })}
      ${p.targets ? rgSec("Target vs achieved", "this month against the media plan", rgTargets(p.targets)) : ""}
      <section class="card">${d1Links()}</section>`;
    document.getElementById("d1-view").addEventListener("click", (ev) => { const b = ev.target.closest("button[data-v]"); if (b && b.dataset.v !== D1.view) { D1.view = b.dataset.v; destroyCharts(); R.d1(p); } });
    document.getElementById("d1-phase")?.addEventListener("click", (ev) => { const b = ev.target.closest("button[data-ph]"); if (b) { MK.phase = b.dataset.ph; R.d1(p); } });
    document.getElementById("d1-copy").addEventListener("click", () => {
      const title = D1.view === "day" ? `Asaya D-1 · ${rgFmtDay(d1, true)} (${kw} day) vs a typical ${kw} day` : `Asaya · ${rgSpan(e.monthStart(d1), d1)} vs the same dates last month`;
      const rows = D1_KPIS.map((id) => {
        const k = METRICS[id].field, v = g.w[k], t = D1.view === "day" ? (D.ok ? D.typ[k] : null) : g.pw ? g.pw[k] : null;
        const ch = D1.view === "day" ? (v != null && t ? v / t - 1 : null) : g.pw ? g.change(k) : null;
        return [METRICS[id].label, mVal(id, v, true) ?? "n/a", ch == null ? "" : `${ch >= 0 ? "+" : "−"}${Math.abs(ch * 100).toFixed(1)}%`];
      });
      d1Copy(title, rows, changed.map((x) => d1Plain(x.html)));
    });
  });
};
