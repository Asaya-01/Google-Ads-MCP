/* The SEO / AEO / GEO tab: "Are more people searching for us, finding us on
   Google and in AI assistants, and is the site fast enough to keep them?"
   Overview · Search demand · Organic search · AI assistants · Website speed ·
   Content. Numbers come from pages/seo.json, built daily by the SEO job from
   Search Console, GA4, the Chrome UX Report, PageSpeed Insights, Keyword
   Planner and Shopify, all read only. Inlined inside the dashboard closure. */

(function seoStyles() {
  if (typeof document === "undefined" || document.getElementById("seo-css")) return;
  const s = document.createElement("style");
  s.id = "seo-css";
  s.textContent = `
.seo-bar { display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; margin: 4px 0 2px; font-size: 12.5px; color: var(--muted); }
.seo-src { display: inline-flex; gap: 5px; align-items: center; font-size: 11.5px; padding: 2px 8px; border-radius: 999px; border: 1px solid var(--line); background: var(--surface); color: var(--ink-2); white-space: nowrap; }
.seo-src i { width: 7px; height: 7px; border-radius: 50%; background: var(--good); display: inline-block; }
.seo-src.error i { background: var(--bad); } .seo-src.off i { background: var(--muted); } .seo-src.stale i { background: var(--warn); }
.seo-r { display: inline-block; font-size: 11px; font-weight: 700; border-radius: 4px; padding: 1px 6px; white-space: nowrap; }
.seo-r.good { background: var(--good-bg); color: var(--good); }
.seo-r.ni { background: var(--warn-bg); color: var(--warn-ink, var(--warn)); }
.seo-r.poor { background: var(--bad-bg); color: var(--bad); }
.seo-alert { display: flex; gap: 8px; align-items: baseline; padding: 6px 0; border-bottom: 1px solid var(--line); font-size: 13px; }
.seo-alert:last-child { border-bottom: 0; }
.seo-alert b { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); min-width: 110px; }
.seo-cwv { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
.seo-cwv .m { border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; background: var(--surface); }
.seo-cwv .m .v { font-size: 22px; font-weight: 700; margin: 4px 0; }
.seo-cwv .m .bar { display: flex; height: 6px; border-radius: 3px; overflow: hidden; background: var(--line); }
.seo-cwv .m .bar span { display: block; height: 100%; background: var(--good); }
.seo-empty { border: 1px dashed var(--line); border-radius: 10px; padding: 12px 14px; font-size: 13px; color: var(--ink-2); }
.seo-empty code { font-size: 12px; }
td .up { color: var(--good); } td .down { color: var(--bad); }
`;
  document.head.appendChild(s);
})();

const SEO = { sub: "overview", q: "top", qBrand: "all", pType: "all", ff: "phone", strat: "mobile", dm: "abs" };
const SEO_SUBS = [["overview", "Overview"], ["demand", "Search demand"], ["organic", "Organic search"], ["ai", "AI assistants"], ["speed", "Website speed"], ["content", "Content"]];
const SEO_SRC = { gsc: "Search Console", ga4: "GA4", crux: "Chrome UX Report", psi: "PageSpeed Insights", keyword_planner: "Keyword Planner", shopify: "Shopify" };
const SEO_COLORS = ["--series-1", "--series-2", "#7a5195", "#2a9d8f", "#bc5090", "#8c8c8c", "#c99a2e"];
const seoCol = (i) => { const c = SEO_COLORS[i % SEO_COLORS.length]; return c.startsWith("--") ? css(c) : c; };
const seoN = (v) => (v == null || !isFinite(v) ? "—" : inGroup.format(Math.round(v)));
const seoK = (v) => (v == null || !isFinite(v) ? "—" : Math.abs(v) >= 1e5 ? (v / 1e5).toFixed(1) + " L" : Math.abs(v) >= 1e3 ? (v / 1e3).toFixed(1) + "K" : inGroup.format(Math.round(v)));
const seoPct = (v, dp = 0) => (v == null || !isFinite(v) ? "—" : (v * 100).toFixed(dp) + "%");
const seoChg = (c, p) => (c == null || !p ? null : c / p - 1);
const seoDelta = (d, lowerBetter) => {
  if (d == null || !isFinite(d)) return '<span class="kpi-vs">—</span>';
  const good = lowerBetter ? d < 0 : d > 0;
  return `<span class="${Math.abs(d) < 0.005 ? "kpi-vs" : good ? "up" : "down"}">${d > 0 ? "▲" : d < 0 ? "▼" : ""} ${Math.abs(d * 100).toFixed(1)}%</span>`;
};
const seoMs = (v) => (v == null ? "—" : v >= 1000 ? (v / 1000).toFixed(2) + " s" : Math.round(v) + " ms");
const seoMetricFmt = (m, v) => (v == null ? "—" : m === "cls" ? Number(v).toFixed(2) : seoMs(v));
const seoRating = (r) => (r ? `<span class="seo-r ${r}">${r === "good" ? "Good" : r === "ni" ? "Needs work" : "Poor"}</span>` : "");
const seoRate = (P, m, v) => { const t = P.settings.thresholds[m]; return v == null || !t ? null : v <= t[0] ? "good" : v > t[1] ? "poor" : "ni"; };
const SEO_METRICS = [["lcp", "LCP", "Largest Contentful Paint: when the main image or text block shows. Good ≤ 2.5 s."], ["inp", "INP", "Interaction to Next Paint: how fast the page responds to a tap. Good ≤ 200 ms."], ["cls", "CLS", "Cumulative Layout Shift: how much the page jumps while loading. Good ≤ 0.1."], ["fcp", "FCP", "First Contentful Paint: when anything first shows. Good ≤ 1.8 s."], ["ttfb", "TTFB", "Time to First Byte: how fast the server answers. Good ≤ 0.8 s."]];
const seoTip = (t) => `<span class="tip" tabindex="0" role="note" data-tip="${esc(t)}">i</span>`;
const seoCard = (label, value, sub, tip) => `<div class="kpi"><div class="kpi-l"><span class="kpi-n">${esc(label)}</span>${tip ? seoTip(tip) : ""}</div><div class="kpi-v${value === "—" ? " na-v" : ""}">${value}</div><div class="kpi-d">${sub || ""}</div></div>`;
const seoEmpty = (P, src, what) => {
  const s = (P.sources || {})[src] || {};
  const msg = s.status === "off" ? "This source is switched off in config.json (seo.sources)."
    : s.status === "error" ? `The last run could not read ${esc(SEO_SRC[src])}: <span class="na">${esc(s.error)}</span>`
    : "Not built yet: the SEO job runs every morning at 08:20 IST. To run it now: <code>gcloud run jobs execute asaya-d2c-seo --region asia-south1</code>";
  return `<div class="seo-empty"><b>${esc(what)}</b><br>${msg}</div>`;
};
const seoStale = (P, src) => { const s = (P.sources || {})[src] || {}; return s.status === "error" && s.stale_from ? `<p class="legend-note">${esc(SEO_SRC[src])} failed on the last run; these are the numbers from ${esc(dayLabel(s.stale_from.slice(0, 10)))}.</p>` : ""; };
const seoPath = (u) => String(u || "").replace(/^https?:\/\/[^/]+/, "") || "/";

