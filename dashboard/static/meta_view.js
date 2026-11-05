/* Marketing › Meta: read Meta in 30 seconds, investigate in 3 clicks.
   Filter bar → KPI strip → funnel efficiency strip → watchlist → SKU × Stage
   matrix → explorer (Campaign › Ad set › Ad, or by stage / SKU / offer) →
   detail drawer. Every number is summed from the meta_ads page (ad × day)
   and ratios are worked out from the summed bases at whatever level is shown.
   The view's state lives in the URL (#marketing?sub=meta&…), so a view can be
   shared and reopens the same. Inlined after range_tabs.js. */

const MV = {
  scope: "perf", offer: "all", acct: "all", status: "all", min: null, q: "",
  mx: "m_roas", g: "camp", cols: "eff", custom: [], cmpv: false,
  xf: { sku: null, stage: null }, exp: new Set(), sel: null, dr: null,
  dm: ["m_roas", "m_spend"], dg: "d", drange: "picked", sort: { col: null, dir: -1 }, more: false,
  ix: null, reach: new Map(),
};
const MV_F = ["spend", "impr", "clicks", "link", "lpv", "atc", "v3s", "purch", "rev", "rd"];
const MV_FUNNEL = new Set(["link", "lpv", "atc", "v3s"]);
const MV_STAGES = ["TOF", "MOF", "BOF", "Catalog"];
const MV_KPI = { perf: ["m_spend", "m_rev", "m_roas", "m_purch", "m_cpp", "m_purch_rate"], aw: ["m_spend", "m_reach", "m_freq", "m_cpm", "m_hook", "m_ctr"] };
const MV_MATRIX = { perf: ["m_roas", "m_spend", "m_cpp", "m_purch", "m_ctr", "m_purch_rate", "m_cpatc"], aw: ["m_spend", "m_cpm", "m_ctr", "m_hook"] };
const MV_COLS = {
  perf: { eff: ["m_spend", "m_rev", "m_roas", "m_purch", "m_cpp", "m_aov"], fun: ["m_ctr", "m_lpv_rate", "m_atc_rate", "m_purch_rate"], cost: ["m_cpm", "m_cpc", "m_cplpv", "m_cpatc", "m_cpp"], del: ["m_impr", "m_reach", "m_freq", "m_link"], cre: ["m_hook", "m_freq", "m_ctr"] },
  aw: { eff: ["m_spend", "m_impr", "m_cpm", "m_ctr", "m_hook", "m_v3s"], fun: ["m_ctr", "m_lpv_rate", "m_atc_rate"], cost: ["m_cpm", "m_cpc", "m_cplpv"], del: ["m_impr", "m_reach", "m_freq", "m_link"], cre: ["m_hook", "m_freq", "m_ctr"] },
};
const MV_PRESET_NAMES = [["eff", "Efficiency"], ["fun", "Funnel"], ["cost", "Costs"], ["del", "Delivery"], ["cre", "Creative"], ["custom", "Custom"]];
const MV_GROUPS = { camp: ["camp", "set", "ad"], stage: ["stage", "sku", "camp", "set", "ad"], sku: ["sku", "stage", "camp", "set", "ad"], offer: ["offer", "stage", "camp", "set", "ad"] };
const MV_GROUP_NAMES = [["camp", "Campaign › Ad set › Ad"], ["stage", "Stage › SKU › …"], ["sku", "SKU › Stage › …"], ["offer", "Offer › Stage › …"]];
const MV_LVL_NAME = { camp: "Campaign", set: "Ad set", ad: "Ad", stage: "Stage", sku: "SKU", offer: "Offer" };

// ---------------------------------------------------------------- URL state
function mvFromUrl() {
  const q = new URLSearchParams((location.hash.split("?")[1]) || "");
  const get = (k, d) => (q.has(k) ? q.get(k) : d);
  MV.scope = get("scope", "perf") === "aw" ? "aw" : "perf";
  MV.offer = get("offer", "all"); MV.acct = get("acct", "all"); MV.status = get("status", "all");
  MV.min = q.has("min") ? Math.max(0, +q.get("min") || 0) : null; MV.q = get("q", "");
  MV.mx = get("mx", MV.scope === "aw" ? "m_spend" : "m_roas"); MV.g = MV_GROUPS[get("g", "camp")] ? get("g", "camp") : "camp";
  MV.cols = get("cols", "eff"); MV.custom = (get("cc", "") || "").split(",").filter((x) => METRICS[x]).slice(0, 8);
  MV.cmpv = get("cv", "0") === "1";
  const xf = (get("xf", "") || "").split(",");
  MV.xf = { sku: xf[0] || null, stage: xf[1] || null };
  MV.exp = new Set((get("exp", "") || "").split("~").filter(Boolean));
  MV.sel = get("sel", null) || null;
  const dr = get("dr", ""); MV.dr = dr ? { lvl: dr.split(":")[0], id: dr.split(":").slice(1).join(":") } : null;
  MV.dm = (get("dm", "") || "").split(",").filter((x) => METRICS[x]).slice(0, 2); if (!MV.dm.length) MV.dm = MV.scope === "aw" ? ["m_spend", "m_cpm"] : ["m_roas", "m_spend"];
  MV.dg = get("dg", "d") === "w" ? "w" : "d"; MV.drange = get("drg", "picked");
  const so = get("so", ""); MV.sort = so ? { col: so.replace(/^-/, ""), dir: so.startsWith("-") ? -1 : 1 } : { col: null, dir: -1 };
}
function mvToUrl() {
  const p = new URLSearchParams({ sub: "meta" });
  const put = (k, v, d) => { if (v !== d && v != null && v !== "") p.set(k, v); };
  put("scope", MV.scope, "perf"); put("offer", MV.offer, "all"); put("acct", MV.acct, "all"); put("status", MV.status, "all");
  if (MV.min != null) p.set("min", String(MV.min)); put("q", MV.q, "");
  put("mx", MV.mx, MV.scope === "aw" ? "m_spend" : "m_roas"); put("g", MV.g, "camp"); put("cols", MV.cols, "eff");
  if (MV.cols === "custom" && MV.custom.length) p.set("cc", MV.custom.join(","));
  if (MV.cmpv) p.set("cv", "1");
  if (MV.xf.sku || MV.xf.stage) p.set("xf", `${MV.xf.sku || ""},${MV.xf.stage || ""}`);
  if (MV.exp.size) p.set("exp", [...MV.exp].join("~"));
  put("sel", MV.sel, null);
  if (MV.dr) p.set("dr", `${MV.dr.lvl}:${MV.dr.id}`);
  if (MV.dr) { p.set("dm", MV.dm.join(",")); put("dg", MV.dg, "d"); put("drg", MV.drange, "picked"); }
  if (MV.sort.col) p.set("so", (MV.sort.dir < 0 ? "-" : "") + MV.sort.col);
  history.replaceState(null, "", "#marketing?" + p.toString());
}

