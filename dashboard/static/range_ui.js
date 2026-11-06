/* Date-range picker and the range-driven Overview and Daily tabs. Inlined into
   app.html inside the dashboard closure, so it shares esc(), fmt(), table(),
   dayLabel(), deltaHtml(), baseChart(), the R registry and $main. The numbers
   come from range_engine.js, over the per-day "days" page. */

const RG = { eng: null, raw: null, mode: "perf", scope: "perf", from: null, to: null, preset: "mtd", cmp: { mode: "month" }, cmpAuto: true, pop: null, draft: null, view: null, error: null };
try {
  const savedMode = (JSON.parse(sessionStorage.getItem("asaya-range") || "null") || {}).mode;
  if (["perf", "aw", "all"].includes(savedMode)) RG.scope = savedMode;
} catch (e) { /* storage blocked: stay on Performance */ }
const RG_CMP = [
  ["previous", "Previous period", "The same number of days straight before"],
  ["month", "Same period last month", "The same dates one month earlier"],
  ["year", "Same period last year", "The same dates one year earlier"],
  ["match", "Last matching period", "The most recent earlier days of the same kind (sale or BAU)"],
  ["custom", "Custom range…", "Pick any dates"],
  ["none", "No comparison", ""],
];
const RG_RATES = ["roas", "cps_all", "cps_ad", "sh_roas_all", "aov", "cvr", "sh_aov", "sh_cvr", "sh_perf_cvr", "sh_ic_to_order", "sh_roas", "perf_cvr", "ic_to_order", "cps", "perf_overall_roas", "atc_rate", "mer", "perf_roas", "meta_sales_roas", "google_sales_roas", "new_share", "overall_roas", "affiliate_roas", "crm_roas", "crm_flow_roas", "crm_broadcast_roas"];
const RG_DEP = {
  roas: ["store_gmv", "perf_all_spend"], aov: ["gmv", "orders"], cvr: ["orders", "sessions"], atc_rate: ["atc", "sessions"], mer: ["gmv", "spend"],
  perf_roas: ["gmv", "perf_spend"], meta_sales_roas: ["meta_perf_value", "meta_perf_spend"],
  google_sales_roas: ["google_perf_value", "google_perf_spend"], new_share: ["new_orders", "repeat_orders"], atc_to_ic: ["atc", "ic"], ic_to_order: ["orders", "ic"], perf_cvr: ["orders", "report_perf_sessions"], cps: ["perf_all_spend", "sessions"], cps_all: ["all_spend", "sessions"], cps_ad: ["spend", "sessions"], sh_roas_all: ["sh_sales", "all_spend"], sh_aov: ["sh_sales", "sh_orders"], sh_cvr: ["sh_orders", "sessions"], sh_perf_cvr: ["sh_orders", "report_perf_sessions"], sh_ic_to_order: ["sh_orders", "ic"], sh_roas: ["sh_sales", "perf_all_spend"], perf_overall_roas: ["gmv", "perf_all_spend"],
  overall_roas: ["gmv", "all_spend"], affiliate_roas: ["affiliate_revenue", "affiliate_spend"], crm_roas: ["crm_revenue", "crm_spend"],
  crm_flow_roas: ["crm_flow_revenue", "crm_flow_spend"], crm_broadcast_roas: ["crm_broadcast_revenue", "crm_broadcast_spend"],
};
const rgNa = (w, k) => w.na[k] || (RG_DEP[k] || []).map((d) => w.na[d]).find(Boolean) || null;
const rgFmtDay = (s, year) => new Date(s + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(year ? { year: "numeric" } : {}), timeZone: "UTC" });
const rgSpan = (a, b) => (a === b ? rgFmtDay(a, true) : `${rgFmtDay(a)} – ${rgFmtDay(b, true)}`);
const rgMonthName = (y, m) => new Date(Date.UTC(y, m, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

async function rgEnsure() {
  if (RG.eng) return;
  const p = await loadPage("days");
  if (!p || !p.dates || !p.dates.length) throw new Error("The day-by-day data has not been built yet.");
  RG.raw = p;
  let saved = null;
  try { saved = JSON.parse(sessionStorage.getItem("asaya-range") || "null"); } catch (err) { /* storage blocked */ }
  if (saved && ["perf", "aw", "all"].includes(saved.mode)) RG.scope = saved.mode;
  RG.eng = createRangeEngine(p, RG.mode);
  const e = RG.eng, pre = e.presets().find((x) => x.id === "mtd");
  RG.from = pre.from; RG.to = pre.to;
  if (saved && saved.from >= e.first && saved.to <= e.last && saved.from <= saved.to) {
    Object.assign(RG, { from: saved.from, to: saved.to, preset: saved.preset, cmp: saved.cmp || RG.cmp, cmpAuto: saved.cmpAuto !== false });
  }
}
function rgSave() {
  try { sessionStorage.setItem("asaya-range", JSON.stringify({ from: RG.from, to: RG.to, preset: RG.preset, cmp: RG.cmp, cmpAuto: RG.cmpAuto, mode: RG.scope })); } catch (e) { /* storage blocked */ }
}
const rgCmpLabel = () => {
  const m = RG.cmp.mode;
  if (m === "custom") return RG.cmp.from && RG.cmp.to ? `${rgSpan(RG.cmp.from, RG.cmp.to)}` : "Custom range";
  return (RG_CMP.find((x) => x[0] === m) || [])[1] || "";
};
const rgRangeLabel = () => {
  const p = RG.eng.presets().find((x) => x.from === RG.from && x.to === RG.to);
  return p ? p.label : rgSpan(RG.from, RG.to);
};


// "23–26 Oct, 28 Oct": consecutive days folded into ranges, so a list of dates stays short and exact
function rgListDays(list) {
  if (!list || !list.length) return "";
  const e = RG.eng, runs = [];
  for (const d of list) {
    const last = runs[runs.length - 1];
    if (last && e.diffDays(last[1], d) === 1) last[1] = d; else runs.push([d, d]);
  }
  const mon = (s) => new Date(s + "T00:00:00Z").toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });
  const num = (s) => +s.slice(8, 10);
  return runs.map(([a, b]) => (a === b ? rgFmtDay(a) : a.slice(0, 7) === b.slice(0, 7) ? `${num(a)}–${num(b)} ${mon(a)}` : `${rgFmtDay(a)} – ${rgFmtDay(b)}`)).join(", ");
}
const rgHour = (h) => (h === 0 || h === 24 ? "midnight" : `${h % 12 || 12} ${h < 12 ? "am" : "pm"}`);
// a sale to the hour: "13 Oct, 6 pm → 16 Oct, 6 pm"
function rgEventLabel(ev) {
  const part = (iso) => `${rgFmtDay(iso.slice(0, 10))}, ${rgHour(+iso.slice(11, 13))}`;
  return `${part(ev.start)} → ${part(ev.end)}`;
}
// the days a block is compared with, spelled out: "Sale 13 Oct, 6 pm → 16 Oct, 6 pm (sale days 14–15 Oct)"
function rgVsText(g, who) {
  const word = g.phase === "sale" ? "sale" : "BAU";
  const days = (list) => `${list.length} ${word} day${list.length === 1 ? "" : "s"}: ${rgListDays(list)}`;
  const evs = who === "cur" ? g.curEvents : g.prevEvents;
  const list = who === "cur" ? g.cur : g.prev;
  if (!list || !list.length) return "";
  return (evs && evs.length ? `${evs.map(rgEventLabel).join(" and ")} (${days(list)})` : days(list));
}


