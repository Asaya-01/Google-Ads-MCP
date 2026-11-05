/* Date-range picker and the range-driven Overview and Daily tabs. Inlined into
   app.html inside the dashboard closure, so it shares esc(), fmt(), table(),
   dayLabel(), deltaHtml(), baseChart(), the R registry and $main. The numbers
   come from range_engine.js, over the per-day "days" page. */

const RG = { eng: null, raw: null, mode: "perf", from: null, to: null, preset: "mtd", cmp: { mode: "month" }, cmpAuto: true, pop: null, draft: null, view: null, error: null };
try {
  const savedMode = (JSON.parse(sessionStorage.getItem("asaya-range") || "null") || {}).mode;
  if (["perf", "aw", "all"].includes(savedMode)) RG.mode = savedMode;
} catch (e) { /* storage blocked: stay on Performance */ }
const RG_CMP = [
  ["previous", "Previous period", "The same number of days straight before"],
  ["month", "Same period last month", "The same dates one month earlier"],
  ["year", "Same period last year", "The same dates one year earlier"],
  ["match", "Last matching period", "The most recent earlier days of the same kind (sale or BAU)"],
  ["custom", "Custom range…", "Pick any dates"],
  ["none", "No comparison", ""],
];
const RG_TILES = [
  ["gmv", "GMV", "inr"], ["orders", "Orders", "int"], ["aov", "AOV", "inr"],
  ["sessions", "Sessions", "int"], ["cvr", "Conversion rate", "pct"], ["atc_rate", "Add-to-cart rate", "pct"],
  ["perf_all_spend", "Performance spend (all channels)", "inr"], ["roas", "ROAS (GMV / performance spend)", "x"], ["cps", "CPS (spend / session)", "inr2"],
  ["new_share", "New-customer orders", "pct"],
  ["spend", "Meta + Google spend", "inr"],
];
const RG_RATES = ["roas", "cps_all", "cps_ad", "sh_roas_all", "aov", "cvr", "sh_aov", "sh_cvr", "sh_perf_cvr", "sh_ic_to_order", "sh_roas", "perf_cvr", "ic_to_order", "cps", "perf_overall_roas", "atc_rate", "mer", "perf_roas", "meta_sales_roas", "google_sales_roas", "new_share", "overall_roas", "affiliate_roas", "crm_roas", "crm_flow_roas", "crm_broadcast_roas"];
const RG_DEP = {
  roas: ["store_gmv", "perf_all_spend"], aov: ["gmv", "orders"], cvr: ["orders", "sessions"], atc_rate: ["atc", "sessions"], mer: ["gmv", "spend"],
  perf_roas: ["gmv", "perf_spend"], meta_sales_roas: ["meta_perf_value", "meta_perf_spend"],
  google_sales_roas: ["google_perf_value", "google_perf_spend"], new_share: ["new_orders", "repeat_orders"], atc_to_ic: ["atc", "ic"], ic_to_order: ["orders", "ic"], perf_cvr: ["orders", "report_perf_sessions"], cps: ["perf_all_spend", "sessions"], cps_all: ["all_spend", "sessions"], cps_ad: ["spend", "sessions"], sh_roas_all: ["sh_sales", "all_spend"], sh_aov: ["sh_sales", "sh_orders"], sh_cvr: ["sh_orders", "sessions"], sh_perf_cvr: ["sh_orders", "report_perf_sessions"], sh_ic_to_order: ["sh_orders", "ic"], sh_roas: ["sh_sales", "perf_all_spend"], perf_overall_roas: ["gmv", "perf_all_spend"],
  overall_roas: ["gmv", "all_spend"], affiliate_roas: ["affiliate_revenue", "affiliate_spend"], crm_roas: ["crm_revenue", "crm_spend"],
  crm_flow_roas: ["crm_flow_revenue", "crm_flow_spend"], crm_broadcast_roas: ["crm_broadcast_revenue", "crm_broadcast_spend"],
};
const RG_NEUTRAL = new Set(["spend", "sessions", "all_spend", "affiliate_spend", "crm_spend", "reddit_spend"]);
const rgNa = (w, k) => w.na[k] || (RG_DEP[k] || []).map((d) => w.na[d]).find(Boolean) || null;
const rgFmtDay = (s, year) => new Date(s + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(year ? { year: "numeric" } : {}), timeZone: "UTC" });
const rgSpan = (a, b) => (a === b ? rgFmtDay(a, true) : `${rgFmtDay(a)} – ${rgFmtDay(b, true)}`);
// a table header's span: "17–21 Oct", "28 Sep – 4 Oct"; the year only when the two differ
const rgSpanShort = (a, b) => {
  if (a === b) return rgFmtDay(a);
  if (a.slice(0, 4) !== b.slice(0, 4)) return `${rgFmtDay(a, true)} – ${rgFmtDay(b, true)}`;
  return a.slice(0, 7) === b.slice(0, 7) ? `${+a.slice(8)}–${rgFmtDay(b)}` : `${rgFmtDay(a)} – ${rgFmtDay(b)}`;
};
const rgMonthName = (y, m) => new Date(Date.UTC(y, m, 1)).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