// ---------------------------------------------------------------- data
function mvIndex(P) {
  if (MV.ix && MV.ix.P === P) return MV.ix;
  const di = new Map(P.dates.map((d, i) => [d, i]));
  const byDay = P.dates.map(() => []);
  P.rows.forEach((r, i) => byDay[r[0]].push(i));
  const ad = P.ads.map((a) => { const s = P.adsets[a[2]], c = P.campaigns[s[2]]; return { set: a[2], camp: s[2], acc: c[2], scope: c[3], status: a[3] || s[3] || c[4], stage: a[5], sku: a[6], offer: a[7], name: a[1], hay: (c[1] + " " + s[1] + " " + a[1]).toLowerCase() }; });
  MV.ix = { P, di, byDay, ad };
  return MV.ix;
}
const mvZero = () => ({ spend: 0, impr: 0, clicks: 0, link: 0, lpv: 0, atc: 0, v3s: 0, purch: 0, rev: 0, rd: 0, nf: 0, n: 0 });
function mvAdd(s, r) {
  s.spend += r[2]; s.impr += r[3]; s.clicks += r[4];
  if (r[5] == null) s.nf++; else { s.link += r[5]; s.lpv += r[6]; s.atc += r[7]; s.v3s += r[8]; s.rd += r[11] || 0; }
  s.purch += r[9]; s.rev += r[10]; s.n++;
}
const MV_ACTIVE = new Set(["ACTIVE", "WITH_ISSUES", "IN_PROCESS", "PENDING_REVIEW"]);
// the page filters (not the matrix's cross-filters)
function mvAdOk(a) {
  const A = MV.ix.ad[a];
  if ((MV.scope === "aw" ? "Awareness" : "Performance") !== A.scope) return false;
  if (MV.offer !== "all" && A.offer !== MV.offer) return false;
  if (MV.acct !== "all" && String(A.acc) !== MV.acct) return false;
  if (MV.status !== "all") { const act = MV_ACTIVE.has(A.status); if ((MV.status === "active") !== act || !A.status) return false; }
  if (MV.q && !A.hay.includes(MV.q.toLowerCase())) return false;
  return true;
}
function mvXOk(a) {
  const A = MV.ix.ad[a], P = MV.ix.P;
  if (MV.xf.sku && P.skus[A.sku].code !== MV.xf.sku) return false;
  if (MV.xf.stage && A.stage !== MV.xf.stage) return false;
  return true;
}
// sums over days for ads passing `ok`, optionally split by key(adIndex)
function mvSum(days, ok, key) {
  const { P, byDay } = MV.ix, out = key ? new Map() : mvZero();
  for (const d of days) for (const i of byDay[d]) {
    const r = P.rows[i];
    if (!ok(r[1])) continue;
    if (key) { const k = key(r[1]); let s = out.get(k); if (!s) out.set(k, (s = mvZero())); mvAdd(s, r); } else mvAdd(out, r);
  }
  return out;
}
// a metric from summed bases; null for a zero base ("—")
function mvVal(id, s) {
  const m = METRICS[id] && METRICS[id].mv;
  if (!m || !s) return null;
  if ((MV_FUNNEL.has(m.num) || MV_FUNNEL.has(m.den)) && s.nf && s.nf === s.n) return null;
  const num = s[m.num];
  if (!m.den) return num;
  const den = s[m.den];
  return den ? (num / den) * (m.mul || 1) : null;
}
const mvNaFunnel = (id, s) => { const m = METRICS[id] && METRICS[id].mv; return m && (MV_FUNNEL.has(m.num) || MV_FUNNEL.has(m.den)) && s && s.nf ? "link clicks, LPV and ATC are being read again for some of these days" : null; };
// change against the comparison: sums per day when the periods differ in length, ratios directly
function mvChange(id, a, b, na, nb) {
  const x = mvVal(id, a), y = mvVal(id, b);
  if (x == null || y == null) return { ch: null, small: b != null && b.n > 0 && y === 0 };
  const m = METRICS[id].mv, count = !m.den;
  const small = !b.spend || b.spend < (MV.ix.P.config.grey_below_spend || 5000) || y === 0;
  if (!y) return { ch: null, small: true };
  return { ch: count && na && nb && na !== nb ? x / na / (y / nb) - 1 : x / y - 1, small };
}
const mvF = (id, v, compact) => (v == null ? "—" : mVal(id, v, compact));
function mvMid(name, n = 46) { // the start and the end carry the stage and the SKU
  if (!name || name.length <= n) return name || "";
  const k = Math.floor((n - 1) / 2);
  return name.slice(0, k) + "…" + name.slice(-(n - 1 - k));
}
function mvSpark(vals, cls = "") {
  const v = vals.map((x) => (x == null || !isFinite(x) ? null : x)), nums = v.filter((x) => x != null);
  if (nums.length < 2) return '<span class="na">–</span>';
  const W = 84, H = 22, lo = Math.min(...nums), hi = Math.max(...nums), sp = hi - lo || 1;
  let d = "", pen = false;
  v.forEach((x, i) => { if (x == null) { pen = false; return; } d += `${pen ? "L" : "M"}${((i / (v.length - 1)) * (W - 2) + 1).toFixed(1)} ${(H - 2 - ((x - lo) / sp) * (H - 4)).toFixed(1)} `; pen = true; });
  return `<svg class="mv-spark ${cls}" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}
// the last 14 days of the period, for sparklines
const mvLast14 = (cur) => { const end = Math.max(...cur); return Array.from({ length: 14 }, (_, i) => end - 13 + i).filter((d) => d >= 0); };
function mvSeries(id, days, ok) { return days.map((d) => mvVal(id, mvSum([d], ok))); }

// ---------------------------------------------------------------- reach (asked of Meta)
async function mvReach(adIdx, days) {
  const { P } = MV.ix;
  if (!adIdx.length || !days.length) return null;
  const since = P.dates[Math.min(...days)], until = P.dates[Math.max(...days)];
  const ids = adIdx.map((a) => P.ads[a][0]);
  const key = `${since}|${until}|${ids.length > 300 ? ids.length + ":" + ids.slice(0, 50).join(",") : ids.join(",")}`;
  if (MV.reach.has(key)) return MV.reach.get(key);
  const pr = (async () => {
    if (embedded) return { reach: null, na: "reach is asked of Meta on the live dashboard only" };
    if (ids.length > 2000) return { reach: null, na: "too many ads to ask Meta for unique reach at once; narrow the filters" };
    try {
      const r = await fetch("/api/meta/reach", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ since, until, ads: ids }) });
      return r.ok ? await r.json() : { reach: null, na: `HTTP ${r.status}` };
    } catch (e) { return { reach: null, na: e.message }; }
  })();
  MV.reach.set(key, pr);
  return pr;
}

// ---------------------------------------------------------------- the period
function mvPeriod() {
  const { P, di } = MV.ix;
  const c = RG.eng.compare(RG.from, RG.to, RG.cmp), g = rgPick(c);
  if (!g) return null;
  const map = (list) => (list || []).map((d) => di.get(d)).filter((x) => x !== undefined).sort((a, b) => a - b);
  const cur = map(g.cur), prev = map(g.prev);
  const missing = (g.cur || []).filter((d) => !di.has(d));
  return { g, cur, prev, missing, P };
}

// ---------------------------------------------------------------- sections
function mvFilterBar(P) {
  const seg = (id, val, opts) => `<div class="seg" data-f="${id}" role="group">${opts.map(([k, l]) => `<button type="button" data-v="${esc(k)}" aria-pressed="${val === k}">${esc(l)}</button>`).join("")}</div>`;
  const min = MV.min == null ? P.config.min_spend_default : MV.min;
  return `<div class="mv-filters" id="mv-filters">
    ${seg("scope", MV.scope, [["perf", "Performance"], ["aw", "Awareness"]])}
    ${seg("offer", MV.offer, [["all", "All"], ["Offer", "Offer"], ["Non-offer", "Non-offer"], ["Not tagged", "Not tagged"]])}
    ${seg("acct", MV.acct, [["all", "All accounts"], ...P.accounts.map((a, i) => [String(i), a.name.replace(/^Asaya /, "")])])}
    ${seg("status", MV.status, [["all", "All"], ["active", "Active"], ["paused", "Paused/ended"]])}
    <label class="mv-min">Min spend ₹<input type="number" id="mv-min" min="0" step="100" value="${min}"></label>
    <input type="search" id="mv-q" placeholder="Search campaigns, ad sets, ads" value="${esc(MV.q)}" aria-label="Search names">
  </div>`;
}
function mvKpis(T, B, pr, ok) {
  const ids = MV_KPI[MV.scope], last = mvLast14(pr.cur);
  return `<div class="kpis six" id="mv-kpis">${ids.map((id) => {
    if (id === "m_reach" || id === "m_freq") return `<div class="kpi-slot" data-reach="${id}">${kpiCard(id, { loading: true })}</div>`;
    const { ch, small } = mvChange(id, T, B, pr.cur.length, pr.prev.length);
    const v = mvVal(id, T);
    return kpiCard(id, { value: v, prev: pr.prev.length ? mvVal(id, B) : null, change: ch, small, na: v == null ? mvNaFunnel(id, T) || "no base in these days" : null, spark: mvSpark(mvSeries(id, last, ok)) });
  }).join("")}</div>`;
}
async function mvKpiReach(pr, ok) {
  const ads = [...mvSum(pr.cur, ok, (a) => a).keys()], pads = pr.prev.length ? [...mvSum(pr.prev, ok, (a) => a).keys()] : [];
  const [a, b] = await Promise.all([mvReach(ads, pr.cur), pads.length ? mvReach(pads, pr.prev) : null]);
  for (const el of document.querySelectorAll("#mv-kpis [data-reach]")) {
    const id = el.dataset.reach, f = (x) => (!x || x.reach == null ? null : id === "m_reach" ? x.reach : x.frequency);
    const v = f(a), pv = f(b);
    el.outerHTML = kpiCard(id, { value: v, prev: pr.prev.length ? pv : null, change: v != null && pv ? v / pv - 1 : null, na: v == null ? (a && a.na) || "not available" : null, tipExtra: "Both accounts: an upper bound (Meta cannot de-duplicate people across accounts)." });
  }
}
/* Impressions → Link clicks → LPV → ATC → Purchase: the rate between steps,
   the cost to reach each, and the step that moved most against us. */
const MV_STEPS = [["m_impr", "Impressions", "m_cpm"], ["m_link", "Link clicks", "m_cpc"], ["m_lpv", "Landing page views", "m_cplpv"], ["m_atc", "Add to cart", "m_cpatc"], ["m_purch", "Purchase", "m_cpp"]];
const MV_RATES = [["m_ctr", "fewer people click the ad"], ["m_lpv_rate", "people click but don't land"], ["m_atc_rate", "people land but don't add to cart"], ["m_purch_from_atc", "people add to cart but don't buy"]];
function mvFunnel(T, B, nc, np, label) {
  if (T.nf && T.nf === T.n) return `<p class="na">Link clicks, landing page views and add to carts appear as the Meta history is read again with them (a few weeks of days per refresh).</p>`;
  let worst = null;
  const rates = MV_RATES.map(([id, why]) => {
    const v = mvVal(id, T), p = B ? mvVal(id, B) : null, { ch, small } = B ? mvChange(id, T, B, nc, np) : { ch: null, small: false };
    if (ch != null && !small && ch < 0 && (!worst || ch < worst.ch)) worst = { id, ch, v, p, why };
    return { id, v, ch, small, worst: false };
  });
  if (worst) rates.find((r) => r.id === worst.id).worst = true;
  const cells = MV_STEPS.map(([id, l, cost], i) => {
    const v = mvVal(id, T), cv = mvVal(cost, T), cc = B ? mvChange(cost, T, B, nc, np) : { ch: null };
    const step = `<div class="mv-step"><div class="mv-sl">${esc(l)}</div><div class="mv-sv">${esc(mvF(id, v, true))}</div><div class="mv-sc">${esc(METRICS[cost].label)} <b>${esc(mvF(cost, cv, true))}</b> ${B ? deltaHtml(cc.ch, cost, cc.small) : ""}</div></div>`;
    const r = rates[i];
    return step + (r ? `<div class="mv-rate${r.worst ? " worst" : ""}"><span class="mv-arrow">→</span><b>${esc(mvF(r.id, r.v))}</b><small>${esc(METRICS[r.id].label)}</small>${B ? `<small>${deltaHtml(r.ch, r.id, r.small)}</small>` : ""}</div>` : "");
  }).join("");
  const line = worst ? `<p class="mv-worst"><b>Biggest change:</b> ${esc(METRICS[worst.id].label)} ${worst.ch < 0 ? "down" : "up"} ${esc(Math.abs((worst.v - worst.p) * 100).toFixed(1))} pts (${esc(mFormat("percent", worst.p))} → ${esc(mFormat("percent", worst.v))}), so ${esc(worst.why)}.</p>` : B ? '<p class="mv-worst sub">No step moved against us beyond the noise.</p>' : "";
  return `${label ? `<div class="mv-showing">Showing: <b>${esc(label)}</b> <button type="button" class="more-link" data-act="unsel">show all</button></div>` : ""}<div class="mv-funnel">${cells}</div>${line}`;
}
// ---------------------------------------------------------------- watchlist
function mvWatch(pr, ok) {
  const { P } = MV.ix, W = P.config.watchlist, V = P.config.validation, nc = pr.cur.length, np = pr.prev.length;
  const A = mvSum(pr.cur, ok, (a) => a), Bm = np ? mvSum(pr.prev, ok, (a) => a) : new Map();
  const stageAvg = {};
  for (const st of MV_STAGES) { const s = mvZero(); for (const [a, x] of A) if (MV.ix.ad[a].stage === st) for (const f of MV_F.concat(["nf", "n"])) s[f] += x[f]; stageAvg[st] = mvVal("m_roas", s); }
  const lastDays = pr.cur.slice(-W.no_purchase_days);
  const out = [];
  for (const [a, s] of A) {
    const b = Bm.get(a), ad = MV.ix.ad[a], name = P.ads[a][1];
    const push = (metric, val, ref, why) => out.push({ a, name, spend: s.spend, metric, val, ref, why });
    if (P.skus[ad.sku].kind === "other" && s.spend >= W.min_spend) push("SKU", "Other", "no product code", "The ad, ad set and campaign names carry no known product code: add it to config.json meta_view.sku_codes or fix the name.");
    if (s.link >= 20 && s.lpv > s.link * V.lpv_per_link_click) push("LPV", mFormat("count", s.lpv), `${mFormat("count", s.link)} link clicks`, "More landing page views than link clicks: check the tracking on this ad.");
    if (s.purch > 0 && s.spend === 0) push("Purchases", mFormat("count", s.purch), "with no spend", "Purchases attributed on days with no spend (conversions reported after delivery stopped).");
    if (s.spend < W.min_spend) continue;
    if (MV.scope === "perf") {
      const r = mvVal("m_roas", s), avg = stageAvg[ad.stage];
      if (r != null && avg && r < avg * 0.5) push("Platform ROAS", mFormat("ratio", r), `${ad.stage} average ${mFormat("ratio", avg)}`, `Spend of ${mCompactInr(s.spend)} at under half the ${ad.stage} average Platform ROAS in view.`);
      const fq = s.rd ? s.impr / s.rd : null;
      if (fq != null && fq > W.frequency_above) push("Frequency", mFormat("decimal", fq), `above ${W.frequency_above}`, "Impressions per person, from daily reach (a lower bound for the period): creative-fatigue risk.");
      if (b) {
        const cp = mvVal("m_cpp", s), pcp = mvVal("m_cpp", b);
        if (cp != null && pcp && cp / pcp - 1 > W.cpp_rise) push("Cost per purchase", mCompactInr(cp), `was ${mCompactInr(pcp)}`, `Cost per purchase up more than ${Math.round(W.cpp_rise * 100)}% against the comparison.`);
      }
      const recent = mvSum(lastDays, (x) => x === a);
      if (lastDays.length >= W.no_purchase_days && recent.spend >= W.min_spend / 2 && s.purch === 0) push("Purchases", "0", `${mCompactInr(s.spend)} spent`, `Spend of at least ${mCompactInr(W.min_spend)} and no purchase in the period, still spending in the last ${W.no_purchase_days} days.`);
    }
    if (b && b.spend >= W.min_spend) {
      const c = mvVal("m_ctr", s), pc = mvVal("m_ctr", b);
      if (c != null && pc && c / pc - 1 < -W.ctr_drop) push("CTR (link)", mFormat("percent", c), `was ${mFormat("percent", pc)}`, `CTR down more than ${Math.round(W.ctr_drop * 100)}% against the comparison.`);
    }
  }
  out.sort((x, y) => y.spend - x.spend);
  if (!out.length) return '<p class="sub">Nothing flagged in these days.</p>';
  return `<ul class="mv-watch">${out.slice(0, 6).map((w) => `<li><button type="button" class="mv-wbtn" data-open="ad:${esc(P.ads[w.a][0])}"><span class="mv-wn" title="${esc(w.name)}">${esc(mvMid(w.name, 54))}</span><span class="mv-wm">${esc(w.metric)} <b>${esc(w.val)}</b> <span class="sub">${esc(w.ref)}</span></span></button><span class="tip" tabindex="0" data-tip="Why flagged: ${esc(w.why)}">i</span></li>`).join("")}</ul>${out.length > 6 ? `<p class="sub">${out.length - 6} more flagged ads; the six with the most spend are shown.</p>` : ""}`;
}
// ---------------------------------------------------------------- SKU × Stage matrix
function mvMatrix(pr, ok) {
  const { P } = MV.ix, id = MV.mx, nc = pr.cur.length, np = pr.prev.length;
  const key = (a) => `${MV.ix.ad[a].sku}|${MV.ix.ad[a].stage}`;
  const C = mvSum(pr.cur, ok, key), B = np ? mvSum(pr.prev, ok, key) : new Map();
  const add = (into, s) => { for (const f of MV_F.concat(["nf", "n"])) into[f] += s[f]; return into; };
  const rowsBy = new Map(), colTot = {}, colTotB = {}, all = mvZero(), allB = mvZero();
  for (const [k, s] of C) { const [sk, st] = k.split("|"); const r = rowsBy.get(sk) || rowsBy.set(sk, { cells: {}, prev: {}, tot: mvZero(), totB: mvZero() }).get(sk); r.cells[st] = s; add(r.tot, s); add(colTot[st] || (colTot[st] = mvZero()), s); add(all, s); }
  for (const [k, s] of B) { const [sk, st] = k.split("|"); const r = rowsBy.get(sk) || rowsBy.set(sk, { cells: {}, prev: {}, tot: mvZero(), totB: mvZero() }).get(sk); r.prev[st] = s; add(r.totB, s); add(colTotB[st] || (colTotB[st] = mvZero()), s); add(allB, s); }
  const min = MV.min == null ? P.config.min_spend_default : MV.min, grey = P.config.grey_below_spend;
  const ORDER = { single: 0, set: 0, multi: 1, offer_creative: 2, sets: 3, catalog: 4, other: 5 };
  const list = [...rowsBy.entries()].map(([sk, r]) => ({ sk: +sk, ...r, sku: P.skus[+sk] })).filter((r) => r.tot.spend > 0 || r.totB.spend > 0)
    .sort((x, y) => (ORDER[x.sku.kind] - ORDER[y.sku.kind]) || (y.tot.spend - x.tot.spend));
  const shown = MV.more ? list : list.filter((r) => r.tot.spend >= min);
  const hidden = list.length - shown.length;
  const cell = (s, b, sku, st) => {
    if (!s || !s.spend) return `<td class="mx-empty">–</td>`;
    const v = mvVal(id, s), { ch, small } = b ? mvChange(id, s, b, nc, np) : { ch: null, small: false };
    const muted = s.spend < grey;
    return `<td class="${muted ? "mv-muted" : ""}"><button type="button" class="mx" data-xf="${esc(sku || "")},${esc(st || "")}" title="${muted ? "Spend under " + mCompactInr(grey) + ": too little to judge" : "Filter the explorer to this"}"><b>${esc(mvF(id, v, true))}</b>${id !== "m_spend" ? `<span class="sub">${esc(mCompactInr(s.spend))}</span>` : ""}${np ? `<span>${deltaHtml(ch, id, small || muted)}</span>` : ""}</button></td>`;
  };
  const head = `<tr><th class="text" scope="col">SKU</th>${MV_STAGES.map((s) => `<th scope="col"><button type="button" class="mv-hbtn" data-xf=",${s}">${s}</button></th>`).join("")}<th scope="col">All stages</th></tr>`;
  let body = "", lastKind = null;
  for (const r of shown) {
    if (r.sku.kind === "multi" && lastKind !== "multi") body += `<tr class="group"><td colspan="6">${esc(P.config.labels.MULTI)}</td></tr>`;
    lastKind = r.sku.kind;
    const label = r.sku.kind === "single" || r.sku.kind === "set" ? `<span class="code">${esc(r.sku.code)}</span> · ${esc(mvMid(r.sku.label, 26))}` : esc(r.sku.label);
    body += `<tr><td class="text"><button type="button" class="mv-hbtn" data-xf="${esc(r.sku.code)},">${label}</button></td>${MV_STAGES.map((st) => cell(r.cells[st], r.prev[st], r.sku.code, st)).join("")}${cell(r.tot, np ? r.totB : null, r.sku.code, "")}</tr>`;
  }
  if (hidden) body += `<tr class="recon-toggle"><td class="text" colspan="6"><button type="button" class="more-link" data-act="more">${MV.more ? "Hide" : "Show"} ${hidden} SKU${hidden === 1 ? "" : "s"} under ₹${inGroup.format(min)}</button></td></tr>`;
  body += `<tr class="total"><td class="text">All SKUs <span class="sub">(the stage view)</span></td>${MV_STAGES.map((st) => cell(colTot[st], np ? colTotB[st] : null, "", st)).join("")}${cell(all, np ? allB : null, "", "")}</tr>`;
  const sw = `<div class="seg" id="mv-mx" role="group" aria-label="Matrix metric">${MV_MATRIX[MV.scope].map((m) => `<button type="button" data-m="${m}" aria-pressed="${MV.mx === m}">${esc(METRICS[m].short || METRICS[m].label)}</button>`).join("")}</div>`;
  return { sw, html: `<div class="table-wrap"><table class="matrix mv-matrix"><thead>${head}</thead><tbody>${body}</tbody></table></div><p class="legend-note">Each cell: ${esc(METRICS[id].label)}${id !== "m_spend" ? ", spend" : ""} and the change against the comparison. Click a cell, SKU or stage to filter the explorer. Cells under ${esc(mCompactInr(grey))} of spend are grey.</p>` };
}
// ---------------------------------------------------------------- explorer
function mvKeyOf(lvl, a) {
  const A = MV.ix.ad[a];
  switch (lvl) { case "camp": return A.camp; case "set": return A.set; case "ad": return a; case "stage": return A.stage; case "sku": return A.sku; case "offer": return A.offer; default: return ""; }
}
function mvLabel(lvl, k) {
  const { P } = MV.ix;
  if (lvl === "camp") return P.campaigns[k][1];
  if (lvl === "set") return P.adsets[k][1];
  if (lvl === "ad") return P.ads[k][1];
  if (lvl === "sku") { const s = P.skus[k]; return s.kind === "single" || s.kind === "set" ? `${s.code} · ${s.label}` : s.label; }
  return String(k);
}
function mvTree(pr, ok) {
  const levels = MV_GROUPS[MV.g], nodes = new Map(), kids = new Map();
  const visit = (days, which) => {
    const { P, byDay } = MV.ix;
    for (const d of days) for (const i of byDay[d]) {
      const r = P.rows[i];
      if (!ok(r[1])) continue;
      let path = "";
      levels.forEach((lvl, depth) => {
        const parent = path; path += (depth ? "/" : "") + lvl + ":" + mvKeyOf(lvl, r[1]);
        let n = nodes.get(path);
        if (!n) { n = { key: path, lvl, k: mvKeyOf(lvl, r[1]), depth, a: mvZero(), b: mvZero(), ads: new Set() }; nodes.set(path, n); (kids.get(parent) || kids.set(parent, []).get(parent)).push(n); }
        mvAdd(n[which], r); n.ads.add(r[1]);
      });
    }
  };
  visit(pr.cur, "a"); if (pr.prev.length) visit(pr.prev, "b");
  return { nodes, kids, levels };
}
function mvColsNow() { return MV.cols === "custom" ? (MV.custom.length ? MV.custom : MV_COLS[MV.scope].eff) : MV_COLS[MV.scope][MV.cols] || MV_COLS[MV.scope].eff; }
const MV_OBJ = { camp: true, set: true, ad: true };
function mvStatusDot(lvl, k) {
  const { P } = MV.ix;
  const st = lvl === "camp" ? P.campaigns[k][4] : lvl === "set" ? P.adsets[k][3] : lvl === "ad" ? P.ads[k][3] : null;
  if (!MV_OBJ[lvl]) return "";
  const cls = !st ? "unk" : st === "ACTIVE" ? "on" : st === "WITH_ISSUES" ? "warn" : "off";
  return `<i class="mv-dot ${cls}" title="${esc(st ? st.replace(/_/g, " ").toLowerCase() : "status not read yet")}"></i>`;
}
function mvTags(n, levels) {
  const { P } = MV.ix, s = (f) => new Set([...n.ads].map((a) => f(MV.ix.ad[a])));
  const out = [];
  const add = (dim, set, lab) => { if (levels.includes(dim)) return; out.push(set.size === 1 ? lab([...set][0]) : `mixed ${dim}`); };
  add("stage", s((A) => A.stage), (x) => x);
  add("sku", s((A) => A.sku), (x) => P.skus[x].code);
  add("offer", s((A) => A.offer), (x) => x);
  return out.map((t) => `<span class="mv-tag">${esc(t)}</span>`).join("");
}
function mvValid(s) {
  const V = MV.ix.P.config.validation, out = [];
  if (!s.nf && s.link >= 20 && s.lpv > s.link * V.lpv_per_link_click) out.push("More landing page views than link clicks × " + V.lpv_per_link_click);
  if (!s.nf && s.lpv >= 20 && s.atc > s.lpv * V.atc_per_lpv) out.push("Add to carts above landing page views × " + V.atc_per_lpv + " (view-through attribution can do this)");
  if (s.purch > 0 && !s.spend) out.push("Purchases with no spend");
  return out;
}
function mvExplorer(pr, ok) {
  const T = mvTree(pr, ok), cols = mvColsNow(), nc = pr.cur.length, np = pr.prev.length, last = mvLast14(pr.cur);
  const prim = MV.scope === "aw" ? "m_spend" : "m_roas", min = MV.min == null ? MV.ix.P.config.min_spend_default : MV.min;
  const sortKey = (n) => (MV.sort.col && METRICS[MV.sort.col] ? mvVal(MV.sort.col, n.a) ?? -Infinity : n.a.spend);
  const sorted = (list) => [...list].sort((x, y) => (MV.sort.col === "name" ? mvLabel(x.lvl, x.k).localeCompare(mvLabel(y.lvl, y.k)) * MV.sort.dir : (sortKey(y) - sortKey(x)) * (MV.sort.col ? -MV.sort.dir : 1)));
  const reachCols = cols.some((c) => c === "m_reach" || c === "m_freq");
  const cellOf = (id, n) => {
    if (id === "m_reach" || id === "m_freq") return `<td data-rc="${esc(n.key)}" data-m="${id}"><span class="na">…</span></td>`;
    const v = mvVal(id, n.a), { ch, small } = np ? mvChange(id, n.a, n.b, nc, np) : { ch: null, small: false };
    const under = !np ? "" : MV.cmpv ? `<span class="sub">${esc(mvF(id, mvVal(id, n.b), true))}</span>` : deltaHtml(ch, id, small);
    return `<td><span class="mv-v">${esc(mvF(id, v, true))}</span>${under ? `<br><small>${under}</small>` : ""}</td>`;
  };
  const rows = [], reachQ = [];
  const emit = (n) => {
    if (n.a.spend < min && !(MV.sel === n.key)) return;
    const children = T.kids.get(n.key) || [], open = MV.exp.has(n.key), label = mvLabel(n.lvl, n.k), warn = mvValid(n.a);
    const name = `<span class="mv-ind" style="--d:${n.depth}"></span>${children.length ? `<button type="button" class="mv-chev" data-tog="${esc(n.key)}" aria-label="${open ? "Collapse" : "Expand"}">${open ? "▾" : "▸"}</button>` : '<span class="mv-chev"></span>'}${mvStatusDot(n.lvl, n.k)}<span class="mv-name" title="${esc(label)}">${esc(mvMid(label, 40 - n.depth * 3))}</span>${warn.length ? ` <span class="mv-warn" title="${esc(warn.join("; "))}">⚠</span>` : ""}<span class="mv-lvl">${MV_LVL_NAME[n.lvl]}</span>`;
    rows.push(`<tr class="mv-row${MV.sel === n.key ? " sel" : ""}${MV.dr && MV_OBJ[n.lvl] && mvDrKey(n.lvl, n.k) === `${MV.dr.lvl}:${MV.dr.id}` ? " open-dr" : ""}" data-k="${esc(n.key)}" data-lvl="${n.lvl}" data-id="${esc(String(n.k))}" tabindex="0">
      <td class="text mv-ncell">${name}<div class="mv-tags">${mvTags(n, T.levels.slice(0, n.depth + 1))}</div></td>${cols.map((c) => cellOf(c, n)).join("")}<td class="mv-tr">${mvSpark(mvSeries(prim, last, (a) => n.ads.has(a)))}</td></tr>`);
    if (reachCols && reachQ.length < 40) reachQ.push(n);
    if (open) for (const c of sorted(children)) emit(c);
  };
  for (const n of sorted(T.kids.get("") || [])) emit(n);
  const tot = mvZero(); for (const n of T.kids.get("") || []) for (const f of MV_F.concat(["nf", "n"])) tot[f] += n.a[f];
  const totB = mvZero(); for (const n of T.kids.get("") || []) for (const f of MV_F.concat(["nf", "n"])) totB[f] += n.b[f];
  const totNode = { key: "_total", a: tot, b: totB, ads: new Set([].concat(...(T.kids.get("") || []).map((n) => [...n.ads]))) };
  const sortBtn = (c, l) => `<button type="button" class="mv-sort" data-sort="${c}">${l}${MV.sort.col === c ? (MV.sort.dir < 0 ? " ▼" : " ▲") : ""}</button>`;
  const head = `<tr><th class="text" scope="col">${sortBtn("name", MV_GROUP_NAMES.find((x) => x[0] === MV.g)[1])}</th>${cols.map((c) => `<th scope="col">${sortBtn(c, esc(METRICS[c].short || METRICS[c].label))} ${mTip(c)}</th>`).join("")}<th scope="col">Trend <span class="sub">${esc(METRICS[prim].label)}, 14 days</span></th></tr>`;
  const total = `<tr class="total mv-total"><td class="text">Total <span class="sub">(${rows.length ? "filters in view" : "nothing above the minimum"})</span></td>${cols.map((c) => cellOf(c, totNode)).join("")}<td class="mv-tr">${mvSpark(mvSeries(prim, last, (a) => totNode.ads.has(a)))}</td></tr>`;
  if (reachCols) reachQ.push(totNode);
  return { html: `<div class="table-wrap mv-xwrap"><table class="mv-x"><thead>${head}</thead><tbody>${rows.join("") || `<tr><td class="text na" colspan="${cols.length + 2}">No ads above the minimum spend with these filters.</td></tr>`}${total}</tbody></table></div>`, reachQ, T };
}
async function mvFillReach(reachQ, pr) {
  for (const n of reachQ) {
    const r = await mvReach([...n.ads], pr.cur);
    for (const td of document.querySelectorAll(`#mv-x td[data-rc="${CSS.escape(n.key)}"]`)) {
      const v = !r || r.reach == null ? null : td.dataset.m === "m_reach" ? r.reach : r.frequency;
      td.innerHTML = v == null ? `<span class="na" title="${esc((r && r.na) || "")}">n/a</span>` : `<span class="mv-v">${esc(mVal(td.dataset.m, v, true))}</span>`;
    }
  }
}
// ---------------------------------------------------------------- drawer
const mvDrKey = (lvl, k) => { const { P } = MV.ix; return `${lvl}:${lvl === "camp" ? P.campaigns[k][0] : lvl === "set" ? P.adsets[k][0] : P.ads[k][0]}`; };
function mvFind(lvl, id) {
  const { P } = MV.ix;
  const arr = lvl === "camp" ? P.campaigns : lvl === "set" ? P.adsets : P.ads;
  const k = arr.findIndex((x) => String(x[0]) === String(id));
  return k < 0 ? null : k;
}
function mvAdsOf(lvl, k) {
  const out = [];
  MV.ix.ad.forEach((A, a) => { if ((lvl === "camp" && A.camp === k) || (lvl === "set" && A.set === k) || (lvl === "ad" && a === k)) out.push(a); });
  return out;
}
function mvDrawer(pr) {
  let el = document.getElementById("mv-drawer");
  if (!MV.dr) { if (el) el.remove(); document.body.classList.remove("mv-dr-open"); return; }
  const { P } = MV.ix, lvl = MV.dr.lvl, k = mvFind(lvl, MV.dr.id);
  if (k == null) { MV.dr = null; mvToUrl(); if (el) el.remove(); return; }
  if (!el) { el = document.createElement("aside"); el.id = "mv-drawer"; el.className = "mv-drawer"; el.setAttribute("role", "dialog"); document.body.appendChild(el); }
  document.body.classList.add("mv-dr-open");
  const ads = mvAdsOf(lvl, k), set = new Set(ads), ok = (a) => set.has(a);
  const camp = lvl === "camp" ? k : lvl === "set" ? P.adsets[k][2] : P.adsets[P.ads[k][2]][2], aset = lvl === "set" ? k : lvl === "ad" ? P.ads[k][2] : null;
  const C = P.campaigns[camp], acct = P.accounts[C[2]];
  const crumb = [`<button type="button" data-dr="camp:${esc(C[0])}">${esc(mvMid(C[1], 40))}</button>`, aset != null ? `<button type="button" data-dr="set:${esc(P.adsets[aset][0])}">${esc(mvMid(P.adsets[aset][1], 40))}</button>` : null, lvl === "ad" ? `<span>${esc(mvMid(P.ads[k][1], 48))}</span>` : null].filter(Boolean).join(" › ");
  const obj = lvl === "camp" ? C : lvl === "set" ? P.adsets[k] : P.ads[k];
  const status = lvl === "camp" ? C[4] : lvl === "set" ? obj[3] : obj[3];
  const budgetOf = (o, i) => (o[i] ? `₹${inGroup.format(o[i])} a day` : o[i + 1] ? `₹${inGroup.format(o[i + 1])} lifetime` : null);
  const budget = budgetOf(C, 6) ? `${budgetOf(C, 6)} (campaign)` : aset != null && budgetOf(P.adsets[aset], 4) ? `${budgetOf(P.adsets[aset], 4)} (ad set)` : "not read yet";
  const A1 = MV.ix.ad[ads[0]], tags = [acct.name, ...new Set(ads.map((a) => MV.ix.ad[a].stage)), ...new Set(ads.map((a) => P.skus[MV.ix.ad[a].sku].code)), ...new Set(ads.map((a) => MV.ix.ad[a].offer))];
  const actNum = acct.id.replace(/^act_/, ""), noun = { camp: "campaign", set: "adset", ad: "ad" }[lvl];
  const amUrl = `https://adsmanager.facebook.com/adsmanager/manage/${noun === "adset" ? "adsets" : noun + "s"}?act=${actNum}&selected_${noun}_ids=${encodeURIComponent(MV.dr.id)}`;
  const T = mvSum(pr.cur, ok), B = pr.prev.length ? mvSum(pr.prev, ok) : null;
  const kp = MV_KPI[MV.scope].map((id) => {
    if (id === "m_reach" || id === "m_freq") return `<div class="kpi-slot" data-dreach="${id}">${kpiCard(id, { loading: true })}</div>`;
    const { ch, small } = B ? mvChange(id, T, B, pr.cur.length, pr.prev.length) : {};
    return kpiCard(id, { value: mvVal(id, T), prev: B ? mvVal(id, B) : null, change: ch, small, na: mvNaFunnel(id, T) || "no base" });
  }).join("");
  // trend chart controls
  const msel = (i) => `<select data-dm="${i}" aria-label="Metric ${i + 1}">${i ? '<option value="">— none —</option>' : ""}${Object.keys(METRICS).filter((x) => METRICS[x].mv).map((x) => `<option value="${x}" ${MV.dm[i] === x ? "selected" : ""}>${esc(METRICS[x].label)}</option>`).join("")}</select>`;
  const rng = `<div class="seg" data-drg role="group">${[["picked", "Picked dates"], ["14", "14d"], ["30", "30d"], ["90", "90d"], ["launch", "Since launch"]].map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${MV.drange === v}">${l}</button>`).join("")}</div>`;
  const gran = `<div class="seg" data-dg role="group"><button type="button" data-v="d" aria-pressed="${MV.dg === "d"}">Daily</button><button type="button" data-v="w" aria-pressed="${MV.dg === "w"}">Weekly</button></div>`;
  // extras
  let extra = "";
  if (lvl === "ad") {
    const sib = mvAdsOf("set", aset).filter((a) => mvSum(pr.cur, (x) => x === a).spend > 0);
    const rows = sib.map((a) => { const s = mvSum(pr.cur, (x) => x === a); return { a, name: P.ads[a][1], spend: s.spend, roas: mvVal("m_roas", s), cpp: mvVal("m_cpp", s) }; });
    const rank = (f, dir) => { const s = [...rows].filter((r) => r[f] != null).sort((x, y) => (y[f] - x[f]) * dir); return new Map(s.map((r, i) => [r.a, i + 1])); };
    const rR = rank("roas", 1), rC = rank("cpp", -1);
    extra = `<h3>Funnel</h3>${mvFunnel(T, B, pr.cur.length, pr.prev.length, "")}
      <h3>Against the other ads in this ad set</h3>${table([{ label: "Ad", text: true, render: (r) => `<span title="${esc(r.name)}">${r.a === k ? "<b>" : ""}${esc(mvMid(r.name, 38))}${r.a === k ? "</b>" : ""}</span>` }, { label: "Spend", render: (r) => esc(mCompactInr(r.spend)) }, { label: "Platform ROAS", render: (r) => `${esc(mvF("m_roas", r.roas))} <span class="sub">#${rR.get(r.a) ?? "–"}</span>` }, { label: "Cost per purchase", render: (r) => `${esc(mvF("m_cpp", r.cpp, true))} <span class="sub">#${rC.get(r.a) ?? "–"}</span>` }], rows.sort((x, y) => y.spend - x.spend), { full: true })}`;
  } else {
    const childLvl = lvl === "camp" ? "set" : "ad";
    const ch = new Map(); for (const a of ads) { const kk = mvKeyOf(childLvl, a); (ch.get(kk) || ch.set(kk, []).get(kk)).push(a); }
    const rows = [...ch.entries()].map(([kk, list]) => { const s2 = new Set(list), s = mvSum(pr.cur, (x) => s2.has(x)); return { kk, name: mvLabel(childLvl, kk), s }; }).filter((r) => r.s.spend > 0).sort((x, y) => y.s.spend - x.s.spend);
    extra = `<h3>${childLvl === "set" ? "Ad sets" : "Ads"} in this ${lvl === "camp" ? "campaign" : "ad set"}</h3>${table([
      { label: childLvl === "set" ? "Ad set" : "Ad", text: true, render: (r) => `<button type="button" class="more-link" data-dr="${childLvl}:${esc(childLvl === "set" ? P.adsets[r.kk][0] : P.ads[r.kk][0])}" title="${esc(r.name)}">${esc(mvMid(r.name, 38))}</button>` },
      { label: "Spend", render: (r) => esc(mCompactInr(r.s.spend)) },
      { label: "Share of spend", render: (r) => esc(mFormat("percent", T.spend ? r.s.spend / T.spend : null) ?? "–") },
      { label: "Share of purchases", render: (r) => { const sp = T.spend ? r.s.spend / T.spend : 0, pp = T.purch ? r.s.purch / T.purch : null; return `<span class="${pp != null && pp < sp * 0.5 && sp > 0.1 ? "down" : ""}">${esc(mFormat("percent", pp) ?? "–")}</span>`; } },
      { label: "Platform ROAS", render: (r) => esc(mvF("m_roas", mvVal("m_roas", r.s))) },
    ], rows, { full: true })}<p class="legend-note">A child taking a much bigger share of spend than of purchases is shown in red.</p>`;
  }
  el.innerHTML = `<div class="mv-dhead"><div class="mv-crumb">${crumb}</div><button type="button" class="ask-iconbtn x" data-act="close-dr" aria-label="Close">×</button></div>
    <div class="mv-dmeta"><span class="mv-dot ${status === "ACTIVE" ? "on" : status ? "off" : "unk"}"></span>${esc(status ? status.replace(/_/g, " ").toLowerCase() : "status not read yet")} · budget ${esc(budget)} ${[...new Set(tags)].map((t) => `<span class="mv-tag">${esc(t)}</span>`).join("")} <a href="${amUrl}" target="_blank" rel="noopener" class="sec-link">Open in Ads Manager ↗</a></div>
    <div class="kpis six mv-dkpis">${kp}</div>
    <div class="mv-dctl">${msel(0)}${msel(1)}${gran}${rng}</div>
    <div class="chart-box mv-dchart"><canvas id="c-mv-dr" aria-label="Trend"></canvas></div>
    <p class="legend-note" id="mv-dleg"></p>
    ${extra}`;
  mvDrawChart(lvl, k, ads, pr);
  mvDrawerReach(ads, pr);
}
async function mvDrawerReach(ads, pr) {
  const prevAds = pr.prev.length ? ads : [];
  const [a, b] = await Promise.all([mvReach(ads, pr.cur), prevAds.length ? mvReach(prevAds, pr.prev) : null]);
  for (const el of document.querySelectorAll("#mv-drawer [data-dreach]")) {
    const id = el.dataset.dreach, f = (x) => (!x || x.reach == null ? null : id === "m_reach" ? x.reach : x.frequency), v = f(a), pv = f(b);
    el.outerHTML = kpiCard(id, { value: v, prev: pr.prev.length ? pv : null, change: v != null && pv ? v / pv - 1 : null, na: v == null ? (a && a.na) || "not available" : null });
  }
}
let mvChart = null;
function mvDrawChart(lvl, k, ads, pr) {
  const el = document.getElementById("c-mv-dr");
  if (!el) return;
  if (!window.Chart) { el.parentElement.innerHTML = '<p class="na">Charts could not load.</p>'; return; }
  const { P } = MV.ix, set = new Set(ads), ok = (a) => set.has(a);
  // the days: picked, the last N up to the period's end, or since launch
  const end = Math.max(...pr.cur);
  let days;
  if (MV.drange === "picked") days = pr.cur;
  else if (MV.drange === "launch") {
    const created = (lvl === "camp" ? P.campaigns[k][8] : lvl === "set" ? P.adsets[k][6] : P.ads[k][4]) || null;
    const first = created && MV.ix.di.has(created) ? MV.ix.di.get(created) : ads.reduce((m, a) => Math.min(m, ...MV.ix.byDay.map((rows, d) => (rows.some((i) => P.rows[i][1] === a) ? d : Infinity))), Infinity);
    days = Array.from({ length: end - (isFinite(first) ? first : 0) + 1 }, (_, i) => (isFinite(first) ? first : 0) + i);
  } else { const n = +MV.drange; days = Array.from({ length: n }, (_, i) => end - n + 1 + i).filter((d) => d >= 0); }
  const cmpDays = MV.drange === "picked" ? pr.prev : days.map((d) => d - days.length).filter((d) => d >= 0);
  const bucket = (list) => {
    if (MV.dg === "d") return list.map((d) => ({ lab: dayLabel(P.dates[d]), days: [d], sale: RG.eng.phaseOf(P.dates[d]) === "sale" }));
    const out = new Map();
    for (const d of list) { const dt = new Date(P.dates[d] + "T00:00:00Z"), mon = new Date(dt - ((dt.getUTCDay() + 6) % 7) * 864e5).toISOString().slice(0, 10); const b = out.get(mon) || out.set(mon, { lab: "w/c " + dayLabel(mon), days: [], sale: false }).get(mon); b.days.push(d); if (RG.eng.phaseOf(P.dates[d]) === "sale") b.sale = true; }
    return [...out.values()];
  };
  const B1 = bucket(days), B2 = bucket(cmpDays);
  const [m1, m2] = MV.dm;
  const series = (id, bs) => bs.map((b) => mvVal(id, mvSum(b.days, ok)));
  // the parent's value over the same days, as a reference line
  const parentOk = lvl === "ad" ? ((s) => (a) => MV.ix.ad[a].set === s)(MV.ix.ad[k].set) : lvl === "set" ? ((c) => (a) => MV.ix.ad[a].camp === c)(P.adsets[k][2]) : (a) => mvAdOk(a);
  const parentName = lvl === "ad" ? "ad set" : lvl === "set" ? "campaign" : "all ads in view";
  const pv = mvVal(m1, mvSum(days, parentOk));
  const unitOf = (id) => ({ currency: "inr", currency2: "inr", count: "int", percent: "pct", ratio: "x", decimal: "x" }[METRICS[id].format] || "int");
  const ds = [{ label: METRICS[m1].label, data: series(m1, B1), borderColor: css("--accent"), backgroundColor: css("--accent"), borderWidth: 2.5, pointRadius: 0, tension: 0.25, yAxisID: "y" }];
  if (B2.length) ds.push({ label: METRICS[m1].label + " (comparison)", data: series(m1, B2).slice(0, B1.length), borderColor: css("--accent"), borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0, tension: 0.25, yAxisID: "y" });
  if (pv != null) ds.push({ label: `${parentName} (${mvF(m1, pv, true)})`, data: B1.map(() => pv), borderColor: css("--muted"), borderDash: [2, 3], borderWidth: 1, pointRadius: 0, yAxisID: "y" });
  if (m2) ds.push({ label: METRICS[m2].label, data: series(m2, B1), borderColor: css("--series-1"), backgroundColor: css("--series-1"), borderWidth: 2, pointRadius: 0, tension: 0.25, yAxisID: "y2" });
  const sale = B1.map((b) => b.sale);
  const shade = { id: "saleShade", beforeDatasetsDraw(ch) { const { ctx: c, chartArea: a, scales: { x } } = ch; c.save(); c.fillStyle = css("--warn-bg"); sale.forEach((s, i) => { if (!s) return; const w = (a.right - a.left) / Math.max(1, sale.length); c.fillRect(x.getPixelForValue(i) - w / 2, a.top, w, a.bottom - a.top); }); c.restore(); } };
  if (mvChart) { try { mvChart.destroy(); } catch (e) { /* gone */ } }
  const y = axisOpts(unitOf(m1)), y2 = { ...axisOpts(m2 ? unitOf(m2) : "int"), position: "right", grid: { display: false } };
  mvChart = new Chart(el, { type: "line", data: { labels: B1.map((b) => b.lab), datasets: ds }, plugins: [shade],
    options: { responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: "index", intersect: false },
      plugins: { legend: { display: true, position: "bottom", labels: { boxWidth: 10, font: { size: 11 }, color: css("--ink-2") } },
        tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${mvF(c.dataset.yAxisID === "y2" ? m2 : m1, c.parsed.y, true)}` } } },
      scales: { x: { ticks: { color: css("--muted"), maxRotation: 0, autoSkipPadding: 12, font: { size: 11 } }, grid: { display: false } }, y, ...(m2 ? { y2 } : {}) } } });
  const leg = document.getElementById("mv-dleg");
  if (leg) leg.textContent = `${MV.dg === "d" ? "Daily" : "Weekly"} · shaded: sale days · dashed: the comparison period, lined up day by day · dotted: the ${parentName} over the same days.`;
}