// ------------------------------------------------ Performance / Awareness views
const RG_MODES = [["perf", "Performance"], ["aw", "Awareness"], ["all", "All campaigns"]];
/* The campaign view (Performance / Awareness / All) acts only where it changes
   numbers: Marketing, and Today's spend. Every other tab reads the
   Performance engine, which is the whole store for sales and sessions. */
function rgUseMode(m) {
  if (RG.mode === m && RG.eng) return;
  RG.mode = m;
  if (RG.raw) RG.eng = createRangeEngine(RG.raw, m);
}
function rgSetMode(m) {
  if (m === RG.scope) return;
  RG.scope = m;
  try {
    const cur = JSON.parse(sessionStorage.getItem("asaya-range") || "null") || {};
    sessionStorage.setItem("asaya-range", JSON.stringify({ ...cur, mode: m }));
  } catch (e) { /* storage blocked */ }
  if (RG.tab === "marketing") rgUseMode(m);
  destroyCharts();
  R[state.tab](state.pages[state.tab]);
}
const rgScopeSeg = (id) => `<div class="filter-row"><span class="lbl">Campaigns</span><div class="seg" id="${id}" role="group" aria-label="Campaign type">${RG_MODES.map(([k, l]) => `<button type="button" data-mode="${k}" aria-pressed="${RG.scope === k}">${l}</button>`).join("")}</div></div>`;
const rgScopeBind = (id) => document.getElementById(id)?.addEventListener("click", (ev) => { const b = ev.target.closest("button[data-mode]"); if (b) rgSetMode(b.dataset.mode); });

// ---------------------------------------------------------------- the bar
/* The date bar: one slim strip pinned under the tabs (#rg-slot is sticky),
   so the dates and the view stay in sight while you scroll. The view switch,
   the two pickers, then one line of context: what the dates hold and what
   they are compared with (sale with sale, BAU with BAU). */