async function rgEnsure() {
  if (RG.eng) return;
  const p = await loadPage("days");
  if (!p || !p.dates || !p.dates.length) throw new Error("The day-by-day data has not been built yet.");
  RG.raw = p;
  let saved = null;
  try { saved = JSON.parse(sessionStorage.getItem("asaya-range") || "null"); } catch (err) { /* storage blocked */ }
  if (saved && ["perf", "aw", "all"].includes(saved.mode)) RG.mode = saved.mode;
  RG.eng = createRangeEngine(p, RG.mode);
  const e = RG.eng, pre = e.presets().find((x) => x.id === "mtd");
  RG.from = pre.from; RG.to = pre.to;
  if (saved && saved.from >= e.first && saved.to <= e.last && saved.from <= saved.to) {
    Object.assign(RG, { from: saved.from, to: saved.to, preset: saved.preset, cmp: saved.cmp || RG.cmp, cmpAuto: saved.cmpAuto !== false });
  }
}
function rgSave() {
  try { sessionStorage.setItem("asaya-range", JSON.stringify({ from: RG.from, to: RG.to, preset: RG.preset, cmp: RG.cmp, cmpAuto: RG.cmpAuto, mode: RG.mode })); } catch (e) { /* storage blocked */ }
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
const RG_MODE_NOTE = {
  perf: "Performance campaigns only: every campaign not named “awareness”, with the sessions and orders that came from them and from everything else that is not awareness.",
  aw: "Awareness campaigns only: spend, delivery and whatever sessions and orders were credited to them. Awareness is judged on reach and cost of reach, so ROAS here is attribution only.",
  all: "Everything together, so the totals tie back to Shopify.",
};
const RG_AW_DROP = new Set(["roas", "cps", "perf_all_spend", "affiliate_spend", "crm_spend", "reddit_spend", "all_spend", "overall_roas", "affiliate_roas", "crm_roas", "perf_roas", "new_share"]);
const RG_AW_LABEL = {
  gmv: "GMV credited to awareness", orders: "Orders credited to awareness", sessions: "Sessions from awareness",
  spend: "Awareness spend (Meta + Google)", meta_spend: "Meta awareness spend", google_spend: "Google awareness spend",
  mer: "Attributed ROAS (GMV / awareness spend)", meta_sales_roas: "Meta awareness ROAS (reported)", google_sales_roas: "Google awareness ROAS (reported)",
};
// the tiles that make sense for the current view
function rgAdapt(tiles) {
  if (RG.mode !== "aw") return tiles;
  return tiles.filter(([k]) => !RG_AW_DROP.has(k)).map(([k, l, u]) => [k, RG_AW_LABEL[k] || l, u]);
}
function rgSetMode(m) {
  if (m === RG.mode) return;
  RG.mode = m;
  if (RG.raw) RG.eng = createRangeEngine(RG.raw, m);
  try {
    const cur = JSON.parse(sessionStorage.getItem("asaya-range") || "null") || {};
    sessionStorage.setItem("asaya-range", JSON.stringify({ ...cur, mode: m }));
  } catch (e) { /* storage blocked */ }
  destroyCharts();
  R[state.tab](state.pages[state.tab]);
}

// ---------------------------------------------------------------- the bar
/* The date bar: one slim strip pinned under the tabs (#rg-slot is sticky),
   so the dates and the view stay in sight while you scroll. The view switch,
   the two pickers, then one line of context: what the dates hold and what
   they are compared with (sale with sale, BAU with BAU). */
function rgBar() {
  const e = RG.eng, c = e.compare(RG.from, RG.to, RG.cmp);
  const cnt = (n, w) => `${n} ${w} day${n === 1 ? "" : "s"}`;
  const cur = [...c.groups.map((g) => cnt(g.cur.length, g.phase === "sale" ? "sale" : "BAU")), ...(c.mixed.length ? [cnt(c.mixed.length, "transition")] : [])].join(" + ");
  const vs = RG.cmp.mode === "none" ? "" : c.groups.map((g) => (g.prev && g.prev.length ? `${g.phase === "sale" ? "sale" : "BAU"}: ${rgListDays(g.prev)}` : `${g.phase === "sale" ? "sale" : "BAU"}: nothing to compare`)).join(" · ");
  const info = `<span class="rg-info" title="Sale days are only compared with sale days, BAU with BAU. Transition days (a sale went live or ended) sit out of both."><b>${esc(rgSpan(RG.from, RG.to))}</b> <span class="rg-dim">${esc(cur)}</span>${vs ? ` <span class="rg-dim">vs</span> <b>${esc(vs)}</b>` : ""}</span>`;
  const mode = RG.tab === "products" || RG.tab === "region"
    ? '<span class="rg-modenote" title="Sales by product and by place cannot be split by campaign type, so there is no Performance / Awareness switch here.">Whole store</span>'
    : `<div class="seg rg-mode" id="rg-mode" role="group" aria-label="Campaign type">${RG_MODES.map(([k, l]) => `<button type="button" data-mode="${k}" aria-pressed="${RG.mode === k}">${l}</button>`).join("")}</div>`;
  return `<section class="rg-barcard" id="rg-bar"><div class="rg-wrap rg-line">
      ${mode}
      <div class="rg-chips">
        <button type="button" class="rg-chip" id="rg-open-main" aria-haspopup="dialog" aria-expanded="${RG.pop === "main"}"><span aria-hidden="true">▦</span> ${esc(rgRangeLabel())} <span aria-hidden="true" class="rg-caret">▾</span></button>
        <span class="rg-vs">vs</span>
        <button type="button" class="rg-chip alt" id="rg-open-cmp" aria-haspopup="dialog" aria-expanded="${RG.pop === "cmp"}"><span aria-hidden="true">⇄</span> ${esc(rgCmpLabel())} <span aria-hidden="true" class="rg-caret">▾</span></button>
      </div>
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
  bar.querySelector("#rg-mode")?.addEventListener("click", (ev) => { const b = ev.target.closest("button[data-mode]"); if (b) rgSetMode(b.dataset.mode); });
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

// ---------------------------------------------------------------- overview
// a ratio over only the days that have every input: the spend sheets are filled in
// a day or two late, so the newest days are missing. Never for counts or totals.
function rgPartial(k, list) {
  const need = RG_DEP[k];
  if (!need || !list || !list.length) return null;
  const e = RG.eng, ok = list.filter((d) => e.hasAll(d, need));
  if (!ok.length || ok.length === list.length) return null;
  const w = e.windowOf(ok), v = w[k];
  return v == null ? null : { v, ok: ok.length, of: list.length, missing: list.filter((d) => !ok.includes(d)) };
}
function rgTile(k, label, unit, g) {
  const w = g.w, pw = g.pw, v = w[k], na = rgNa(w, k);
  if ((v === null || v === undefined) && RG_RATES.includes(k)) {
    const part = rgPartial(k, g.cur);
    if (part) {
      const pp = pw && pw[k] == null ? rgPartial(k, g.prev) : null;
      const prior = pw ? (pw[k] != null ? pw[k] : pp ? pp.v : null) : null;
      const ch = prior ? part.v / prior - 1 : null;
      return `<div class="tile"><div class="label">${esc(label)}</div><div class="value">${esc(fmt(part.v, unit, true))}</div>
        <div class="foot">${pw ? `${deltaHtml(ch, k)}<span>vs ${esc(prior == null ? "n/a" : fmt(prior, unit, true))}</span>` : ""}</div>
        <div class="foot sub" title="${esc(rgNa(w, k) || "")}">${part.ok} of ${part.of} days · ${esc(rgListDays(part.missing))} not entered yet</div></div>`;
    }
  }
  if (v === null || v === undefined) return `<div class="tile"><div class="label">${esc(label)}</div><div class="na" title="${esc(na || "not available")}">Data unavailable: ${esc(na || "not available")}</div></div>`;
  const ch = g.change(k);
  const count = !RG_RATES.includes(k);
  const prior = pw ? pw[k] : null;
  const foot = pw
    ? `${deltaHtml(ch, RG_NEUTRAL.has(k) ? "spend" : k)}<span>vs ${esc(prior == null ? "n/a" : fmt(prior, unit, true))}</span>`
    : `<span>${g.prev === null ? "no comparison" : "no comparison data"}</span>`;
  const perDay = count && w.days > 1 ? `<div class="foot sub">${esc(fmt(v / w.days, unit, true))} a day</div>` : "";
  const est = rgEstFor(k, w);
  return `<div class="tile"><div class="label">${esc(label)}${est ? ` <span class="chip pending" title="${esc(est)}">est.</span>` : ""}</div><div class="value">${esc(fmt(v, unit, true))}</div><div class="foot">${foot}</div>${perDay}${est ? `<div class="foot sub" title="${esc(est)}">${esc(rgEstShort(w))}</div>` : ""}</div>`;
}
/* Spends the sheets have not reached yet are estimated (server side); a tile
   built on them says so. */
const RG_EST_FIELDS = { affiliate_spend: "affiliate", crm_flow_spend: "CRM flow", crm_broadcast_spend: "CRM broadcast", reddit_spend: "Reddit" };
const RG_EST_USES = { affiliate_spend: ["affiliate_spend"], crm_spend: ["crm_flow_spend", "crm_broadcast_spend"], reddit_spend: ["reddit_spend"] };
function rgEstShort(w) {
  const days = [...new Set(Object.keys(RG_EST_FIELDS).flatMap((f) => (w.est && w.est[f]) || []))].sort();
  return `${rgListDays(days)} estimated`;
}
function rgEstFor(k, w) {
  if (!w || !w.est) return "";
  const parts = RG_EST_USES[k] || (["other_spend", "all_spend", "perf_all_spend", "roas", "sh_roas", "cps", "cps_all", "perf_overall_roas", "overall_roas"].includes(k) ? Object.keys(RG_EST_FIELDS) : null);
  if (!parts) return "";
  const hit = parts.filter((f) => w.est[f] && w.est[f].length);
  if (!hit.length) return "";
  const days = [...new Set(hit.flatMap((f) => w.est[f]))].sort();
  return `Estimated ${hit.map((f) => RG_EST_FIELDS[f]).join(", ")} spend for ${rgListDays(days)}: the sheets are not filled yet`;
}
function rgGroupHtml(g, mixed, tiles, title) {
  tiles = rgAdapt(tiles || RG_TILES);
  const nm = g.phase === "sale" ? "Sale days" : "BAU days";
  // one quiet line: the dates are already in the bar above
  const span = `${esc(rgVsText(g, "cur"))}${g.pw ? ` <span class="rg-dim">vs</span> ${esc(rgVsText(g, "prev"))}` : ""}`;
  return `<section class="card rg-group">
    <div class="section-head"><h2>${phaseChip(g.phase)} ${nm}</h2><span class="sub">${span}</span></div>
    ${g.note ? `<div class="banner">${esc(g.note)}</div>` : ""}
    <div class="tiles">${tiles.map(([k, l, u]) => rgTile(k, l, u, g)).join("")}</div>
    ${g.pw && g.pw.days !== g.w.days ? `<p class="legend-note">Changes compare per-day averages, because the two periods are not the same length.</p>` : ""}
  </section>`;
}
function rgCharts(c) {
  const e = RG.eng, days = e.rangeOf(RG.from, RG.to).filter((d) => e.phaseOf(d));
  if (!days.length) return "";
  const withCmp = RG.cmp.mode !== "none" && RG.cmp.mode !== "match";
  return `<div class="grid-2">
    <section class="card"><div class="section-head"><h2>GMV per day</h2>${legend([["--series-1", "BAU day"], ["--series-2", "Sale day"]])}</div><div class="chart-box"><canvas id="c-rg-gmv" aria-label="GMV per day in the selected range"></canvas></div><p class="legend-note">${withCmp ? "The dashed line is the comparison period, day by day. " : ""}A faded bar is a day a sale went live or ended.</p></section>
    <section class="card"><div class="section-head"><h2>Orders per day</h2>${legend([["--series-1", "BAU day"], ["--series-2", "Sale day"]])}</div><div class="chart-box"><canvas id="c-rg-orders" aria-label="Orders per day in the selected range"></canvas></div></section>
  </div>`;
}
function rgDrawCharts() {
  const e = RG.eng, days = e.rangeOf(RG.from, RG.to).filter((d) => e.phaseOf(d));
  if (!days.length) return;
  const len = e.diffDays(RG.from, RG.to) + 1, m = RG.cmp.mode;
  let a = null, b = null;
  if (m === "previous") { b = e.addDays(RG.from, -1); a = e.addDays(RG.from, -len); }
  else if (m === "month") { a = e.shiftMonths(RG.from, -1); b = e.shiftMonths(RG.to, -1); }
  else if (m === "year") { a = e.shiftMonths(RG.from, -12); b = e.shiftMonths(RG.to, -12); }
  else if (m === "custom") { a = RG.cmp.from; b = RG.cmp.to; }
  const cmpDays = a && b ? e.rangeOf(a, b) : [];
  const series = (key, canvasId, unit, label) => {
    const el = document.getElementById(canvasId);
    if (!el) return;
    const val = (d) => { const w = e.windowOf([d]); return w[key]; };
    const datasets = [{ type: "bar", label, data: days.map(val), ...barStyle, backgroundColor: days.map((d) => { const ph = e.phaseOf(d); return ph === "sale" ? css("--series-2") : ph === "mixed" ? css("--series-2") + "80" : css("--series-1"); }) }];
    if (cmpDays.length) datasets.push({ type: "line", label: "Comparison", data: days.map((_, i) => (cmpDays[i] && e.phaseOf(cmpDays[i]) ? val(cmpDays[i]) : null)), borderColor: css("--ink-2"), borderDash: [5, 4], borderWidth: 2, pointRadius: 0, tension: 0.2, spanGaps: false });
    baseChart(el, { type: "bar", data: { labels: days.map((d) => dayLabel(d)), datasets } }, unit);
  };
  series("gmv", "c-rg-gmv", "inr", "GMV");
  series("orders", "c-rg-orders", "int", "Orders");
}
function rgBody() {
  const host = document.getElementById("rg-body");
  if (!host) return;
  const e = RG.eng, c = e.compare(RG.from, RG.to, RG.cmp);
  let html = "";
  if (!c.groups.length) {
    html = `<section class="card"><p class="na">Data unavailable: there are no days in the data for ${esc(rgSpan(RG.from, RG.to))}. The history runs ${esc(rgFmtDay(e.first, true))} to ${esc(rgFmtDay(e.last, true))}.</p></section>`;
  } else {
    if (c.mixed.length) html += `<div class="banner">${c.mixed.length} transition day${c.mixed.length === 1 ? "" : "s"} (${c.mixed.slice(0, 6).map((d) => `${esc(rgFmtDay(d))}: ${esc(e.noteOf(d) || "sale going live or ending")}`).join("; ")}${c.mixed.length > 6 ? "; …" : ""}) are left out of both blocks, because part of the day was a sale and part was not. They are in the whole-range figures.</div>`;
    if (c.outside) html += `<div class="banner">${c.outside} day${c.outside === 1 ? "" : "s"} of this range fall outside the data (${esc(rgFmtDay(e.first, true))} to ${esc(rgFmtDay(e.last, true))}) and are left out.</div>`;
    html += c.groups.map((g) => rgGroupHtml(g, c.groups.length > 1)).join("");
    if (c.groups.length > 1) {
      const whole = { w: c.w, pw: null, prev: null, change: () => null };
      html += `<details class="card rg-all"><summary>The whole range, for reference</summary><p class="legend-note">Sale and BAU days together are not a like-for-like comparison, so there is no change shown here.</p><div class="tiles">${rgAdapt(RG_TILES).map(([k, l, u]) => rgTile(k, l, u, whole)).join("")}</div></details>`;
    }
    html += `<div id="ov-break"><section class="card"><p class="empty">Loading the channel breakdown…</p></section></div>`;
    html += rgCharts(c);
  }
  host.innerHTML = html;
  rgDrawCharts();
  if (c.groups.length) rgOverviewBreakdown(c);
}
// Overview, level 2 and below: sales by channel, then spend and return by
// channel › stage › product. Loaded after the tiles so they show at once.
const OV = { phase: null };
async function rgOverviewBreakdown(c) {
  const slot = document.getElementById("ov-break");
  try { for (const pg of ["channel_days", "slab_days", "campaign_days", "meta_tree", "google_tree"]) await loadPage(pg); }
  catch (err) { if (slot) slot.innerHTML = `<section class="card"><p class="na">Data unavailable: ${esc(err.message)}</p></section>`; return; }
  if (state.tab !== "overview" || !document.getElementById("ov-break")) return;
  const have = c.groups.map((g) => g.phase);
  if (!have.includes(OV.phase)) OV.phase = have[0];
  const g = c.groups.find((x) => x.phase === OV.phase);
  const ctl = c.groups.length > 1 ? `<div class="seg" id="ov-phase" role="group" aria-label="Which days">${c.groups.map((x) => `<button type="button" data-ph="${x.phase}" aria-pressed="${x.phase === OV.phase}">${x.phase === "sale" ? "Sale days" : "BAU days"}</button>`).join("")}</div>` : "";
  const vs = `${esc(rgVsText(g, "cur"))}${g.pw ? ` · compared with ${esc(rgVsText(g, "prev"))}` : ""}`;
  document.getElementById("ov-break").innerHTML = `
    <section class="card"><div class="section-head"><h2>${phaseChip(g.phase)} Where the sales came from</h2>${ctl}<span class="sub">Shopify, by channel · ${vs}</span></div>${trChannelHtml(g)}</section>
    <section class="card"><div class="section-head"><h2>${phaseChip(g.phase)} Basket size</h2><span class="sub">orders by number of items · ${vs}</span></div>${bkHtml(g)}</section>
    <section class="card"><div class="section-head"><h2>${phaseChip(g.phase)} Spend and return: channel › stage › product</h2><span class="sub">${vs}</span></div>${trBarHtml("ov-tree")}<div id="ov-tree"></div></section>`;
  trBind("ov-tree", g);
  document.getElementById("ov-phase")?.addEventListener("click", (ev) => { const b = ev.target.closest("button[data-ph]"); if (b) { OV.phase = b.dataset.ph; rgOverviewBreakdown(c); } });
}

async function rgShell(render) {
  try { await rgEnsure(); }
  catch (err) { const m = document.getElementById("rg-body"); if (m) m.innerHTML = `<section class="card"><h2>Date ranges are unavailable</h2><p class="na">Data unavailable: ${esc(err.message)}</p></section>`; return; }
  if (state.tab !== RG.tab) return; // the user moved on while this loaded
  render();
}

R.overview = (p) => {
  RG.tab = "overview";
  // no "Yesterday at a glance" here: yesterday is the D-1 tab's job
  $main.innerHTML = `<div id="rg-slot"><p class="empty">Loading the date picker…</p></div><div id="rg-body"></div><section class="card">${notes(p)}</section>`;
  rgShell(() => {
    document.getElementById("rg-slot").innerHTML = rgBar();
    rgBind();
    rgBody();
  });
};

R.daily = (p) => {
  RG.tab = "daily";
  $main.innerHTML = `<div id="rg-slot"><p class="empty">Loading the date picker…</p></div><section class="card"><div class="section-head"><h2>Daily</h2><span class="sub" id="rg-dsub"></span></div>${statusStrip()}<div id="rg-dtable"></div>${notes(p)}</section>`;
  rgShell(() => {
    document.getElementById("rg-slot").innerHTML = rgBar();
    rgBind();
    const e = RG.eng, days = e.rangeOf(RG.from, RG.to).filter((d) => e.phaseOf(d)).reverse();
    const cols = p.columns.filter((c) => RG.mode !== "aw" || !RG_AW_DROP.has(c.key)).map((c) => (c.key === "date" ? { label: c.label, text: true, render: (r) => esc(dayLabel(r.date)) }
      : c.key === "phase" ? { label: c.label, text: true, render: (r) => phaseChip(r.phase, r.note) } : c));
    const rows = days.map((d) => {
      const w = e.windowOf([d]);
      const na = {};
      for (const k of Object.keys(RG_DEP)) na[k] = rgNa(w, k);
      return { ...w, date: d, phase: e.phaseOf(d), note: e.noteOf(d), na: { ...w.na, ...Object.fromEntries(Object.entries(na).filter(([, v]) => v)) } };
    });
    document.getElementById("rg-dsub").textContent = `${rows.length} day${rows.length === 1 ? "" : "s"}, newest first. Hover “n/a” for the reason.`;
    document.getElementById("rg-dtable").innerHTML = table(cols, rows, { maxHeight: "70vh" });
  });
};