R.seo = (page) => {
  const qs = new URLSearchParams(location.hash.split("?")[1] || "");
  if (qs.get("sub") && SEO_SUBS.some(([k]) => k === qs.get("sub"))) SEO.sub = qs.get("sub");
  seoDraw(page);
};

function seoDraw(P) {
  destroyCharts();
  const nav = `<nav class="subtabs" aria-label="SEO sections">${SEO_SUBS.map(([k, l]) => `<a href="#seo?sub=${k}" data-seosub="${k}" ${SEO.sub === k ? 'aria-current="page"' : ""}>${esc(l)}</a>`).join("")}</nav>`;
  const srcs = Object.entries(P.sources || {}).map(([k, s]) => {
    const cls = s.status === "error" ? (s.stale_from ? "stale" : "error") : s.status === "off" ? "off" : "";
    const tip = s.status === "error" ? s.error : s.status === "off" ? s.detail : s.detail || (s.at ? "read " + new Date(s.at).toLocaleString("en-IN") : "");
    return `<a class="seo-src ${cls}" href="#health" title="${esc(tip || "")}"><i aria-hidden="true"></i>${esc(SEO_SRC[k] || k)}</a>`;
  }).join("");
  const bar = `<div class="seo-bar">${srcs}<span>Built ${esc(new Date(P.built_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }))}</span></div>`;
  const body = { overview: seoOverview, demand: seoDemand, organic: seoOrganic, ai: seoAI, speed: seoSpeed, content: seoContent }[SEO.sub](P);
  $main.innerHTML = nav + bar + body;
  seoBind(P);
  seoCharts(P);
}

function seoBind(P) {
  $main.querySelectorAll("[data-seosub]").forEach((a) => a.addEventListener("click", (ev) => { ev.preventDefault(); SEO.sub = a.dataset.seosub; history.replaceState(null, "", "#seo?sub=" + SEO.sub); seoDraw(P); }));
  $main.querySelectorAll("[data-seoset]").forEach((b) => b.addEventListener("click", () => { const [k, v] = b.dataset.seoset.split(":"); SEO[k] = v; seoDraw(P); }));
}
const seoSeg = (key, opts) => `<div class="seg">${opts.map(([v, l]) => `<button type="button" data-seoset="${key}:${v}" aria-pressed="${SEO[key] === v}">${esc(l)}</button>`).join("")}</div>`;

// ---------------------------------------------------------------- helpers on the data
function seoGscKpi(P, seg, w) { return (((P.gsc || {}).kpis || {})[seg] || {})[w] || null; }
function seoSum(rows, from, to, idx) { let s = 0, n = 0; for (const r of rows || []) if (r[0] >= from && r[0] <= to) { s += r[idx] || 0; n++; } return n ? s : null; }
function seoWin(P, days = 28) {
  const end = P.as_of, e = new Date(end + "T00:00:00");
  const iso = (d) => d.toISOString().slice(0, 10);
  const back = (n) => { const d = new Date(e); d.setDate(d.getDate() - n); return iso(d); };
  return { cur: [back(days - 1), end], prev: [back(2 * days - 1), back(days)] };
}
function seoWeekly(dates, series, pick) {
  // Monday-start weeks; a week with fewer than 7 days of data is left out
  const out = new Map();
  dates.forEach((d, i) => {
    const v = series[i]; if (!v) return;
    const dt = new Date(d + "T00:00:00"), wd = (dt.getDay() + 6) % 7; dt.setDate(dt.getDate() - wd);
    const k = dt.toISOString().slice(0, 10), a = out.get(k) || { n: 0, v: 0 };
    a.n++; a.v += pick(v); out.set(k, a);
  });
  return [...out.entries()].filter(([, a]) => a.n === 7);
}

