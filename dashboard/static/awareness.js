/* The Awareness tab: "Is awareness spend growing demand in the geos we spend
   in, and which geos can we test next?" Geo Pulse · Tests · Test Planner ·
   Media & Leakage, plus a geo drawer. Weekly by default; share is never shown
   without the absolute number and the relative index; every lift is a floor;
   contamination is always visible. Numbers come from pages/awareness.json
   (built by the Awareness job from Maplemonk, read only) and the GeoLift job's
   results folded into it. Inlined inside the dashboard closure. */

(function awStyles() {
  if (typeof document === "undefined" || document.getElementById("aw-css")) return;
  const s = document.createElement("style");
  s.id = "aw-css";
  s.textContent = `
.aw-bar { position: static; background: var(--bg); padding: 8px 0; display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; }
@media (min-width: 760px) { .aw-bar:not(.aw-form) { position: sticky; top: 0; z-index: 6; } }
.aw-bar select { font: inherit; font-size: 13px; padding: 5px 8px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); color: var(--ink); }
.aw-bar label { font-size: 12.5px; color: var(--muted); display: inline-flex; gap: 6px; align-items: center; }
.aw-chip { display: inline-block; font-size: 11px; font-weight: 600; border-radius: 4px; padding: 1px 6px; white-space: nowrap; }
.aw-chip.Treatment { background: var(--accent); color: var(--surface); }
.aw-chip.Contaminated { background: var(--warn-bg, #fdecc8); color: var(--warn, #8a5a00); border: 1px dashed currentColor; }
.aw-chip.Dark { background: var(--surface); color: var(--muted); border: 1px dotted currentColor; }
.aw-chip.floor { background: var(--accent-wash); color: var(--ink-2); cursor: help; }
.aw-chip.low { background: var(--surface); color: var(--muted); border: 1px solid var(--line); }
.aw-v { display: inline-block; font-size: 12px; font-weight: 700; border-radius: 6px; padding: 2px 8px; background: var(--accent-wash); color: var(--ink); }
.aw-v.warn { background: var(--bad-bg); color: var(--bad); }
.aw-v.ok { background: var(--good-bg); color: var(--good); }
.aw-map svg { width: 100%; height: auto; max-height: 640px; display: block; }
.aw-map path { stroke: var(--surface); stroke-width: 0.8; cursor: pointer; outline: none; }
.aw-map path:focus, .aw-map path:hover { stroke: var(--ink); stroke-width: 1.6; }
.aw-map path.st-Treatment { stroke: var(--ink); stroke-width: 2.4; }
.aw-map path.st-Contaminated { stroke: var(--ink); stroke-width: 1.6; stroke-dasharray: 5 3; }
.aw-map path.st-Dark { stroke: var(--ink-2); stroke-width: 1.2; stroke-dasharray: 1.5 2.5; }
.aw-map circle { cursor: pointer; stroke: var(--ink); stroke-width: 0.8; fill-opacity: 0.85; }
.aw-legend { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 12px; color: var(--ink-2); margin-top: 6px; }
.aw-legend i { display: inline-block; width: 14px; height: 10px; border-radius: 2px; margin-right: 4px; vertical-align: middle; }
.aw-spark { vertical-align: middle; }
.aw-mix { display: inline-flex; width: 70px; height: 8px; border-radius: 4px; overflow: hidden; vertical-align: middle; background: var(--line); }
.aw-mix span { display: block; height: 100%; }
.aw-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 10px; }
.aw-card { border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; background: var(--surface); cursor: pointer; font-size: 13px; text-align: left; font: inherit; }
.aw-card[aria-pressed="true"] { outline: 2px solid var(--accent); }
.aw-prog { height: 6px; border-radius: 3px; background: var(--line); margin: 6px 0; overflow: hidden; }
.aw-prog span { display: block; height: 100%; background: var(--accent); }
.aw-scale { position: relative; height: 64px; margin: 12px 60px 22px; border-bottom: 2px solid var(--line); }
.aw-scale .mk { position: absolute; bottom: -2px; transform: translateX(-50%); font-size: 11.5px; text-align: center; white-space: nowrap; display: flex; flex-direction: column; align-items: center; }
.aw-scale .mk > span { background: var(--surface); padding: 0 3px; border-radius: 3px; }
.aw-scale .mk b { display: block; width: 2px; background: currentColor; }
.aw-scale .tk { position: absolute; top: 100%; transform: translateX(-50%); font-size: 10.5px; color: var(--muted); padding-top: 3px; }
.aw-drawer { position: fixed; top: 0; right: 0; bottom: 0; width: min(760px, 100vw); background: var(--surface); box-shadow: -10px 0 40px rgba(0,0,0,.2); z-index: 60; overflow-y: auto; padding: 18px 20px; }
.aw-drawer .x { position: absolute; top: 10px; right: 14px; font-size: 22px; border: 0; background: none; cursor: pointer; color: var(--ink-2); }
.aw-donor { display: grid; grid-template-columns: 140px 1fr 60px 60px; gap: 6px; align-items: center; font-size: 12.5px; margin: 3px 0; }
.aw-donor .b { height: 8px; background: var(--series-1); border-radius: 4px; }
.aw-gantt { position: relative; font-size: 12.5px; }
.aw-g-row { display: grid; grid-template-columns: minmax(120px, 30%) 1fr; gap: 10px; align-items: center; min-height: 40px; border-bottom: 1px solid var(--line); }
.aw-g-axis { min-height: 22px; border-bottom: 0; }
.aw-g-t { position: relative; height: 100%; min-height: 22px; }
.aw-g-t .tk, .aw-g-t .today { position: absolute; top: 3px; font-size: 11px; color: var(--muted); transform: translateX(-50%); white-space: nowrap; }
.aw-g-t .today { color: var(--ink); font-weight: 600; }
.aw-g-bar { position: absolute; top: 50%; height: 16px; margin-top: -8px; border-radius: 4px; min-width: 4px; }
.aw-g-bar.open { border-radius: 4px 0 0 4px; }
.aw-g-bar.open::after { content: "▸"; position: absolute; right: -11px; top: -2px; font-size: 13px; color: var(--ink-2); }
.aw-g-bar.pend { opacity: .3; outline: 1px dashed var(--ink); }
.aw-g-t .nowl { position: absolute; top: 0; bottom: 0; border-left: 1px dashed var(--ink-2); }
.aw-faded { opacity: .45; }
.aw-form { position: static; padding: 0 0 6px; }
.aw-bar input[type=number] { font: inherit; font-size: 13px; padding: 5px 8px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); color: var(--ink); }
`;
  document.head.appendChild(s);
})();

const AW = { sub: "pulse", level: "state", region: "All", group: "ALL", kpi: "sales", clean: true, test: null, colour: "rel", view: "visual", drawer: null, chartDaily: false, testKpi: "Y", testDaily: true, regionClean: true, plan: { geo: "", dur: 42, spend: 300000, iroas: 0.5 } };
const AW_SUBS = [["pulse", "Geo Pulse"], ["tests", "Tests"], ["planner", "Test Planner"], ["media", "Media & Leakage"]];
const AW_KPI = [["sales", "Sales (₹)"], ["orders", "Orders"], ["units", "Units"], ["newc", "D2C new customers"]];
const AW_GROUP = [["ALL", "All"], ["D2C", "D2C"], ["MARKETPLACE", "Marketplace"], ["QUICK_COMMERCE", "Quick commerce"]];
const AW_REGIONS = ["All", "South", "North", "West", "East", "North-East"];
const AW_COLOUR = [["rel", "Relative index"], ["share", "Share Δ pp"], ["wow", "WoW %"], ["mom", "vs same phase last month"]];
const awFloor = (P) => `<span class="aw-chip floor" title="${esc("Floor estimate: Nykaa, Amazon 1P (RK Worldinfocom) and B2B are sold in bulk to resellers and carry no customer location, so they cannot be split by geo and are left out. Any lift measured here is at least this much.")}">${esc(P.config.floor_note.replace(/^Floor: /, "Floor: "))}</span>`;
const awChip = (st) => (st && st !== "None" ? `<span class="aw-chip ${st}" title="${esc({ Treatment: "Treatment: a live test's media is on here", Contaminated: "Contaminated: other awareness media touches this geo this week", Dark: "Dark: Top Funnel switched off here" }[st] || st)}">${esc(st)}</span>` : "");
const awFmt = (v) => (v == null || !isFinite(v) ? "—" : AW.kpi === "sales" ? mFormat("currency", v, true) : mFormat("count", v));
const awPct = (v, d = 1) => (v == null || !isFinite(v) ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(d)}%`);
const awPp = (v) => (v == null || !isFinite(v) ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(1)} pp`);
const awIdx = (v) => (v == null || !isFinite(v) ? "—" : v.toFixed(2));
const awTitle = (s) => String(s || "").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
function awUrl() {
  const q = new URLSearchParams({ sub: AW.sub, level: AW.level, region: AW.region, group: AW.group, kpi: AW.kpi, clean: AW.clean ? "1" : "0", colour: AW.colour });
  if (AW.test) q.set("test", AW.test);
  if (AW.drawer) q.set("geo", AW.drawer.level + ":" + AW.drawer.key);
  history.replaceState(null, "", "#awareness?" + q.toString());
}
function awReadUrl() {
  const q = new URLSearchParams(location.hash.split("?")[1] || "");
  if (q.get("sub") && AW_SUBS.some(([k]) => k === q.get("sub"))) AW.sub = q.get("sub");
  if (["state", "city"].includes(q.get("level"))) AW.level = q.get("level");
  if (AW_REGIONS.includes(q.get("region"))) AW.region = q.get("region");
  if (AW_GROUP.some(([k]) => k === q.get("group"))) AW.group = q.get("group");
  if (AW_KPI.some(([k]) => k === q.get("kpi"))) AW.kpi = q.get("kpi");
  if (q.get("clean")) AW.clean = q.get("clean") === "1";
  if (AW_COLOUR.some(([k]) => k === q.get("colour"))) AW.colour = q.get("colour");
  if (q.get("test")) AW.test = q.get("test");
  const g = q.get("geo");
  if (g && g.includes(":")) { const [level, key] = g.split(":"); AW.drawer = { level, key }; }
}

// ---------------------------------------------------------------- the numbers (all from the weekly rows)
/* One geo's weekly values for the chosen KPI and channel group. D2C new
   customers only exist for D2C (the website). */