const RG_PHASE_RULE = "Sale days are only compared with sale days, and BAU days with BAU days. When the two periods differ in length, changes compare per-day averages. Transition days (a sale went live or ended) sit out of both.";
function rgBar() {
  const e = RG.eng, c = e.compare(RG.from, RG.to, RG.cmp);
  const cnt = (n, w) => `${n} ${w} day${n === 1 ? "" : "s"}`;
  const cur = [...c.groups.map((g) => cnt(g.cur.length, g.phase === "sale" ? "sale" : "BAU")), ...(c.mixed.length ? [cnt(c.mixed.length, "transition")] : [])].join(" + ");
  const have = c.groups.map((g) => g.phase);
  if (!have.includes(MK.phase)) MK.phase = have[0] || null;
  const g = c.groups.find((x) => x.phase === MK.phase);
  const word = (p) => (p === "sale" ? "Sale" : "BAU");
  const vs = !g ? "" : RG.cmp.mode === "none" ? "no comparison" : g.prev && g.prev.length ? `vs ${rgListDays(g.prev)}` : "nothing to compare";
  const phase = c.groups.length > 1
    ? `<div class="seg" id="rg-phase" role="group" aria-label="Which days" title="${esc(RG_PHASE_RULE)}">${c.groups.map((x) => `<button type="button" data-ph="${x.phase}" aria-pressed="${x.phase === MK.phase}">${word(x.phase)} days</button>`).join("")}</div>`
    : g ? `<span class="phase-badge" tabindex="0" title="${esc(RG_PHASE_RULE)}">${word(g.phase)}${RG.cmp.mode === "none" ? " days" : ` vs ${word(g.phase)}`}</span>` : "";
  const info = `<span class="rg-info" title="${esc(RG_PHASE_RULE)}"><b>${esc(rgSpan(RG.from, RG.to))}</b> <span class="rg-dim">${esc(cur)}</span>${g && g.cur.length ? ` <span class="rg-dim">· showing ${esc(rgListDays(g.cur))}</span> <b>${esc(vs)}</b>` : ""}</span>`;
  return `<section class="rg-barcard" id="rg-bar"><div class="rg-wrap rg-line">
      <div class="rg-chips">
        <button type="button" class="rg-chip" id="rg-open-main" aria-haspopup="dialog" aria-expanded="${RG.pop === "main"}"><span aria-hidden="true">▦</span> ${esc(rgRangeLabel())} <span aria-hidden="true" class="rg-caret">▾</span></button>
        <span class="rg-vs">vs</span>
        <button type="button" class="rg-chip alt" id="rg-open-cmp" aria-haspopup="dialog" aria-expanded="${RG.pop === "cmp"}"><span aria-hidden="true">⇄</span> ${esc(rgCmpLabel())} <span aria-hidden="true" class="rg-caret">▾</span></button>
      </div>
      ${phase}
      ${info}
      ${RG.pop ? rgPopover() : ""}
    </div></section>`;
}
function rgCal(y, m) { // m: 0-11
  const e = RG.eng, first = new Date(Date.UTC(y, m, 1)), pad = first.getUTCDay(), n = e.daysInMonth(y, m + 1);
  const d = RG.draft, a = d.from, b = d.to || d.hover || d.from;
  const [lo, hi] = a && b && a > b ? [b, a] : [a, b];
  let cells = "";
  for (let i = 0; i < pad; i++) cells += "<span></span>";
  for (let day = 1; day <= n; day++) {
    const s = `${y}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const off = s < e.first || s > e.last;
    const ph = off ? "" : e.phaseOf(s);
    const pv = d.preview, inPrev = pv && s >= pv[0] && s <= pv[1];
    const cls = ["rg-day", s === lo || s === hi ? "edge" : "", lo && hi && s > lo && s < hi ? "mid" : "", off ? "off" : "", ph === "sale" ? "sale" : ph === "mixed" ? "mixed" : "", inPrev ? "prev" : ""].join(" ");
    cells += `<button type="button" class="${cls}" data-day="${s}" ${off ? "disabled" : ""} aria-label="${esc(rgFmtDay(s, true))}${ph === "sale" ? ", sale day" : ph === "mixed" ? ", " + esc(e.noteOf(s) || "sale going live or ending") : ""}" title="${ph === "mixed" ? esc(e.noteOf(s) || "") : ""}">${day}</button>`;
  }
  return `<div class="rg-month"><div class="rg-mname">${rgMonthName(y, m)}</div><div class="rg-dow">${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((x) => `<span>${x}</span>`).join("")}</div><div class="rg-grid">${cells}</div></div>`;
}

// what the picked dates contain: how many BAU, sale and transition days
function rgSelSummary(d) {
  if (!d.from) return `<div class="rg-selsum na">Pick a start date and an end date.</div>`;
  const e = RG.eng, a = d.to && d.to < d.from ? d.to : d.from, b = d.to && d.to < d.from ? d.from : d.to || d.from;
  const days = e.rangeOf(a, b), n = {};
  for (const x of days) { const p = e.phaseOf(x) || "none"; n[p] = (n[p] || 0) + 1; }
  const part = (k, l, cls) => (n[k] ? `<span class="rg-chipcount ${cls}"><b>${n[k]}</b> ${l}</span>` : "");
  return `<div class="rg-selsum"><strong>${esc(rgSpan(a, b))}</strong> · ${days.length} day${days.length === 1 ? "" : "s"}
    ${part("bau", "BAU", "bau")}${part("sale", "sale", "sale")}${part("mixed", "transition", "mixed")}${part("none", "outside the data", "none")}</div>`;
}
function rgPopover() {
  const e = RG.eng, d = RG.draft, kind = RG.pop;
  let left = "";
  if (kind === "main") {
    const ps = e.presets();
    const btn = (p) => {
      const on = d.from === p.from && d.to === p.to;
      return `<button type="button" class="rg-pre ${p.kind} ${on ? "on" : ""}" data-pre="${esc(p.id)}"><span class="l">${esc(p.label)}</span>${p.sub ? `<small>${esc(p.sub)}</small>` : ""}</button>`;
    };
    const n = (k) => ps.filter((x) => x.kind === k).length;
    const tabs = [["quick", "Quick", n("quick")], ["sale", "Sales", n("sale")], ["bau", "BAU", n("bau")], ["custom", "Custom", 0]];
    const tab = d.tab || "quick";
    const head = `<div class="rg-tabs" role="tablist" aria-label="Kind of range">${tabs.map(([k, l, c]) => `<button type="button" role="tab" class="rg-tab ${k}" data-tab="${k}" aria-selected="${tab === k}">${l}${c ? `<i>${c}</i>` : ""}</button>`).join("")}</div>`;
    const note = { quick: "", sale: "Sales found from hourly orders, newest first.", bau: "The stretches between sales, newest first.", custom: "" }[tab];
    const body = tab === "custom"
      ? `<p class="rg-hint pad">Type two dates, or click a start day and an end day on the calendar.</p><button type="button" class="rg-pre custom ${d.custom ? "on" : ""}" data-pre="custom"><span class="l">Use my own dates</span><small>${d.from ? esc(rgSpan(d.from, d.to || d.from)) : "nothing picked yet"}</small></button>`
      : `${note ? `<p class="rg-hint pad">${note}</p>` : ""}${ps.filter((x) => x.kind === tab).map(btn).join("") || '<p class="rg-hint pad">Nothing in the data for this yet.</p>'}`;
    left = head + `<div class="rg-list">${body}</div>`;
  } else {
    left = RG_CMP.map(([k, l, hint]) => {
      let shown = hint;
      if (k !== "none" && !(k === "custom" && !(d.from && d.to))) {
        const c = e.compare(RG.from, RG.to, k === "custom" ? { mode: k, from: d.from <= d.to ? d.from : d.to, to: d.from <= d.to ? d.to : d.from } : { mode: k });
        shown = c.groups.map((g) => `${g.phase === "sale" ? "Sale" : "BAU"}: ${g.prev && g.prev.length ? (g.prevEvents && g.prevEvents.length ? g.prevEvents.map(rgEventLabel).join(" and ") : rgListDays(g.prev)) : "none"}`).join(" · ") || hint;
      }
      return `<button type="button" class="rg-pre ${d.mode === k ? "on" : ""}" data-cmp="${k}" title="${esc(hint)}">${esc(l)}${shown ? `<small>${esc(shown)}</small>` : ""}</button>`;
    }).join("");
  }
  const showCal = kind === "main" || d.mode === "custom";
  const [vy, vm] = RG.view;
  const ny = vm === 11 ? vy + 1 : vy, nm = (vm + 1) % 12;
  const apply = kind === "main" ? !!(d.from && (d.to || d.from)) : d.mode !== "custom" || !!(d.from && d.to);
  const right = showCal ? `
      <div class="rg-inputs"><input type="date" id="rg-in-from" value="${d.from || ""}" min="${e.first}" max="${e.last}" aria-label="Start date"><span aria-hidden="true">→</span><input type="date" id="rg-in-to" value="${d.to || ""}" min="${e.first}" max="${e.last}" aria-label="End date"></div>
      <div class="rg-nav"><button type="button" id="rg-prev" aria-label="Earlier months">‹</button><button type="button" id="rg-next" aria-label="Later months">›</button></div>
      <div class="rg-cals">${rgCal(vy, vm)}${rgCal(ny, nm)}</div>
      ${rgSelSummary(d)}
      <p class="rg-hint rg-legend"><span><i class="rg-sw sale"></i>sale day</span><span><i class="rg-sw mixed"></i>sale went live or ended</span><span><i class="rg-sw"></i>BAU day</span><span class="rg-span">data runs ${esc(rgFmtDay(e.first, true))} to ${esc(rgFmtDay(e.last, true))}</span></p>`
    : `<p class="rg-hint pad">${kind === "cmp" && d.mode === "none" ? "Numbers will be shown without a comparison." : "Sale days are only compared with sale days, and BAU days with BAU days, whichever way you compare."}</p>`;
  return `<div class="rg-pop" role="dialog" aria-label="${kind === "main" ? "Choose dates" : "Choose comparison"}">
      <div class="rg-left">${left}</div>
      <div class="rg-right">${right}</div>
      <div class="rg-foot"><button type="button" class="rg-btn" id="rg-cancel">Cancel</button><button type="button" class="rg-btn primary" id="rg-apply" ${apply ? "" : "disabled"}>Apply</button></div>
    </div>`;
}
function rgOpen(kind) {
  RG.pop = kind;
  const e = RG.eng;
  if (kind === "main") {
    const cur = e.presets().find((x) => x.from === RG.from && x.to === RG.to);
    RG.draft = { from: RG.from, to: RG.to, custom: RG.preset === "custom", tab: cur ? cur.kind : "custom" };
    const m = e.shiftMonths(RG.to, -1);
    RG.view = [+m.slice(0, 4), +m.slice(5, 7) - 1];
  } else {
    RG.draft = { mode: RG.cmp.mode, from: RG.cmp.from || null, to: RG.cmp.to || null };
    const m = e.shiftMonths(RG.cmp.to || RG.from, -1);
    RG.view = [+m.slice(0, 4), +m.slice(5, 7) - 1];
  }
  rgRepaint();
}
function rgClose() { RG.pop = null; RG.draft = null; rgRepaint(); }
function rgRepaint() {
  const host = document.getElementById("rg-bar");
  if (!host) return;
  host.outerHTML = rgBar();
  rgBind();
}
function rgChanged() { // re-render the current tab around the new range
  rgSave();
  destroyCharts();
  R[state.tab](state.pages[state.tab]);
}
function rgApply() {
  const d = RG.draft, e = RG.eng;
  if (RG.pop === "main") {
    let a = d.from, b = d.to || d.from;
    if (a > b) [a, b] = [b, a];
    RG.from = a; RG.to = b;
    const p = e.presets().find((x) => x.from === a && x.to === b);
    RG.preset = p ? p.id : "custom";
    if (RG.cmpAuto) RG.cmp = { mode: RG.preset === "mtd" ? "month" : RG.preset.startsWith("sale:") ? "match" : "previous" };
  } else {
    RG.cmp = d.mode === "custom" ? { mode: "custom", from: d.from <= d.to ? d.from : d.to, to: d.from <= d.to ? d.to : d.from } : { mode: d.mode };
    RG.cmpAuto = false;
  }
  RG.pop = null; RG.draft = null;
  rgChanged();
}
function rgBind() {
  const bar = document.getElementById("rg-bar");
  if (!bar) return;
  bar.querySelector("#rg-phase")?.addEventListener("click", (ev) => { const b = ev.target.closest("button[data-ph]"); if (b && b.dataset.ph !== MK.phase) { MK.phase = b.dataset.ph; rgRepaint(); rgChanged(); } });
  bar.querySelector("#rg-open-main").addEventListener("click", () => (RG.pop === "main" ? rgClose() : rgOpen("main")));
  bar.querySelector("#rg-open-cmp").addEventListener("click", () => (RG.pop === "cmp" ? rgClose() : rgOpen("cmp")));
  const pop = bar.querySelector(".rg-pop");
  if (!pop) return;
  const e = RG.eng, d = RG.draft;
  pop.addEventListener("click", (ev) => {
    const t = ev.target;
    const pre = t.closest("[data-pre]"), cm = t.closest("[data-cmp]"), day = t.closest("[data-day]"), tb = t.closest("[data-tab]");
    if (tb) { d.tab = tb.dataset.tab; return rgPopRepaint(); }
    if (pre) {
      if (pre.dataset.pre === "custom") { d.custom = true; }
      else { const p = e.presets().find((x) => x.id === pre.dataset.pre); d.from = p.from; d.to = p.to; d.custom = false; const m = e.shiftMonths(p.to, -1); RG.view = [+m.slice(0, 4), +m.slice(5, 7) - 1]; }
      return rgPopRepaint();
    }
    if (cm) { d.mode = cm.dataset.cmp; return rgPopRepaint(); }
    if (day) {
      const s = day.dataset.day;
      if (!d.from || d.to) { d.from = s; d.to = null; } else if (s < d.from) { d.to = d.from; d.from = s; } else d.to = s;
      d.custom = true; d.tab = "custom";
      return rgPopRepaint();
    }
    if (t.closest("#rg-prev")) { RG.view = RG.view[1] === 0 ? [RG.view[0] - 1, 11] : [RG.view[0], RG.view[1] - 1]; return rgPopRepaint(); }
    if (t.closest("#rg-next")) { RG.view = RG.view[1] === 11 ? [RG.view[0] + 1, 0] : [RG.view[0], RG.view[1] + 1]; return rgPopRepaint(); }
    if (t.closest("#rg-cancel")) return rgClose();
    if (t.closest("#rg-apply")) return rgApply();
  });
  pop.addEventListener("mouseover", (ev) => {
    const pre = ev.target.closest("[data-pre]");
    if (pre) {
      const p = pre.dataset.pre === "custom" ? null : e.presets().find((x) => x.id === pre.dataset.pre);
      const want = p ? [p.from, p.to] : null;
      if (JSON.stringify(want) !== JSON.stringify(d.preview || null)) { d.preview = want; rgPaintCals(); }
      return;
    }
    const day = ev.target.closest("[data-day]");
    if (day && d.from && !d.to && d.hover !== day.dataset.day) { d.hover = day.dataset.day; rgPopRepaint(true); }
  });
  const leftPane = pop.querySelector(".rg-left");
  if (leftPane) leftPane.addEventListener("mouseleave", () => { if (d.preview) { d.preview = null; rgPaintCals(); } });
  for (const id of ["rg-in-from", "rg-in-to"]) {
    const el = pop.querySelector("#" + id);
    if (el) el.addEventListener("change", () => {
      const v = el.value;
      if (!v || v < e.first || v > e.last) return;
      if (id === "rg-in-from") { d.from = v; if (d.to && d.to < v) d.to = v; } else { d.to = v; if (!d.from || d.from > v) d.from = v; }
      d.custom = true; d.tab = "custom";
      const m = e.shiftMonths(d.to || d.from, -1);
      RG.view = [+m.slice(0, 4), +m.slice(5, 7) - 1];
      rgPopRepaint();
    });
  }
}
function rgPopRepaint() { rgRepaint(); }
// repaint just the two months (hovering a preset previews it on the calendar without rebuilding the popover)
function rgPaintCals() {
  const el = document.querySelector("#rg-bar .rg-cals");
  if (!el || !RG.view) return;
  const [vy, vm] = RG.view, ny = vm === 11 ? vy + 1 : vy, nm = (vm + 1) % 12;
  el.innerHTML = rgCal(vy, vm) + rgCal(ny, nm);
}
document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && RG.pop) rgClose(); });
document.addEventListener("click", (ev) => { if (RG.pop && !ev.target.closest("#rg-bar")) rgClose(); });

// ---------------------------------------------------------------- shared tab parts
/* Spends the sheets have not reached yet are estimated (server side); a card
   built on them carries an "est." tag. */
const RG_EST_FIELDS = { affiliate_spend: "affiliate", crm_flow_spend: "CRM flow", crm_broadcast_spend: "CRM broadcast", reddit_spend: "Reddit" };
const RG_EST_USES = { affiliate_spend: ["affiliate_spend"], crm_spend: ["crm_flow_spend", "crm_broadcast_spend"], reddit_spend: ["reddit_spend"] };
function rgEstFor(k, w) {
  if (!w || !w.est) return "";
  const parts = RG_EST_USES[k] || (["other_spend", "all_spend", "perf_all_spend", "roas", "sh_roas", "cps", "cps_all", "perf_overall_roas", "overall_roas"].includes(k) ? Object.keys(RG_EST_FIELDS) : null);
  if (!parts) return "";
  const hit = parts.filter((f) => w.est[f] && w.est[f].length);
  if (!hit.length) return "";
  const days = [...new Set(hit.flatMap((f) => w.est[f]))].sort();
  return `Estimated ${hit.map((f) => RG_EST_FIELDS[f]).join(", ")} spend for ${rgListDays(days)}: the sheets are not filled yet`;
}
/* One KPI card for a registry metric over a phase block g (from engine.compare). */
function rgKpi(id, g, o = {}) {
  const m = METRICS[id], k = m.field, w = g.w, pw = g.pw;
  const v = w[k];
  const perDay = o.perDay && v != null && w.days > 1 ? `${mVal(id, v / w.days, true)} a day` : "";
  return kpiCard(id, {
    value: v, prev: pw ? (pw[k] ?? null) : null, change: pw ? g.change(k) : null, small: mSmall(id, pw),
    na: v == null ? rgNa(w, k) : null, est: rgEstFor(k, w), sub: perDay, ...o,
  });
}
/* A section: title, one line saying what it answers, optional controls and link. */
const rgSec = (title, q, body, o = {}) => `<section class="card${o.cls ? " " + o.cls : ""}" ${o.id ? `id="${o.id}"` : ""} ${o.comp ? `data-component="${o.comp}"` : ""}><div class="sec-head"><h2>${esc(title)}</h2>${q ? `<span class="q">${q}</span>` : ""}${o.ctl || o.link ? `<span class="ctl">${o.ctl || ""}${o.link || ""}</span>` : ""}</div>${body}</section>`;
/* Secondary detail, collapsed by default. */
const rgFold = (title, q, body, o = {}) => `<details class="fold"${o.open ? " open" : ""} ${o.id ? `id="${o.id}"` : ""} ${o.comp ? `data-component="${o.comp}"` : ""}><summary><h2>${esc(title)}</h2>${q ? `<span class="q">${q}</span>` : ""}</summary><div class="fold-body">${body}</div></details>`;
const rgLink = (tab, label) => `<a class="sec-link" href="#${tab}">${esc(label)} →</a>`;
const rgNone = () => `<section class="card"><p class="na">Data unavailable: there are no days in the data for ${esc(rgSpan(RG.from, RG.to))}. The history runs ${esc(rgFmtDay(RG.eng.first, true))} to ${esc(rgFmtDay(RG.eng.last, true))}.</p></section>`;
/* The block the header's BAU / Sale switch picked. */
function rgPick(c) {
  const have = c.groups.map((g) => g.phase);
  if (!have.includes(MK.phase)) MK.phase = have[0] || null;
  return c.groups.find((x) => x.phase === MK.phase) || null;
}
const rgVsLine = (g) => `${esc(rgVsText(g, "cur"))}${g.pw ? ` · vs ${esc(rgVsText(g, "prev"))}` : ""}`;

// the comparison days lined up with the picked days, for a dashed line on a chart
function rgCmpDays() {
  const e = RG.eng, len = e.diffDays(RG.from, RG.to) + 1, m = RG.cmp.mode;
  let a = null, b = null;
  if (m === "previous") { b = e.addDays(RG.from, -1); a = e.addDays(RG.from, -len); }
  else if (m === "month") { a = e.shiftMonths(RG.from, -1); b = e.shiftMonths(RG.to, -1); }
  else if (m === "year") { a = e.shiftMonths(RG.from, -12); b = e.shiftMonths(RG.to, -12); }
  else if (m === "custom") { a = RG.cmp.from; b = RG.cmp.to; }
  return a && b ? e.rangeOf(a, b) : [];
}
/* A per-day bar chart: BAU and sale days in their colours, transition days
   faded, the comparison as a dashed line. */
function rgDayChart(canvasId, key, unit, label) {
  const e = RG.eng, days = e.rangeOf(RG.from, RG.to).filter((d) => e.phaseOf(d)), el = document.getElementById(canvasId);
  if (!el || !days.length) return;
  const cmpDays = rgCmpDays();
  const val = (d) => e.windowOf([d])[key];
  const datasets = [{ type: "bar", label, data: days.map(val), ...barStyle, backgroundColor: days.map((d) => { const ph = e.phaseOf(d); return ph === "sale" ? css("--series-2") : ph === "mixed" ? css("--series-2") + "80" : css("--series-1"); }) }];
  if (cmpDays.length) datasets.push({ type: "line", label: "Comparison", data: days.map((_, i) => (cmpDays[i] && e.phaseOf(cmpDays[i]) ? val(cmpDays[i]) : null)), borderColor: css("--ink-2"), borderDash: [5, 4], borderWidth: 2, pointRadius: 0, tension: 0.2, spanGaps: false });
  baseChart(el, { type: "bar", data: { labels: days.map((d) => dayLabel(d)), datasets } }, unit);
}
const rgDayLegend = () => legend([["--series-1", "BAU day"], ["--series-2", "Sale day"], ...(rgCmpDays().length ? [["--ink-2", "Comparison (dashed)"]] : [])]);

/* Target vs achieved: the media plan's daily targets (plan_days, from the
   'Target vs Achieved' tab of the monthly workbooks) summed over the dates,
   against the dashboard's own numbers for the same days, so achieved always
   matches every other tab. The sheet's typed-in actuals are never used.
   Ratios come from the summed numbers. */
const RG_PLAN_ORDER = ["store", "meta", "google", "reddit", "crm_flow", "crm_broadcast", "affiliate"];
function rgTargets(from, to) {
  const P = state.pages.plan_days, D = RG.raw;
  if (!P || !P.days || !Object.keys(P.days).length) return `<p class="na">Data unavailable: ${esc((P && P.na) || "the media-plan targets have not been read yet")}.</p>`;
  const planDays = Object.keys(P.days).sort(), di = new Map(D.dates.map((d, i) => [d, i]));
  const days = D.dates.filter((d) => d >= from && d <= to), planned = days.filter((d) => P.days[d]);
  if (!planned.length) return `<p class="na">The media plan has no targets for ${esc(rgSpan(from, to))}; it covers ${esc(rgSpan(planDays[0], planDays[planDays.length - 1]))}.</p>`;
  const sumF = (f, list) => { if (!f || !D.values[f]) return { v: null, miss: list.length }; let t = 0, miss = 0; for (const d of list) { const i = di.get(d), v = i == null ? null : D.values[f][i]; if (v == null) miss++; else t += v; } return { v: miss === list.length ? null : t, miss }; };
  const sumP = (k, j, list) => { let t = 0, n = 0; for (const d of list) { const x = (P.days[d] || {})[k]; if (x && x[j] != null) { t += x[j]; n++; } } return n ? t : null; };
  const pct = (a, t) => (a != null && t ? a / t : null);
  const cls = (r, good) => (r == null ? "" : good === "neutral" ? "flat" : r >= 1 ? "up" : r >= 0.9 ? "flat" : "down");
  const rows = RG_PLAN_ORDER.filter((k) => P.achieved[k] && planned.some((d) => P.days[d][k])).map((k) => {
    const A = P.achieved[k], ts = sumP(k, 0, planned), tr = sumP(k, 1, planned), as = sumF(A.spend, planned), ar = A.revenue ? sumF(A.revenue, planned) : { v: null, miss: 0 };
    return { k, A, ts, tr, as: as.v, ar: ar.v, miss: Math.max(as.miss, A.revenue ? ar.miss : 0), troas: ts ? (tr || 0) / ts : null, aroas: as.v && ar.v != null ? ar.v / as.v : null };
  });
  const money = (v) => esc(v == null ? "—" : mFormat("currency", v));
  const pc = (r, good) => (r == null ? '<span class="cell-na">—</span>' : `<span class="${cls(r, good)}">${esc(mFormat("percent", r))}</span>`);
  const body = rows.map((r) => `<tr class="${r.k === "store" ? "total" : ""}"><td class="text"><b>${esc(r.A.label)}</b><br><span class="sub">${esc(r.A.revenue_label)}</span>${r.miss ? ` <span class="mv-warn" title="${r.miss} of ${planned.length} days have no achieved number yet (a spend sheet not filled in)">⚠</span>` : ""}</td>
    <td>${money(r.ts)}</td><td>${money(r.as)}</td><td>${pc(pct(r.as, r.ts), "neutral")}</td>
    <td>${money(r.tr)}</td><td>${r.A.revenue ? money(r.ar) : '<span class="cell-na" title="No revenue source for this channel">—</span>'}</td><td>${r.A.revenue ? pc(pct(r.ar, r.tr), "higher") : '<span class="cell-na">—</span>'}</td>
    <td>${esc(r.troas == null ? "—" : mFormat("ratio", r.troas))}</td><td>${r.aroas == null ? '<span class="cell-na">—</span>' : `<span class="${cls(r.troas ? r.aroas / r.troas : null, "higher")}">${esc(mFormat("ratio", r.aroas))}</span>`}</td></tr>`).join("");
  // the whole month of `to`: where the store stands against the month's plan
  const month = to.slice(0, 7), mDays = planDays.filter((d) => d.startsWith(month)), done = mDays.filter((d) => d <= to && di.has(d)), left = mDays.filter((d) => d > to);
  let monthLine = "";
  if (mDays.length && P.achieved.store) {
    const S = P.achieved.store, mt = sumP("store", 1, mDays), ms = sumP("store", 0, mDays), ma = sumF(S.revenue, done).v, msa = sumF(S.spend, done).v;
    const need = left.length && mt != null && ma != null ? Math.max(0, mt - ma) / left.length : null;
    monthLine = `<p class="legend-note">${esc(new Date(month + "-01T00:00:00Z").toLocaleString("en-IN", { month: "long", timeZone: "UTC" }))} plan: Total sales <b>${money(mt)}</b>, ${money(ma)} achieved through ${esc(rgFmtDay(done[done.length - 1] || to, true))} (<b>${esc(mFormat("percent", pct(ma, mt)) ?? "—")}</b> of the month with ${done.length} of ${mDays.length} days gone); Performance spend <b>${money(ms)}</b>, ${money(msa)} spent (${esc(mFormat("percent", pct(msa, ms)) ?? "—")}).${need == null ? "" : need > 0 ? ` To reach the month: <b>${money(need)}</b> of Total sales a day over the ${left.length} day${left.length === 1 ? "" : "s"} left.` : " The month's Total sales target is already reached."}</p>`;
  }
  const cover = planned.length < days.length ? ` The plan covers ${planned.length} of the ${days.length} days picked; only those are compared.` : "";
  return `<div class="table-wrap"><table><thead><tr><th class="text" scope="col">Channel</th><th scope="col">Target spend</th><th scope="col">Spend</th><th scope="col">Of target</th><th scope="col">Target revenue</th><th scope="col">Revenue</th><th scope="col">Of target</th><th scope="col">Target ROAS</th><th scope="col">ROAS</th></tr></thead><tbody>${body}</tbody></table></div>
    ${monthLine}<p class="legend-note">Targets: the media-plan workbook's 'Target vs Achieved' tab, summed over ${esc(rgSpan(planned[0], planned[planned.length - 1]))}. Achieved: the dashboard's own numbers for the same days (Total sales from Shopify; Meta and Google revenue as their platforms attribute it; CRM and affiliate revenue from their sheets). Performance spend only.${cover}${P.na ? " " + esc(P.na) + "." : ""}</p>`;
}

async function rgShell(render) {
  try { await rgEnsure(); }
  catch (err) { const m = document.getElementById("rg-body"); if (m) m.innerHTML = `<section class="card"><h2>Date ranges are unavailable</h2><p class="na">Data unavailable: ${esc(err.message)}</p></section>`; return; }
  if (state.tab !== RG.tab) return; // the user moved on while this loaded
  rgUseMode(RG.tab === "marketing" ? RG.scope : "perf");
  render();
}

// ---------------------------------------------------------------- overview
/* "How did the period go, and what drove it?" Six headline numbers (each owned
   by a tab it links to), what changed, and one chart. No tables. */
const OV = { metric: "gmv" };
const OV_KPIS = [
  ["total_sales", null, { perDay: true }], ["orders", null, {}], ["aov", null, {}],
  ["blended_roas", "marketing", {}], ["perf_spend", "marketing", { perDay: true }], ["cvr", "funnel", {}],
];
/* What changed: deterministic, ranked by how much each moved Total sales. */
function rgWhatChanged(g) {
  if (!g.pw) return [];
  const out = [], e = RG.eng, cd = g.w.days, pd = g.pw.days;
  const per = (c, p) => c / cd - p / pd; // per-day change, so unequal periods compare fairly
  const cur = new Set(g.cur), prev = new Set(g.prev);
  // channels by their contribution to the change in sales (Shopify last click)
  const ch = state.pages.channel_days;
  if (ch) {
    const sum = (set) => { const m = new Map(); for (const r of ch.rows) if (set.has(r[0]) && ch.kinds[r[2]] !== "awareness") m.set(r[1], (m.get(r[1]) || 0) + (r[6] || 0)); return m; };
    const a = sum(cur), b = sum(prev);
    const moves = [...new Set([...a.keys(), ...b.keys()])].map((i) => ({ name: ch.channels[i], d: per(a.get(i) || 0, b.get(i) || 0) })).sort((x, y) => Math.abs(y.d) - Math.abs(x.d)).slice(0, 2);
    for (const m of moves) if (Math.abs(m.d) >= 1) out.push({ w: Math.abs(m.d), dir: m.d > 0 ? "up" : "down", html: `<b>${esc(m.name)}</b> ${m.d > 0 ? "added" : "took off"} ${esc(mCompactInr(Math.abs(m.d)))} a day in sales (orders placed, last click)`, link: "#marketing", lab: "Channels" });
  }
  // products by their contribution to the change in product revenue
  const pdp = state.pages.product_days;
  if (pdp) {
    const sum = (set) => { const m = new Map(); for (const r of pdp.rows) if (set.has(r[0])) m.set(r[1], (m.get(r[1]) || 0) + (r[3] || 0)); return m; };
    const a = sum(cur), b = sum(prev);
    const moves = [...new Set([...a.keys(), ...b.keys()])].map((i) => ({ name: productName(i), d: per(a.get(i) || 0, b.get(i) || 0) })).sort((x, y) => Math.abs(y.d) - Math.abs(x.d)).slice(0, 2);
    for (const m of moves) if (Math.abs(m.d) >= 1) out.push({ w: Math.abs(m.d), dir: m.d > 0 ? "up" : "down", html: `<b>${esc(m.name)}</b> ${m.d > 0 ? "up" : "down"} ${esc(mCompactInr(Math.abs(m.d)))} a day in product revenue`, link: "#products", lab: "Products" });
  }
  // the funnel step whose rate moved most
  const steps = [["atc_rate", "Sessions → ATC"], ["atc_to_ic", "ATC → IC"], ["ic_to_order", "IC → Order"]]
    .map(([k, l]) => ({ k, l, c: g.w[k], p: g.pw[k] })).filter((x) => x.c != null && x.p != null && x.p > 0)
    .map((x) => ({ ...x, r: x.c / x.p - 1 })).sort((x, y) => Math.abs(y.r) - Math.abs(x.r));
  if (steps.length && Math.abs(steps[0].r) >= METRIC_RULES.flat_below) {
    const s = steps[0], orders = g.w.orders || 0;
    out.push({ w: Math.abs(s.r) * orders * (g.w.aov || 0) / cd, dir: s.r > 0 ? "up" : "down", html: `<b>${esc(s.l)}</b> moved most in the funnel: ${esc(mFormat("percent", s.p))} → ${esc(mFormat("percent", s.c))}`, link: "#funnel", lab: "Funnel" });
  }
  out.sort((x, y) => y.w - x.w);
  // data-quality issues always show
  const st = state.status || {}, late = Object.keys(st.missing || {}), un = Object.keys(st.unavailable || {});
  if (late.length || un.length) out.push({ w: 0, dir: "warn", html: `<b>Data:</b> ${esc([...late.map((k) => `${SRC_LABEL[k] || k} late`), ...un.map((k) => `${k.replace(/_/g, " ")} unavailable`)].slice(0, 3).join(", "))}`, link: "#health", lab: "Data health" });
  return out.slice(0, 5);
}
function productName(i) {
  const pd = state.pages.product_days, n = pd && pd.names[i];
  if (!n) return "a product";
  const pm = typeof pmProduct === "function" ? pmProduct(n.id) : null;
  return pm ? `${pm.code} · ${pm.name}` : n.label;
}
R.overview = (p) => {
  RG.tab = "overview";
  $main.innerHTML = `<div id="rg-body"><p class="empty">Loading…</p></div>`;
  rgShell(async () => {
    setSub(rgBar()); rgBind();
    for (const pg of ["channel_days", "product_days", "plan_days"]) { try { await loadPage(pg); } catch (err) { /* the sections say what is missing */ } }
    if (state.tab !== "overview") return;
    const e = RG.eng, c = e.compare(RG.from, RG.to, RG.cmp), g = rgPick(c);
    const host = document.getElementById("rg-body");
    if (!g) { host.innerHTML = rgNone(); return; }
    const kpis = OV_KPIS.map(([id, href, o]) => rgKpi(id, g, { ...o, ...(href ? { href: "#" + href, hrefLabel: href === "funnel" ? "Funnel" : "Marketing" } : {}) })).join("");
    const ch = rgWhatChanged(g);
    const changed = !g.pw ? '<p class="na">Pick a comparison above to see what changed.</p>'
      : ch.length ? `<ul class="changed">${ch.map((x) => `<li><span class="ic ${x.dir}">${x.dir === "up" ? "▲" : x.dir === "down" ? "▼" : "!"}</span><span>${x.html}</span><a href="${x.link}">${esc(x.lab)} →</a></li>`).join("")}</ul>`
      : '<p class="na">Nothing moved enough to call out.</p>';
    const mseg = `<div class="seg" id="ov-metric" role="group" aria-label="Chart metric">${[["gmv", "Total sales"], ["orders", "Orders"]].map(([k, l]) => `<button type="button" data-m="${k}" aria-pressed="${OV.metric === k}">${l}</button>`).join("")}</div>`;
    host.innerHTML = `
      <section class="card" data-component="overview-kpis"><div class="kpis six">${kpis}</div>${g.note ? `<p class="legend-note">${esc(g.note)}</p>` : ""}</section>
      ${rgSec("What changed", "the biggest movers behind the change, each linked to its detail", changed, { comp: "what-changed" })}
      ${rgSec(OV.metric === "gmv" ? "Total sales per day" : "Orders per day", "each day of the picked dates", `${rgDayLegend()}<div class="chart-box"><canvas id="c-ov" aria-label="${OV.metric === "gmv" ? "Total sales" : "Orders"} per day"></canvas></div>`, { ctl: mseg, comp: "sales-per-day-chart" })}
      ${rgSec("Target vs achieved", `the media plan for ${esc(rgSpan(RG.from, RG.to))}, every day picked`, rgTargets(RG.from, RG.to), { comp: "targets" })}`;
    rgDayChart("c-ov", OV.metric, OV.metric === "gmv" ? "inr" : "int", OV.metric === "gmv" ? "Total sales" : "Orders");
    document.getElementById("ov-metric").addEventListener("click", (ev) => { const b = ev.target.closest("button[data-m]"); if (b && b.dataset.m !== OV.metric) { OV.metric = b.dataset.m; destroyCharts(); R.overview(p); } });
  });
};
