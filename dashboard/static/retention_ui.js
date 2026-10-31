/* Retention tab. Inlined into app.html inside the dashboard closure, so it
   shares esc(), fmt(), table(), dayLabel(), the R renderer registry and
   $main with the other tabs. The numbers come from retention_engine.js. */

const RET = {
  eng: null, census: null, A: 0, B: 0, HZ: 90, tab: "brand", code: null, vsel: "all",
  res: [], resV: [], sort: { key: "base", dir: -1 }, meta: null,
};
const RET_TABS = [
  ["brand", "Brand-wide"], ["value", "Revenue & LTV"], ["matrix", "Products compared"], ["journey", "Product journey"],
  ["same", "Buys it again"], ["switch", "Switches to"], ["variants", "Variants & packs"], ["method", "Data & method"],
];
const retTabs = () => RET_TABS.filter(([k]) => k !== "value" || (RET.census && RET.census.has_revenue));
const RET_HZ = [["30 days", 30], ["60 days", 60], ["90 days", 90], ["120 days", 120], ["180 days", 180], ["No limit", null]];
const RET_PRESETS = [["Last 3 months", 91], ["Last 6 months", 182], ["Last 12 months", 365], ["Calendar 2025", "2025"], ["All time", -1]];
const RET_TARGET = { 30: [7, 5], 60: [11, 8], 90: [15, 12], 120: [17, 13], 180: [20, 16], 365: [30, 25] };