const awSeries = (g) => (AW.kpi === "newc" ? g.w.newc : g.w[AW.kpi][AW.group]);
const awNational = (P) => (AW.kpi === "newc" ? P.national.newc : P.national[AW.kpi][AW.group]);
function awCtx(P) {
  const weeks = P.weeks, n = weeks.length;
  // the focus week: the last complete week inside the header's range
  const to = RG.to || P.as_of, from = RG.from || weeks[0];
  let wi = -1;
  for (let i = 0; i < n; i++) { const end = new Date(Date.parse(weeks[i]) + 6 * 864e5).toISOString().slice(0, 10); if (end <= to && end <= P.as_of && end >= from) wi = i; }
  if (wi < 0) wi = Math.max(0, weeks.findIndex((w) => w > P.as_of) - 2);
  // baseline: the 12 weeks before the reference date (latest test start in config, else 12 weeks back)
  const starts = (P.tests || []).map((t) => t.test_start).sort();
  const ref = starts.length ? starts[starts.length - 1] : weeks[Math.max(0, wi - 11)];
  let ri = weeks.findIndex((w) => w >= ref); if (ri < 0) ri = wi;
  const baseIdx = []; for (let i = Math.max(0, ri - P.config.baseline_weeks); i < ri; i++) baseIdx.push(i);
  const geos = P.geos[AW.level];
  const nat = awNational(P);
  const mean = (arr, idx) => (idx.length ? idx.reduce((s, i) => s + (arr[i] || 0), 0) / idx.length : null);
  // "clean" rest of India: excludes the geo itself and every geo with live media (Treatment / Contaminated) that week
  const touched = (i) => new Set(geos.filter((g) => ["Treatment", "Contaminated"].includes(g.media[i])).map((g) => g.key));
  const restOf = (g, i, clean) => { let r = nat[i] - awSeries(g)[i]; if (clean) for (const h of geos) if (h.key !== g.key && touched(i).has(h.key)) r -= awSeries(h)[i]; return r; };
  const restBase = (g, i, clean) => { const t = touched(i); return mean(baseIdx.map((j) => { let r = nat[j] - awSeries(g)[j]; if (clean) for (const h of geos) if (h.key !== g.key && t.has(h.key)) r -= awSeries(h)[j]; return r; }), baseIdx.map((_, k) => k)); };
  const metrics = (g, i = wi) => {
    const s = awSeries(g), v = s[i], base = mean(s, baseIdx), share = nat[i] ? v / nat[i] : null;
    const bshare = mean(baseIdx.map((j) => (nat[j] ? s[j] / nat[j] : 0)), baseIdx.map((_, k) => k));
    const rel = (clean) => { const rb = restBase(g, i, clean), rn = restOf(g, i, clean); return base && rb && rn ? (v / base) / (rn / rb) : null; };
    // same week-of-month last month, only when it is the same offer phase
    let mom = null; for (const k of [4, 5]) { const j = i - k; if (j >= 0 && P.week_phase[j] === P.week_phase[i] && P.week_phase[i] !== "Mixed" && s[j]) { mom = v / s[j] - 1; break; } }
    return { v, wow: i > 0 && s[i - 1] ? v / s[i - 1] - 1 : null, mom, share, dshare: share != null && bshare != null ? share - bshare : null,
      base_idx: base ? v / base : null, rel: rel(true), rel_all: rel(false), status: g.media[i] };
  };
  return { weeks, wi, baseIdx, ref, nat, metrics, geos, mean };
}
const awScales = (unit, extra = {}) => ({ x: { ...axisOpts(), ticks: { color: css("--muted"), maxRotation: 0, autoSkipPadding: 12, font: { size: 11 } }, grid: { display: false } }, y: { ...axisOpts(unit), ...(extra.y || {}) }, ...(extra.y1 ? { y1: { ...axisOpts("x"), position: "right", grid: { display: false }, ticks: { color: css("--muted"), font: { size: 11 }, callback: (v) => (+v).toFixed(2) }, ...extra.y1 } } : {}) });
const awInRegion = (g) => AW.region === "All" || g.region === AW.region;