// ---------------------------------------------------------------- the tab
function mvDraw() {
  const host = document.getElementById("mv-body");
  if (!host) return;
  const P = state.pages.meta_ads;
  if (!P || !P.rows) { host.innerHTML = '<section class="card"><p class="na">Data unavailable: the Meta view is built with the next refresh.</p></section>'; return; }
  mvIndex(P);
  const pr = mvPeriod();
  if (!pr || !pr.cur.length) { host.innerHTML = mvFilterBar(P) + `<section class="card"><p class="na">Data unavailable: Meta ad-level data covers ${esc(rgSpan(P.dates[0], P.dates[P.dates.length - 1]))}; pick dates inside it.</p></section>`; mvBind(); return; }
  const ok = mvAdOk, okx = (a) => mvAdOk(a) && mvXOk(a);
  const T = mvSum(pr.cur, ok), B = pr.prev.length ? mvSum(pr.prev, ok) : null;
  // the funnel follows the cross-filters and the selected row
  let fT = mvSum(pr.cur, okx), fB = pr.prev.length ? mvSum(pr.prev, okx) : null, fLabel = MV.xf.sku || MV.xf.stage ? [MV.xf.sku, MV.xf.stage].filter(Boolean).join(" · ") : "";
  const X = mvExplorer(pr, okx);
  if (MV.sel && X.T.nodes.get(MV.sel)) { const n = X.T.nodes.get(MV.sel); fT = n.a; fB = pr.prev.length ? n.b : null; fLabel = MV.sel.split("/").map((p) => { const [l, k] = [p.slice(0, p.indexOf(":")), p.slice(p.indexOf(":") + 1)]; return l === "sku" ? P.skus[+k].code : l === "camp" || l === "set" || l === "ad" ? mvMid(mvLabel(l, +k), 30) : k; }).join(" · "); }
  const M = mvMatrix(pr, ok);
  const chips = [MV.xf.sku ? `<button type="button" class="chip" data-xclear="sku">SKU: ${esc(MV.xf.sku)} ✕</button>` : "", MV.xf.stage ? `<button type="button" class="chip" data-xclear="stage">Stage: ${esc(MV.xf.stage)} ✕</button>` : ""].join("");
  const presets = `<div class="seg" id="mv-cols" role="group" aria-label="Columns">${MV_PRESET_NAMES.map(([k, l]) => `<button type="button" data-v="${k}" aria-pressed="${MV.cols === k}">${l}</button>`).join("")}</div>`;
  const groupSel = `<select id="mv-g" aria-label="Group by">${MV_GROUP_NAMES.map(([k, l]) => `<option value="${k}" ${MV.g === k ? "selected" : ""}>${l}</option>`).join("")}</select>`;
  const custom = MV.cols === "custom" ? `<details class="mv-picker"><summary>Pick columns (${(MV.custom.length || 0)}/8)</summary><div>${Object.keys(METRICS).filter((x) => METRICS[x].mv || x === "m_reach" || x === "m_freq").map((x) => `<label><input type="checkbox" data-cc="${x}" ${MV.custom.includes(x) ? "checked" : ""}> ${esc(METRICS[x].label)}</label>`).join("")}</div></details>` : "";
  const missing = pr.missing.length ? `<p class="legend-note">Meta ad-level data is not available for ${esc(rgListDays(pr.missing))}; those days are left out.</p>` : "";
  host.innerHTML = mvFilterBar(P) + `
    <section class="card" data-component="meta-kpis">${mvKpis(T, B, pr, ok)}${missing}</section>
    ${MV.scope === "perf" ? rgSec("Funnel efficiency", "impressions to purchase: the rate between steps, and the cost to reach each", mvFunnel(fT, fB, pr.cur.length, pr.prev.length, fLabel), { comp: "meta-funnel" }) : ""}
    <div class="cols-2 mv-top">
      ${rgSec("SKU × Stage", "each product at each funnel stage; the bottom row is the stage view", M.html, { ctl: M.sw, comp: "meta-matrix" })}
      ${rgSec("Watchlist", "rule-based flags, the six with the most spend", mvWatch(pr, ok), { comp: "meta-watchlist" })}
    </div>
    <section class="card" id="mv-explorer" data-component="meta-explorer"><div class="sec-head"><h2>Explorer</h2><span class="q">drill down; click a row for its detail</span><span class="ctl">${groupSel}${presets}<label class="mv-cv"><input type="checkbox" id="mv-cv" ${MV.cmpv ? "checked" : ""}> Show comparison values</label></span></div>
      ${chips ? `<div class="filter-row">${chips}</div>` : ""}${custom}<div id="mv-x">${X.html}</div></section>
    <p class="legend-note mv-foot">${esc(P.attribution_note)}. Ratios are worked out from summed numbers at every level, never averaged.</p>`;
  mvBind();
  mvKpiReach(pr, ok);
  if (X.reachQ.length) mvFillReach(X.reachQ, pr);
  mvDrawer(pr);
}
function mvRedraw() { mvToUrl(); destroyCharts(); mvDraw(); }
function mvBind() {
  const host = document.getElementById("mv-body");
  if (!host || host.dataset.bound) return;
  host.dataset.bound = "1";
  host.addEventListener("click", (ev) => {
    const t = ev.target;
    const f = t.closest(".seg[data-f] button[data-v]");
    if (f) { const k = f.closest(".seg").dataset.f; MV[k] = f.dataset.v; if (k === "scope") { MV.mx = MV.scope === "aw" ? "m_spend" : "m_roas"; MV.dm = MV.scope === "aw" ? ["m_spend", "m_cpm"] : ["m_roas", "m_spend"]; MV.sel = null; MV.dr = null; } return mvRedraw(); }
    const mx = t.closest("#mv-mx button[data-m]"); if (mx) { MV.mx = mx.dataset.m; return mvRedraw(); }
    const xf = t.closest("[data-xf]"); if (xf) { const [sku, st] = xf.dataset.xf.split(","); MV.xf = { sku: sku || null, stage: st || null }; MV.sel = null; mvRedraw(); document.getElementById("mv-explorer")?.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
    const xc = t.closest("[data-xclear]"); if (xc) { MV.xf[xc.dataset.xclear] = null; return mvRedraw(); }
    const pc = t.closest("#mv-cols button[data-v]"); if (pc) { MV.cols = pc.dataset.v; return mvRedraw(); }
    const so = t.closest("[data-sort]"); if (so) { const c = so.dataset.sort; MV.sort = MV.sort.col === c ? { col: c, dir: -MV.sort.dir } : { col: c, dir: -1 }; return mvRedraw(); }
    const tg = t.closest("[data-tog]"); if (tg) { const k = tg.dataset.tog; if (MV.exp.has(k)) MV.exp.delete(k); else MV.exp.add(k); return mvRedraw(); }
    if (t.closest('[data-act="more"]')) { MV.more = !MV.more; return mvRedraw(); }
    if (t.closest('[data-act="unsel"]')) { MV.sel = null; return mvRedraw(); }
    const op = t.closest("[data-open]"); if (op) { const [l, id] = op.dataset.open.split(":"); MV.dr = { lvl: l, id }; return mvRedraw(); }
    const row = t.closest("tr.mv-row");
    if (row && !t.closest("a,button,input,select")) return mvRowAct(row);
  });
  host.addEventListener("change", (ev) => {
    const t = ev.target;
    if (t.id === "mv-g") { MV.g = t.value; MV.exp = new Set(); MV.sel = null; return mvRedraw(); }
    if (t.id === "mv-cv") { MV.cmpv = t.checked; return mvRedraw(); }
    if (t.id === "mv-min") { MV.min = Math.max(0, +t.value || 0); return mvRedraw(); }
    if (t.dataset.cc) { const x = t.dataset.cc; MV.custom = t.checked ? [...new Set([...MV.custom, x])].slice(0, 8) : MV.custom.filter((y) => y !== x); return mvRedraw(); }
  });
  let qt = null;
  host.addEventListener("input", (ev) => { if (ev.target.id === "mv-q") { clearTimeout(qt); qt = setTimeout(() => { MV.q = ev.target.value.trim(); mvRedraw(); const q = document.getElementById("mv-q"); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }, 300); } });
  // keyboard: arrows move, Enter expands, Space opens the drawer
  host.addEventListener("keydown", (ev) => {
    const row = ev.target.closest && ev.target.closest("tr.mv-row");
    if (!row) return;
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") { ev.preventDefault(); const sib = ev.key === "ArrowDown" ? row.nextElementSibling : row.previousElementSibling; if (sib && sib.matches("tr.mv-row")) sib.focus(); }
    else if (ev.key === "Enter") { ev.preventDefault(); const k = row.dataset.k; if (MV.exp.has(k)) MV.exp.delete(k); else MV.exp.add(k); mvRedraw(); document.querySelector(`tr.mv-row[data-k="${CSS.escape(k)}"]`)?.focus(); }
    else if (ev.key === " ") { ev.preventDefault(); mvRowAct(row); }
  });
}
// a row: Meta objects open the drawer; stage / SKU / offer rows drive the funnel strip
function mvRowAct(row) {
  const lvl = row.dataset.lvl;
  if (MV_OBJ[lvl]) { const [l, id] = mvDrKey(lvl, +row.dataset.id).split(":"); MV.dr = { lvl: l, id }; }
  else MV.sel = MV.sel === row.dataset.k ? null : row.dataset.k;
  mvRedraw();
}
// the drawer lives outside the tab body
document.addEventListener("click", (ev) => {
  const d = ev.target.closest && ev.target.closest("#mv-drawer");
  if (!d) return;
  const c = ev.target.closest("[data-act='close-dr']"); if (c) { MV.dr = null; return mvRedraw(); }
  const j = ev.target.closest("[data-dr]"); if (j) { const [l, id] = j.dataset.dr.split(":"); MV.dr = { lvl: l, id }; return mvRedraw(); }
  const r = ev.target.closest("[data-drg] button[data-v]"); if (r) { MV.drange = r.dataset.v; return mvRedraw(); }
  const g = ev.target.closest("[data-dg] button[data-v]"); if (g) { MV.dg = g.dataset.v; return mvRedraw(); }
});
document.addEventListener("change", (ev) => {
  const s = ev.target.closest && ev.target.closest("#mv-drawer select[data-dm]");
  if (!s) return;
  const i = +s.dataset.dm; MV.dm[i] = s.value; MV.dm = MV.dm.filter(Boolean).slice(0, 2); if (!MV.dm.length) MV.dm = ["m_spend"];
  mvRedraw();
});
document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && MV.dr && document.getElementById("mv-drawer")) { MV.dr = null; mvRedraw(); } });
/* Entry point from Marketing › Meta. */
async function mvRender(host) {
  mvFromUrl();
  host.innerHTML = '<div id="mv-body"><p class="empty">Loading the Meta view…</p></div>';
  try { await loadPage("meta_ads"); } catch (e) { document.getElementById("mv-body").innerHTML = `<section class="card"><p class="na">Data unavailable: ${esc(e.message)}</p></section>`; return; }
  if (state.tab !== "marketing") return;
  mvDraw();
}