// ---------------------------------------------------------------- overview
function seoOverview(P) {
  const tc = seoGscKpi(P, "total", "cur"), tp = seoGscKpi(P, "total", "prev");
  const bc = seoGscKpi(P, "branded", "cur"), bp = seoGscKpi(P, "branded", "prev");
  const nc = seoGscKpi(P, "nonbranded", "cur"), np = seoGscKpi(P, "nonbranded", "prev");
  const W = seoWin(P), ai = (P.shopify || {}).ai || [];
  const aiC = seoSum(ai, W.cur[0], W.cur[1], 2), aiP = seoSum(ai, W.prev[0], W.prev[1], 2);
  const ph = ((P.speed || {}).origin || {}).phone;
  const own = ((P.demand || {}).brands || []).find((b) => b.own);
  const share = own ? (own.share || []).filter((x) => x != null) : [];
  const cards = [
    seoCard("Organic clicks", seoK(tc && tc.clicks), `${seoDelta(seoChg(tc && tc.clicks, tp && tp.clicks))} <span class="kpi-vs">last 28 days vs 28 before</span>`, "Clicks from Google Search to worldofasaya.com (Search Console). Ends 3 days ago: Search Console's data lags."),
    seoCard("Non-branded clicks", seoK(nc && nc.clicks), `${seoDelta(seoChg(nc && nc.clicks, np && np.clicks))} <span class="kpi-vs">people who did not search our name</span>`, "Clicks on queries that do not contain Asaya or a product name (the regex is in config.json, seo.gsc.brand_regex)."),
    seoCard("Branded clicks", seoK(bc && bc.clicks), `${seoDelta(seoChg(bc && bc.clicks, bp && bp.clicks))} <span class="kpi-vs">searched Asaya or a product</span>`),
    seoCard("Avg position", tc && tc.position ? tc.position.toFixed(1) : "—", `${seoDelta(seoChg(tc && tc.position, tp && tp.position), true)} <span class="kpi-vs">lower is better</span>`, "Impression-weighted average position across all queries."),
    seoCard("AI assistant visits", seoN(aiC), `${seoDelta(seoChg(aiC, aiP))} <span class="kpi-vs">ChatGPT, Perplexity, Gemini…</span>`, "Shopify sessions referred by AI assistants, last 28 days (to yesterday)."),
    seoCard("Mobile Core Web Vitals", ph ? (ph.passes ? "Pass" : ph.passes === false ? "Fail" : "—") : "—", ph ? `<span class="kpi-vs">LCP ${seoMetricFmt("lcp", ph.lcp.p75)} · INP ${seoMetricFmt("inp", ph.inp.p75)} · CLS ${seoMetricFmt("cls", ph.cls.p75)}</span>` : '<span class="kpi-vs">real Chrome users, p75</span>', "Real Chrome users on phones over 28 days (Chrome UX Report). Pass = LCP, INP and CLS all good at the 75th percentile."),
  ].join("");
  const alerts = (P.alerts || []).length
    ? P.alerts.map((a) => `<div class="seo-alert"><b>${esc(a.area)}</b><span>${esc(a.text)}</span></div>`).join("")
    : '<p class="sub">Nothing flagged. The rules: branded or non-branded clicks down 20% or more (28 days against the 28 before); mobile failing Core Web Vitals; mobile LCP or INP 15% worse than four weeks earlier; share of search down 2 pp month on month.</p>';
  const shareCard = share.length ? seoCard("Share of search", seoPct(share[share.length - 1], 1), `${share.length > 1 ? `<span class="kpi-vs">${((share[share.length - 1] - share[share.length - 2]) * 100).toFixed(1)} pp MoM</span>` : ""}`, "Asaya's Google searches as a share of the 12 brands in the team's Keyword Planner sheet.") : "";
  const tiles = [
    ["demand", "Search demand", P.demand ? "Monthly Google searches for Asaya and the competitors, share of search, category keywords" : "Not connected yet: see the section"],
    ["organic", "Organic search", "Search Console clicks and impressions, branded vs non-branded, queries and pages that moved, and what it brings in"],
    ["ai", "AI assistants", "Visits and orders from ChatGPT, Perplexity, Gemini, Copilot and Claude, and where they land"],
    ["speed", "Website speed", "Real-user LCP, INP, CLS, FCP and TTFB against competitors, lab tests of the key pages, what slows them"],
    ["content", "Content", "Blog posts published per month"],
  ].map(([k, t, d]) => `<a class="kpi" href="#seo?sub=${k}" data-seosub="${k}" style="min-height:auto"><div class="kpi-l"><span class="kpi-n"><b>${esc(t)}</b></span></div><div class="kpi-d" style="white-space:normal">${esc(d)}</div></a>`).join("");
  return `<section class="card" data-component="seo-kpis"><div class="kpis ${shareCard ? "seven" : "six"}">${cards}${shareCard}</div></section>
    ${rgSec("Flags", "rule-based, from the latest numbers", alerts, { comp: "seo-alerts" })}
    ${rgSec("Sections", "", `<div class="kpis">${tiles}</div>`, { comp: "seo-tiles" })}
    ${rgSec("Not connected", "", `<div class="seo-empty">Authority score, backlinks, referring domains and AI visibility / citation share (the Semrush numbers in the team's sheet) need Semrush, which is not connected. If it is added later, or the agency fills one fixed-format sheet each month, those numbers go into this tab.</div>`, { comp: "seo-gaps" })}`;
}

// ---------------------------------------------------------------- search demand
function seoDemand(P) {
  const D = P.demand;
  const gsc = P.gsc && P.gsc.daily ? (() => {
    // branded impressions per month: the demand for Asaya that Search Console sees, available today
    const m = new Map();
    P.gsc.daily.dates.forEach((d, i) => { const v = P.gsc.daily.branded[i]; if (!v) return; const k = d.slice(0, 7); const a = m.get(k) || [0, 0, 0]; a[0] += v[1]; a[1] += v[0]; a[2]++; m.set(k, a); });
    return [...m.entries()].map(([k, a]) => ({ month: k, impr: a[0], clicks: a[1], days: a[2] }));
  })() : null;
  const gscSec = gsc && gsc.length ? rgSec("Branded searches on Google (Search Console)", "impressions of results for searches with Asaya or a product name, by month: our own demand, available while Keyword Planner is not",
    `<div class="chart-box" style="height:260px"><canvas id="c-seo-brandimp" aria-label="Branded impressions per month"></canvas></div>${table([{ label: "Month", text: true, render: (r) => esc(r.month) + (r.days < 28 ? ` <span class="sub">(${r.days} days)</span>` : "") }, { label: "Branded impressions", render: (r) => seoN(r.impr) }, { label: "Branded clicks", render: (r) => seoN(r.clicks) }], gsc.slice().reverse().slice(0, 16), { full: true })}`, { comp: "seo-brandimp" }) : "";
  if (!D) return seoEmpty(P, "keyword_planner", "Monthly searches for Asaya and the competitors (Keyword Planner)") + gscSec;
  const mo = D.months || [];
  const lbl = (k) => new Date(k + "-01T00:00:00").toLocaleDateString("en-IN", { month: "short", year: "2-digit" });
  const brands = D.brands.slice().sort((a, b) => (b.avg || 0) - (a.avg || 0));
  const cols = [{ label: "Brand", text: true, render: (b) => `${b.own ? "<b>" : ""}${esc(b.brand)}${b.own ? "</b>" : ""}${b.in_share ? "" : ' <span class="sub" title="Not in the share-of-search set">·</span>'}` },
    { label: "Avg monthly", render: (b) => seoN(b.avg) },
    ...mo.map((m, i) => ({ label: lbl(m), render: (b) => { const v = b.monthly[i], p = i ? b.monthly[i - 1] : null; return `${seoN(v)}${i && SEO.dm === "mom" ? `<br><span class="sub">${seoPct(seoChg(v, p))}</span>` : ""}`; } })),
    { label: "Share (latest)", render: (b) => (b.share ? seoPct(b.share[b.share.length - 1], 1) : "—") }];
  const kw = (D.category || []).slice().sort((a, b) => b.avg - a.avg);
  return `${rgSec("Monthly Google searches", "Keyword Planner, India, Google Search; each brand's name with Google's close variants merged. The team's sheet, automated", `<div style="margin-bottom:8px">${seoSeg("dm", [["abs", "Searches"], ["mom", "With MoM %"]])}</div>${table(cols, brands, { full: true })}`, { comp: "seo-demand" })}
    <div class="cols-2">
      ${rgSec("Share of search", "Asaya's searches ÷ the 12 brands in the set, by month", `<div class="chart-box" style="height:280px"><canvas id="c-seo-share" aria-label="Share of search"></canvas></div>`, { comp: "seo-share" })}
      ${rgSec("Asaya vs the biggest competitors", "monthly searches", `<div class="chart-box" style="height:280px"><canvas id="c-seo-brands" aria-label="Monthly searches by brand"></canvas></div>`, { comp: "seo-brands" })}
    </div>
    ${rgSec("Category keywords", "how many people search for what Asaya solves (config.json, seo.category_keywords)", table([{ label: "Keyword", text: true, render: (r) => esc(r.keyword) }, { label: "Avg monthly", render: (r) => seoN(r.avg) },
      { label: "Latest month", render: (r) => seoN(r.monthly[mo[mo.length - 1]]) }, { label: "vs a year before", render: (r) => { const a = r.monthly[mo[mo.length - 1]], b = r.monthly[mo[mo.length - 13]]; return seoPct(seoChg(a, b)); } },
      { label: "Competition", text: true, render: (r) => esc((r.competition || "").toLowerCase()) }], kw, { full: true }), { comp: "seo-category" })}
    ${gscSec}`;
}

// ---------------------------------------------------------------- organic search
function seoOrganic(P) {
  const G = P.gsc;
  if (!G || !G.daily) return seoEmpty(P, "gsc", "Search Console");
  const seg = (s, w) => seoGscKpi(P, s, w);
  const kcard = (s, label) => {
    const c = seg(s, "cur"), p = seg(s, "prev"), y = seg(s, "yoy");
    return seoCard(label + " clicks", seoK(c && c.clicks), `${seoDelta(seoChg(c && c.clicks, p && p.clicks))}<span class="kpi-vs">${y && y.clicks ? ` · YoY ${seoPct(seoChg(c.clicks, y.clicks))}` : ""} · ${seoK(c && c.impressions)} impr · CTR ${seoPct(c && c.ctr, 1)}</span>`);
  };
  // rolling 28 days, week by week: the sheet's "Overall Performance" tab
  const D = G.daily, n = D.dates.length, roll = [];
  for (let i = n - 1; i >= 27 && roll.length < 12; i -= 7) {
    const sum = (k, j) => { let s = 0; for (let x = i - 27; x <= i; x++) s += (D[k][x] || [0, 0])[j]; return s; };
    roll.push({ end: D.dates[i], c: sum("total", 0), im: sum("total", 1), nc: sum("nonbranded", 0), nim: sum("nonbranded", 1) });
  }
  roll.forEach((r, i) => { const p = roll[i + 1]; if (p) { r.dc = seoChg(r.c, p.c); r.dim = seoChg(r.im, p.im); r.dnc = seoChg(r.nc, p.nc); r.dnim = seoChg(r.nim, p.nim); } });
  const pc = (v) => (v == null ? "" : `<br><span class="${v >= 0 ? "up" : "down"}">${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%</span>`);
  const rollT = table([{ label: "28 days to", text: true, render: (r) => esc(dayLabel(r.end)) }, { label: "Clicks", render: (r) => seoN(r.c) + pc(r.dc) }, { label: "Impressions", render: (r) => seoN(r.im) + pc(r.dim) },
    { label: "Non-branded clicks", render: (r) => seoN(r.nc) + pc(r.dnc) }, { label: "Non-branded impressions", render: (r) => seoN(r.nim) + pc(r.dnim) }], roll, { full: true });
  // queries
  let qs = (G.queries || []).filter((q) => SEO.qBrand === "all" || (SEO.qBrand === "brand" ? q.branded : !q.branded));
  const d = (r) => r.clicks - r.clicks_prev;
  qs = SEO.q === "win" ? qs.filter((r) => d(r) > 0).sort((a, b) => d(b) - d(a)) : SEO.q === "lose" ? qs.filter((r) => d(r) < 0).sort((a, b) => d(a) - d(b))
    : SEO.q === "near" ? qs.filter((r) => r.position >= 8 && r.position <= 20).sort((a, b) => b.impressions - a.impressions) : qs.slice().sort((a, b) => b.clicks - a.clicks);
  const posCell = (r) => { if (r.position == null) return "—"; const dp = r.position_prev == null ? null : r.position - r.position_prev; return `${r.position.toFixed(1)}${dp == null || Math.abs(dp) < 0.1 ? "" : ` <span class="${dp < 0 ? "up" : "down"}">${dp < 0 ? "▲" : "▼"}${Math.abs(dp).toFixed(1)}</span>`}`; };
  const chg = (r) => { const v = d(r); return `${seoN(r.clicks)}${v ? ` <span class="${v > 0 ? "up" : "down"}">${v > 0 ? "+" : ""}${seoN(v)}</span>` : ""}`; };
  const qT = table([{ label: "Query", text: true, render: (r) => `<span class="trunc" title="${esc(r.key)}">${esc(r.key)}</span>${r.branded ? ' <span class="sub">brand</span>' : ""}` }, { label: "Clicks (change)", render: chg }, { label: "Impressions", render: (r) => seoN(r.impressions) },
    { label: "CTR", render: (r) => seoPct(r.impressions ? r.clicks / r.impressions : null, 1) }, { label: "Position", render: posCell }], qs.slice(0, 50), { full: true, maxHeight: "520px" });
  // pages
  const pg = (G.pages || []).filter((p) => SEO.pType === "all" || p.type === SEO.pType).slice().sort((a, b) => b.clicks - a.clicks);
  const types = [...new Set((G.pages || []).map((p) => p.type))];
  const pT = table([{ label: "Page", text: true, render: (r) => `<span class="trunc" title="${esc(r.key)}">${esc(seoPath(r.key))}</span> <span class="sub">${esc(r.type)}</span>` }, { label: "Clicks (change)", render: chg }, { label: "Impressions", render: (r) => seoN(r.impressions) }, { label: "Position", render: posCell }], pg.slice(0, 50), { full: true, maxHeight: "520px" });
  const typeT = table([{ label: "Page type", text: true, render: (r) => esc(r.type) }, { label: "Clicks", render: (r) => `${seoN(r.clicks)} ${seoDelta(seoChg(r.clicks, r.clicks_prev))}` }, { label: "Impressions", render: (r) => seoN(r.impressions) }, { label: "Pages with impressions", render: (r) => seoN(r.pages) }], G.page_types || []);
  const bT = table([{ label: "Position", text: true, render: (r) => esc(r.band) }, { label: "Queries", render: (r) => seoN(r.queries) }, { label: "Clicks", render: (r) => seoN(r.clicks) }, { label: "Impressions", render: (r) => seoN(r.impressions) }], G.buckets || []);
  // what organic brings in
  const W = seoWin(P), S = P.shopify || {}, O = (P.orders || []).filter((r) => r[1] === "Organic Search");
  const sC = seoSum(S.organic, W.cur[0], W.cur[1], 2), sP = seoSum(S.organic, W.prev[0], W.prev[1], 2);
  const oC = seoSum(O, W.cur[0], W.cur[1], 2), oP = seoSum(O, W.prev[0], W.prev[1], 2), gC = seoSum(O, W.cur[0], W.cur[1], 3);
  const ga = (P.ga4 || {}).channels || [], gaO = ga.filter((r) => r[1] === "Organic Search");
  const gaC = seoSum(gaO, W.cur[0], W.cur[1], 2), gaP = seoSum(gaO, W.prev[0], W.prev[1], 2), gaPur = seoSum(gaO, W.cur[0], W.cur[1], 4), gaRev = seoSum(gaO, W.cur[0], W.cur[1], 5);
  const lp = (P.ga4 || {}).organic_landing || [];
  const money = `<div class="kpis">${[
    seoCard("Organic sessions (Shopify)", seoN(sC), `${seoDelta(seoChg(sC, sP))} <span class="kpi-vs">search visits with no ad tag</span>`, "Shopify sessions referred by a search engine with no UTM (or utm_medium organic / product_sync). Google Ads clicks also come in as 'search' on Shopify, so tagged visits are left out."),
    seoCard("Organic sessions (GA4)", seoN(gaC), `${seoDelta(seoChg(gaC, gaP))} <span class="kpi-vs">GA4 channel Organic Search</span>`),
    seoCard("Orders (GoKwik UTM)", seoN(oC), `${seoDelta(seoChg(oC, oP))} <span class="kpi-vs">${gC != null ? "₹" + seoK(gC) + " GMV" : ""}</span>`, "Orders whose checkout UTM is google with no paid medium (the dashboard's Organic Search channel). A floor: most organic visitors carry no UTM at checkout."),
    seoCard("Purchases (GA4)", seoN(gaPur), `<span class="kpi-vs">${gaRev != null ? "₹" + seoK(gaRev) : ""} revenue</span>`, "GA4 purchases in the Organic Search channel. GA4 sees only the purchases its tag records through the GoKwik checkout."),
  ].join("")}</div><p class="legend-note">Last 28 days to ${esc(dayLabel(P.as_of))} against the 28 before. Search Console's own window ends 3 days earlier.</p>`;
  return `${seoStale(P, "gsc")}<section class="card" data-component="seo-gsc-kpis"><div class="kpis">${kcard("total", "All")}${kcard("nonbranded", "Non-branded")}${kcard("branded", "Branded")}${seoCard("Avg position", seg("total", "cur") ? seg("total", "cur").position.toFixed(1) : "—", seoDelta(seoChg(seg("total", "cur") && seg("total", "cur").position, seg("total", "prev") && seg("total", "prev").position), true))}</div>
      <p class="legend-note">Search Console, ${esc(dayLabel(G.kpis.window.cur[0]))}–${esc(dayLabel(G.kpis.window.cur[1]))} against the 28 days before; YoY is the same 28 days a year earlier. Branded + non-branded is less than all: Google leaves rare queries out of any query filter.</p></section>
    ${rgSec("Clicks by week", "Search Console, branded and non-branded, with impressions (right axis)", `${legend([["--series-1", "Non-branded clicks"], ["--series-2", "Branded clicks"], ["--muted", "Impressions (right)"]])}<div class="chart-box" style="height:300px"><canvas id="c-seo-gsc" aria-label="Weekly organic clicks"></canvas></div>`, { comp: "seo-gsc-chart" })}
    ${rgSec("Last 28 days, week by week", "the team's Overall Performance sheet, automated: each row is the 28 days to that date, with the change on the row before", rollT, { comp: "seo-roll" })}
    ${rgSec("Queries", "last 28 days against the 28 before", `<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:8px">${seoSeg("q", [["top", "Top"], ["win", "Winners"], ["lose", "Losers"], ["near", "Nearly there (position 8–20)"]])}${seoSeg("qBrand", [["all", "All"], ["nonbrand", "Non-branded"], ["brand", "Branded"]])}</div>${qT}${G.query_count && G.query_count.capped ? '<p class="legend-note">Search Console returns at most 5,000 queries per period; rarer ones are left out.</p>' : ""}`, { comp: "seo-queries" })}
    <div class="cols-2">
      ${rgSec("Pages", "last 28 days against the 28 before", `<div style="margin-bottom:8px">${seoSeg("pType", [["all", "All"], ...types.map((t) => [t, t])])}</div>${pT}`, { comp: "seo-pages" })}
      <div>${rgSec("By page type", "", typeT, { comp: "seo-ptype" })}${rgSec("Where we rank", "queries by average position, last 28 days", bT, { comp: "seo-buckets" })}</div>
    </div>
    ${rgSec("What organic search brings in", "", money, { comp: "seo-organic-money" })}
    ${lp.length ? rgSec("Organic landing pages (GA4)", "last 28 days", table([{ label: "Landing page", text: true, render: (r) => `<span class="trunc" title="${esc(r.path)}">${esc(r.path)}</span>` }, { label: "Sessions", render: (r) => seoN(r.sessions) }, { label: "Engaged", render: (r) => seoPct(r.sessions ? r.engaged / r.sessions : null) }, { label: "Purchases", render: (r) => seoN(r.purchases) }, { label: "Revenue", render: (r) => "₹" + seoK(r.revenue) }], lp.slice(0, 25), { full: true }), { comp: "seo-ga4-lp" }) : ""}`;
}

// ---------------------------------------------------------------- AI assistants
function seoAI(P) {
  const S = P.shopify;
  if (!S || !S.ai) return seoEmpty(P, "shopify", "AI assistant visits (Shopify)");
  const W = seoWin(P), plats = P.settings.ai_platforms;
  const by = plats.map((p) => { const rows = S.ai.filter((r) => r[1] === p); return { p, c: seoSum(rows, W.cur[0], W.cur[1], 2), pr: seoSum(rows, W.prev[0], W.prev[1], 2), atc: seoSum(rows, W.cur[0], W.cur[1], 3), all: seoSum(rows, "0000", "9999", 2) }; }).filter((r) => r.all);
  const tot = (k) => by.reduce((s, r) => s + (r[k] || 0), 0);
  const O = (P.orders || []).filter((r) => r[1] === "AI Assistants");
  const oC = seoSum(O, W.cur[0], W.cur[1], 2), oP = seoSum(O, W.prev[0], W.prev[1], 2), gC = seoSum(O, W.cur[0], W.cur[1], 3);
  const G = (P.ga4 || {}).ai || [];
  const gS = seoSum(G, W.cur[0], W.cur[1], 2), gPur = seoSum(G, W.cur[0], W.cur[1], 4), gRev = seoSum(G, W.cur[0], W.cur[1], 5);
  const allS = ((P.ga4 || {}).channels || []).length ? seoSum(P.ga4.channels, W.cur[0], W.cur[1], 2) : null;
  const cards = [
    seoCard("AI assistant visits", seoN(tot("c")), `${seoDelta(seoChg(tot("c"), tot("pr")))} <span class="kpi-vs">Shopify, last 28 days</span>`, "Sessions whose referrer or UTM is an AI assistant: ChatGPT tags its links utm_source=chatgpt.com; Perplexity, Claude and others show as the referrer."),
    seoCard("Added to cart", seoPct(tot("c") ? tot("atc") / tot("c") : null, 1), '<span class="kpi-vs">of AI visits</span>'),
    seoCard("Orders (GoKwik UTM)", seoN(oC), `${seoDelta(seoChg(oC, oP))} <span class="kpi-vs">${gC != null ? "₹" + seoK(gC) : ""}</span>`, "Orders whose checkout UTM is chatgpt.com, perplexity or gemini (the dashboard's AI Assistants channel). A floor: AI visitors who come back later carry no UTM."),
    seoCard("GA4 AI sessions", seoN(gS), `<span class="kpi-vs">${gPur != null ? seoN(gPur) + " purchases · ₹" + seoK(gRev) : ""}</span>`, "GA4 sessions whose source is an AI assistant."),
    seoCard("Share of all visits", allS && gS != null ? seoPct(gS / allS, 2) : "—", '<span class="kpi-vs">GA4, AI ÷ all sessions</span>'),
  ].join("");
  const pT = table([{ label: "Assistant", text: true, render: (r) => esc(r.p) }, { label: "Visits, last 28 days", render: (r) => `${seoN(r.c)} ${seoDelta(seoChg(r.c, r.pr))}` }, { label: "Added to cart", render: (r) => seoPct(r.c ? r.atc / r.c : null, 1) }, { label: `Visits since ${dayLabel(S.start)}`, render: (r) => seoN(r.all) }], by.sort((a, b) => (b.c || 0) - (a.c || 0)));
  const lp = (S.ai_landing || []).slice(0, 20), glp = ((P.ga4 || {}).ai_landing || []).slice(0, 20);
  return `${seoStale(P, "shopify")}<section class="card" data-component="seo-ai-kpis"><div class="kpis">${cards}</div></section>
    ${rgSec("AI assistant visits by week", "Shopify sessions, by assistant", `<div class="chart-box" style="height:320px"><canvas id="c-seo-ai" aria-label="AI assistant visits by week"></canvas></div>`, { comp: "seo-ai-chart" })}
    <div class="cols-2">
      ${rgSec("By assistant", "", pT, { comp: "seo-ai-plat" })}
      ${rgSec("Where AI visitors land", "Shopify, last 90 days: the pages AI assistants send people to", table([{ label: "Landing page", text: true, render: (r) => `<span class="trunc" title="${esc(r.path)}">${esc(r.path || "(none)")}</span>` }, { label: "Visits", render: (r) => seoN(r.sessions) }, { label: "Added to cart", render: (r) => seoPct(r.sessions ? r.atc / r.sessions : null, 1) }], lp, { full: true }), { comp: "seo-ai-lp" })}
    </div>
    ${glp.length ? rgSec("AI landing pages in GA4", "last 90 days, with purchases", table([{ label: "Landing page", text: true, render: (r) => `<span class="trunc">${esc(r.path)}</span>` }, { label: "Sessions", render: (r) => seoN(r.sessions) }, { label: "Engaged", render: (r) => seoPct(r.sessions ? r.engaged / r.sessions : null) }, { label: "Purchases", render: (r) => seoN(r.purchases) }, { label: "Revenue", render: (r) => "₹" + seoK(r.revenue) }], glp, { full: true }), { comp: "seo-ai-ga4" }) : ""}
    ${rgSec("AI visibility and citations", "", '<div class="seo-empty">How often ChatGPT, Google AI Overviews, AI Mode and Gemini mention or cite Asaya against competitors (the Semrush AI Visibility numbers in the team\'s sheet) needs Semrush or a similar tool, which is not connected. The visits and orders above are what that visibility turns into.</div>', { comp: "seo-ai-vis" })}`;
}

// ---------------------------------------------------------------- website speed
function seoSpeed(P) {
  const Sp = P.speed || {};
  const O = Sp.origin || {}, cur = O[SEO.ff];
  const crux = !Sp.origin ? seoEmpty(P, "crux", "Real-user speed (Chrome UX Report)") : !cur ? '<div class="seo-empty">Chrome has too little traffic data for this form factor.</div>'
    : `<div class="seo-cwv">${SEO_METRICS.map(([k, l, tip]) => { const m = cur[k] || {}; return `<div class="m"><div class="kpi-l"><span class="kpi-n">${esc(l)}</span>${seoTip(tip)}</div><div class="v">${seoMetricFmt(k, m.p75)}</div>${seoRating(m.rating)}${m.good_share != null ? `<div class="bar" style="margin-top:8px" title="${seoPct(m.good_share)} of visits were good"><span style="width:${(m.good_share * 100).toFixed(0)}%"></span></div><div class="sub">${seoPct(m.good_share)} of visits good</div>` : ""}</div>`; }).join("")}</div>
      <p class="legend-note">${cur.passes ? "<b>Passes</b>" : cur.passes === false ? "<b>Fails</b>" : "—"} Core Web Vitals (LCP, INP and CLS all good at p75). Real Chrome users on worldofasaya.com over the 28 days to ${esc(cur.period ? dayLabel(cur.period) : "—")}; p75 = 3 in 4 visits were at least this fast.</p>`;
  const comp = (Sp.brands || []).slice().sort((a, b) => (b.own ? 1 : 0) - (a.own ? 1 : 0) || (((a.phone || {}).lcp || {}).p75 || 1e9) - (((b.phone || {}).lcp || {}).p75 || 1e9));
  const compT = table([{ label: "Site", text: true, render: (r) => `${r.own ? "<b>" : ""}${esc(r.brand)}${r.own ? "</b>" : ""} <span class="sub">${esc((r.origin || "").replace(/^https:\/\//, "") || "no Chrome data")}</span>` },
    ...SEO_METRICS.map(([k, l]) => ({ label: l, render: (r) => { const m = ((r.phone || {})[k]) || {}; return m.p75 == null ? "—" : `${seoMetricFmt(k, m.p75)} ${seoRating(m.rating)}`; } })),
    { label: "Core Web Vitals", render: (r) => (!r.phone ? "—" : r.phone.passes ? '<span class="seo-r good">Pass</span>' : r.phone.passes === false ? '<span class="seo-r poor">Fail</span>' : "—") }], comp, { full: true });
  const urls = (Sp.urls || []);
  const urlT = table([{ label: "Page", text: true, render: (r) => `${esc(r.name)} <span class="sub">${esc(r.path)}</span>` }, ...SEO_METRICS.slice(0, 3).map(([k, l]) => ({ label: l, render: (r) => { const m = ((r.phone || {})[k]) || {}; return m.p75 == null ? '<span class="sub">too few visits</span>' : `${seoMetricFmt(k, m.p75)} ${seoRating(m.rating)}`; } }))], urls, { full: true });
  const psi = (Sp.psi || {}).latest || [];
  const lab = psi.filter((t) => t.strategy === SEO.strat);
  const sc = (v) => (v == null ? "—" : `<span class="seo-r ${v >= 90 ? "good" : v >= 50 ? "ni" : "poor"}">${v}</span>`);
  const labT = table([{ label: "Page", text: true, render: (t) => `${esc(t.name || t.path)} <span class="sub">${esc(t.path)}</span>` }, { label: "Score", render: (t) => sc(t.score) },
    { label: "LCP", render: (t) => `${seoMs(t.lab.lcp)} ${seoRating(seoRate(P, "lcp", t.lab.lcp))}` }, { label: "TBT", render: (t) => seoMs(t.lab.tbt) }, { label: "CLS", render: (t) => (t.lab.cls == null ? "—" : t.lab.cls.toFixed(2)) },
    { label: "FCP", render: (t) => seoMs(t.lab.fcp) }, { label: "Server", render: (t) => seoMs(t.lab.ttfb) }, { label: "Page weight", render: (t) => (t.lab.bytes ? (t.lab.bytes / 1048576).toFixed(1) + " MB" : "—") }, { label: "Requests", render: (t) => seoN(t.lab.requests) },
    { label: "Tested", render: (t) => esc(dayLabel(t.date)) }], lab, { full: true });
  // fixes and scripts, across the tested pages
  const fix = new Map(), third = new Map();
  for (const t of lab) {
    for (const o of t.opportunities || []) { const a = fix.get(o.title) || { title: o.title, pages: 0, ms: 0 }; a.pages++; a.ms += o.saving_ms; fix.set(o.title, a); }
    for (const s of t.third_party || []) { const a = third.get(s.entity) || { entity: s.entity, pages: 0, bytes: 0, ms: 0 }; a.pages++; a.bytes += s.bytes || 0; a.ms += s.blocking_ms || 0; third.set(s.entity, a); }
  }
  const fixT = table([{ label: "Fix (Lighthouse)", text: true, render: (r) => esc(r.title) }, { label: "Pages", render: (r) => seoN(r.pages) }, { label: "Avg saving", render: (r) => seoMs(r.ms / r.pages) }], [...fix.values()].sort((a, b) => b.ms - a.ms).slice(0, 10));
  const thT = table([{ label: "Third-party script", text: true, render: (r) => esc(r.entity) }, { label: "Pages", render: (r) => seoN(r.pages) }, { label: "Avg blocking", render: (r) => seoMs(r.ms / r.pages) }, { label: "Avg size", render: (r) => (r.bytes / r.pages / 1024).toFixed(0) + " KB" }], [...third.values()].sort((a, b) => b.ms - a.ms || b.bytes - a.bytes).slice(0, 12));
  const errs = (Sp.psi || {}).errors || [];
  return `${seoStale(P, "crux")}${rgSec("Real users", "Chrome UX Report, p75 over 28 days", `<div style="margin-bottom:10px">${seoSeg("ff", [["phone", "Mobile"], ["desktop", "Desktop"]])}</div>${crux}`, { comp: "seo-cwv" })}
    ${Sp.history ? `<div class="cols-2">
      ${rgSec("LCP and INP over time", `${SEO.ff === "phone" ? "mobile" : "desktop"}, p75, each point the 28 days to that week; dashed: the good limit`, `${legend([["--series-1", "LCP (left)"], ["--series-2", "INP (right)"]])}<div class="chart-box" style="height:280px"><canvas id="c-seo-hist" aria-label="LCP and INP over time"></canvas></div>`, { comp: "seo-hist" })}
      ${rgSec("CLS over time", "p75; dashed: the good limit (0.1)", `<div class="chart-box" style="height:280px"><canvas id="c-seo-cls" aria-label="CLS over time"></canvas></div>`, { comp: "seo-cls" })}
    </div>` : ""}
    ${rgSec("Against competitors", "real Chrome users on phones, p75, 28 days", compT, { comp: "seo-speed-comp" })}
    ${urls.length ? rgSec("Key pages, real users", "phones, p75; pages with too few visits have no page-level data", urlT, { comp: "seo-speed-urls" }) : ""}
    ${rgSec("Lab tests", "PageSpeed Insights (Lighthouse), one run per page a day; lab numbers vary run to run, so read the trend", `<div style="margin-bottom:8px">${seoSeg("strat", [["mobile", "Mobile"], ["desktop", "Desktop"]])}</div>${lab.length ? labT : seoEmpty(P, "psi", "PageSpeed Insights")}${errs.length ? `<p class="legend-note">Not tested on the last run: ${esc(errs.join("; "))}</p>` : ""}<p class="legend-note">TBT (Total Blocking Time) is the lab stand-in for INP: a lab test cannot tap the page.</p>`, { comp: "seo-psi" })}
    ${lab.length ? `<div class="cols-2">${rgSec("What would make it faster", "Lighthouse's opportunities across the tested pages", fixT, { comp: "seo-fix" })}${rgSec("Third-party scripts", "apps and pixels, by main-thread blocking time", thT, { comp: "seo-third" })}</div>` : ""}
    ${psi.length ? rgSec("Lab score by day", `${SEO.strat}, performance score per page`, `<div class="chart-box" style="height:280px"><canvas id="c-seo-psi" aria-label="Lab score by day"></canvas></div>`, { comp: "seo-psi-trend" }) : ""}`;
}

// ---------------------------------------------------------------- content
function seoContent(P) {
  const C = (P.shopify || {}).content;
  if (!C) return (P.shopify || {}).content_error
    ? `<div class="seo-empty"><b>Blog posts</b><br>Shopify did not list the articles: <span class="na">${esc(P.shopify.content_error)}</span>. The dashboard's Shopify app needs the read_content scope for this section.</div>`
    : seoEmpty(P, "shopify", "Blog posts (Shopify)");
  const rows = C.months.map((m, i) => ({ m, counts: C.counts[i], total: C.counts[i].reduce((a, b) => a + b, 0) })).reverse();
  return `${rgSec("Blog posts published per month", "Shopify blog articles by publish date", `<div class="chart-box" style="height:280px"><canvas id="c-seo-content" aria-label="Blog posts per month"></canvas></div>`, { comp: "seo-content-chart" })}
    <div class="cols-2">
      ${rgSec("By month", "", table([{ label: "Month", text: true, render: (r) => esc(r.m) }, { label: "Posts", render: (r) => seoN(r.total) }, ...C.blogs.map((b, j) => ({ label: b, render: (r) => seoN(r.counts[j]) }))], rows.slice(0, 18), { full: true }), { comp: "seo-content-month" })}
      ${rgSec("Latest posts", "", table([{ label: "Post", text: true, render: (r) => `<span class="trunc" title="${esc(r.handle)}">${esc(r.handle.replace(/-/g, " "))}</span>` }, { label: "Blog", text: true, render: (r) => esc(r.blog_title || r.blog) }, { label: "Published", render: (r) => esc(dayLabel(r.published)) }], C.recent || [], { full: true, maxHeight: "480px" }), { comp: "seo-content-recent" })}
    </div>
    <p class="legend-note">Organic clicks to blog posts are on Organic search › By page type.</p>`;
}

// ---------------------------------------------------------------- charts
function seoCharts(P) {
  const el = (id) => document.getElementById(id);
  const lineDs = (label, data, color, extra = {}) => ({ type: "line", label, data, borderColor: color, backgroundColor: color, pointRadius: 0, borderWidth: 2, tension: 0.25, spanGaps: true, ...extra });
  const xAxis = { ticks: { color: css("--muted"), maxRotation: 0, autoSkipPadding: 14, font: { size: 11 } }, grid: { display: false } };
  if (el("c-seo-gsc") && P.gsc) {
    const D = P.gsc.daily, nb = seoWeekly(D.dates, D.nonbranded, (v) => v[0]), br = new Map(seoWeekly(D.dates, D.branded, (v) => v[0])), im = new Map(seoWeekly(D.dates, D.total, (v) => v[1]));
    baseChart(el("c-seo-gsc"), { type: "bar", data: { labels: nb.map(([k]) => dayLabel(k)), datasets: [
      { label: "Non-branded clicks", data: nb.map(([, a]) => a.v), backgroundColor: css("--series-1"), stack: "c", ...barStyle },
      { label: "Branded clicks", data: nb.map(([k]) => (br.get(k) || {}).v ?? null), backgroundColor: css("--series-2"), stack: "c", ...barStyle },
      lineDs("Impressions", nb.map(([k]) => (im.get(k) || {}).v ?? null), css("--muted"), { yAxisID: "y1" })] },
      options: { scales: { x: { ...xAxis, stacked: true }, y: { ...axisOpts("int"), stacked: true }, y1: { ...axisOpts("int"), position: "right", grid: { display: false } } } } }, "int");
  }
  if (el("c-seo-brandimp") && P.gsc) {
    const m = new Map(); P.gsc.daily.dates.forEach((d, i) => { const v = P.gsc.daily.branded[i]; if (v) m.set(d.slice(0, 7), (m.get(d.slice(0, 7)) || 0) + v[1]); });
    const ks = [...m.keys()];
    baseChart(el("c-seo-brandimp"), { type: "bar", data: { labels: ks, datasets: [{ label: "Branded impressions", data: ks.map((k) => m.get(k)), backgroundColor: css("--series-1"), ...barStyle }] } }, "int");
  }
  if (P.demand && (el("c-seo-share") || el("c-seo-brands"))) {
    const D = P.demand, labels = D.months.map((k) => new Date(k + "-01T00:00:00").toLocaleDateString("en-IN", { month: "short", year: "2-digit" }));
    const own = D.brands.find((b) => b.own), top = D.brands.filter((b) => !b.own && b.in_share).sort((a, b) => (b.avg || 0) - (a.avg || 0)).slice(0, 5);
    if (el("c-seo-share") && own) baseChart(el("c-seo-share"), { type: "line", data: { labels, datasets: [lineDs("Asaya share of search", own.share, css("--series-1"))] } }, "pct");
    if (el("c-seo-brands")) baseChart(el("c-seo-brands"), { type: "line", data: { labels, datasets: [own, ...top].filter(Boolean).map((b, i) => lineDs(b.brand, b.monthly, seoCol(i), b.own ? { borderWidth: 3 } : { borderDash: [4, 3] })) } }, "int");
  }
  if (el("c-seo-ai") && P.shopify) {
    const plats = P.settings.ai_platforms, dates = [...new Set(P.shopify.ai.map((r) => r[0]))].sort();
    const all = []; let s = P.shopify.start; const end = P.shopify.end; const dd = new Date(s + "T00:00:00");
    while (s <= end) { all.push(s); dd.setDate(dd.getDate() + 1); s = dd.toISOString().slice(0, 10); }
    const ds = plats.map((p, i) => {
      const byDay = new Map(P.shopify.ai.filter((r) => r[1] === p).map((r) => [r[0], r[2]]));
      const w = seoWeekly(all, all.map((d) => [byDay.get(d) || 0]), (v) => v[0]);
      return { p, i, w };
    }).filter((x) => x.w.some(([, a]) => a.v));
    const labels = (ds[0] ? ds[0].w : []).map(([k]) => dayLabel(k));
    if (dates.length) baseChart(el("c-seo-ai"), { type: "bar", data: { labels, datasets: ds.map((x, j) => ({ label: x.p, data: x.w.map(([, a]) => a.v), backgroundColor: seoCol(j), stack: "a", ...barStyle })) },
      options: { plugins: { legend: { display: true, position: "bottom", labels: { boxWidth: 10, color: css("--ink-2") } } }, scales: { x: { ...xAxis, stacked: true }, y: { ...axisOpts("int"), stacked: true } } } }, "int");
  }
  const H = (P.speed || {}).history && P.speed.history[SEO.ff];
  if (H && H.dates && el("c-seo-hist")) {
    const labels = H.dates.map((d) => dayLabel(d)), th = P.settings.thresholds, n = labels.length;
    baseChart(el("c-seo-hist"), { type: "line", data: { labels, datasets: [lineDs("LCP p75 (ms)", H.lcp, css("--series-1")), lineDs("INP p75 (ms)", H.inp, css("--series-2"), { yAxisID: "y1" }),
      lineDs("LCP good limit", Array(n).fill(th.lcp[0]), css("--series-1"), { borderDash: [5, 4], borderWidth: 1 }), lineDs("INP good limit", Array(n).fill(th.inp[0]), css("--series-2"), { borderDash: [5, 4], borderWidth: 1, yAxisID: "y1" })] },
      options: { scales: { x: xAxis, y: { ...axisOpts("int"), beginAtZero: true }, y1: { ...axisOpts("int"), position: "right", beginAtZero: true, grid: { display: false } } } } }, "int");
  }
  if (H && H.dates && el("c-seo-cls")) {
    const n = H.dates.length;
    baseChart(el("c-seo-cls"), { type: "line", data: { labels: H.dates.map((d) => dayLabel(d)), datasets: [lineDs("CLS p75", H.cls, css("--series-1")), lineDs("Good limit", Array(n).fill(P.settings.thresholds.cls[0]), css("--muted"), { borderDash: [5, 4], borderWidth: 1 })] },
      options: { scales: { x: xAxis, y: { ...axisOpts(), beginAtZero: true, ticks: { color: css("--muted"), callback: (v) => Number(v).toFixed(2) } } } } }, "");
  }
  if (el("c-seo-psi")) {
    const tr = ((P.speed || {}).psi || {}).trend || [], mine = tr.filter((t) => t.strategy === SEO.strat), days = [...new Set(mine.map((t) => t.date))].sort();
    const pages = P.settings.speed_pages;
    baseChart(el("c-seo-psi"), { type: "line", data: { labels: days.map((d) => dayLabel(d)), datasets: pages.map((p, i) => { const m = new Map(mine.filter((t) => t.path === p.path).map((t) => [t.date, t.score])); return lineDs(p.name, days.map((d) => m.get(d) ?? null), seoCol(i)); }) },
      options: { plugins: { legend: { display: true, position: "bottom", labels: { boxWidth: 10, color: css("--ink-2") } } }, scales: { x: xAxis, y: { ...axisOpts("int"), min: 0, max: 100 } } } }, "int");
  }
  const C = (P.shopify || {}).content;
  if (C && el("c-seo-content")) {
    baseChart(el("c-seo-content"), { type: "bar", data: { labels: C.months, datasets: C.blogs.map((b, j) => ({ label: b, data: C.counts.map((r) => r[j]), backgroundColor: seoCol(j), stack: "b", ...barStyle })) },
      options: { plugins: { legend: { display: true, position: "bottom", labels: { boxWidth: 10, color: css("--ink-2") } } }, scales: { x: { ...xAxis, stacked: true }, y: { ...axisOpts("int"), stacked: true } } } }, "int");
  }
}

// ---------------------------------------------------------------- Data health
function seoHealth(P) {
  const rows = Object.entries(P.sources || {}).map(([k, s]) => ({ k, s }));
  const runs = (P.run_log || []).slice(0, 10);
  return table([{ label: "Source", text: true, render: (r) => esc(SEO_SRC[r.k] || r.k) },
    { label: "Status", text: true, render: (r) => r.s.status === "ok" ? '<span class="chip ok">ok</span>' : r.s.status === "off" ? '<span class="chip">off</span>' : `<span class="chip missing">error</span>${r.s.stale_from ? ` <span class="sub">showing ${esc(r.s.stale_from.slice(0, 10))}</span>` : ""}` },
    { label: "Detail", text: true, render: (r) => esc(r.s.error || r.s.detail || (r.s.at ? "read " + new Date(r.s.at).toLocaleString("en-IN") : "")) }], rows, { full: true })
    + (P.gsc ? `<p class="legend-note">Search Console property: ${esc(P.gsc.site)}${P.ga4 ? ` · GA4: ${esc(P.ga4.property)}` : ""}${(P.speed || {}).origin_url ? ` · Chrome UX origin: ${esc(P.speed.origin_url)}` : ""}</p>` : "")
    + (runs.length ? `<p class="legend-note">Last runs: ${runs.map((r) => `${esc(new Date(r.run_time).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }))} ${esc(r.status)}`).join(" · ")}</p>` : "");
}