// ---------------------------------------------------------------- the tab
R.awareness = (page) => {
  awReadUrl();
  const nav = `<nav class="subtabs" aria-label="Awareness">${AW_SUBS.map(([k, l]) => `<a href="#awareness?sub=${k}" data-awsub="${k}" ${AW.sub === k ? 'aria-current="page"' : ""}>${esc(l)}</a>`).join("")}</nav>`;
  rgTab("awareness", [], nav, async () => {
    const host = document.getElementById("rg-body");
    if (!page || !page.weeks) { host.innerHTML = `<section class="card"><p class="na">Data unavailable: the Awareness job has not run yet.</p></section>`; return; }
    try { await loadPage("awareness_map"); } catch (e) { /* the table stands in for the map */ }
    if (state.tab !== "awareness") return;
    awDraw(page);
  });
};
function awBar(P) {
  const sel = (id, opts, cur, lbl) => `<label>${esc(lbl)}<select id="${id}">${opts.map(([k, l]) => `<option value="${esc(k)}" ${k === cur ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></label>`;
  const q = P.quality || {};
  const pill = `<a class="aw-chip ${q.unknown_state_pct != null && q.unknown_state_pct < 0.02 ? "floor" : "Contaminated"}" href="#health" title="Data quality is on Data health">Data: ${q.unknown_state_pct == null ? "—" : (100 - q.unknown_state_pct * 100).toFixed(1) + "% located"}</a>`;
  return `<div class="aw-bar" role="toolbar" aria-label="Awareness filters">
    ${sel("aw-level", [["state", "State"], ["city", "City cluster"]], AW.level, "Geo")}
    ${sel("aw-region", AW_REGIONS.map((r) => [r, r]), AW.region, "Region")}
    ${sel("aw-group", AW_GROUP, AW.group, "Channels")}
    ${sel("aw-kpi", AW_KPI, AW.kpi, "KPI")}
    <label title="Contaminated geos (other awareness media this week) are left out of 'rest of India'"><input type="checkbox" id="aw-clean" ${AW.clean ? "checked" : ""}> Exclude contaminated geos from comparisons</label>
    ${AW.sub === "tests" ? sel("aw-test", (P.tests || []).map((t) => [t.test_id, t.test_name]), AW.test, "Test") : ""}
    ${pill}
  </div>`;
}
function awDraw(P) {
  if (AW.kpi === "newc") AW.group = "D2C"; // new customers are only known for the website
  if (!AW.test && P.tests && P.tests.length) AW.test = P.tests[0].test_id;
  const host = document.getElementById("rg-body");
  const body = AW.sub === "pulse" ? awPulse(P) : AW.sub === "tests" ? awTests(P) : AW.sub === "planner" ? awPlanner(P) : awMedia(P);
  host.innerHTML = awBar(P) + body + (AW.kpi === "newc" ? '<p class="legend-note">D2C new customers exist only for the website, so the channel filter is set to D2C.</p>' : "");
  awBind(P);
  awUrl();
  if (AW.drawer) awDrawer(P, AW.drawer.level, AW.drawer.key);
}

// ---------------------------------------------------------------- Geo Pulse
function awPulse(P) {
  const X = awCtx(P), wi = X.wi, wk = X.weeks[wi];
  const states = P.geos.state;
  const south = states.filter((g) => g.region === "South");
  const sum = (gs, i) => gs.reduce((s, g) => s + (awSeries(g)[i] || 0), 0);
  const india = X.nat[wi], southV = sum(south, wi), southPrev = sum(south, wi - 1);
  // South relative index (clean): South vs clean rest of India, each against its 12-week baseline
  const touchedS = new Set(states.filter((g) => ["Treatment", "Contaminated"].includes(g.media[wi])).map((g) => g.key));
  const restClean = (i) => X.nat[i] - sum(south, i) - sum(states.filter((g) => g.region !== "South" && touchedS.has(g.key)), i);
  const sB = X.mean(X.baseIdx.map((j) => sum(south, j)), X.baseIdx.map((_, k) => k)), rB = X.mean(X.baseIdx.map((j) => restClean(j)), X.baseIdx.map((_, k) => k));
  const southRel = sB && rB ? (southV / sB) / (restClean(wi) / rB) : null;
  const sShare = india ? southV / india : null, sSharePrev = X.nat[wi - 1] ? southPrev / X.nat[wi - 1] : null;
  const media = (P.geos[AW.level] || []).filter((g) => ["Treatment", "Contaminated"].includes(g.media[wi])).length;
  const card = (label, value, sub, tip) => `<div class="kpi"><div class="kpi-l"><span class="kpi-n">${esc(label)}</span>${tip ? `<span class="tip" tabindex="0" role="note" data-tip="${esc(tip)}">i</span>` : ""}</div><div class="kpi-v">${value}</div><div class="kpi-d"><span class="kpi-vs">${sub || ""}</span></div></div>`;
  const kpis = [
    card("India geo-trackable", esc(awFmt(india)), `WoW ${esc(awPct(X.nat[wi - 1] ? india / X.nat[wi - 1] - 1 : null))} · ${esc(P.week_phase[wi])} week`, "Week of " + dayLabel(wk) + ". Sales from channels with a customer location (website, Amazon 3P, Flipkart, Myntra, quick commerce, CRED). Nykaa, Amazon 1P and B2B are not in it."),
    card("South", esc(awFmt(southV)), `WoW ${esc(awPct(southPrev ? southV / southPrev - 1 : null))}`),
    card("South rel. index", esc(awIdx(southRel)), "vs clean rest of India", "Against the clean rest of India, each against its own 12-week baseline. 1.08 = the South grew 8% more than the clean rest of India against its own baseline. Clean: geos with other awareness media this week are left out."),
    card("South share", esc(sShare == null ? "—" : (sShare * 100).toFixed(1) + "%"), esc(awPp(sShare != null && sSharePrev != null ? sShare - sSharePrev : null)) + " WoW", "South's share of India. Share can rise just because other geos fell (Top Funnel went dark outside Tamil Nadu on 1 Nov). Read it with the relative index."),
    card("Active media", String(media), `${AW.level === "state" ? "states" : "city clusters"} this week`, "Geos with Treatment or Contaminated media in the focus week."),
    card("Geo coverage", esc(P.quality.unknown_state_pct == null ? "—" : (100 - P.quality.unknown_state_pct * 100).toFixed(1) + "%"), "sales with a state"),
  ].join("");
  const rows = X.geos.filter(awInRegion).map((g) => ({ g, m: X.metrics(g) })).sort((a, b) => (b.m.v || 0) - (a.m.v || 0));
  const strong = rows.filter((r) => r.g.eligible), weak = rows.filter((r) => !r.g.eligible);
  return `<section class="card" data-component="aw-kpis"><div class="kpis six">${kpis}</div></section>
    ${rgSec("India", `${AW_COLOUR.find((c) => c[0] === AW.colour)[1]} · week of ${esc(dayLabel(wk))} · click a geo for its detail`, awMap(P, X, rows),
      { ctl: `<div class="seg" id="aw-colour">${AW_COLOUR.map(([k, l]) => `<button type="button" data-k="${k}" aria-pressed="${AW.colour === k}">${esc(l)}</button>`).join("")}</div>`, comp: "aw-map" })}
    ${rgSec("Geos", "absolute, share and relative index together; never share alone", awGeoTable(P, X, strong, weak), { ctl: `<button type="button" class="rg-btn" data-awcsv="geos">CSV</button>`, comp: "aw-geos" })}
    <div class="cols-2">
      ${rgSec("The share trap", "x: share change vs baseline (pp) · y: relative index − 1", `<div class="chart-box" style="height:340px"><canvas id="c-aw-trap" aria-label="Share change against relative index"></canvas></div><div class="aw-legend"><span>↗ Real gain</span><span>↘ Share up only because others fell</span><span>↖ Growing, but others grew more</span><span>↙ Real decline</span></div>`, { comp: "aw-trap" })}
      ${rgSec("South vs rest of India", "weekly, both rebased to 100 at the 12-week baseline; relative index on the right", `${legend([["--accent", "South"], ["--muted", "Rest of India (dashed)"], ["--series-2", "Relative index (right)"]])}<div class="chart-box" style="height:340px"><canvas id="c-aw-region" aria-label="South against rest of India"></canvas></div><label class="legend-note"><input type="checkbox" id="aw-region-clean" ${AW.regionClean ? "checked" : ""}> Exclude contaminated geos${(() => { const o = P.geos.state.filter((g) => g.media.some((m, i) => m === "Contaminated" && i <= X.wi && i > X.wi - 26)).map((g) => awTitle(g.name)); return o.length ? ` (${esc(o.join(", "))})` : " (none in view)"; })()}</label>`, { comp: "aw-region" })}
    </div>`;
}
function awColour(m) {
  const v = AW.colour === "rel" ? (m.rel == null ? null : m.rel - 1) : AW.colour === "share" ? m.dshare * 10 : AW.colour === "wow" ? m.wow : m.mom;
  if (v == null || !isFinite(v)) return "var(--line)";
  const band = AW.colour === "rel" ? 0.05 : 0.02;
  if (Math.abs(v) <= band) return "#d9d6cf"; // neutral
  const t = Math.min(1, (Math.abs(v) - band) / 0.25);
  // colour-blind safe diverging: blue below, orange above (never red / green alone)
  return v < 0 ? `color-mix(in srgb, #2166ac ${Math.round(35 + t * 60)}%, #f2f2f2)` : `color-mix(in srgb, #e08214 ${Math.round(35 + t * 60)}%, #f2f2f2)`;
}
function awMap(P, X, rows) {
  const M = state.pages.awareness_map;
  if (!M) return '<p class="na">The map file is not loaded; the table below has every geo.</p>';
  const by = new Map(rows.map((r) => [r.g.key, r]));
  const alias = { "andaman & nicobar": "andaman and nicobar islands", "jammu & kashmir": "jammu and kashmir" };
  const pr = M.projection, pt = (lat, lng) => [(lng - pr.lon0) * pr.k * pr.scale, (pr.lat0 - lat) * pr.scale];
  const st = P.geos.state.reduce((m, g) => m.set(g.key, g), new Map());
  const tip = (r) => r ? `${r.g.name}\n${awFmt(r.m.v)} · WoW ${awPct(r.m.wow)} · share ${(r.m.share * 100).toFixed(1)}% (${awPp(r.m.dshare)}) · relative index ${awIdx(r.m.rel)}${r.m.status !== "None" ? "\n" + r.m.status : ""}${r.g.eligible ? "" : "\nlow volume"}` : "";
  let paths = "";
  for (const s of M.states) {
    const key = alias[s.name.toLowerCase()] || s.name.toLowerCase();
    const r = AW.level === "state" ? by.get(key) : null, g = st.get(key);
    const fill = AW.level === "city" ? "var(--line)" : !r ? "var(--line)" : !r.g.eligible ? "url(#aw-hatch)" : awColour(r.m);
    const cls = AW.level === "state" && r ? `st-${r.m.status}` : "";
    paths += `<path d="${s.d}" fill="${fill}" class="${cls} ${r && !awInRegion(r.g) ? "aw-faded" : ""}" ${r ? `tabindex="0" role="button" data-awgeo="state:${esc(key)}" aria-label="${esc(tip(r).replace(/\n/g, ", "))}"` : ""}><title>${esc(r ? tip(r) : awTitle(s.name))}</title></path>`;
  }
  let dots = "";
  if (AW.level === "city") {
    const maxV = Math.max(...rows.map((r) => r.m.v || 0), 1);
    for (const r of rows.slice().sort((a, b) => (b.m.v || 0) - (a.m.v || 0))) {
      if (!r.g.centroid) continue;
      const [x, y] = pt(r.g.centroid[0], r.g.centroid[1]), rad = 3 + 22 * Math.sqrt((r.m.v || 0) / maxV);
      const dash = r.m.status === "Contaminated" ? 'stroke-dasharray="4 2"' : r.m.status === "Dark" ? 'stroke-dasharray="1 2"' : "";
      dots += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${rad.toFixed(1)}" fill="${r.g.eligible ? awColour(r.m) : "url(#aw-hatch)"}" ${dash} stroke-width="${r.m.status === "Treatment" ? 2.5 : 0.8}" tabindex="0" role="button" data-awgeo="city:${esc(r.g.key)}" aria-label="${esc(tip(r).replace(/\n/g, ", "))}"><title>${esc(tip(r))}</title></circle>`;
    }
  }
  const unplaced = AW.level === "city" ? rows.filter((r) => !r.g.centroid).length : 0;
  const legend = `<div class="aw-legend"><span><i style="background:color-mix(in srgb, #2166ac 80%, #f2f2f2)"></i>below (${AW.colour === "rel" ? "< 0.95" : "falling"})</span><span><i style="background:#d9d6cf"></i>about even</span><span><i style="background:color-mix(in srgb, #e08214 80%, #f2f2f2)"></i>above (${AW.colour === "rel" ? "> 1.05" : "rising"})</span><span><i style="background:repeating-linear-gradient(45deg,#ccc 0 2px,#fff 2px 4px)"></i>low volume</span><span>━ Treatment</span><span>╌ Contaminated</span><span>┈ Dark</span></div>`;
  return `<div class="aw-map"><svg viewBox="0 0 ${M.width} ${M.height}" role="group" aria-label="Map of India by ${AW.level}"><defs><pattern id="aw-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#eee"/><line x1="0" y1="0" x2="0" y2="6" stroke="#bbb" stroke-width="2"/></pattern></defs>${paths}${dots}</svg></div>${legend}${unplaced ? `<p class="legend-note">${unplaced} city clusters have no map position yet; they are in the table.</p>` : ""}<p class="legend-note">State outlines: DataMeet India community (CC BY 4.0), simplified.</p>`;
}
function awSpark(arr, n = 12) {
  const a = arr.slice(-n).map((v) => (v == null || !isFinite(v) ? null : v));
  const ok = a.filter((v) => v != null);
  if (ok.length < 2) return "";
  const lo = Math.min(...ok, 1), hi = Math.max(...ok, 1), w = 70, h = 18;
  const y = (v) => h - 2 - ((v - lo) / (hi - lo || 1)) * (h - 4);
  const pts = a.map((v, i) => (v == null ? null : `${(i / (a.length - 1)) * w},${y(v).toFixed(1)}`)).filter(Boolean).join(" ");
  return `<svg class="aw-spark" width="${w}" height="${h}" aria-hidden="true"><line x1="0" x2="${w}" y1="${y(1)}" y2="${y(1)}" stroke="var(--line)"/><polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="1.5"/></svg>`;
}
function awGeoTable(P, X, strong, weak) {
  const relSeries = (g) => X.weeks.map((_, i) => (i <= X.wi && i > X.wi - 12 ? X.metrics(g, i).rel : null)).slice(Math.max(0, X.wi - 11), X.wi + 1);
  const mix = (g) => { const w = g.w[AW.kpi === "newc" ? "sales" : AW.kpi], t = w.ALL[X.wi] || 0; if (!t) return ""; return `<span class="aw-mix" title="${esc(`D2C ${(w.D2C[X.wi] / t * 100).toFixed(0)}% · Marketplace ${(w.MARKETPLACE[X.wi] / t * 100).toFixed(0)}% · Quick commerce ${(w.QUICK_COMMERCE[X.wi] / t * 100).toFixed(0)}%`)}"><span style="width:${(w.D2C[X.wi] / t) * 100}%;background:var(--series-1)"></span><span style="width:${(w.MARKETPLACE[X.wi] / t) * 100}%;background:var(--series-2)"></span><span style="width:${(w.QUICK_COMMERCE[X.wi] / t) * 100}%;background:var(--muted)"></span></span>`; };
  const newc = (g) => { const s = g.w.newc, v = s[X.wi], p = s[X.wi - 1]; return `${mFormat("count", v) ?? "—"} <span class="sub">${awPct(p ? v / p - 1 : null)}</span>`; };
  const cols = [
    { label: "#", render: (r) => String(r.rank) },
    { label: AW.level === "state" ? "State" : "City cluster", text: true, render: (r) => `<a href="#" data-awgeo="${AW.level}:${esc(r.g.key)}">${esc(awTitle(r.g.name))}</a> ${awChip(r.m.status)}`, csv: (r) => r.g.name },
    { label: "Week", render: (r) => `${esc(awFmt(r.m.v))} <span class="sub">${esc(awPct(r.m.wow))}</span>`, csv: (r) => Math.round(r.m.v) },
    { label: "vs same phase last month", render: (r) => esc(awPct(r.m.mom)) },
    { label: mHead("aw_share", "Share"), render: (r) => `${r.m.share == null ? "—" : (r.m.share * 100).toFixed(1) + "%"} <span class="sub">${esc(awPp(r.m.dshare))}</span>`, csv: (r) => r.m.share },
    { label: mHead("aw_rel_index", "Relative index"), render: (r) => `<b>${esc(awIdx(AW.clean ? r.m.rel : r.m.rel_all))}</b> ${awSpark(relSeries(r.g))}`, csv: (r) => (AW.clean ? r.m.rel : r.m.rel_all) },
    { label: "Channel mix", text: true, render: (r) => mix(r.g), csv: () => "" },
    { label: "D2C new customers", render: (r) => newc(r.g), csv: (r) => r.g.w.newc[X.wi] },
  ];
  strong.forEach((r, i) => { r.rank = i + 1; });
  AW.csv = { geos: { cols, rows: strong.concat(weak) } };
  return table(cols, strong, { full: true, maxHeight: "60vh" }) + (weak.length ? `<details><summary class="legend-note">${weak.length} low-volume geos (under the GeoLift threshold)</summary>${table(cols, weak.map((r, i) => ({ ...r, rank: strong.length + i + 1 })), { full: true, maxHeight: "40vh" })}</details>` : "")
    + `<p class="legend-note">Relative index ${AW.clean ? "against the clean rest of India (geos with other awareness media that week left out)" : "against all of the rest of India"}: 1.08 = this geo grew 8% more than the rest against its own 12-week baseline (before ${esc(dayLabel(X.ref))}). Week phases: ${esc(P.week_phase[X.wi])} this week; same-phase comparisons skip Mixed weeks.</p>`;
}

// ---------------------------------------------------------------- Tests
function awTestCard(t) {
  const v = t.verdict, pct = Math.min(100, (v.days_in / v.days_total) * 100);
  return `<button type="button" class="aw-card" data-awtest="${esc(t.test_id)}" aria-pressed="${AW.test === t.test_id}"><b>${esc(t.test_name)}</b><br>
    <span class="sub">${esc(t.geo_level)} · ${esc(t.status)} · KPI ${esc(t.kpi === "Y" ? "sales" : t.kpi)}</span>
    <div class="aw-prog" title="Day ${v.days_in} of ${v.days_total}"><span style="width:${pct}%"></span></div>
    <span class="sub">Day ${v.days_in} of ${v.days_total}</span><br>
    <span class="aw-v ${/detected/.test(v.main) ? "ok" : /no detectable|down/.test(v.main) ? "warn" : ""}">${esc(v.main)}</span> ${v.flags.map((f) => `<span class="aw-v warn">${esc(f)}</span>`).join(" ")}</button>`;
}
function awTests(P) {
  const T = (P.tests || []).find((t) => t.test_id === AW.test) || (P.tests || [])[0];
  if (!T) return '<section class="card"><p class="na">No tests in config (awareness.tests).</p></section>';
  const kpi = AW.testKpi;
  const res = (T.results || []).filter((r) => r.kpi === kpi);
  const power = res.find((r) => r.run_type === "power"), latest = res.find((r) => r.run_type === "interim" || r.run_type === "final");
  const ci = (lo, hi, f) => (lo == null || hi == null ? "" : ` <span class="sub">(CI ${f(lo)} to ${f(hi)})</span>`);
  const weak = latest && latest.lift_ci_low != null && latest.lift_ci_low < 0 && latest.lift_ci_high > 0;
  const head = latest ? `<div class="kpis six">
      <div class="kpi"><div class="kpi-l"><span class="kpi-n">Lift</span></div><div class="kpi-v ${weak ? "aw-faded" : ""}">${esc(awPct(latest.lift_pct, 0))}</div><div class="kpi-d">${ci(latest.lift_ci_low, latest.lift_ci_high, (x) => awPct(x, 0))}</div></div>
      <div class="kpi"><div class="kpi-l"><span class="kpi-n">Incremental ₹ (floor)</span></div><div class="kpi-v ${weak ? "aw-faded" : ""}">${esc(mFormat("currency", latest.incremental_sales, true) ?? "—")}</div><div class="kpi-d">${ci(latest.ci_low, latest.ci_high, (x) => mFormat("currency", x, true))}</div></div>
      <div class="kpi"><div class="kpi-l"><span class="kpi-n">iROAS</span></div><div class="kpi-v ${weak ? "aw-faded" : ""}">${latest.iroas == null ? "—" : latest.iroas.toFixed(2) + "x"}</div><div class="kpi-d">${ci(latest.iroas_ci_low, latest.iroas_ci_high, (x) => x.toFixed(2) + "x")}</div></div>
      <div class="kpi"><div class="kpi-l"><span class="kpi-n">Spend in window</span></div><div class="kpi-v">${esc(mFormat("currency", latest.spend_in_window, true) ?? "—")}</div><div class="kpi-d"><span class="kpi-vs">from config until geo spend is joined</span></div></div>
      <div class="kpi"><div class="kpi-l"><span class="kpi-n">p-value</span></div><div class="kpi-v">${latest.p_value == null ? "—" : latest.p_value.toFixed(3)}</div><div class="kpi-d"><span class="kpi-vs">${latest.run_type === "interim" ? "interim: never called significant" : "alpha 0.1"}</span></div></div>
      <div class="kpi"><div class="kpi-l"><span class="kpi-n">Run</span></div><div class="kpi-v">${esc(latest.run_type.toUpperCase())}</div><div class="kpi-d"><span class="kpi-vs">${esc(latest.run_date)}</span></div></div></div>`
    : `<div class="cro-empty" style="border:1px dashed var(--line);border-radius:10px;padding:12px">No GeoLift readout yet: the GeoLift job runs on Mondays (09:00 IST), from the first full test week. Until then the simple ratio tracker below is the live view.</div>`;
  const mde28 = power ? power.mde_28d : null, mde42 = power ? power.mde_42d : null, plaus = power ? power.plausible_lift : (T.weekly_spend * T.expected_iroas) / (awTestBase(P, T) || NaN);
  const scale = (x) => `${Math.min(100, Math.max(0, (x / 0.6) * 100))}%`;
  // labels stack at different heights so close values never overlap
  const marks = [[mde28, "MDE 28 days", "var(--ink-2)"], [mde42, "MDE 42 days", "var(--ink)"], [plaus, "Expected lift", "var(--accent)"]].filter(([x]) => x != null && isFinite(x)).sort((a, b) => a[0] - b[0]);
  const can = `<div class="aw-scale">${marks.map(([x, l, c], i) => `<span class="mk" style="left:${scale(x)};color:${c}"><span>${esc(l)} ${(x * 100).toFixed(0)}%</span><b style="height:${8 + (marks.length - 1 - i) * 18}px"></b></span>`).join("")}${[0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6].map((x) => `<span class="tk" style="left:${scale(x)}">${x * 100}%</span>`).join("")}</div>
    <p>${plaus != null && isFinite(plaus) ? `Expected lift ${(plaus * 100).toFixed(0)}% (₹${mFormat("count", T.weekly_spend)}/week × iROAS ${T.expected_iroas} ÷ the treatment's weekly baseline)` : (T.weekly_spend == null ? "Expected lift: — (this test's weekly spend is not set: add it to private/awareness.json in the bucket)" : "Expected lift: —")}${mde42 != null ? ` vs smallest detectable ${(mde42 * 100).toFixed(0)}% at 42 days: ${plaus < mde42 ? "this test can only detect a much bigger effect than we expect." : "the test can see an effect of the size we expect."}` : ": the smallest detectable lift comes with the first GeoLift power run."}</p>`;
  const inc = T.donors.filter((d) => d.included).sort((a, b) => (b.weight || 0) - (a.weight || 0) || (b.correlation || 0) - (a.correlation || 0));
  const exc = T.donors.filter((d) => !d.included);
  const maxW = Math.max(...inc.map((d) => d.weight || 0), 0.0001);
  const donorsHtml = `<h3>Included (${inc.length})</h3>${inc.slice(0, 30).map((d) => `<div class="aw-donor"><span>${esc(awTitle(d.location))}</span><span><span class="b" style="display:block;width:${d.weight != null ? (d.weight / maxW) * 100 : 0}%"></span></span><span title="GeoLift weight">${d.weight == null ? "—" : d.weight.toFixed(3)}</span><span title="Correlation with the treatment, pre-period, daily sales">${d.correlation == null ? "—" : d.correlation.toFixed(2)}</span></div>`).join("")}
    <p class="legend-note">Columns: GeoLift weight (after the first readout) · correlation with the treatment in the pre-period.</p>
    <h3>Excluded (${exc.length})</h3><p>${exc.map((d) => `<span class="aw-chip ${/^Contaminated/.test(d.exclusion_reason) ? "Contaminated" : "low"}" title="${esc(d.exclusion_reason)}">${esc(awTitle(d.location))} · ${esc(d.exclusion_reason)}</span>`).join(" ")}</p>`;
  const drift = T.drift || {}, dp = (latest && latest.donor_drift_pct != null) ? latest.donor_drift_pct : drift.pct;
  const driftHtml = `<p>Donor drift: <b class="${dp != null && dp < P.config.geolift.drift_flag ? "na" : ""}">${awPct(dp)}</b> vs the donors' own pre-period trend${dp != null && dp < P.config.geolift.drift_flag ? " · <span class=\"aw-v warn\">DONOR DRIFT</span> donors are falling (they went dark), which inflates the lift" : ""}.</p><div class="chart-box" style="height:160px"><canvas id="c-aw-drift" aria-label="Donors against their pre-period trend"></canvas></div>`;
  const q = T.quick || {};
  const quick = rgSec("Quick tracker", "Simple ratio tracker, not the GeoLift result", (q.weeks || []).length ? table([
    { label: "Week", text: true, render: (r) => esc(dayLabel(r.week)) + (r.complete ? "" : ' <span class="sub">(so far)</span>') },
    { label: "Treatment actual", render: (r) => esc(mFormat("currency", r.actual, true)) },
    { label: "Donor-implied", render: (r) => esc(mFormat("currency", r.expected, true)) },
    { label: "Lift", render: (r) => esc(awPct(r.lift_pct)) },
  ], q.weeks, { full: true }) + `<p class="legend-note">${esc(q.note || "")}</p>` : `<p class="na">${esc(q.note || "No full test week yet.")}</p>`, { comp: "aw-quick" });
  const hist = rgSec("Run history", "every GeoLift run, so movement between interim runs shows", table([
    { label: "Run", text: true, render: (r) => esc(`${r.run_date} · ${r.run_type}`) }, { label: "KPI", text: true, render: (r) => esc(r.kpi === "Y" ? "Sales" : "D2C new customers") },
    { label: "Lift", render: (r) => esc(awPct(r.lift_pct)) }, { label: "CI", render: (r) => (r.lift_ci_low == null ? "—" : esc(`${awPct(r.lift_ci_low, 0)} to ${awPct(r.lift_ci_high, 0)}`)) },
    { label: "p", render: (r) => (r.p_value == null ? "—" : r.p_value.toFixed(3)) }, { label: "MDE 42d", render: (r) => (r.mde_42d == null ? "—" : (r.mde_42d * 100).toFixed(0) + "%") },
  ], T.results || [], { full: true }), { comp: "aw-history" });
  const series = rgSec("Actual vs counterfactual", "treatment (solid) against its synthetic control (dashed), CI band; test window highlighted", `<div class="chart-box" style="height:300px"><canvas id="c-aw-cf" aria-label="Actual against counterfactual"></canvas></div>`,
    { ctl: `<div class="seg" id="aw-tkpi">${[["Y", "Sales"], ["d2c_new_customers", "D2C new customers"]].map(([k, l]) => `<button type="button" data-k="${k}" aria-pressed="${AW.testKpi === k}">${l}</button>`).join("")}</div><div class="seg" id="aw-tdaily">${[["d", "Daily"], ["w", "Weekly"]].map(([k, l]) => `<button type="button" data-k="${k}" aria-pressed="${AW.testDaily === (k === "d")}">${l}</button>`).join("")}</div>`, comp: "aw-cf" });
  const cum = rgSec("Cumulative incremental ₹", "across the test window, with the CI band (floor)", `<div class="chart-box" style="height:220px"><canvas id="c-aw-cum" aria-label="Cumulative incremental sales"></canvas></div>`, { comp: "aw-cum" });
  const haveSeries = T.series && T.series[kpi];
  return `<section class="card"><div class="aw-cards">${(P.tests || []).map(awTestCard).join("")}</div></section>
    <section class="card" data-component="aw-head"><div class="sec-head"><h2>${esc(T.test_name)}</h2><span class="q">${esc(T.test_start)} → ${esc(T.test_end)} · ${awFloor(P)}</span></div>${head}</section>
    ${haveSeries ? "" : quick}
    ${haveSeries ? series + cum : ""}
    <div class="cols-2">
      ${rgSec("Can this test see the effect?", "the smallest lift it can detect against the lift we expect", can, { comp: "aw-power" })}
      ${rgSec("Donors", "the comparison geos, and why every other geo is out", donorsHtml + driftHtml, { comp: "aw-donors" })}
    </div>
    ${haveSeries ? quick : ""}
    ${hist}
    ${rgSec("Notes", "", `<p>${esc(T.notes || "")}</p><p><b>Design caveat:</b> the donor geos are not untouched. On ${esc(T.test_start)} they lost Top Funnel at the same moment Tamil Nadu got the heavy-up, so this reads "Tamil Nadu with heavy-up Top Funnel vs Tamil Nadu with no Top Funnel", and the first weeks include awareness carry-over still decaying in the donors (see donor drift). ${esc(P.config.floor_note)}.</p>`)}`;
}
function awTestBase(P, T) { // the treatment's weekly sales over the last 12 pre-period weeks
  const lv = P.geos[T.geo_level] || [];
  const idx = P.weeks.map((w, i) => [w, i]).filter(([w]) => w < T.test_start).slice(-12).map(([, i]) => i);
  const tot = lv.filter((g) => T.treatment_locations.includes(g.key)).reduce((s, g) => s + idx.reduce((a, i) => a + g.w.sales.ALL[i], 0), 0);
  return idx.length ? tot / idx.length : null;
}

// ---------------------------------------------------------------- Test Planner
function awPlanner(P) {
  const rows = (P.testability || []).filter((r) => r.geo_level === AW.level).sort((a, b) => (a.mde_42d ?? 9) - (b.mde_42d ?? 9));
  const X = awCtx(P), status = new Map(X.geos.map((g) => [g.key, g.media[X.wi]]));
  // media live now or still to come in this geo: a new test there would be contaminated
  const busy = (loc) => { const ev = (P.events || []).filter((e) => e.review_status === "approved" && ["geo_targeted", "heavy_up", "leakage"].includes(e.event_type) && (!e.end_date || e.end_date >= P.as_of) && (AW.level === "state" ? e.locations : e.city_locations || []).includes(loc)); if (!ev.length) return null; const open = ev.some((e) => !e.end_date); return { text: open ? "Busy: media running, no end date" : `Busy until ${dayLabel(ev.map((e) => e.end_date).sort().pop())}`, ids: ev.map((e) => e.event_id).join(", ") }; };
  const table1 = rows.length ? table([
    { label: "Geo", text: true, render: (r) => `<a href="#" data-awgeo="${AW.level}:${esc(r.location)}">${esc(awTitle(r.location))}</a> ${awChip(status.get(r.location))}` },
    { label: "Avg daily sales", render: (r) => esc(mFormat("currency", r.avg_daily_sales, true)) },
    { label: mHead("aw_mde", "MDE 28d"), render: (r) => (r.mde_28d == null ? "—" : (r.mde_28d * 100).toFixed(0) + "%") },
    { label: "MDE 42d", render: (r) => (r.mde_42d == null ? "> 60%" : (r.mde_42d * 100).toFixed(0) + "%") },
    { label: "Min weekly spend to detect (iROAS 0.5)", render: (r) => esc(mFormat("currency", r.min_weekly_spend_to_detect_at_iroas_0_5 ?? r["min_weekly_spend_to_detect_at_iroas_0.5"], true) ?? "—") },
    { label: "Media now", text: true, render: (r) => { const b = busy(r.location); return b ? `<span class="aw-chip Contaminated" title="${esc(b.ids)}">${esc(b.text)}</span>` : '<span class="sub">Free to test</span>'; } },
    { label: "Scanned", text: true, render: (r) => esc(r.scan_date) },
  ], rows, { full: true, maxHeight: "55vh" }) : `<div style="border:1px dashed var(--line);border-radius:10px;padding:12px">No testability scan yet: the GeoLift job scans every eligible state and city on the 1st of each month (or run it now: <code>gcloud run jobs execute asaya-geolift-monthly --region asia-south1</code>).</div>`;
  const geos = rows.map((r) => r.location);
  if (!AW.plan.geo && geos.length) AW.plan.geo = geos[0];
  const calc = awPlanCalc(P);
  return `${rgSec("Testability", "every eligible geo, smallest detectable lift first", table1, { comp: "aw-testability" })}
    <div class="cols-2">
      ${rgSec("Sales against detectability", "avg daily sales (log) vs MDE at 42 days; line: a good test (≤ " + (P.config.planner.good_test_mde * 100).toFixed(0) + "%)", `<div class="chart-box" style="height:320px"><canvas id="c-aw-plan" aria-label="Sales against MDE"></canvas></div>`, { comp: "aw-plan-scatter" })}
      ${rgSec("Planner", "from the stored power curves; nothing runs here", calc, { comp: "aw-plan-calc" })}
    </div>`;
}
function awPlanCalc(P) {
  const key = `${AW.level}|${AW.plan.geo}`, curve = (P.power_curves || {})[key];
  const row = (P.testability || []).find((r) => r.geo_level === AW.level && r.location === AW.plan.geo);
  const opts = (P.testability || []).filter((r) => r.geo_level === AW.level).map((r) => r.location);
  const form = `<div class="aw-bar aw-form"><label>Geo <select id="aw-pl-geo">${opts.map((g) => `<option value="${esc(g)}" ${g === AW.plan.geo ? "selected" : ""}>${esc(awTitle(g))}</option>`).join("")}</select></label>
    <label>Days <select id="aw-pl-dur">${[28, 42].map((d) => `<option ${d === AW.plan.dur ? "selected" : ""}>${d}</option>`).join("")}</select></label>
    <label>Weekly spend ₹ <input id="aw-pl-spend" type="number" min="0" step="10000" value="${AW.plan.spend}" style="width:110px"></label>
    <label>Expected iROAS <input id="aw-pl-iroas" type="number" min="0" step="0.1" value="${AW.plan.iroas}" style="width:70px"></label></div>`;
  if (!row || !curve) return form + '<p class="na">Pick a geo once the monthly scan has run.</p>';
  const pts = curve[String(AW.plan.dur)] || [];
  const plaus = row.weekly_baseline ? (AW.plan.spend * AW.plan.iroas) / row.weekly_baseline : null;
  const mde = AW.plan.dur === 28 ? row.mde_28d : row.mde_42d;
  const pAt = (x) => { let best = null; for (const [e, p] of pts) if (e <= x + 1e-9) best = p; return best; };
  const ok = mde != null && plaus != null && plaus >= mde;
  const need = mde != null && row.weekly_baseline ? (mde * row.weekly_baseline) / AW.plan.iroas : null;
  AW.plan.copy = JSON.stringify({ test_id: `NEW_${AW.plan.geo.toUpperCase().replace(/\W+/g, "_")}`, test_name: `${awTitle(AW.plan.geo)}: <campaign>`, geo_level: AW.level, treatment_locations: [AW.plan.geo], manual_exclusions: [],
    pre_start: P.weeks[0], pre_end: "<day before the test>", test_start: "<start>", test_end: "<end>", kpi: "Y", weekly_spend: null, expected_iroas: AW.plan.iroas, linked_event_id: "<event id>", status: "planned", notes: "" }, null, 2);
  return form + `<p>Expected lift <b>${plaus == null ? "—" : (plaus * 100).toFixed(1) + "%"}</b> · MDE at ${AW.plan.dur} days <b>${mde == null ? "> 60%" : (mde * 100).toFixed(0) + "%"}</b> · power at that lift <b>${plaus == null ? "—" : ((pAt(plaus) ?? 0) * 100).toFixed(0) + "%"}</b></p>
    <p><span class="aw-v ${ok ? "ok" : "warn"}">${ok ? "Detectable" : `Not detectable: need ${need ? mFormat("currency", need, true) + "/week" : "a bigger budget"} or a longer test`}</span></p>
    <div class="chart-box" style="height:160px"><canvas id="c-aw-pc" aria-label="Power curve"></canvas></div>
    <p><button type="button" class="rg-btn" id="aw-copy">Copy config entry</button> <span class="legend-note">for awareness.tests in config.json; the weekly spend goes in private/awareness.json in the bucket (the repository is public). Nothing is written from here.</span></p>`;
}

// ---------------------------------------------------------------- Media & Leakage
function awMedia(P) {
  const ev = P.events || [], today = P.as_of, day = 864e5;
  // the window: two weeks before the first event to four weeks after today (or the last end date)
  const starts = ev.map((e) => Date.parse(e.start_date)), ends = ev.map((e) => Date.parse(e.end_date || today));
  const x0 = Math.min(Date.parse(today) - 28 * day, ...starts) - 14 * day, x1 = Math.max(Date.parse(today), ...ends) + 28 * day;
  const pc = (t) => (((t - x0) / (x1 - x0)) * 100).toFixed(2) + "%";
  const colour = { geo_targeted: "var(--series-2)", heavy_up: "var(--accent)", go_dark: "var(--muted)", leakage: "#e08214" };
  const ticks = []; for (let t = x0 + day; t < x1; t += day) { const d = new Date(t); if (d.getUTCDate() === 1) ticks.push(t); }
  const where = (e) => e.locations.map((l) => (l.startsWith("*except:") ? "all except " + awTitle(l.slice(8)) : awTitle(l))).join(", ");
  const rowsHtml = ev.map((e) => { const a = Math.max(x0, Date.parse(e.start_date)), b = Date.parse(e.end_date || today) + day, pend = e.review_status !== "approved";
    return `<div class="aw-g-row"><div class="aw-g-l"><b>${esc(e.platform)}</b> · ${esc(e.event_type.replace(/_/g, " "))}<br><span class="sub">${esc(where(e))}</span></div>
      <div class="aw-g-t"><span class="nowl" style="left:${pc(Date.parse(today))}"></span><span class="aw-g-bar${pend ? " pend" : ""}${e.end_date ? "" : " open"}" style="left:${pc(a)};width:calc(${pc(b)} - ${pc(a)});background:${colour[e.event_type] || "var(--series-1)"}" title="${esc(`${e.event_id} · ${e.account_or_campaign || ""} · ${e.start_date} → ${e.end_date || "no end date"}${pend ? " · awaiting review" : ""}`)}"></span></div></div>`; }).join("");
  const gantt = `<div class="aw-gantt"><div class="aw-g-row aw-g-axis"><div class="aw-g-l"></div><div class="aw-g-t">${ticks.map((t) => `<span class="tk" style="left:${pc(t)}">${esc(new Date(t).toLocaleDateString("en-IN", { month: "short" }))}</span>`).join("")}<span class="today" style="left:${pc(Date.parse(today))}">today</span></div></div>${rowsHtml}</div>
    <div class="aw-legend">${Object.entries(colour).map(([k, c]) => `<span><i style="background:${c}"></i>${esc(k.replace(/_/g, " "))}</span>`).join("")}<span><i style="border:1px dashed var(--ink)"></i>auto-proposed, awaiting review</span><span>▸ no end date yet</span></div>`;
  const leak = ev.filter((e) => e.event_type === "leakage");
  const pending = ev.filter((e) => e.review_status === "pending");
  return `${rgSec("Media timeline", "every media event that touches a geo (config awareness.media_events)", gantt, { comp: "aw-gantt" })}
    <div class="cols-2">
      ${rgSec("Leakage", `spend outside a campaign's target geos (flag above ${(P.config.leakage_flag * 100).toFixed(0)}%)`, leak.length ? table([
        { label: "Campaign", text: true, render: (e) => esc(e.account_or_campaign) }, { label: "Leaks into", text: true, render: (e) => esc(e.locations.join(", ")) },
        { label: "Share of spend", render: (e) => (e.leak_share == null ? '<span class="sub">not set</span>' : esc((e.leak_share * 100).toFixed(1) + "%")) }, { label: "Since", text: true, render: (e) => esc(e.start_date) },
      ], leak, { full: true }) + '<p class="legend-note">Measured leakage per campaign arrives with geo spend (phase 2).</p>' : '<p class="sub">None logged.</p>', { comp: "aw-leak" })}
      ${rgSec("Review queue", "auto-proposed events wait here; approve or reject them in config.json (awareness.media_events, review_status)", pending.length ? table([{ label: "Event", text: true, render: (e) => esc(e.event_id) }, { label: "Waiting", render: (e) => esc(String(Math.round((Date.parse(today) - Date.parse(e.start_date)) / 864e5)) + " days") }], pending) : '<p class="sub">Nothing waiting. Auto-detection (a campaign with > 80% of spend in one geo, or a geo whose spend share moves > 2x) starts with geo spend in phase 2.</p>', { comp: "aw-review" })}
    </div>
    ${rgSec("Geo spend", "awareness and performance spend by state and week", '<div style="border:1px dashed var(--line);border-radius:10px;padding:12px"><b>Phase 2.</b> Meta (both accounts, region breakdown) and Google Ads (geographic view) spend by geo, daily. Until then iROAS uses the weekly spend in each test\'s config.</div>', { comp: "aw-spend" })}`;
}

// ---------------------------------------------------------------- drawer
async function awDrawer(P, level, key) {
  document.getElementById("aw-drawer")?.remove();
  const g = (P.geos[level] || []).find((x) => x.key === key);
  if (!g) return;
  let D = state.pages.awareness_daily;
  if (!D) { try { D = await loadPage("awareness_daily"); } catch (e) { D = null; } }
  const X = awCtx({ ...P }), saved = AW.level; AW.level = level; const X2 = awCtx(P); AW.level = saved;
  const m = X2.metrics(g);
  const cities = level === "state" ? P.geos.city.filter((c) => c.state === key).map((c) => ({ c, m: X2.metrics(c) })) : [];
  const tests = (P.tests || []).filter((t) => t.treatment_locations.includes(key) || (t.donors || []).some((d) => d.location === key));
  const tb = (P.testability || []).find((r) => r.geo_level === level && r.location === key);
  const el = document.createElement("aside");
  el.id = "aw-drawer"; el.className = "aw-drawer"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", g.name);
  el.innerHTML = `<button type="button" class="x" aria-label="Close">×</button>
    <h2>${esc(awTitle(g.name))}</h2><p class="sub">${level === "city" ? `${esc(awTitle(g.state))} · ` : ""}${esc(g.region)} · ${g.eligible ? "eligible for GeoLift" : "low volume"} ${awChip(m.status)}</p>
    <p>Week of ${esc(dayLabel(X2.weeks[X2.wi]))}: <b>${esc(awFmt(m.v))}</b> · WoW ${esc(awPct(m.wow))} · share ${m.share == null ? "—" : (m.share * 100).toFixed(1) + "%"} (${esc(awPp(m.dshare))}) · relative index <b>${esc(awIdx(m.rel))}</b> (all: ${esc(awIdx(m.rel_all))})</p>
    <div class="seg" id="aw-dr-mode"><button type="button" data-k="w" aria-pressed="${!AW.chartDaily}">Weekly</button><button type="button" data-k="d" aria-pressed="${AW.chartDaily}">Daily</button></div>
    ${AW.chartDaily ? "" : legend([["--accent", "Sales"], ["--muted", "12-week baseline (dashed)"], ["--series-2", "Relative index (right)"]])}<div class="chart-box" style="height:260px"><canvas id="c-aw-dr" aria-label="Sales against baseline"></canvas></div>
    <h3>Channel split</h3>${legend([["--series-1", "D2C"], ["--series-2", "Marketplace"], ["--muted", "Quick commerce"]])}<div class="chart-box" style="height:200px"><canvas id="c-aw-dr-mix" aria-label="Channel split over time"></canvas></div>
    <h3>D2C new customers</h3><div class="chart-box" style="height:160px"><canvas id="c-aw-dr-new" aria-label="D2C new customers"></canvas></div>
    ${cities.length ? `<h3>City clusters in ${esc(awTitle(key))}</h3>${table([{ label: "City", text: true, render: (r) => `<a href="#" data-awgeo="city:${esc(r.c.key)}">${esc(awTitle(r.c.name))}</a> ${awChip(r.m.status)}` }, { label: "Week", render: (r) => esc(awFmt(r.m.v)) }, { label: "WoW", render: (r) => esc(awPct(r.m.wow)) }, { label: "Relative index", render: (r) => esc(awIdx(r.m.rel)) }], cities.sort((a, b) => (b.m.v || 0) - (a.m.v || 0)).slice(0, 15), { full: true })}` : ""}
    ${level === "city" && g.state ? `<p>State: <a href="#" data-awgeo="state:${esc(g.state)}">${esc(awTitle(g.state))}</a></p>` : ""}
    <h3>Tests</h3>${tests.length ? tests.map((t) => `<p>${esc(t.test_name)}: <span class="aw-v">${esc(t.verdict.main)}</span> (${t.treatment_locations.includes(key) ? "treatment" : "donor"})</p>`).join("") : '<p class="sub">Not in a test.</p>'}
    <h3>Testability</h3>${tb ? `<p>MDE ${tb.mde_28d == null ? "—" : (tb.mde_28d * 100).toFixed(0) + "%"} (28 days) · ${tb.mde_42d == null ? "> 60%" : (tb.mde_42d * 100).toFixed(0) + "%"} (42 days) · min ${esc(mFormat("currency", tb.min_weekly_spend_to_detect_at_iroas_0_5 ?? tb["min_weekly_spend_to_detect_at_iroas_0.5"], true) ?? "—")}/week · <a href="#awareness?sub=planner&level=${level}" data-awplan="${esc(key)}">open in the planner</a></p>` : '<p class="sub">Not scanned yet.</p>'}
    <p class="legend-note">Spend against sales arrives with geo spend (phase 2); an overlay never shows cause.</p>`;
  document.body.appendChild(el);
  const close = () => { el.remove(); AW.drawer = null; awUrl(); };
  el.querySelector(".x").addEventListener("click", close);
  el.addEventListener("keydown", (ev) => { if (ev.key === "Escape") close(); });
  el.addEventListener("click", (ev) => {
    const a = ev.target.closest("[data-awgeo]"); if (a) { ev.preventDefault(); const [lv, k] = a.dataset.awgeo.split(":"); AW.drawer = { level: lv, key: k }; awUrl(); awDrawer(P, lv, k); }
    const b = ev.target.closest("#aw-dr-mode button[data-k]"); if (b) { AW.chartDaily = b.dataset.k === "d"; awDrawer(P, level, key); }
    const pl = ev.target.closest("[data-awplan]"); if (pl) { AW.plan.geo = pl.dataset.awplan; AW.level = level; AW.sub = "planner"; close(); awDraw(P); }
  });
  el.querySelector(".x").focus();
  // charts
  const labels = AW.chartDaily && D ? D.dates : P.weeks.map((w) => dayLabel(w));
  const vals = AW.chartDaily && D ? (D[level] || {})[key] || [] : awSeries(g);
  const base = X2.mean(awSeries(g), X2.baseIdx);
  const relLine = AW.chartDaily ? [] : P.weeks.map((_, i) => X2.metrics(g, i).rel);
  const sale = P.week_phase.map((p) => p === "Sale");
  baseChart(document.getElementById("c-aw-dr"), { type: "line", data: { labels: AW.chartDaily && D ? D.dates.map(dayLabel) : labels, datasets: [
    { label: "Sales", data: vals, borderColor: css("--accent"), borderWidth: 2, pointRadius: AW.chartDaily ? 0 : 2, tension: 0.2, yAxisID: "y" },
    ...(AW.chartDaily ? [] : [{ label: "12-week baseline", data: vals.map(() => base), borderColor: css("--muted"), borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0, yAxisID: "y" },
      { label: "Relative index", data: relLine, borderColor: css("--series-2"), borderWidth: 1.5, pointRadius: 0, yAxisID: "y1" }]),
  ] }, options: { scales: awScales(AW.kpi === "sales" ? "inr" : "int", AW.chartDaily ? {} : { y1: {} }) }, plugins: [awMarkers(P, sale, AW.chartDaily)] }, AW.kpi === "sales" ? "inr" : "int");
  baseChart(document.getElementById("c-aw-dr-mix"), { type: "line", data: { labels: P.weeks.map(dayLabel), datasets: [["D2C", "--series-1"], ["MARKETPLACE", "--series-2"], ["QUICK_COMMERCE", "--muted"]].map(([k, c]) => ({ label: awTitle(k.replace("_", " ")), data: g.w.sales[k], borderColor: css(c), backgroundColor: css(c), fill: true, pointRadius: 0, borderWidth: 1 })) }, options: { scales: awScales("inr", { y: { stacked: true } }) } }, "inr");
  baseChart(document.getElementById("c-aw-dr-new"), { type: "bar", data: { labels: P.weeks.map(dayLabel), datasets: [{ label: "D2C new customers", data: g.w.newc, backgroundColor: css("--series-1") }] } }, "int");
}
/* sale weeks shaded and media events marked on a weekly chart */
function awMarkers(P, sale, daily) {
  return { id: "aw-markers", beforeDatasetsDraw(chart) {
    if (daily) return;
    const { ctx, chartArea: a, scales: { x } } = chart;
    ctx.save();
    sale.forEach((s, i) => { if (!s) return; const x0 = x.getPixelForValue(i) - (x.width / sale.length) / 2; ctx.fillStyle = "rgba(224,130,20,0.08)"; ctx.fillRect(x0, a.top, x.width / sale.length, a.bottom - a.top); });
    for (const e of P.events || []) { const i = P.weeks.findIndex((w) => w >= e.start_date); if (i < 0) continue; const px = x.getPixelForValue(i); ctx.strokeStyle = "rgba(0,0,0,0.35)"; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(px, a.top); ctx.lineTo(px, a.bottom); ctx.stroke(); }
    ctx.restore();
  } };
}

// ---------------------------------------------------------------- events and charts
function awBind(P) {
  const host = document.getElementById("rg-body"), redraw = () => { destroyCharts(); awDraw(P); };
  const on = (id, fn) => document.getElementById(id)?.addEventListener("change", (ev) => { fn(ev.target); redraw(); });
  on("aw-level", (t) => { AW.level = t.value; }); on("aw-region", (t) => { AW.region = t.value; });
  on("aw-group", (t) => { AW.group = t.value; if (AW.kpi === "newc" && t.value !== "D2C") AW.kpi = "sales"; });
  on("aw-kpi", (t) => { AW.kpi = t.value; }); on("aw-clean", (t) => { AW.clean = t.checked; }); on("aw-test", (t) => { AW.test = t.value; });
  on("aw-region-clean", (t) => { AW.regionClean = t.checked; });
  on("aw-pl-geo", (t) => { AW.plan.geo = t.value; }); on("aw-pl-dur", (t) => { AW.plan.dur = +t.value; });
  on("aw-pl-spend", (t) => { AW.plan.spend = +t.value || 0; }); on("aw-pl-iroas", (t) => { AW.plan.iroas = +t.value || 0; });
  document.getElementById("aw-copy")?.addEventListener("click", () => { navigator.clipboard?.writeText(AW.plan.copy || ""); document.getElementById("aw-copy").textContent = "Copied"; });
  if (!host.dataset.awBound) {
    host.dataset.awBound = "1";
    host.addEventListener("click", (ev) => {
      const sub = ev.target.closest("[data-awsub]"); if (sub) { ev.preventDefault(); AW.sub = sub.dataset.awsub; destroyCharts(); awDraw(state.pages.awareness); return; }
      const geo = ev.target.closest("[data-awgeo]"); if (geo) { ev.preventDefault(); const [lv, k] = geo.dataset.awgeo.split(":"); AW.drawer = { level: lv, key: k }; awUrl(); awDrawer(state.pages.awareness, lv, k); return; }
      const t = ev.target.closest("[data-awtest]"); if (t) { AW.test = t.dataset.awtest; destroyCharts(); awDraw(state.pages.awareness); return; }
      const c = ev.target.closest("[data-awcsv]"); if (c) { awCsv(c.dataset.awcsv); return; }
      const b = ev.target.closest(".seg button[data-k]"); if (!b) return;
      const id = b.parentElement.id;
      if (id === "aw-colour") AW.colour = b.dataset.k; else if (id === "aw-tkpi") AW.testKpi = b.dataset.k; else if (id === "aw-tdaily") AW.testDaily = b.dataset.k === "d"; else return;
      destroyCharts(); awDraw(state.pages.awareness);
    });
    host.addEventListener("keydown", (ev) => { const g = ev.target.closest("[data-awgeo]"); if (g && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); g.dispatchEvent(new MouseEvent("click", { bubbles: true })); } });
  }
  // the sub-tab links live in the header nav, outside rg-body
  document.querySelectorAll("nav.subtabs [data-awsub]").forEach((a) => { a.onclick = (ev) => { ev.preventDefault(); AW.sub = a.dataset.awsub; document.querySelectorAll("nav.subtabs [data-awsub]").forEach((x) => x.toggleAttribute("aria-current", x === a)); if (a.getAttribute("aria-current") === "") a.setAttribute("aria-current", "page"); destroyCharts(); awDraw(P); }; });
  awCharts(P);
}
function awCsv(id) {
  const t = (AW.csv || {})[id]; if (!t) return;
  const plain = (h) => String(h ?? "").replace(/<[^>]+>/g, "").trim();
  const q = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [t.cols.map((c) => q(plain(c.label))).join(",")].concat(t.rows.map((r) => t.cols.map((c) => q(plain(c.csv ? c.csv(r) : c.render(r)))).join(",")));
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" })); a.download = `asaya-awareness-${id}.csv`; document.body.appendChild(a); a.click(); a.remove();
}
function awCharts(P) {
  const X = awCtx(P);
  const trap = document.getElementById("c-aw-trap");
  if (trap && window.Chart) {
    const pts = X.geos.filter((g) => g.eligible && awInRegion(g)).map((g) => ({ g, m: X.metrics(g) })).filter((r) => r.m.dshare != null && r.m.rel != null);
    const maxV = Math.max(...pts.map((r) => r.m.v || 0), 1);
    state.charts.push(new Chart(trap, { type: "bubble", data: { datasets: [{ label: "Geo", data: pts.map((r) => ({ x: r.m.dshare * 100, y: r.m.rel - 1, r: 3 + 14 * Math.sqrt((r.m.v || 0) / maxV), key: r.g.key, name: awTitle(r.g.name) })),
      backgroundColor: pts.map((r) => (r.m.status === "Treatment" ? css("--accent") : r.m.status === "Contaminated" ? "#e08214" : css("--series-1"))) }] },
      options: { responsive: true, maintainAspectRatio: false, animation: false, onClick: (e, els) => { if (els[0]) { const d = els[0].element.$context.raw; AW.drawer = { level: AW.level, key: d.key }; awUrl(); awDrawer(P, AW.level, d.key); } },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ` ${c.raw.name}: share ${c.raw.x >= 0 ? "+" : ""}${c.raw.x.toFixed(2)} pp · index ${(c.raw.y + 1).toFixed(2)}` } } },
        scales: { x: { title: { display: true, text: "Share change vs baseline (pp)" } }, y: { title: { display: true, text: "Relative index − 1" } } } },
      plugins: [{ id: "aw-quad", beforeDatasetsDraw(ch) { const { ctx, chartArea: a, scales: { x, y } } = ch; const x0 = x.getPixelForValue(0), y0 = y.getPixelForValue(0); ctx.save(); ctx.strokeStyle = "rgba(0,0,0,0.3)"; ctx.beginPath(); ctx.moveTo(x0, a.top); ctx.lineTo(x0, a.bottom); ctx.moveTo(a.left, y0); ctx.lineTo(a.right, y0); ctx.stroke(); ctx.fillStyle = "rgba(0,0,0,0.45)"; ctx.font = "11px sans-serif";
        ctx.fillText("Real gain", a.right - 70, a.top + 12); ctx.fillText("Share up only because others fell", a.right - 200, a.bottom - 6); ctx.fillText("Growing, others grew more", a.left + 4, a.top + 12); ctx.fillText("Real decline", a.left + 4, a.bottom - 6); ctx.restore(); } }] }));
  }
  const reg = document.getElementById("c-aw-region");
  if (reg) {
    const st = P.geos.state, south = st.filter((g) => g.region === "South");
    const n = P.weeks.length, idx = [...Array(n).keys()].filter((i) => i <= X.wi).slice(-26);
    // geos other awareness media touched at any point in view are left out of every week, baseline included, so the comparison stays like for like
    const out = new Set(st.filter((g) => idx.some((i) => g.media[i] === "Contaminated")).map((g) => g.key));
    const sum = (gs, i, clean) => gs.reduce((s, g) => s + (clean && out.has(g.key) ? 0 : awSeries(g)[i] || 0), 0);
    const rest = (i, clean) => X.nat[i] - sum(south, i, false) - (clean ? st.filter((g) => g.region !== "South" && out.has(g.key)).reduce((s, g) => s + (awSeries(g)[i] || 0), 0) : 0);
    const sb = X.mean(X.baseIdx.map((j) => sum(south, j, AW.regionClean)), X.baseIdx.map((_, k) => k)), rb = X.mean(X.baseIdx.map((j) => rest(j, AW.regionClean)), X.baseIdx.map((_, k) => k));
    const sIdx = idx.map((i) => (sb ? (sum(south, i, AW.regionClean) / sb) * 100 : null)), rIdx = idx.map((i) => (rb ? (rest(i, AW.regionClean) / rb) * 100 : null));
    baseChart(reg, { type: "line", data: { labels: idx.map((i) => dayLabel(P.weeks[i])), datasets: [
      { label: "South (index)", data: sIdx, borderColor: css("--accent"), borderWidth: 2, pointRadius: 0 },
      { label: "Rest of India (index)", data: rIdx, borderColor: css("--muted"), borderDash: [5, 4], borderWidth: 2, pointRadius: 0 },
      { label: "Relative index", data: sIdx.map((s, k) => (s && rIdx[k] ? s / rIdx[k] : null)), borderColor: css("--series-2"), borderWidth: 1.5, pointRadius: 0, yAxisID: "y1" },
    ] }, options: { scales: awScales("int", { y1: {} }) }, plugins: [awMarkers({ ...P, weeks: idx.map((i) => P.weeks[i]) }, idx.map((i) => P.week_phase[i] === "Sale"), false)] }, "int");
  }
  const T = (P.tests || []).find((t) => t.test_id === AW.test);
  const S = T && T.series && T.series[AW.testKpi];
  const cf = document.getElementById("c-aw-cf");
  if (cf && S) {
    let lab = S.dates, a = S.actual, c = S.counterfactual, lo = S.ci_low, hi = S.ci_high;
    if (!AW.testDaily) { const wk = new Map(); S.dates.forEach((d, i) => { const m = new Date(Date.parse(d) - ((new Date(d).getUTCDay() + 6) % 7) * 864e5).toISOString().slice(0, 10); const v = wk.get(m) || [0, 0, 0, 0]; v[0] += a[i]; v[1] += c[i]; v[2] += lo[i] ?? 0; v[3] += hi[i] ?? 0; wk.set(m, v); }); lab = [...wk.keys()]; a = [...wk.values()].map((v) => v[0]); c = [...wk.values()].map((v) => v[1]); lo = [...wk.values()].map((v) => v[2]); hi = [...wk.values()].map((v) => v[3]); }
    const ti = lab.findIndex((d) => d >= S.test_start);
    baseChart(cf, { type: "line", data: { labels: lab.map(dayLabel), datasets: [
      { label: "CI high", data: hi, borderColor: "transparent", backgroundColor: "rgba(0,0,0,0.07)", pointRadius: 0, fill: "+1" }, { label: "CI low", data: lo, borderColor: "transparent", pointRadius: 0, fill: false },
      { label: "Synthetic control", data: c, borderColor: css("--muted"), borderDash: [5, 4], borderWidth: 2, pointRadius: 0 },
      { label: "Treatment", data: a, borderColor: css("--accent"), borderWidth: 2, pointRadius: 0 },
    ] }, plugins: [{ id: "aw-tw", beforeDatasetsDraw(ch) { if (ti < 0) return; const { ctx, chartArea: ar, scales: { x } } = ch; ctx.save(); ctx.fillStyle = "rgba(224,130,20,0.08)"; const px = x.getPixelForValue(ti); ctx.fillRect(px, ar.top, ar.right - px, ar.bottom - ar.top); ctx.restore(); } }] }, AW.testKpi === "Y" ? "inr" : "int");
    const cum = document.getElementById("c-aw-cum");
    if (cum) { let s = 0, sl = 0, sh = 0; const i0 = S.dates.findIndex((d) => d >= S.test_start); const xs = S.dates.slice(i0);
      const ys = xs.map((_, k) => (s += S.actual[i0 + k] - S.counterfactual[i0 + k])), yl = xs.map((_, k) => (sl += S.actual[i0 + k] - (S.ci_high[i0 + k] ?? S.counterfactual[i0 + k]))), yh = xs.map((_, k) => (sh += S.actual[i0 + k] - (S.ci_low[i0 + k] ?? S.counterfactual[i0 + k])));
      baseChart(cum, { type: "line", data: { labels: xs.map(dayLabel), datasets: [{ label: "CI high", data: yh, borderColor: "transparent", backgroundColor: "rgba(0,0,0,0.07)", pointRadius: 0, fill: "+1" }, { label: "CI low", data: yl, borderColor: "transparent", pointRadius: 0 }, { label: "Cumulative incremental", data: ys, borderColor: css("--accent"), borderWidth: 2, pointRadius: 0 }] } }, "inr"); }
  }
  const dr = document.getElementById("c-aw-drift");
  if (dr && T && T.drift && (T.drift.pre || T.drift.weeks)) {
    const all = (T.drift.pre || []).concat(T.drift.weeks || []);
    baseChart(dr, { type: "line", data: { labels: all.map((r) => dayLabel(r.week)), datasets: [{ label: "Donors actual", data: all.map((r) => r.actual), borderColor: css("--accent"), borderWidth: 2, pointRadius: 0 }, { label: "Donors' pre-period trend", data: all.map((r) => r.trend), borderColor: css("--muted"), borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0 }] } }, "inr");
  }
  const pl = document.getElementById("c-aw-plan");
  if (pl && window.Chart) {
    const rows = (P.testability || []).filter((r) => r.geo_level === AW.level && r.mde_42d != null);
    const rc = { South: css("--accent"), North: css("--series-1"), West: css("--series-2"), East: "#e08214", "North-East": css("--muted") };
    const regOf = new Map((P.geos[AW.level] || []).map((g) => [g.key, g.region]));
    state.charts.push(new Chart(pl, { type: "scatter", data: { datasets: [{ label: "Geo", data: rows.map((r) => ({ x: r.avg_daily_sales, y: r.mde_42d * 100, name: awTitle(r.location) })), backgroundColor: rows.map((r) => rc[regOf.get(r.location)] || css("--muted")) },
      { type: "line", label: "Good test", data: [{ x: Math.min(...rows.map((r) => r.avg_daily_sales), 1000), y: P.config.planner.good_test_mde * 100 }, { x: Math.max(...rows.map((r) => r.avg_daily_sales), 2000), y: P.config.planner.good_test_mde * 100 }], borderColor: css("--muted"), borderDash: [4, 4], pointRadius: 0 }] },
      options: { responsive: true, maintainAspectRatio: false, animation: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => (c.raw.name ? ` ${c.raw.name}: ₹${Math.round(c.raw.x).toLocaleString("en-IN")}/day · MDE ${c.raw.y.toFixed(0)}%` : "") } } },
        scales: { x: { type: "logarithmic", title: { display: true, text: "Avg daily sales (₹, log)" }, ticks: { autoSkip: false, maxRotation: 0, callback: (v) => ([1, 2, 5].includes(+String(v)[0]) && /^\d0*$/.test(String(v)) ? mFormat("currency", v, true) : "") } }, y: { title: { display: true, text: "MDE at 42 days (%)" } } } } }));
  }
  const pc = document.getElementById("c-aw-pc");
  if (pc) { const pts = ((P.power_curves || {})[`${AW.level}|${AW.plan.geo}`] || {})[String(AW.plan.dur)] || []; baseChart(pc, { type: "line", data: { labels: pts.map((p) => (p[0] * 100).toFixed(0) + "%"), datasets: [{ label: "Power", data: pts.map((p) => p[1]), borderColor: css("--accent"), borderWidth: 2, pointRadius: 0 }] } }, "pct"); }
}

// ---------------------------------------------------------------- Data health: Awareness data
function awHealth(P) {
  if (!P || !P.checks) return '<p class="na">Data unavailable: the Awareness job has not run yet.</p>';
  const checks = table([{ label: "#", render: (c) => esc(String(c.id)) }, { label: "Check", text: true, render: (c) => esc(c.check) }, { label: "Result", text: true, render: (c) => esc(c.value || "") },
    { label: "", text: true, render: (c) => (c.pass === true ? '<span class="chip ok">Pass</span>' : c.pass === false ? '<span class="chip missing">Fail</span>' : '<span class="chip">Waiting</span>') }], P.checks, { full: true });
  const q = P.quality || {};
  const unk = table([{ label: "Channel", text: true, render: (r) => esc(r.channel) }, { label: "Sales", render: (r) => esc(mFormat("currency", r.sales, true)) },
    { label: "Unknown state", render: (r) => `<span class="${r.unknown_state_pct > 0.02 ? "na" : ""}">${(r.unknown_state_pct * 100).toFixed(2)}%</span>` }, { label: "Unknown city", render: (r) => `<span class="${r.unknown_city_pct > 0.02 ? "na" : ""}">${(r.unknown_city_pct * 100).toFixed(2)}%</span>` }], q.by_channel || [], { full: true });
  const un = (q.unmapped_top || []).length ? table([{ label: "Raw city", text: true, render: (r) => esc(r.city) }, { label: "State", text: true, render: (r) => esc(r.state || "") }, { label: "Sales", render: (r) => esc(mFormat("currency", r.sales, true)) }, { label: "Suggested cluster", text: true, render: (r) => esc(r.suggested_cluster || "") }], q.unmapped_top, { full: true, maxHeight: "40vh" }) + '<p class="legend-note">Suggestions come from config awareness.city_clusters_proposed; they change nothing until moved into city_clusters.</p>' : '<p class="sub">No proposed mapping is waiting.</p>';
  const runs = table([{ label: "Job", text: true, render: (r) => esc(r.job) }, { label: "When", text: true, render: (r) => esc(new Date(r.run_time).toLocaleString("en-IN")) }, { label: "Status", text: true, render: (r) => (r.status === "ok" ? '<span class="chip ok">ok</span>' : `<span class="chip missing" title="${esc(r.error || "")}">${esc(r.status)}</span>`) }, { label: "Rows", render: (r) => esc(r.rows ?? "–") }, { label: "Seconds", render: (r) => esc(r.duration_s ?? "–") }], (P.run_log || []).slice(0, 12), { full: true });
  return `<h3>Acceptance checks</h3>${checks}<h3>Locations by channel</h3>${unk}<p class="legend-note">Target: under 2% unknown. Panel: ${q.panel ? `${q.panel.dates} days × ${q.panel.states} states and ${q.panel.cities} city clusters, zero-filled` : "—"}.</p>
    <h3>Unmapped city names</h3>${un}<h3>Runs</h3>${runs}
    <h3>Offer calendar</h3><p>Week phases (Sale / BAU / Mixed) come from ${esc(P.phase_source || "the dashboard's sale calendar")}. Days the team's sale calendar does not cover use hourly-order detection.</p>
    <h3>Map file</h3><p>State outlines: DataMeet India community, github.com/datameet/maps (States/Admin2), licensed CC BY 4.0; simplified for the dashboard.</p>`;
}