/* Data health › Meta classification: every ad's tags cover all of the spend;
   what is Not tagged or Other is listed so the names can be fixed; the
   validation rules; and the tie-out to the Meta spend every tab uses. */
function mvHealth(P, D) {
  if (!P || !P.rows || !P.rows.length) return '<p class="na">Data unavailable: the Meta view is built with the next refresh.</p>';
  const ix = mvIndex(P), last = P.dates.length - 1, days = Array.from({ length: Math.min(30, P.dates.length) }, (_, i) => last - i);
  const per = mvSum(days, () => true, (a) => a), tot = [...per.values()].reduce((t, s) => t + s.spend, 0);
  const share = (f) => { const m = new Map(); for (const [a, s] of per) { const k = f(a); m.set(k, (m.get(k) || 0) + s.spend); } return m; };
  const pc = (v) => mFormat("percent", tot ? v / tot : null);
  const off = share((a) => ix.ad[a].offer), sku = share((a) => P.skus[ix.ad[a].sku].kind), sc = share((a) => ix.ad[a].scope);
  const cover = `<p>Over the last ${days.length} days every ad carries a stage, a SKU bucket and an offer tag: <b>100%</b> of spend is assigned. Offer: ${["Offer", "Non-offer", "Not tagged"].map((k) => `${k} <b>${pc(off.get(k) || 0)}</b>`).join(" · ")}. SKU: named product or set <b>${pc((sku.get("single") || 0) + (sku.get("set") || 0))}</b>, multi-SKU <b>${pc(sku.get("multi") || 0)}</b>, offer creative <b>${pc(sku.get("offer_creative") || 0)}</b>, catalog <b>${pc(sku.get("catalog") || 0)}</b>, sets not named <b>${pc(sku.get("sets") || 0)}</b>, Other <b>${pc(sku.get("other") || 0)}</b>. Scope: ${["Performance", "Awareness", "Excluded"].map((k) => `${k === "Excluded" ? "Reach & Amazon" : k} <b>${pc(sc.get(k) || 0)}</b>`).join(" · ")}.</p>`;
  const list = (pred, why) => { const rows = [...per.entries()].filter(([a, s]) => s.spend > 0 && pred(a)).sort((x, y) => y[1].spend - x[1].spend).slice(0, 25); return rows.length ? table([{ label: "Ad", text: true, render: (r) => `<span title="${esc(r.name)}">${esc(mvMid(r.name, 60))}</span><br><span class="sub">${esc(mvMid(r.camp, 60))}</span>` }, { label: "Spend", render: (r) => esc(mCompactInr(r.spend)) }], rows.map(([a, s]) => ({ name: P.ads[a][1], camp: P.campaigns[ix.ad[a].camp][1], spend: s.spend })), { full: true }) + `<p class="legend-note">${esc(why)}</p>` : '<p class="sub">None.</p>'; };
  const V = P.config.validation; let lpv = 0, atc = 0, zero = 0;
  for (const s of per.values()) { if (!s.nf && s.link >= 20 && s.lpv > s.link * V.lpv_per_link_click) lpv++; if (!s.nf && s.lpv >= 20 && s.atc > s.lpv * V.atc_per_lpv) atc++; if (s.purch > 0 && !s.spend) zero++; }
  const valid = `<ul class="notes"><li>Landing page views above link clicks × ${V.lpv_per_link_click}: <b>${lpv}</b> ad${lpv === 1 ? "" : "s"} (a warning on the row).</li><li>Add to carts above landing page views × ${V.atc_per_lpv}: <b>${atc}</b> (a warning only: view-through attribution and multi-item baskets can do this).</li><li>Purchases with no spend: <b>${zero}</b> (conversions reported after delivery stopped).</li></ul>`;
  // tie-out: Meta spend in this view against the Meta spend the other tabs use, day by day
  let tie = "";
  if (D && D.dates) {
    const fi = D.fields.indexOf("meta_spend"), di = new Map(D.dates.map((d, i) => [d, i]));
    let worst = 0, n = 0;
    for (const d of days) { const ours = mvSum([d], () => true).spend, i = di.get(P.dates[d]); const theirs = i == null || fi < 0 ? null : D.values.meta_spend ? D.values.meta_spend[i] : null; if (theirs == null) continue; n++; worst = Math.max(worst, Math.abs(ours - theirs)); }
    tie = `<div class="ck"><span class="spill ${worst < 1 ? "ok" : "late"}"><i></i>${worst < 1 ? "Meta spend ties to the dashboard" : "Meta spend differs from the dashboard"}</span><span class="why">${n} days compared; largest daily difference ${esc(mFormat("currency", worst))}.</span></div>`;
  }
  const nt = [...per.entries()].filter(([a, s]) => s.spend > 0 && ix.ad[a].offer === "Not tagged").length, ot = [...per.entries()].filter(([a, s]) => s.spend > 0 && P.skus[ix.ad[a].sku].kind === "other").length;
  return `${tie}${cover}<h3>Validation</h3>${valid}
    <details class="steps"><summary>Offer: ${nt} ads Not tagged, to rename (offer ads say "Offer", others "Non-offer")</summary>${list((a) => ix.ad[a].offer === "Not tagged", "The 25 with the most spend in the last 30 days.")}</details>
    <details class="steps"><summary>SKU: ${ot} ads Other (no product code in the ad, ad set or campaign name)</summary>${list((a) => P.skus[ix.ad[a].sku].kind === "other", "Add the code to config.json → meta_view.sku_codes, or fix the name.")}</details>`;
}