const rN = (n) => inGroup.format(n ?? 0);
const rRs = (v) => (v === null || v === undefined ? "—" : "Rs " + inGroup.format(Math.round(v)));
const rPct = (v, d = 1) => (v === null || v === undefined ? "—" : v.toFixed(d) + "%");
const rDays = (v) => (v === null || v === undefined ? "—" : v + "d");
const rPretty = (d) => RET.eng.dayToDate(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const $r = (id) => document.getElementById(id);

async function retLoadCensus() {
  if (embedded && embedded.census) return embedded.census;
  const res = await fetch("/api/retention/census", { credentials: "same-origin" });
  if (!res.ok) {
    let msg = "HTTP " + res.status;
    try { msg = (await res.json()).error || msg; } catch (e) { /* not JSON */ }
    throw new Error(msg);
  }
  return res.json();
}

function retInit() {
  RET.eng = createRetentionEngine(RET.census);
  const e = RET.eng;
  let saved = null;
  try { saved = JSON.parse(sessionStorage.getItem("asaya-ret") || "null"); } catch (err) { /* storage blocked */ }
  RET.B = e.NDAYS;
  RET.A = Math.max(0, e.NDAYS - 365);
  if (saved && saved.built === RET.census.built_at) Object.assign(RET, { A: saved.A, B: saved.B, HZ: saved.HZ, tab: saved.tab, code: saved.code });
  if (!retTabs().some(([k]) => k === RET.tab)) RET.tab = "brand";
}
function retSave() {
  try { sessionStorage.setItem("asaya-ret", JSON.stringify({ built: RET.census.built_at, A: RET.A, B: RET.B, HZ: RET.HZ, tab: RET.tab, code: RET.code })); } catch (e) { /* storage blocked */ }
}

// ---------------------------------------------------------------- building blocks
const rFig = (v, label, note, cls) => `<div class="rfig ${cls || ""}"><div class="rv">${v}</div><div class="rl">${label}</div><div class="rn">${note || ""}</div></div>`;
const rBox = (html, kind) => `<div class="rnote ${kind || "good"}">${html}</div>`;
const rHow = (html) => `<details class="rhow"><summary>How to read this</summary><div>${html}</div></details>`;
function rBars(rows, labelFn, cls) {
  const max = Math.max(...rows.map((r) => r[1]), 1);
  return `<div class="rbars ${cls || ""}">${rows.map((r) => `<div class="rbar"><span class="k">${esc(r[0])}</span><span class="track"><span class="fill" style="width:${Math.max((r[1] / max) * 100, r[1] > 0 ? 3 : 0).toFixed(1)}%"></span></span><span class="v">${labelFn(r)}</span></div>`).join("")}</div>`;
}
function rTable(head, rows, opts = {}) {
  const th = head.map((h, i) => `<th class="${h.n ? "n" : ""}" ${h.sort ? `data-sort="${h.sort}" aria-sort="${RET.sort.key === h.sort ? (RET.sort.dir > 0 ? "ascending" : "descending") : "none"}"` : ""}>${h.sort ? `<button type="button">${esc(h.t)}${RET.sort.key === h.sort ? (RET.sort.dir > 0 ? " ▲" : " ▼") : ""}</button>` : esc(h.t)}</th>`).join("");
  const body = rows.length ? rows.join("") : `<tr><td colspan="${head.length}" class="rempty">${esc(opts.empty || "Nothing to show for this selection.")}</td></tr>`;
  const csv = opts.csv ? `<button type="button" class="rcsv" data-csv="${esc(opts.csv)}">Download CSV</button>` : "";
  return `<div class="rtbl-wrap"><table class="rtbl" ${opts.id ? `id="${opts.id}"` : ""}><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div>${csv}`;
}
const RET_CSV = {};
function rCsv(name, header, rows) { RET_CSV[name] = [header, ...rows]; }
function rDownload(name) {
  const data = RET_CSV[name];
  if (!data) return;
  const csv = data.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = `asaya-retention-${name}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function rRuler(r) {
  const W = 940, H = 130, L = 52, Rr = 34, y = 64, w = W - L - Rr, max = 210, x = (d) => L + (Math.min(d, max) / max) * w;
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="When buyers of ${esc(r.name)} buy it again">`;
  const segs = [[0, 30, "0-30"], [30, 60, "31-60"], [60, 90, "61-90"], [90, max, "90+"]], tot = r.repeat_n || 1;
  for (const [a, b, k] of segs) {
    const n = r.buckets[k], op = n ? 0.2 + 0.65 * (n / tot) : 0.07;
    s += `<rect x="${x(a)}" y="${y - 21}" width="${x(b) - x(a) - 2}" height="42" rx="5" fill="var(--accent)" opacity="${op.toFixed(3)}"/>`;
    if (n) s += `<text x="${(x(a) + x(b)) / 2}" y="${y + 6}" text-anchor="middle" font-size="16" font-weight="700" fill="var(--ink)">${rN(n)}</text>`;
  }
  for (const t of [0, 30, 60, 90, 120, 150, 180]) {
    s += `<line x1="${x(t)}" y1="${y + 21}" x2="${x(t)}" y2="${y + 28}" stroke="var(--axis)" stroke-width="1.5"/>`;
    s += `<text x="${x(t)}" y="${y + 44}" text-anchor="middle" font-size="12.5" fill="var(--muted)">${t === 180 ? "180+" : t}</text>`;
  }
  s += `<text x="${L}" y="${y + 62}" font-size="12.5" fill="var(--muted)">days after the first purchase</text>`;
  if (r.med != null) {
    const mx = x(r.med), e = mx > W - 190;
    s += `<line x1="${mx}" y1="${y - 36}" x2="${mx}" y2="${y + 21}" stroke="var(--ink)" stroke-width="2.5"/><circle cx="${mx}" cy="${y - 36}" r="4" fill="var(--ink)"/>`;
    s += `<text x="${mx + (e ? -10 : 10)}" y="${y - 30}" text-anchor="${e ? "end" : "start"}" font-size="14" font-weight="700" fill="var(--ink)">median ${r.med} days</text>`;
  } else s += `<text x="${L}" y="${y - 30}" font-size="14" fill="var(--muted)">no repeat purchase of this product inside the window</text>`;
  return s + "</svg>";
}
function rFunnel(r) {
  const W = 980, H = 214, L = 20, Rr = 20, w = W - L - Rr, bw = w / 4 - 64, topY = 34, maxH = 110;
  const steps = [["1st order", r.c1], ["2nd order", r.c2], ["3rd order", r.c3], ["4th order", r.c4]];
  const gaps = [r.g12, r.g23, r.g34];
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="How many customers reach the 2nd, 3rd and 4th order">`;
  for (let i = 0; i < 4; i++) {
    const [lab, n] = steps[i], pct = r.c1 ? (100 * n) / r.c1 : 0;
    const h = Math.max(6, maxH * (pct / 100)), x = L + i * (w / 4), y = topY + maxH - h;
    s += `<rect x="${x}" y="${y}" width="${bw}" height="${h}" rx="6" fill="var(--accent)" opacity="${(0.28 + 0.62 * (pct / 100)).toFixed(3)}"/>`;
    s += `<text x="${x + bw / 2}" y="${y - 9}" text-anchor="middle" font-size="17" font-weight="800" fill="var(--ink)">${pct.toFixed(1)}%</text>`;
    s += `<text x="${x + bw / 2}" y="${topY + maxH + 21}" text-anchor="middle" font-size="14" font-weight="600" fill="var(--ink)">${lab}</text>`;
    s += `<text x="${x + bw / 2}" y="${topY + maxH + 40}" text-anchor="middle" font-size="12.5" fill="var(--muted)">${rN(n)} customers</text>`;
    if (i < 3) {
      const cx = x + bw + (w / 4 - bw) / 2, ay = topY + maxH - 14;
      s += `<line x1="${x + bw + 4}" y1="${ay}" x2="${x + w / 4 - 4}" y2="${ay}" stroke="var(--muted)" stroke-width="1.5" stroke-dasharray="3 3"/>`;
      s += `<text x="${cx}" y="${ay - 8}" text-anchor="middle" font-size="13" font-weight="700" fill="var(--accent)">${gaps[i] == null ? "—" : "+" + gaps[i] + "d"}</text>`;
    }
  }
  s += `<text x="${L}" y="${H - 4}" font-size="12.5" fill="var(--muted)">dashed figures: median gap between consecutive orders</text>`;
  return s + "</svg>";
}

// ---------------------------------------------------------------- shell and controls
function retShell(p) {
  RET.meta = p || {};
  $main.innerHTML = `
    <section class="card ret-controls">
      <div class="section-head"><h2>Who to follow</h2><span class="sub" id="r-built"></span></div>
      <div class="ret-row"><div class="ret-lab">Customers acquired in</div><div class="seg" id="r-presets"></div></div>
      <div class="ret-dates">
        <label>From <input type="date" id="r-from"></label>
        <label>To <input type="date" id="r-to"></label>
        <div class="ret-slider"><div class="rail"><div class="railfill" id="r-fill"></div></div>
          <input type="range" id="r-r1" aria-label="Window start"><input type="range" id="r-r2" aria-label="Window end"></div>
      </div>
      <div class="ret-row"><div class="ret-lab">Days each customer gets to come back</div><div class="seg" id="r-hz"></div></div>
      <div class="ret-row ret-picks">
        <label>Product <select id="r-sku"></select></label>
        <label id="r-vwrap">Variant or pack <select id="r-var"></select></label>
      </div>
      <p class="ret-sum" id="r-sum"></p>
      <div class="banner" id="r-warn" hidden></div>
    </section>
    <section class="card" id="r-hero"></section>
    <div class="ret-tabs" role="tablist" id="r-tabs">${retTabs().map(([k, l]) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${RET.tab === k}">${l}</button>`).join("")}</div>
    <section class="card ret-panel" id="r-panel" role="tabpanel"></section>`;
  const e = RET.eng;
  $r("r-presets").innerHTML = RET_PRESETS.map((q, i) => `<button type="button" data-pre="${i}" aria-pressed="false">${q[0]}</button>`).join("");
  $r("r-hz").innerHTML = RET_HZ.map((h, i) => `<button type="button" data-hz="${i}" aria-pressed="false">${h[0]}</button>`).join("");
  for (const id of ["r-r1", "r-r2"]) { const el = $r(id); el.min = 0; el.max = e.NDAYS; el.step = 1; }
  $r("r-from").min = $r("r-to").min = e.iso(e.dayToDate(0));
  $r("r-from").max = $r("r-to").max = e.iso(e.dayToDate(e.NDAYS));
  $r("r-built").textContent = `Customer history to ${rPretty(e.NDAYS)}` + (RET.census.built_at ? ` · built ${new Date(RET.census.built_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : "");

  $r("r-presets").addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-pre]"); if (!b) return;
    const q = RET_PRESETS[+b.dataset.pre];
    if (q[1] === -1) { RET.A = 0; RET.B = e.NDAYS; }
    else if (q[1] === "2025") { RET.A = Math.max(0, e.dateToDay("2025-01-01")); RET.B = e.dateToDay("2025-12-31"); }
    else { RET.B = e.NDAYS; RET.A = Math.max(0, e.NDAYS - q[1]); }
    retSync(true);
  });
  $r("r-hz").addEventListener("click", (ev) => { const b = ev.target.closest("button[data-hz]"); if (!b) return; RET.HZ = RET_HZ[+b.dataset.hz][1]; retSync(true); });
  const r1 = $r("r-r1"), r2 = $r("r-r2");
  r1.addEventListener("input", () => { RET.A = Math.min(+r1.value, RET.B - 6); retSync(false); });
  r2.addEventListener("input", () => { RET.B = Math.max(+r2.value, RET.A + 6); retSync(false); });
  r1.addEventListener("change", () => retRun()); r2.addEventListener("change", () => retRun());
  $r("r-from").addEventListener("change", (ev) => { const d = e.dateToDay(ev.target.value); if (!isNaN(d)) { RET.A = Math.max(0, Math.min(d, RET.B - 6)); retSync(true); } });
  $r("r-to").addEventListener("change", (ev) => { const d = e.dateToDay(ev.target.value); if (!isNaN(d)) { RET.B = Math.min(e.NDAYS, Math.max(d, RET.A + 6)); retSync(true); } });
  $r("r-sku").addEventListener("change", (ev) => { RET.code = ev.target.value; RET.vsel = "all"; retSyncVariants(); });
  $r("r-var").addEventListener("change", (ev) => { RET.vsel = ev.target.value; retRender(); });
  $r("r-tabs").addEventListener("click", (ev) => { const b = ev.target.closest("button[data-tab]"); if (b) retTab(b.dataset.tab); });
  $r("r-panel").addEventListener("click", (ev) => {
    const s = ev.target.closest("th[data-sort]");
    if (s) { const k = s.dataset.sort; RET.sort = { key: k, dir: RET.sort.key === k ? -RET.sort.dir : -1 }; retRender(); return; }
    const row = ev.target.closest("tr[data-code]");
    if (row) { RET.code = row.dataset.code; RET.vsel = "all"; retSyncVariants(); retTab("journey"); window.scrollTo({ top: 0, behavior: "smooth" }); return; }
    const c = ev.target.closest("button[data-csv]"); if (c) rDownload(c.dataset.csv);
  });
}

function retTab(k) {
  RET.tab = k;
  document.querySelectorAll("#r-tabs button").forEach((b) => b.setAttribute("aria-selected", b.dataset.tab === k));
  retSave();
  retRenderPanel();
}

function retSync(recalc) {
  const e = RET.eng;
  if (RET.A > RET.B) [RET.A, RET.B] = [RET.B, RET.A];
  $r("r-r1").value = RET.A; $r("r-r2").value = RET.B;
  $r("r-from").value = e.iso(e.dayToDate(RET.A)); $r("r-to").value = e.iso(e.dayToDate(RET.B));
  $r("r-fill").style.left = (100 * RET.A / e.NDAYS) + "%";
  $r("r-fill").style.width = (100 * (RET.B - RET.A) / e.NDAYS) + "%";
  const days = RET.B - RET.A + 1, months = days / 30.44, hz = RET.HZ;
  document.querySelectorAll("#r-hz button").forEach((b, i) => b.setAttribute("aria-pressed", RET_HZ[i][1] === hz));
  document.querySelectorAll("#r-presets button").forEach((b, i) => {
    const q = RET_PRESETS[i];
    const on = q[1] === -1 ? RET.A === 0 && RET.B === e.NDAYS : q[1] === "2025" ? RET.A === e.dateToDay("2025-01-01") && RET.B === e.dateToDay("2025-12-31") : RET.B === e.NDAYS && RET.A === Math.max(0, e.NDAYS - q[1]);
    b.setAttribute("aria-pressed", on);
  });
  const bE = e.acqEnd(RET.B, hz), trimmed = RET.B - bE;
  let msg = `<b>${rPretty(RET.A)} to ${rPretty(RET.B)}</b> · ${rN(days)} days (${months.toFixed(1)} months). `;
  const w = $r("r-warn");
  w.hidden = true;
  if (hz == null) {
    msg += `No limit: each customer is followed to ${rPretty(e.NDAYS)}, so people acquired recently have had less time to come back. Fine for actuals, not for comparing cohorts.`;
    if (days < 120) { w.hidden = false; w.textContent = "Short window with no limit: most buyers have not had time to come back, so the rate is understated. Pick a number of days instead."; }
  } else if (bE < RET.A) {
    msg += `<b>Nothing to show.</b> Nobody acquired in this range has had a full ${hz} days yet.`;
    w.hidden = false; w.textContent = `No cohort yet: customers acquired ${rPretty(RET.A)} to ${rPretty(RET.B)} need until ${rPretty(RET.A + hz)} to complete ${hz} days, and the history ends ${rPretty(e.NDAYS)}. Pick earlier dates or a shorter horizon.`;
  } else {
    msg += `Each customer is followed for <b>${hz} days from their own first order</b>.` + (trimmed > 0 ? ` The last ${rN(trimmed)} days of the window are left out because those customers have not had ${hz} days yet, so the cohort is <b>${rPretty(RET.A)} to ${rPretty(bE)}</b>.` : " The whole window is fully observable.");
  }
  $r("r-sum").innerHTML = msg;
  retSave();
  if (recalc) retRun();
}

function retRun() {
  const e = RET.eng;
  RET.res = e.compute(RET.A, RET.B, "sku", RET.HZ);
  RET.resV = e.compute(RET.A, RET.B, "variant", RET.HZ);
  const sel = $r("r-sku"), keep = RET.code;
  sel.innerHTML = RET.res.map((r) => `<option value="${esc(r.code)}">${esc(r.name)} · ${rN(r.base)} buyers</option>`).join("");
  const found = RET.res.find((r) => r.code === keep);
  RET.code = found ? keep : RET.res[0] && RET.res[0].code;
  if (RET.code) sel.value = RET.code;
  retSyncVariants();
}
function retSyncVariants() {
  const base = RET.res.find((r) => r.code === RET.code);
  const wrap = $r("r-vwrap"), vsel = $r("r-var");
  if (!base) { wrap.hidden = true; retRender(); return; }
  const vs = RET.resV.filter((r) => r.sku === base.i).sort((p, q) => q.base - p.base);
  if (vs.length < 2) { wrap.hidden = true; RET.vsel = "all"; retRender(); return; }
  wrap.hidden = false;
  vsel.innerHTML = `<option value="all">All variants · ${rN(base.base)} buyers</option>` + vs.map((r) => `<option value="${esc(r.code)}">${esc(RET.eng.VARS[r.i].label)} · ${rN(r.base)} buyers</option>`).join("");
  if (RET.vsel !== "all" && !vs.find((r) => r.code === RET.vsel)) RET.vsel = "all";
  vsel.value = RET.vsel;
  retRender();
}

// ---------------------------------------------------------------- hero
function retCurrent() {
  const base = RET.res.find((x) => x.code === RET.code);
  const r = RET.vsel !== "all" ? RET.resV.find((x) => x.code === RET.vsel) : base;
  return { base, r };
}
function retRender() {
  retHero();
  retRenderPanel();
}
function retHero() {
  const e = RET.eng, hz = RET.HZ, host = $r("r-hero");
  const { r } = retCurrent();
  const bE = e.acqEnd(RET.B, hz);
  if (bE < RET.A) { host.innerHTML = `<div class="section-head"><h2>No cohort in this range</h2><span class="rbadge warn">Not enough elapsed time</span></div><p class="na">Customers acquired ${rPretty(RET.A)} to ${rPretty(RET.B)} have not had a full ${hz} days to come back yet.</p>`; return; }
  if (!r) { host.innerHTML = `<div class="section-head"><h2>No data in this window</h2></div>`; return; }
  const days = RET.B - RET.A + 1;
  host.innerHTML = `
    <div class="section-head"><h2>${esc(r.name)}</h2>
      <div class="rbadges"><span class="rbadge">${rN(r.allBuyers)} bought it</span><span class="rbadge">${rN(r.newToBrand)} new to Asaya</span><span class="rbadge">${rN(r.base)} new to this product</span><span class="rbadge">${rN(r.repeat_n)} bought it again · ${rN(r.cross_n)} switched</span>${days < 120 ? '<span class="rbadge warn">Short window</span>' : ""}${r.monthsLive < 4 ? `<span class="rbadge warn">First sold ${rPretty(r.first)}</span>` : ""}</div></div>
    <div class="ruler">${rRuler(r)}</div>
    <div class="rwho">
      <div><div class="rv">${rN(r.allBuyers)}</div><div class="rl">All buyers</div><div class="rn">Everyone who bought ${esc(r.name)} in the window.</div></div>
      <div><div class="rv">${rN(r.newToBrand)}</div><div class="rl">New to Asaya</div><div class="rn">Their very first order with the brand.</div></div>
      <div><div class="rv">${rN(r.newToProduct)}</div><div class="rl">New to this product</div><div class="rn">First time buying it; ${rN(r.crossSell)} had bought Asaya before. Every rate here is built on this group.</div></div>
    </div>
    <div class="rfigs">
      ${rFig(rPct(r.rate, 2), hz != null ? `Bought it again within ${hz} days` : "Bought it again", `${rN(r.repeat_n)} of ${rN(r.base)} buyers`)}
      ${rFig(rPct(r.m90_rate, 2), "Bought it again within 90 days", `only the ${rN(r.m90_base)} buyers who had 90 days to do so`)}
      ${rFig(rDays(r.med), "Median gap", hz != null ? `capped at ${hz} days by the horizon` : "half of repeat buyers return sooner")}
      ${rFig(rDays(r.avg), "Average gap", hz != null ? `also capped at ${hz} days` : "pulled later by a long tail")}
    </div>`;
}

function retRenderPanel() {
  const host = $r("r-panel"), e = RET.eng;
  if (e.acqEnd(RET.B, RET.HZ) < RET.A && RET.tab !== "method") { host.innerHTML = `<p class="na">No cohort in this range. Pick earlier dates or a shorter horizon above.</p>`; return; }
  const fn = { brand: retBrand, value: retValue, matrix: retMatrix, journey: retJourney, same: retSame, switch: retSwitch, variants: retVariants, method: retMethod }[RET.tab];
  host.innerHTML = fn();
}

// ---------------------------------------------------------------- panels
function retBrand() {
  const e = RET.eng, x = e.computeBrand(RET.A, RET.B, RET.HZ), T = x.n[1], hz = RET.HZ;
  const p = (i) => (T ? (100 * x.n[i]) / T : 0);
  const days = RET.B - RET.A + 1, mo = days / 30.44;
  const winLab = hz != null ? `${hz}-day repeat rate` : mo >= 11.5 && mo <= 12.5 ? "12-month repeat rate" : mo >= 5.5 && mo <= 6.5 ? "6-month repeat rate" : mo >= 2.5 && mo <= 3.5 ? "3-month repeat rate" : mo >= 1.5 ? Math.round(mo) + "-month repeat rate" : days + "-day repeat rate";
  const useHz = hz != null && x.cb[hz];
  const winRate = useHz ? (100 * x.ch[hz]) / x.cb[hz] : T ? (100 * x.n[2]) / T : 0;
  const winBase = useHz ? x.cb[hz] : T, winHit = useHz ? x.ch[hz] : x.n[2];
  const tgt = hz != null ? RET_TARGET[hz] || [15, 12] : mo >= 11.5 ? [30, 25] : mo >= 5.5 ? [20, 16] : mo >= 2.5 ? [15, 12] : [7, 5];
  let HZ2 = null;
  for (const h of [365, 180, 90, 60, 30]) if (x.cb[h] >= 500 && h <= days) { HZ2 = h; break; }
  const hzRate = HZ2 ? (100 * x.ch[HZ2]) / x.cb[HZ2] : null, ht = HZ2 ? RET_TARGET[HZ2] : [0, 0];
  const cls = (v, t) => (v >= t[0] ? "good" : v < t[1] ? "bad" : "");
  const figs = [
    rFig(winRate.toFixed(1) + "%", winLab, `${rN(winHit)} of ${rN(winBase)} customers` + (hz != null ? ` came back within ${hz} days of their own first order` : ` ordered again by ${rPretty(e.NDAYS)}`), cls(winRate, tgt)),
    rFig(hzRate == null ? "—" : hzRate.toFixed(1) + "%", HZ2 ? `Repeat within ${HZ2} days` : "Like-for-like rate", HZ2 ? `only the ${rN(x.cb[HZ2])} customers who had a full ${HZ2} days` : "window too short for a like-for-like cohort", hzRate != null ? cls(hzRate, ht) : ""),
    rFig(p(3).toFixed(2) + "%", "Reach 3 or more orders", `${rN(x.n[3])} of ${rN(T)} customers`, p(3) >= 8 ? "good" : "bad"),
    rFig(x.g12 == null ? "—" : x.g12 + "d", "Median days to the 2nd order", "across everyone who returns"),
  ].join("");
  const curve = x.H.map((h) => [`by day ${h}`, x.cb[h] ? (100 * x.ch[h]) / x.cb[h] : 0]);
  rCsv("brand-curve", ["Day", "Repeat rate %", "Customers repeated", "Cohort size"], x.H.map((h) => [h, x.cb[h] ? ((100 * x.ch[h]) / x.cb[h]).toFixed(2) : "", x.ch[h], x.cb[h]]));
  const bl = { 1: "1 product", 2: "2 products", 3: "3 or more products" };
  const [one, two, three] = [x.bs[1], x.bs[2], x.bs[3]], tot1 = one[0] + two[0] + three[0];
  let sum = `<b>Summary.</b> ${rN(T)} customers acquired in this window. ${rN(x.n[2])} placed a 2nd order (${p(2).toFixed(1)}%), ${rN(x.n[3])} reached a 3rd (${p(3).toFixed(2)}%), ${rN(x.n[4])} a 4th (${p(4).toFixed(2)}%). Median gap to the 2nd order is ${x.g12 == null ? "—" : x.g12 + " days"}${x.g23 != null ? `, then ${x.g23} days to the 3rd` : ""}. `;
  sum += `Over this ${mo >= 1.5 ? mo.toFixed(1) + "-month" : days + "-day"} window the repeat rate is <b>${winRate.toFixed(1)}%</b>. `;
  if (HZ2) sum += `On a like-for-like ${HZ2}-day runway it is ${hzRate.toFixed(1)}% across ${rN(x.cb[HZ2])} customers. `;
  if (tot1 && one[0] && two[0] && three[0]) sum += `First orders split ${((100 * one[0]) / tot1).toFixed(0)}% single-product, ${((100 * two[0]) / tot1).toFixed(0)}% two, ${((100 * three[0]) / tot1).toFixed(0)}% three or more, repeating at ${((100 * one[1]) / one[0]).toFixed(1)}%, ${((100 * two[1]) / two[0]).toFixed(1)}% and ${((100 * three[1]) / three[0]).toFixed(1)}% within 90 days.`;
  let act = `<b>Insight and action.</b> `;
  if (mo >= 11.5 && mo <= 12.5) act += `Against a like-for-like D2C benchmark (category 15-20%, best-in-class 30-35% at this revenue stage) Asaya sits ${winRate >= 30 ? "at parity" : (30 - winRate).toFixed(0) + "-" + (35 - winRate).toFixed(0) + " points short"}. `;
  act += `${(100 - p(2)).toFixed(1)}% of customers never place a second order, so the retention problem is the first repeat, not depth. `;
  if (one[0] && three[0] && one[1] && tot1) act += `Basket size at first order is the strongest controllable lever in this data: three-plus baskets repeat ${((100 * three[1]) / three[0] / ((100 * one[1]) / one[0])).toFixed(1)}x better than single-product ones, yet ${((100 * one[0]) / tot1).toFixed(0)}% of first orders are still a single product. Push bundles at first checkout before spending anything on win-back. `;
  if (x.g12 != null) act += `Trigger the first retention touch around day ${Math.max(7, Math.round(x.g12 * 0.8))}, ahead of the ${x.g12}-day median.`;
  rCsv("brand-basket", ["First order contained", "Customers", "Repeat in 90 days %"], [1, 2, 3].map((z) => [bl[z], x.bs[z][0], x.bs[z][0] ? ((100 * x.bs[z][1]) / x.bs[z][0]).toFixed(2) : ""]));
  return `
    <h3>Every customer, whatever they bought first</h3>
    <p class="rsub">The whole customer base, not one product: how many people who ever buy from Asaya come back, how fast, and how deep they go. Use this number to benchmark against other D2C brands.</p>
    <div class="rfigs">${figs}</div>
    <div class="rfunnel">${rFunnel({ c1: x.n[1], c2: x.n[2], c3: x.n[3], c4: x.n[4], g12: x.g12, g23: x.g23, g34: x.g34 })}</div>
    <h4>Cumulative repeat curve</h4>
    <p class="rsub">Share of customers who had placed a 2nd order by each milestone. Each row counts only customers who had that much time before the history ends, so the rows are directly comparable.</p>
    ${rBars(curve, (r) => r[1].toFixed(2) + "%")}
    ${rTable([{ t: "By day" }, { t: "Repeat rate", n: 1 }, { t: "Customers repeated", n: 1 }, { t: "Cohort size", n: 1 }], x.H.map((h) => `<tr><td>${h} days</td><td class="n">${x.cb[h] ? ((100 * x.ch[h]) / x.cb[h]).toFixed(2) + "%" : "—"}</td><td class="n">${rN(x.ch[h])}</td><td class="n">${rN(x.cb[h])}</td></tr>`), { csv: "brand-curve" })}
    <h4>First-order basket size against 90-day repeat</h4>
    <p class="rsub">How many different products were in the very first order.</p>
    ${rTable([{ t: "First order contained" }, { t: "Customers", n: 1 }, { t: "Repeat in 90 days", n: 1 }], [1, 2, 3].map((z) => `<tr><td>${bl[z]}</td><td class="n">${rN(x.bs[z][0])}</td><td class="n">${x.bs[z][0] ? ((100 * x.bs[z][1]) / x.bs[z][0]).toFixed(2) + "%" : "—"}</td></tr>`), { csv: "brand-basket" })}
    ${rBox(sum + "<br><br>" + act)}`;
}

function retValue() {
  const e = RET.eng, v = e.computeValue(RET.A, RET.B, RET.HZ);
  if (v.empty) return `<h3>Revenue and lifetime value</h3><p class="na">No customers acquired in this window.</p>`;
  const L = (h) => v.ltv.find((q) => q.h === h) || {};
  const l90 = L(90), l365 = L(365), l180 = L(180);
  const hz = RET.HZ;
  const figs = [
    rFig(rRs(v.firstAov), "First-order value", `average across ${rN(v.cust)} new customers`),
    rFig(rRs(v.repAov), "Repeat-order value", `${rN(v.repOrders)} repeat orders${hz != null ? ` within ${hz} days` : ""}`),
    rFig(rRs(l90.per), "Value per customer at 90 days", l90.n ? `${rN(l90.n)} ${l90.n === 1 ? "customer" : "customers"} with a full 90 days` : "no cohort has had 90 days yet"),
    rFig(rRs(l365.per), "Value per customer at 12 months", l365.n ? `${rN(l365.n)} ${l365.n === 1 ? "customer" : "customers"} with a full year` : "no cohort has had a year yet"),
  ].join("");
  const curve = v.ltv.filter((q) => q.n).map((q) => [`by day ${q.h}`, q.per]);
  rCsv("value-ltv", ["Day", "Value per customer Rs", "First order Rs", "Multiple of first order", "Cohort"], v.ltv.map((q) => [q.h, q.per == null ? "" : Math.round(q.per), q.first == null ? "" : Math.round(q.first), q.lift == null ? "" : q.lift.toFixed(2), q.n]));
  const ltvTbl = rTable([{ t: "By day" }, { t: "Value per customer", n: 1 }, { t: "of which first order", n: 1 }, { t: "Multiple", n: 1 }, { t: "Cohort", n: 1 }], v.ltv.map((q) => `<tr><td>${q.h} days</td><td class="n">${q.n ? `<b>${rRs(q.per)}</b>` : "—"}</td><td class="n">${rRs(q.first)}</td><td class="n">${q.lift == null ? "—" : q.lift.toFixed(2) + "x"}</td><td class="n">${rN(q.n)}</td></tr>`), { csv: "value-ltv" });
  const bl = { 1: "1 product", 2: "2 products", 3: "3 or more products" };
  rCsv("value-size", ["First order contained", "Customers", "First-order value Rs", "Value at 90 days Rs"], v.size.map((q) => [bl[q.z], q.n, q.first == null ? "" : Math.round(q.first), q.ltv90 == null ? "" : Math.round(q.ltv90)]));
  const sizeTbl = rTable([{ t: "First order contained" }, { t: "Customers", n: 1 }, { t: "First-order value", n: 1 }, { t: "Value at 90 days", n: 1 }], v.size.map((q) => `<tr><td>${bl[q.z]}</td><td class="n">${rN(q.n)}</td><td class="n">${rRs(q.first)}</td><td class="n">${rRs(q.ltv90)}</td></tr>`), { csv: "value-size" });
  const months = e.computeMonthly(RET.A, RET.B);
  rCsv("value-monthly", ["Month", "New customers", "First-order value Rs", "Repeat in 90 days %", "30d Rs", "90d Rs", "180d Rs", "365d Rs"], months.map((m) => [m.label, m.n, m.aov == null ? "" : Math.round(m.aov), m.again90 == null ? "" : m.again90.toFixed(2), ...m.ltv.filter((q) => [30, 90, 180, 365].includes(q.h)).map((q) => (q.per == null ? "" : Math.round(q.per)))]));
  const cellv = (q) => (q.per == null ? '<td class="n na-cell">—</td>' : `<td class="n">${rRs(q.per)}</td>`);
  const monthTbl = rTable([{ t: "Month acquired" }, { t: "New customers", n: 1 }, { t: "First order", n: 1 }, { t: "Repeat in 90d", n: 1 }, { t: "30 days", n: 1 }, { t: "90 days", n: 1 }, { t: "180 days", n: 1 }, { t: "12 months", n: 1 }],
    months.map((m) => `<tr><td>${esc(m.label)}</td><td class="n">${rN(m.n)}</td><td class="n">${rRs(m.aov)}</td><td class="n">${rPct(m.again90)}</td>${m.ltv.filter((q) => [30, 90, 180, 365].includes(q.h)).map(cellv).join("")}</tr>`), { csv: "value-monthly", empty: "No months in this window." });
  const pv = e.computeProductValue(RET.A, RET.B).filter((r) => r.n >= 300);
  const keys = ["name", "n", "aov", "ltv90", "ltv180", "ltv365"];
  const sk = keys.includes(RET.sort.key) ? RET.sort.key : "n", sd = keys.includes(RET.sort.key) ? RET.sort.dir : -1;
  const pval = (r) => (sk === "name" ? r.name : r[sk] == null ? -1 : r[sk]);
  pv.sort((p, q) => (typeof pval(p) === "string" ? pval(p).localeCompare(pval(q)) : pval(p) - pval(q)) * sd);
  rCsv("value-products", ["Acquired on", "Customers", "First order Rs", "90d Rs", "180d Rs", "12m Rs"], pv.map((r) => [r.name, r.n, Math.round(r.aov), r.ltv90 == null ? "" : Math.round(r.ltv90), r.ltv180 == null ? "" : Math.round(r.ltv180), r.ltv365 == null ? "" : Math.round(r.ltv365)]));
  const hd = (t, k) => ({ t, sort: k, n: k !== "name" ? 1 : 0 });
  const prodTbl = rTable([hd("Acquired on", "name"), hd("Customers", "n"), hd("First order", "aov"), hd("90 days", "ltv90"), hd("180 days", "ltv180"), hd("12 months", "ltv365")],
    pv.map((r) => `<tr class="click" data-code="${esc(r.code)}" tabindex="0" title="Open the journey for ${esc(r.name)}"><td>${esc(r.name)}</td><td class="n">${rN(r.n)}</td><td class="n">${rRs(r.aov)}</td><td class="n">${rRs(r.ltv90)}</td><td class="n">${rRs(r.ltv180)}</td><td class="n">${rRs(r.ltv365)}</td></tr>`), { csv: "value-products", empty: "No product has 300 or more acquisitions in this window." });
  const ranked = pv.filter((r) => r.ltv90 != null).sort((p, q) => q.ltv90 - p.ltv90);
  let sum = `<b>Summary.</b> ${rN(v.cust)} new customers in this window spent an average of <b>${rRs(v.firstAov)}</b> on their first order. `;
  if (v.repAov != null) sum += `Repeat orders average ${rRs(v.repAov)}${v.repShare != null ? `, and repeat orders make up ${v.repShare.toFixed(0)}% of the revenue these customers brought in${hz != null ? ` within ${hz} days` : ""}` : ""}. `;
  if (l90.n) sum += `By day 90 a customer is worth ${rRs(l90.per)} (${l90.lift.toFixed(2)}x their first order)${l365.n ? `, and ${rRs(l365.per)} by 12 months (${l365.lift.toFixed(2)}x)` : ""}.`;
  let act = "<b>Insight and action.</b> ";
  if (l90.n) act += `Everything above first-order value is retention revenue: ${rRs(l90.per - l90.first)} per customer in the first 90 days. Set the allowable acquisition cost against ${rRs(l90.per)}, not against the first order alone. `;
  const one = v.size[0], three = v.size[2];
  if (one.ltv90 && three.ltv90 && three.n) act += `Customers whose first basket held 3 or more products are worth ${rRs(three.ltv90)} at 90 days against ${rRs(one.ltv90)} for single-product baskets (${(three.ltv90 / one.ltv90).toFixed(1)}x). `;
  if (ranked.length > 1) act += `Among products with enough customers, ${esc(ranked[0].name)} brings in the most valuable customers (${rRs(ranked[0].ltv90)} at 90 days) and ${esc(ranked[ranked.length - 1].name)} the least (${rRs(ranked[ranked.length - 1].ltv90)}). `;
  act += "Monthly cohorts show a dash until they have had the full time, so a recent month is never compared on a horizon it has not reached.";
  return `
    <h3>What a customer is worth</h3>
    <p class="rsub">Order value is what the customer paid for the whole order: every line after discounts, with shipping and tax, the same basis as Shopify's Total sales (September 2026 matches within 0.5%). A customer's value within a number of days counts their first order and everything after it. Only customers who have had the full number of days are counted.</p>
    <div class="rfigs">${figs}</div>
    <h4>Value per customer over time</h4>
    ${curve.length ? rBars(curve, (r) => rRs(r[1])) : ""}
    ${ltvTbl}
    <h4>First-order basket size against value</h4>
    ${sizeTbl}
    <h4>Monthly cohorts</h4>
    <p class="rsub">Each row is everyone first ordering in that month. A dash means the month has not yet had that long.</p>
    ${monthTbl}
    <h4>Value by the product a customer was acquired on</h4>
    <p class="rsub">The first order's revenue is shared by every product in that basket, so a product in a bundle sees the whole order. Click a column to sort, a row to open the journey.</p>
    ${prodTbl}
    ${rBox(sum + "<br><br>" + act)}`;
}

function retMatrix() {
  const rows0 = RET.res.filter((r) => r.miles && r.miles[0] && r.miles[0].base >= 1000);
  if (!rows0.length) return `<h3>Every product, side by side</h3><p class="na">Not enough runway in this window: a product needs at least 1,000 acquisitions with 30 days to come back.</p>`;
  const key = RET.sort.key, dir = RET.sort.dir;
  const val = (r) => key === "name" ? r.name : key === "base" ? r.miles[0].base : key === "any" ? (r.late && r.late.base ? r.late.anyRate : -1) : (r.miles[+key] && r.miles[+key].rate != null ? r.miles[+key].rate : -1);
  const rows = rows0.slice().sort((p, q) => (typeof val(p) === "string" ? val(p).localeCompare(val(q)) : val(p) - val(q)) * dir);
  const vals = rows0.map((r) => (r.miles[2] && r.miles[2].rate != null ? r.miles[2].rate : 0));
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const cell = (m, heat) => {
    if (!m || !m.base) return "<td class=\"n\">—</td>";
    let bg = "";
    if (heat && hi > lo) bg = `background:color-mix(in srgb, var(--accent) ${(8 + 34 * ((m.rate - lo) / (hi - lo))).toFixed(0)}%, transparent);`;
    return `<td class="n"><span class="hm" style="${bg}"><b>${m.rate.toFixed(1)}%</b><span class="abs">${rN(m.hit)}</span></span></td>`;
  };
  const body = rows.map((r) => {
    const L = r.late;
    return `<tr class="click" data-code="${esc(r.code)}" tabindex="0" title="Open the journey for ${esc(r.name)}"><td>${esc(r.name)}</td><td class="n">${rN(r.miles[0].base)}</td>${r.miles.map((m, i) => cell(m, i === 2)).join("")}${L && L.base ? `<td class="n"><span class="hm"><b>${L.anyRate.toFixed(1)}%</b><span class="abs">${rN(L.any)}</span></span></td>` : '<td class="n">—</td>'}</tr>`;
  });
  rCsv("matrix", ["Acquired on", "Acquired", "30d %", "60d %", "90d %", "120d %", "180d %", "Any time %"], rows.map((r) => [r.name, r.miles[0].base, ...r.miles.map((m) => (m.rate == null ? "" : m.rate.toFixed(2))), r.late && r.late.base ? r.late.anyRate.toFixed(2) : ""]));
  const best = rows0.slice().sort((p, q) => (q.miles[2] ? q.miles[2].rate : 0) - (p.miles[2] ? p.miles[2].rate : 0))[0];
  const worst = rows0.slice().sort((p, q) => (p.miles[2] ? p.miles[2].rate : 0) - (q.miles[2] ? q.miles[2].rate : 0))[0];
  const big = rows0.slice().sort((p, q) => q.miles[0].base - p.miles[0].base)[0];
  const tot = rows0.reduce((p, q) => p + q.miles[0].base, 0);
  const note = `<b>Summary.</b> Across ${rows0.length} products and ${rN(tot)} acquisitions with at least 30 days to come back, 90-day repeat ranges from <b>${best.miles[2].rate.toFixed(1)}%</b> (${esc(best.name)}) down to <b>${worst.miles[2].rate.toFixed(1)}%</b> (${esc(worst.name)}). The product you acquire most is ${esc(big.name)}: ${rN(big.miles[0].base)} customers, ${big.miles[2].rate.toFixed(1)}% by day 90.<br><br><b>Insight and action.</b> ` +
    (big.miles[2].rate < best.miles[2].rate * 0.75 ? `The product you acquire most on converts well below the best in the range: a customer acquired on ${esc(best.name)} is worth ${(best.miles[2].rate / big.miles[2].rate).toFixed(1)}x one acquired on ${esc(big.name)} on repeat alone. Shifting acquisition mix moves the brand rate more than any CRM sequence can. ` : `Acquisition mix is reasonably balanced against repeat quality, so the gains here are in timing and basket size rather than which product you acquire on. `) +
    `Read the absolute numbers beside each percentage: a high rate on a small base is a hypothesis, not a plan.`;
  const head = [{ t: "Acquired on", sort: "name" }, { t: "Acquired", sort: "base", n: 1 }, ...[30, 60, 90, 120, 180].map((h, i) => ({ t: h + "d", sort: String(i), n: 1 })), { t: "Any time", sort: "any", n: 1 }];
  return `
    <h3>Every product, side by side</h3>
    <p class="rsub">Each row is the product a customer was <em>acquired</em> on. Each column is the share who had come back for <em>anything</em> from Asaya by that day. Click a column to sort, click a row to open that product's journey.</p>
    ${rHow("Every column keeps its own equal-time cohort: a customer only counts once they have actually had that many days, which is why the cohort gets smaller as you move right. The small grey number is how many customers came back. The shading compares products on the 90-day column.")}
    ${rTable(head, body, { id: "r-matrix", csv: "matrix" })}
    ${rBox(note)}`;
}

function retJourney() {
  const { r } = retCurrent();
  if (!r) return `<p class="na">No data for this product in the window.</p>`;
  const hz = RET.HZ, rr = r.c1 ? (100 * r.c2) / r.c1 : 0, three = r.c1 ? (100 * r.c3) / r.c1 : 0, py = r.perYear;
  const figs = [
    rFig(rr.toFixed(1) + "%", hz != null ? `Come back within ${hz} days` : "Come back at all", `${rN(r.c2)} of ${rN(r.c1)} buyers placed a 2nd order` + (hz != null ? ` inside ${hz} days` : " for anything"), rr >= 30 ? "good" : rr < 15 ? "bad" : ""),
    rFig(py == null ? "—" : py.toFixed(2), "Orders a year", `average over the first 12 months, across the ${rN(r.yrBase)} buyers with a full year`, py != null && py >= 3 ? "good" : py != null && py < 2 ? "bad" : ""),
    rFig(three.toFixed(1) + "%", "Reach 3 or more orders", "the share that hits a 3-4 orders a year pace", three >= 12 ? "good" : three < 5 ? "bad" : ""),
    rFig(rDays(r.g12), "Median days to the 2nd order", "when to fire the next-order prompt"),
  ].join("");
  let prev = 0;
  const mrows = [];
  for (const m of r.miles) {
    if (!m.base) { mrows.push(`<tr><td>${m.h} days</td><td class="n">—</td><td class="n">—</td><td class="n">—</td><td class="n">0</td></tr>`); continue; }
    mrows.push(`<tr><td>${m.h} days</td><td class="n"><b>${m.rate.toFixed(2)}%</b></td><td class="n">${prev ? "+" + (m.rate - prev).toFixed(2) + " pts" : "—"}</td><td class="n">${rN(m.hit)}</td><td class="n">${rN(m.base)}</td></tr>`);
    prev = m.rate;
  }
  const L = r.late;
  if (L.base) {
    mrows.push(`<tr><td>After 180 days</td><td class="n">${L.rate.toFixed(2)}%</td><td class="n">+${L.rate.toFixed(2)} pts</td><td class="n">${rN(L.hit)}</td><td class="n">${rN(L.base)}</td></tr>`);
    mrows.push(`<tr><td><b>Any time</b></td><td class="n"><b>${L.anyRate.toFixed(2)}%</b></td><td class="n">—</td><td class="n">${rN(L.any)}</td><td class="n">${rN(L.base)}</td></tr>`);
  }
  rCsv("journey-milestones", ["By", "Repeat rate %", "Customers repeated", "Cohort with runway"], r.miles.map((m) => [m.h + " days", m.rate == null ? "" : m.rate.toFixed(2), m.hit, m.base]));
  rCsv("journey-second", ["Product on 2nd order", "% of returners", "Median days", "Customers"], r.p2.map((q) => [q.name, q.share.toFixed(1), q.med ?? "", q.n]));
  const second = r.p2.length ? rBars(r.p2.map((q) => [q.name, q.share]), (q) => q[1].toFixed(1) + "%") +
    rTable([{ t: "#" }, { t: "Product on 2nd order" }, { t: "% of returners", n: 1 }, { t: "Median days", n: 1 }, { t: "Customers", n: 1 }], r.p2.map((q, i) => `<tr><td class="rank">${i + 1}</td><td>${esc(q.name)}${q.code === r.code ? " <b>(same product)</b>" : ""}</td><td class="n">${q.share.toFixed(1)}%</td><td class="n">${q.med == null ? "—" : q.med}</td><td class="n">${rN(q.n)}</td></tr>`), { csv: "journey-second" })
    : '<p class="na">No second orders in this window.</p>';
  const third = r.p3.length ? rTable([{ t: "#" }, { t: "Product on 3rd order" }, { t: "% of 3rd-order customers", n: 1 }, { t: "Customers", n: 1 }], r.p3.map((q, i) => `<tr><td class="rank">${i + 1}</td><td>${esc(q.name)}${q.code === r.code ? " <b>(same product)</b>" : ""}</td><td class="n">${q.share.toFixed(1)}%</td><td class="n">${rN(q.n)}</td></tr>`)) : '<p class="na">No third orders in this window.</p>';
  let nj;
  if (!r.c2) nj = "<b>Nothing to act on yet.</b> No customer acquired on this product has placed a second order inside this window.";
  else {
    const same = r.p2.find((q) => q.code === r.code), other = r.p2.filter((q) => q.code !== r.code)[0];
    let sum = `<b>Summary.</b> ${rN(r.c1)} customers were acquired on ${esc(r.name)} in this window. ${rN(r.c2)} came back for anything (${rr.toFixed(1)}%), ${rN(r.c3)} reached a 3rd order (${three.toFixed(2)}%), ${rN(r.c4)} a 4th (${r.c1 ? ((100 * r.c4) / r.c1).toFixed(2) : "0"}%). Median gap to the 2nd order is ${r.g12} days${r.g23 != null ? `, then ${r.g23} days to the 3rd` : ""}. `;
    if (py != null) sum += `Across the ${rN(r.yrBase)} buyers with a full year they average <b>${py.toFixed(2)} orders a year</b>. `;
    if (r.miles[2] && r.miles[2].base) sum += `By day 90, ${r.miles[2].rate.toFixed(1)}% have come back for something; by day 180, ${r.miles[4] && r.miles[4].base ? r.miles[4].rate.toFixed(1) + "%" : "—"}. `;
    sum += same ? `On the 2nd order ${same.share.toFixed(1)}% buy ${esc(r.name)} again` : "Almost nobody repeats the product itself on order two";
    if (other) sum += `, ${other.share.toFixed(1)}% take ${esc(other.name)} (median ${other.med == null ? "—" : other.med + "d"})`;
    sum += ".";
    let act = "<b>Insight and action.</b> ";
    if (py != null) act += py >= 3 ? `At ${py.toFixed(2)} orders a year this cohort clears the 3-4x target: protect it, do not discount it. ` : `At ${py.toFixed(2)} orders a year this cohort is below the 3-4x target, so the gain is frequency, not more acquisition. `;
    if (same && other) act += `Lead the next-order message with ${same.share >= other.share ? "replenishment of " + esc(r.name) : esc(other.name)}, since that is where the larger share already goes. `;
    else if (other) act += `Treat this as a gateway product and merchandise ${esc(other.name)} as the planned follow-on rather than pushing replenishment. `;
    act += `Fire the touch around day ${Math.max(7, Math.round((r.g12 || 30) * 0.8))}, ahead of the ${r.g12}-day median.`;
    nj = sum + "<br><br>" + act;
  }
  return `
    <h3>The journey after they buy ${esc(r.name)} first</h3>
    <p class="rsub">Everyone whose <em>first</em> order in the window contained this product: how many come back at all (for anything), how fast, how many times a year, and what they pick up next.</p>
    <div class="rfigs">${figs}</div>
    <div class="rfunnel">${rFunnel(r)}</div>
    <h4>Come back by milestone</h4>
    <p class="rsub">Cumulative: each row includes everyone before it. Each row counts only customers who had that much time before the history ends.</p>
    ${rTable([{ t: "By" }, { t: "Repeat rate", n: 1 }, { t: "Gained", n: 1 }, { t: "Customers", n: 1 }, { t: "Cohort with runway", n: 1 }], mrows, { csv: "journey-milestones" })}
    <h4>What they buy on the 2nd order</h4>
    <p class="rsub">Share of returning customers whose second order contained each product, and the typical gap from the first order.</p>
    ${second}
    <h4>What they buy on the 3rd order</h4>
    ${third}
    ${rBox(nj)}`;
}

function retSame() {
  const { r } = retCurrent();
  if (!r) return `<p class="na">No data for this product in the window.</p>`;
  const keys = ["0-30", "31-60", "61-90", "90+"], labs = ["0-30 days", "31-60 days", "61-90 days", "90+ days"], tot = r.repeat_n, days = RET.B - RET.A + 1;
  const bars = rBars(keys.map((k, i) => [labs[i], r.buckets[k]]), (q) => rN(q[1]) + (tot ? `  (${((100 * q[1]) / tot).toFixed(0)}%)` : ""));
  const tbl = rTable([{ t: "Window" }, { t: "Customers", n: 1 }, { t: "Share of repurchasers", n: 1 }], keys.map((k, i) => `<tr><td>${labs[i]}</td><td class="n">${rN(r.buckets[k])}</td><td class="n">${tot ? ((100 * r.buckets[k]) / tot).toFixed(1) + "%" : "—"}</td></tr>`));
  let note;
  if (!tot) note = `<b>No repurchase signal.</b> Nobody bought this product a second time inside this window.` + (r.monthsLive < 4 ? ` It only started selling on ${rPretty(r.first)}, so there are just ${r.monthsLive.toFixed(1)} months of history: far too early to judge.` : " Widen the range if the product is slower moving.");
  else {
    const late = r.buckets["90+"], early = r.buckets["0-30"] + r.buckets["31-60"];
    let t;
    if (late / tot >= 0.45) t = `Most repurchases land past day 90 (${rN(late)} of ${rN(tot)}). This is slow replenishment: a win-back around day ${Math.max(30, Math.round(r.med * 0.75))} catches them before they drift.`;
    else if (early / tot >= 0.5) t = `Repurchase clusters inside the first two months (${rN(early)} of ${rN(tot)}), which points at trial-then-stock-up. A pack of 2 at first purchase would pull that second order forward.`;
    else t = `Repurchase spreads fairly evenly, so one broadcast date will miss most of the base. Trigger off the median (day ${r.med}) and follow up.`;
    if (days < 120) t += ` This window is only ${(days / 30.44).toFixed(1)} months wide, so longer cycles are cut off by the window edge rather than absent.`;
    if (r.monthsLive < 4) t += ` This product only started selling on ${rPretty(r.first)}, so there are just ${r.monthsLive.toFixed(1)} months of history behind it: the rate is held down by buyers who have not had time to return, not by weak retention.`;
    const sum = `<b>Summary.</b> ${rN(r.base)} customers bought ${esc(r.name)} in this window and ${rN(r.repeat_n)} bought it again (${r.rate.toFixed(2)}%). On a like-for-like 90-day runway the rate is ${r.m90_rate == null ? "—" : r.m90_rate.toFixed(2) + "%"}${r.m90_base ? " across " + rN(r.m90_base) + " buyers" : ""}. Median gap ${r.med} days, average ${r.avg} days. Split: ${rN(r.buckets["0-30"])} repurchase inside 30 days (${((100 * r.buckets["0-30"]) / tot).toFixed(0)}%), ${rN(r.buckets["31-60"])} in 31-60 (${((100 * r.buckets["31-60"]) / tot).toFixed(0)}%), ${rN(r.buckets["61-90"])} in 61-90 (${((100 * r.buckets["61-90"]) / tot).toFixed(0)}%), ${rN(r.buckets["90+"])} past 90 days (${((100 * r.buckets["90+"]) / tot).toFixed(0)}%).`;
    note = sum + "<br><br><b>Insight and action.</b> " + t;
  }
  return `
    <h3>Time to buy the same product again</h3>
    <p class="rsub">Every customer who bought ${esc(r.name)} inside the window, and how many came back for the <em>same</em> product, with the gap between the two orders.</p>
    ${bars}${tbl}${rBox(note)}`;
}

function retSwitch() {
  const { r } = retCurrent();
  if (!r) return `<p class="na">No data for this product in the window.</p>`;
  if (!r.top.length) return `<h3>What they buy instead</h3><p class="na">No switches recorded for this product in this window.</p>`;
  rCsv("switch", ["Next product", "Share of switchers %", "Avg days", "Median days", "Customers"], r.top.map((t) => [t.name, t.share.toFixed(1), t.avg, t.med, t.n]));
  const l = r.top[0], top3 = r.top.slice(0, 3).map((t) => `${esc(t.name)} ${t.share.toFixed(1)}% (median ${t.med}d)`).join(", ");
  const note = `<b>Summary.</b> ${rN(r.cross_n)} customers placed a next order without ${esc(r.name)} in it. Top destinations: ${top3}. Strongest single pull is ${esc(l.name)}, taking ${l.share.toFixed(1)}% of switchers at a median of ${l.med} days.<br><br><b>Insight and action.</b> Build the cross-sell for ${esc(r.name)} around ${esc(l.name)}, and time it just before day ${Math.max(5, Math.round((l.med || l.avg) * 0.8))}. Switchers move earlier than repeat buyers, so a late message lands after the decision is made.`;
  return `
    <h3>What they buy instead</h3>
    <p class="rsub">For customers whose next order did not contain ${esc(r.name)}: the products they moved to, and how long after the first purchase.</p>
    ${rBars(r.top.map((t) => [t.name, t.share]), (q) => q[1].toFixed(1) + "%", "alt")}
    ${rTable([{ t: "#" }, { t: "Next product" }, { t: "Share of switchers", n: 1 }, { t: "Avg days", n: 1 }, { t: "Median", n: 1 }, { t: "Customers", n: 1 }], r.top.map((t, i) => `<tr><td class="rank">${i + 1}</td><td>${esc(t.name)}</td><td class="n">${t.share.toFixed(1)}%</td><td class="n">${t.avg}</td><td class="n">${t.med}</td><td class="n">${rN(t.n)}</td></tr>`), { csv: "switch" })}
    ${rBox(note, "alt")}`;
}

function retVariants() {
  const e = RET.eng, { base } = retCurrent();
  if (!base) return `<p class="na">Pick a product above.</p>`;
  const x = e.computeVariants(RET.A, RET.B, base.i, RET.HZ);
  const vr = RET.resV.filter((r) => r.sku === base.i).sort((p, q) => q.base - p.base);
  const tot = vr.reduce((p, q) => p + q.base, 0);
  const mix = rTable([{ t: "Variant" }, { t: "Buyers", n: 1 }, { t: "Share", n: 1 }, { t: "Repeat rate", n: 1 }, { t: "Median gap", n: 1 }], vr.map((r) => `<tr><td>${esc(e.VARS[r.i].label)}</td><td class="n">${rN(r.base)}</td><td class="n">${tot ? ((100 * r.base) / tot).toFixed(1) + "%" : "—"}</td><td class="n">${r.rate.toFixed(2)}%</td><td class="n">${rDays(r.med)}</td></tr>`), { empty: "No variant data in this window.", csv: "variant-mix" });
  rCsv("variant-mix", ["Variant", "Buyers", "Share %", "Repeat rate %", "Median gap days"], vr.map((r) => [e.VARS[r.i].label, r.base, tot ? ((100 * r.base) / tot).toFixed(1) : "", r.rate.toFixed(2), r.med ?? ""]));
  let loy = '<p class="na">This product has no fragrance or shade variants, only pack sizes.</p>';
  let rr = [];
  if (x.hasSub) {
    const rows = x.subs.map((f) => {
      const t = Object.values(x.lm[f]).reduce((p, q) => p + q, 0), same = x.lm[f][f] || 0;
      const sw = Object.entries(x.lm[f]).filter(([k]) => k !== f).sort((p, q) => q[1] - p[1])[0];
      return { f, b: x.lb[f], t, same, sw, med: e.median(x.lg[f]) };
    }).filter((r) => r.t >= 15).sort((p, q) => q.b - p.b);
    rr = rows;
    loy = rTable([{ t: "Started on" }, { t: "Bought again", n: 1 }, { t: "Stayed", n: 1 }, { t: "Swapped", n: 1 }, { t: "Most common swap" }, { t: "Median days", n: 1 }], rows.map((r) => `<tr><td>${esc(r.f)}</td><td class="n">${rN(r.t)} of ${rN(r.b)}</td><td class="n"><b>${((100 * r.same) / r.t).toFixed(1)}%</b></td><td class="n">${((100 * (r.t - r.same)) / r.t).toFixed(1)}%</td><td>${r.sw ? esc(r.sw[0]) + " (" + ((100 * r.sw[1]) / r.t).toFixed(1) + "%)" : "—"}</td><td class="n">${rDays(r.med)}</td></tr>`), { empty: "Too few repeat buyers to measure swapping in this window." });
  }
  const pl = { 1: "Pack of 1", 2: "Pack of 2" };
  const pack = rTable([{ t: "Pack" }, { t: "Buyers", n: 1 }, { t: "Repeat rate", n: 1 }, { t: "Median gap", n: 1 }, { t: "Orders a year", n: 1 }], [1, 2].map((p) => { const v = x.pk[p]; return v ? `<tr><td>${pl[p]}</td><td class="n">${rN(v.base)}</td><td class="n">${v.rate.toFixed(2)}%</td><td class="n">${rDays(v.med)}</td><td class="n">${v.perYear == null ? "—" : v.perYear.toFixed(2)}</td></tr>` : ""; }), { empty: "No pack data." });
  const p1 = x.pk[1], p2 = x.pk[2];
  let sum = "<b>Summary.</b> ";
  if (vr.length) sum += `${rN(tot)} buyers across ${vr.length} variants; the largest is ${esc(e.VARS[vr[0].i].label)} at ${((100 * vr[0].base) / tot).toFixed(1)}%. `;
  if (rr.length) { const best = rr.slice().sort((p, q) => q.same / q.t - p.same / p.t)[0], worst = rr.slice().sort((p, q) => p.same / p.t - q.same / q.t)[0]; sum += `On repurchase, loyalty ranges from ${((100 * best.same) / best.t).toFixed(1)}% (${esc(best.f)}) down to ${((100 * worst.same) / worst.t).toFixed(1)}% (${esc(worst.f)}). `; }
  if (p1 && p2) sum += `Pack of 1: ${rN(p1.base)} buyers, ${p1.rate.toFixed(2)}% repeat, ${rDays(p1.med)} median. Pack of 2: ${rN(p2.base)} buyers, ${p2.rate.toFixed(2)}% repeat, ${rDays(p2.med)} median.`;
  let act = "<b>Insight and action.</b> ";
  if (p1 && p2) {
    const gd = p2.med != null && p1.med != null ? p2.med - p1.med : null;
    act += p2.rate < p1.rate ? `Pack of 2 repeats ${(p1.rate - p2.rate).toFixed(2)} points lower than pack of 1${gd != null && gd > 0 ? ` and stretches the gap by ${gd} days` : ""}. It is buying a larger first order at the cost of the second one, which is the wrong trade while order-1-to-2 drop-off is the main problem. Push packs only at customers who have already repeated once. ` : `Pack of 2 holds up against pack of 1 on repeat, so it is deepening rather than cannibalising: safe to merchandise harder at first purchase. `;
  }
  if (rr.length) { const avg = rr.reduce((p, q) => p + q.same / q.t, 0) / rr.length; act += avg < 0.6 ? "Most repeat buyers change variant rather than restock the same one, so treat the range as a discovery set: merchandise a trial or mixed pack instead of a single-variant replenishment reminder." : "Most repeat buyers stay on their original variant, so lead with same-variant replenishment and keep swaps as a secondary offer."; }
  const warn = x.hasSub && x.A2 > RET.A ? `<div class="banner">New variants of ${esc(base.name)} launched ${rPretty(x.A2)}. The original is the continuation of the earlier product, so its buyer count includes everyone before that date. Stay-or-swap is only measured from the launch.</div>` : "";
  return `
    <h3>Variant loyalty and pack behaviour: ${esc(base.name)}</h3>
    <p class="rsub">Which variant people start on, whether they stay on it or swap, and how a pack of 1 compares with a pack of 2.</p>
    ${warn}
    <h4>Variant mix</h4>${mix}
    <h4>Stay or swap</h4>
    <p class="rsub">Of customers who bought this product again, did they pick the same variant or a different one? Pack size is ignored: this is purely fragrance or shade.</p>${loy}
    <h4>Pack of 1 against pack of 2</h4>${pack}
    ${rBox(sum + "<br><br>" + act)}`;
}

function retMethod() {
  const c = RET.census, s = c.stats || {}, meta = RET.meta || {};
  const checks = (c.checks || meta.checks || []).map((k) => `<tr><td>${esc(k.label)}</td><td class="n">${k.ours == null ? "—" : rN(k.ours)}</td><td class="n">${k.theirs == null ? "—" : rN(k.theirs)}</td><td>${k.ok === true ? '<span class="chip ok">Matches</span>' : k.ok === false ? '<span class="chip missing">Differs</span>' : '<span class="chip pending">Context</span>'} <span class="sub">${esc(k.note || "")}</span></td></tr>`);
  const excl = Object.entries(s.excluded || {}).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="n">${rN(v.lines)}</td><td class="n">${rN(v.revenue)}</td></tr>`);
  const prod = Object.entries(s.counted || {}).slice(0, 12).map(([k, v]) => `<tr><td>${esc((c.skus.find((q) => q[0] === k) || [k, k])[1])}</td><td class="n">${rN(v.lines)}</td><td class="n">${rN(v.revenue)}</td></tr>`);
  const oth = (s.other_top || []).slice(0, 15).map((v) => `<tr><td>${esc(v.title)}</td><td class="n">${rN(v.revenue)}</td></tr>`);
  const chain = s.orders_with_lines ? `<ul class="notes"><li>${rN(s.lines_in)} order lines read, from valid orders only (not cancelled, no tests, no sample or influencer orders).</li><li>${rN(s.orders_with_lines)} orders had at least one counted product; ${rN(s.merged_pairs)} pairs of orders placed under 24 hours apart were merged into one (payment retries and COD re-attempts, not repurchases).</li><li>${rN(s.orders_counted)} orders from ${rN(s.customers)} customers: ${rN(s.customers_multi)} with two or more orders (full timelines), ${rN(s.customers_single)} with one (kept as daily counts).</li></ul>` : "";
  return `
    <h3>How these numbers are built</h3>
    <p class="rsub">A complete census, not a sample: every order since the first one, read from the Shopify order history, with each customer's purchase timeline. Changing the dates or horizon recomputes every figure live.</p>
    ${chain}
    <h4>Checks against the source</h4>
    ${rTable([{ t: "Check" }, { t: "Ours", n: 1 }, { t: "Source", n: 1 }, { t: "Result" }], checks, { empty: "No checks are stored with this census yet." })}
    <h4>Three customer counts, because they answer different questions</h4>
    <ul class="notes">
      <li><b>All buyers</b> is everyone who bought the product in the window; it reconciles with Shopify's "Customers".</li>
      <li><b>New to Asaya</b> is their first ever order with the brand; it reconciles with Shopify's "New customers".</li>
      <li><b>New to this product</b> is the group every repeat rate is built on: the first time they bought that product, whether or not they had bought Asaya before.</li>
    </ul>
    <h4>The rules</h4>
    <ul class="notes">
      <li><b>The date range is the acquisition window, not the observation window.</b> Pick 1 to 31 January and you get everyone whose first order fell in January; each is then followed for the full horizon from their own first order, reading forward into February and March. The window end is trimmed so every member had the full horizon, and the trim is stated under the controls.</li>
      <li><b>Equal time for everyone.</b> A 90-day horizon counts only customers who had 90 days before the history ends, and only repeats inside their own 90 days, so late cohorts no longer drag the rate down. "No limit" switches the rule off and is for actuals, not comparisons. Medians and average gaps are capped by the horizon by design.</li>
      <li><b>Combos stay whole.</b> A duo or set is its own product and is never split into its parts.</li>
      <li><b>Each customer counts once per product</b>, from their first purchase of it inside the window.</li>
      <li><b>Not counted as purchases:</b> free gifts (zero-value lines), merch, minis and trial sizes, travel kits, gift sets, books and gummies. The rules are in <code>retention_catalog.json</code> and take effect on the next build.</li>
    </ul>
    <h4>What was left out, and what was counted</h4>
    <div class="grid-2">
      <div>${rTable([{ t: "Left out because" }, { t: "Lines", n: 1 }, { t: "Revenue (Rs)", n: 1 }], excl, { empty: "Not recorded in this census." })}</div>
      <div>${rTable([{ t: "Counted: largest products" }, { t: "Lines", n: 1 }, { t: "Revenue (Rs)", n: 1 }], prod, { empty: "Not recorded in this census." })}</div>
    </div>
    <h4>Products not yet mapped to a named product</h4>
    <p class="rsub">These are counted as "Other products and seasonal sets". If one of them deserves its own row, add a rule to the catalogue.</p>
    ${rTable([{ t: "Product title" }, { t: "Revenue (Rs)", n: 1 }], oth, { empty: "Nothing is sitting in the Other bucket." })}`;
}

R.retention = async (p) => {
  $main.innerHTML = '<section class="card"><p class="empty" id="r-load">Loading the customer history. It is a few MB and only loads once.</p></section>';
  if (!RET.eng) {
    try { RET.census = await retLoadCensus(); retInit(); }
    catch (err) { $main.innerHTML = `<section class="card"><div class="section-head"><h2>Retention</h2></div><p class="na">Data unavailable: ${esc(err.message)}</p></section>`; return; }
  }
  retShell(p);
  retSync(true);
};
