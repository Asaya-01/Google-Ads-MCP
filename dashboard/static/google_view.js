/* Marketing › Google: see in 10 seconds what is working and what is wasting
   money, reach any campaign, ad group, keyword, search term, ad, asset group
   or product in 2–3 clicks. Filter bar → KPI strip → Brand vs Non-brand →
   What's working → Product × Campaign-type matrix → watchlist → explorer
   (Campaign › Ad group / Asset group › Keywords | Search terms | Ads, or
   Products | Assets | Search insights) → detail drawer.
   Every number is summed from the google_ads page (entity × day) and ratios
   are worked out from the summed bases at whatever level is shown. Tags come
   from the page (app/google_model.py), never computed here. The state lives
   in the URL (#marketing?sub=google&…). Shares the Meta view's parts: the
   sparkline, middle truncation, drawer, filter bar and matrix styles.
   Read-only: nothing here writes to Google Ads ("Add as negative" only copies
   the term). Inlined after meta_view.js. */

const GV = {
  scope: "perf", seg: "all", types: [], skus: [], status: "all", min: null, q: "",
  vt: new Set(), mx: "g_roas", g: "camp", cols: "eff", custom: [], cmpv: false,
  xf: { sku: null, st: null }, exp: new Set(), expAll: true, tabs: {}, dr: null,
  dm: ["g_roas", "g_cost"], dg: "d", drange: "picked", dview: "chart", sort: { col: null, dir: -1 },
  tf: "all", ix: null, net: new Map(), tables: {}, fsort: {}, more: false, leak: null,
};
const GV_F = ["cost", "impr", "clicks", "conv", "value", "oconv", "oval", "views", "q25", "q50", "q75", "q100", "elig", "abs", "top", "lrank", "lbudget"];
const GV_SUBS = ["Brand Search", "Brand PMax", "Non-brand PMax", "Demand Gen", "Non-brand Search"];
const GV_TYPES = { perf: ["Search", "PMax", "Demand Gen"], aw: ["Search", "PMax", "Demand Gen", "Video"] };
const GV_KPI = { perf: ["g_cost", "g_value", "g_roas", "g_conv", "g_cpa", "g_cvr"], aw: ["g_cost", "g_impr", "g_views", "g_view_rate", "g_cpv", "g_reach"] };
const GV_MATRIX = ["g_roas", "g_cost", "g_value", "g_conv", "g_cpa", "g_cvr", "g_ctr"];
const GV_COLS = {
  perf: { eff: ["g_cost", "g_value", "g_roas", "g_conv", "g_cpa", "g_aov"], traffic: ["g_impr", "g_clicks", "g_ctr", "g_cpc", "g_cpm"], health: ["g_is", "g_abs", "g_lost_budget", "g_lost_rank", "g_cost", "g_roas"], video: ["g_views", "g_view_rate", "g_cpv", "g_q25", "g_q100"] },
  aw: { eff: ["g_cost", "g_impr", "g_cpm", "g_ctr", "g_views", "g_view_rate", "g_oconv"], traffic: ["g_impr", "g_clicks", "g_ctr", "g_cpc", "g_cpm"], health: ["g_is", "g_abs", "g_lost_budget", "g_lost_rank", "g_cost"], video: ["g_views", "g_view_rate", "g_cpv", "g_q25", "g_q50", "g_q75", "g_q100"] },
};
const GV_PRESET_NAMES = [["eff", "Efficiency"], ["traffic", "Traffic"], ["health", "Search health"], ["video", "Video"], ["custom", "Custom"]];
const GV_GROUPS = { camp: ["camp", "grp"], type: ["type", "camp", "grp"], seg: ["seg", "type", "camp", "grp"], sku: ["sku", "camp", "grp"] };
const GV_GROUP_NAMES = [["camp", "Campaign › Ad group / Asset group"], ["type", "Type › Campaign › …"], ["seg", "Segment › Type › Campaign › …"], ["sku", "SKU › Campaign › …"]];
const GV_LVL = { camp: "Campaign", grp: "Ad group", asg: "Asset group", type: "Type", seg: "Segment", sku: "SKU" };
// metrics that never show in Awareness (no ROAS, conversions or AOV there)
const GV_PERF_ONLY = new Set(["g_conv", "g_value", "g_roas", "g_cvr", "g_cpa", "g_aov"]);
const GV_MATCH = { EXACT: "E", PHRASE: "P", BROAD: "B", NEAR_EXACT: "E~", NEAR_PHRASE: "P~" };

// ---------------------------------------------------------------- URL state
function gvFromUrl() {
  const q = new URLSearchParams(location.hash.split("?")[1] || "");
  const get = (k, d) => (q.has(k) ? q.get(k) : d);
  const list = (k) => (get(k, "") || "").split(",").filter(Boolean);
  GV.scope = get("scope", "perf") === "aw" ? "aw" : "perf";
  GV.seg = ["Brand", "Non-brand"].includes(get("seg", "all")) ? get("seg") : "all";
  GV.types = list("ty"); GV.skus = list("sku"); GV.status = get("st", "all");
  GV.min = q.has("min") ? Math.max(0, +q.get("min") || 0) : null; GV.q = get("q", "");
  GV.vt = new Set(list("vt"));
  GV.mx = get("mx", "g_roas"); if (!GV_MATRIX.includes(GV.mx)) GV.mx = "g_roas";
  GV.g = GV_GROUPS[get("g", "camp")] ? get("g", "camp") : "camp";
  GV.cols = get("cols", "eff"); GV.custom = list("cc").filter((x) => METRICS[x]).slice(0, 8);
  GV.cmpv = get("cv", "0") === "1";
  const xf = (get("xf", "") || "").split("|");
  GV.xf = { sku: xf[0] || null, st: xf[1] || null };
  // open by default: every campaign shows its ad groups until rows are collapsed
  GV.expAll = !q.has("exp");
  GV.exp = new Set((get("exp", "") || "").split("~").filter((x) => x && x !== "-"));
  GV.tabs = Object.fromEntries((get("gt", "") || "").split("~").filter(Boolean).map((x) => [x.slice(0, x.lastIndexOf("=")), x.slice(x.lastIndexOf("=") + 1)]));
  GV.tf = get("tf", "all");
  const dr = get("dr", ""); GV.dr = dr ? { lvl: dr.split(":")[0], id: dr.split(":").slice(1).join(":") } : null;
  GV.dm = list("dm").filter((x) => METRICS[x] && METRICS[x].gv).slice(0, 2); if (!GV.dm.length) GV.dm = GV.scope === "aw" ? ["g_cost", "g_cpm"] : ["g_roas", "g_cost"];
  GV.dg = get("dg", "d") === "w" ? "w" : "d"; GV.drange = get("drg", "picked"); GV.dview = get("dv", "chart") === "table" ? "table" : "chart";
  const so = get("so", ""); GV.sort = so ? { col: so.replace(/^-/, ""), dir: so.startsWith("-") ? -1 : 1 } : { col: null, dir: -1 };
}
function gvToUrl() {
  const p = new URLSearchParams({ sub: "google" });
  const put = (k, v, d) => { if (v !== d && v != null && v !== "") p.set(k, v); };
  put("scope", GV.scope, "perf"); put("seg", GV.seg, "all");
  if (GV.types.length) p.set("ty", GV.types.join(",")); if (GV.skus.length) p.set("sku", GV.skus.join(","));
  put("st", GV.status, "all"); if (GV.min != null) p.set("min", String(GV.min)); put("q", GV.q, "");
  if (GV.vt.size) p.set("vt", [...GV.vt].join(","));
  put("mx", GV.mx, "g_roas"); put("g", GV.g, "camp"); put("cols", GV.cols, "eff");
  if (GV.cols === "custom" && GV.custom.length) p.set("cc", GV.custom.join(","));
  if (GV.cmpv) p.set("cv", "1");
  if (GV.xf.sku || GV.xf.st) p.set("xf", `${GV.xf.sku || ""}|${GV.xf.st || ""}`);
  if (!GV.expAll) p.set("exp", GV.exp.size ? [...GV.exp].join("~") : "-");
  const gt = Object.entries(GV.tabs).filter(([k]) => gvOpen(k)).map(([k, v]) => `${k}=${v}`);
  if (gt.length) p.set("gt", gt.join("~"));
  put("tf", GV.tf, "all");
  if (GV.dr) { p.set("dr", `${GV.dr.lvl}:${GV.dr.id}`); p.set("dm", GV.dm.join(",")); put("dg", GV.dg, "d"); put("drg", GV.drange, "picked"); put("dv", GV.dview, "chart"); }
  if (GV.sort.col) p.set("so", (GV.sort.dir < 0 ? "-" : "") + GV.sort.col);
  history.replaceState(null, "", "#marketing?" + p.toString());
}

// ---------------------------------------------------------------- data
/* Rows of every page are brought to one layout: [day, entity, ...GV_F]. */
function gvNorm(rows, pick) { return (rows || []).map((r) => { const out = [r[0], r[1], ...GV_F.map(() => null)]; for (const [f, j] of pick) out[2 + GV_F.indexOf(f)] = r[j]; return out; }); }
function gvByDay(n, rows) { const out = Array.from({ length: n }, () => []); rows.forEach((r, i) => { if (out[r[0]]) out[r[0]].push(i); }); return out; }
function gvIndex(P) {
  if (GV.ix && GV.ix.P === P) return GV.ix;
  const n = P.dates.length, di = new Map(P.dates.map((d, i) => [d, i]));
  const C = P.campaigns.map((c, i) => ({ i, id: c[0], name: c[1], scope: c[2], seg: c[3], type: c[4], sub: c[5], sku: c[6], status: c[7], primary: c[8], bidding: c[9], budgetDay: c[10], budgetTotal: c[11], start: c[12], end: c[13], troas: c[14], limited: !!c[15], pure: P.pure ? P.pure[i] : true, groups: [], gskus: new Set([c[6]]) }));
  const G = P.groups.map((g, i) => ({ i, id: g[0], name: g[1], camp: g[2], kind: g[3], status: g[4], strength: g[5], sku: g[6], primary: g[7], gtype: g[8], ads: [] }));
  G.forEach((g) => { C[g.camp].groups.push(g.i); C[g.camp].gskus.add(g.sku); });
  const A = P.ads.map((a, i) => ({ i, id: a[0], name: a[1], grp: a[2], camp: G[a[2]].camp, type: a[3], status: a[4], strength: a[5], url: a[6] }));
  A.forEach((a) => G[a.grp].ads.push(a.i));
  const rows = { c: P.crows, g: P.grows, a: P.arows, m: P.mrows.map((r) => { const o = [r[0], r[1], ...GV_F.map(() => null)]; o[2] = r[4]; o[3] = r[5]; o[4] = r[6]; o[5] = r[7]; o[6] = r[8]; o.sku = r[2]; o.src = r[3]; return o; }) };
  const by = { c: gvByDay(n, rows.c), g: gvByDay(n, rows.g), a: gvByDay(n, rows.a), m: gvByDay(n, rows.m) };
  GV.ix = { P, n, di, C, G, A, rows, by, treeFrom: P.tree_from ? di.get(P.tree_from) ?? 0 : n, S: null, PR: null, AS: null };
  return GV.ix;
}
// the lazy pages, normalised once
function gvSearchIx() {
  const ix = GV.ix, S = state.pages.google_search;
  if (!S || !S.keywords) return null;
  if (ix.S && ix.S.raw === S) return ix.S;
  const kr = gvNorm(S.krows, [["cost", 2], ["impr", 3], ["clicks", 4], ["conv", 5], ["value", 6], ["elig", 7], ["abs", 8], ["lrank", 9]]);
  const tr = gvNorm(S.trows, [["cost", 2], ["impr", 3], ["clicks", 4], ["conv", 5], ["value", 6]]);
  const K = S.keywords.map((k, i) => ({ i, id: k[0], text: k[1], match: k[2], grp: k[3], status: k[4], qs: k[5], qsCtr: k[6], qsRel: k[7], qsLp: k[8] }));
  const T = S.terms.map((t, i) => ({ i, term: t[0], grp: t[1], kw: t[2], match: t[3], status: t[4], kwText: t[5] }));
  ix.S = { raw: S, K, T, kr, tr, kby: gvByDay(ix.n, kr), tby: gvByDay(ix.n, tr) };
  return ix.S;
}
function gvProdIx() {
  const ix = GV.ix, PP = state.pages.google_products;
  if (!PP || !PP.products) return null;
  if (ix.PR && ix.PR.raw === PP) return ix.PR;
  const rows = gvNorm(PP.rows, [["cost", 2], ["impr", 3], ["clicks", 4], ["conv", 5], ["value", 6], ["oconv", 7]]);
  ix.PR = { raw: PP, items: PP.products.map((p, i) => ({ i, item: p[0], title: p[1], camp: p[2], sku: p[3], code: p[4] })), rows, by: gvByDay(ix.n, rows) };
  return ix.PR;
}
function gvAssetIx() {
  const ix = GV.ix, AP = state.pages.google_assets;
  if (!AP || !AP.assets) return null;
  if (ix.AS && ix.AS.raw === AP) return ix.AS;
  const rows = gvNorm(AP.rows, [["cost", 2], ["impr", 3], ["clicks", 4]]);
  ix.AS = { raw: AP, items: AP.assets.map((a, i) => ({ i, id: a[0], pk: a[1], parent: a[2], type: a[3], field: a[4], text: a[5], label: a[6] })), rows, by: gvByDay(ix.n, rows) };
  return ix.AS;
}
const gvZero = () => { const s = { n: 0, has: {}, isimpr: 0 }; for (const f of GV_F) s[f] = 0; return s; };
function gvAdd(s, r) {
  s.n++;
  for (let j = 0; j < GV_F.length; j++) { const v = r[j + 2]; if (v == null) continue; s[GV_F[j]] += v; s.has[GV_F[j]] = (s.has[GV_F[j]] || 0) + 1; }
  if (r[2 + 12] != null) { s.isimpr += r[3] || 0; s.has.isimpr = (s.has.isimpr || 0) + 1; }
}
function gvMerge(into, s) { into.n += s.n; into.isimpr += s.isimpr; for (const f of GV_F) into[f] += s[f]; for (const [k, v] of Object.entries(s.has)) into.has[k] = (into.has[k] || 0) + v; return into; }
// sums over days of one row set, for entities passing ok, optionally split by key(entity, row)
function gvSum(kind, days, ok, key, src) {
  const ix = GV.ix, R = src ? src.rows : ix.rows[kind], by = src ? src.by : ix.by[kind], out = key ? new Map() : gvZero();
  for (const d of days) for (const i of by[d] || []) {
    const r = R[i];
    if (!ok(r[1], r)) continue;
    if (key) { const k = key(r[1], r); let s = out.get(k); if (!s) out.set(k, (s = gvZero())); gvAdd(s, r); } else gvAdd(out, r);
  }
  return out;
}
/* A metric from summed bases; null ("—") when a base is missing or zero, or
   when a number is not reported at this level (no impression share outside
   Search, no views outside video, impressions not additive for products). */
function gvVal(id, s) {
  const m = METRICS[id] && METRICS[id].gv;
  if (!m || !s || !s.n) return null;
  if (GV.scope === "aw" && GV_PERF_ONLY.has(id)) return null;
  if (!s.has[m.num]) return null;
  if (m.num === "impr" || m.den === "impr") { if ((s.has.impr || 0) < s.n) return null; }
  const num = s[m.num];
  if (!m.den) return num;
  if (!s.has[m.den]) return null;
  const den = s[m.den];
  return den ? (num / den) * (m.mul || 1) : null;
}
const gvF = (id, v, compact) => (v == null ? "—" : mVal(id, v, compact));
const gvGrey = () => (GV.ix.P.config.grey_below_cost || 3000);
// change against the comparison: counts per day when the periods differ in length, ratios directly
function gvChange(id, a, b, na, nb) {
  const x = gvVal(id, a), y = b ? gvVal(id, b) : null;
  if (x == null || y == null) return { ch: null, small: false };
  if (!y) return { ch: null, small: true };
  const count = !METRICS[id].gv.den, small = !b.cost || b.cost < gvGrey();
  return { ch: count && na && nb && na !== nb ? x / na / (y / nb) - 1 : x / y - 1, small };
}
/* Colour against the sub_type's target where one is set; grey under the
   cost threshold. "" when there is no target (the Δ colours instead). */
function gvTargetCls(id, v, sub, cost) {
  if (v == null || !sub) return "";
  if (cost < gvGrey()) return "mv-muted";
  const t = (GV.ix.P.config.targets || {})[sub] || {}, amber = GV.ix.P.config.target_amber || 0.15;
  if (id === "g_roas" && t.roas) return v >= t.roas ? "tg-good" : v >= t.roas * (1 - amber) ? "tg-amber" : "tg-bad";
  if (id === "g_cpa" && t.cpa) return v <= t.cpa ? "tg-good" : v <= t.cpa * (1 + amber) ? "tg-amber" : "tg-bad";
  return "";
}
const gvTarget = (id, sub) => { const t = (GV.ix.P.config.targets || {})[sub] || {}; return id === "g_roas" ? t.roas : id === "g_cpa" ? t.cpa : null; };
const gvLast14 = (cur) => { const end = Math.max(...cur); return Array.from({ length: 14 }, (_, i) => end - 13 + i).filter((d) => d >= 0); };
function gvSeries(id, days, kind, ok, src) { return days.map((d) => gvVal(id, gvSum(kind, [d], ok, null, src))); }

// ---------------------------------------------------------------- the period
function gvPeriod() {
  const { di } = GV.ix;
  const c = RG.eng.compare(RG.from, RG.to, RG.cmp), g = rgPick(c);
  if (!g) return null;
  const map = (list) => (list || []).map((d) => di.get(d)).filter((x) => x !== undefined).sort((a, b) => a - b);
  const cur = map(g.cur), prev = map(g.prev);
  return { g, cur, prev, missing: (g.cur || []).filter((d) => !di.has(d)), early: cur.length && cur[0] < GV.ix.treeFrom };
}

// ---------------------------------------------------------------- filters
const GV_ACTIVE = new Set(["ENABLED"]);
function gvCampOk(ci) {
  const C = GV.ix.C[ci];
  if ((GV.scope === "aw" ? "Awareness" : "Performance") !== C.scope) return false;
  if (GV.seg !== "all" && C.seg !== GV.seg) return false;
  if (GV.types.length && !GV.types.includes(C.type)) return false;
  if (GV.skus.length && !GV.skus.some((k) => C.gskus.has(gvSkuIdx(k)))) return false;
  if (GV.status !== "all") { if (!C.status) return false; if ((GV.status === "active") !== GV_ACTIVE.has(C.status)) return false; }
  if (GV.q && !gvHay(C).includes(GV.q.toLowerCase())) return false;
  return true;
}
// the matrix's cross-filters (SKU and sub_type), on top of the page filters
function gvXOk(ci) {
  const C = GV.ix.C[ci];
  if (GV.xf.sku && !C.gskus.has(gvSkuIdx(GV.xf.sku))) return false;
  if (GV.xf.st && C.sub !== GV.xf.st) return false;
  return true;
}
const gvSkuIdx = (code) => GV.ix.P.skus.findIndex((s) => s.code === code);
const gvSkuLabel = (k) => { const s = GV.ix.P.skus[k]; return !s ? "?" : s.kind === "single" ? `${s.code} · ${s.label}` : s.label; };
/* what the search box matches: names, and keywords and search terms when loaded */
function gvHay(C) {
  if (C.hay) return C.hay;
  const ix = GV.ix, parts = [C.name, ...C.groups.map((g) => ix.G[g].name), ...C.groups.flatMap((g) => ix.G[g].ads.map((a) => ix.A[a].name))];
  const S = gvSearchIx();
  if (S) { const gs = new Set(C.groups); for (const k of S.K) if (gs.has(k.grp)) parts.push(k.text); for (const t of S.T) if (gs.has(t.grp)) parts.push(t.term); C.hay = parts.join(" ").toLowerCase(); return C.hay; }
  return parts.join(" ").toLowerCase();
}

// ---------------------------------------------------------------- asked of Google on demand
async function gvAsk(kind, campIds, days) {
  const P = GV.ix.P;
  if (!campIds.length || !days.length) return { na: "nothing in view" };
  const since = P.dates[Math.min(...days)], until = P.dates[Math.max(...days)];
  const ids = [...new Set(campIds.map((c) => GV.ix.C[c].id))].sort();
  const key = `${kind}|${since}|${until}|${ids.join(",")}`;
  if (GV.net.has(key)) return GV.net.get(key);
  const pr = (async () => {
    if (embedded) return { na: `${kind === "insights" ? "search insights are" : "reach is"} asked of Google on the live dashboard only` };
    if (!(P.on || {})[kind]) return { na: `${kind === "insights" ? "Search insights" : "Reach"} is a pipeline addition not switched on yet` };
    try {
      const r = await fetch(`/api/google/${kind}`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ since, until, campaigns: ids }) });
      return r.ok ? await r.json() : { na: `HTTP ${r.status}` };
    } catch (e) { return { na: e.message }; }
  })();
  GV.net.set(key, pr);
  return pr;
}
const gvBrandRx = () => { const t = GV.ix.P.config.brand_terms || []; return t.length ? new RegExp(t.map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "i") : null; };

// ---------------------------------------------------------------- Visual | Table and CSV, on every section
/* spec: { cols: [[label, (row) => value, metricId?]], rows } — the flat table
   behind a section, shown in Table mode and exported as CSV. */
function gvSecT(id, title, q, visual, spec, o = {}) {
  GV.tables[id] = spec;
  const table_ = GV.vt.has(id);
  const ctl = `${o.ctl && !table_ ? o.ctl : ""}<div class="seg gv-vt" role="group" aria-label="View"><button type="button" data-vt="${id}" data-v="v" aria-pressed="${!table_}">Visual</button><button type="button" data-vt="${id}" data-v="t" aria-pressed="${table_}">Table</button></div><button type="button" class="more-link gv-csv" data-csv="${id}" title="Download this section as CSV">CSV ↓</button>`;
  return rgSec(title, q, table_ ? gvFlat(spec, id) : visual, { ctl, comp: o.comp, id: o.id, cls: o.cls });
}
function gvFlat(spec, id) {
  const sortCol = GV.fsort[id];
  let rows = spec.rows.slice();
  if (sortCol) { const [j, dir] = sortCol; rows.sort((a, b) => { const x = spec.cols[j][1](a), y = spec.cols[j][1](b); return (typeof x === "number" && typeof y === "number" ? x - y : String(x ?? "").localeCompare(String(y ?? ""))) * dir; }); }
  const head = spec.cols.map(([l, , mid], j) => `<th class="${mid ? "" : "text"}" scope="col"><button type="button" class="mv-sort" data-fsort="${id}:${j}">${esc(l)}${sortCol && sortCol[0] === j ? (sortCol[1] < 0 ? " ▼" : " ▲") : ""}</button></th>`).join("");
  const body = rows.map((r) => `<tr>${spec.cols.map(([, get, mid]) => { const v = get(r); return `<td class="${mid ? "" : "text"}">${esc(mid ? gvF(mid, v) : v ?? "—")}</td>`; }).join("")}</tr>`).join("");
  return `<div class="table-wrap" style="max-height:60vh"><table><thead><tr>${head}</tr></thead><tbody>${body || `<tr><td class="text na" colspan="${spec.cols.length}">No rows with these filters.</td></tr>`}</tbody></table></div>`;
}
function gvCsv(id) {
  const spec = GV.tables[id];
  if (!spec) return;
  const q = (v) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [spec.cols.map(([l]) => q(l)).join(","), ...spec.rows.map((r) => spec.cols.map(([, get]) => { const v = get(r); return q(typeof v === "number" ? Math.round(v * 10000) / 10000 : v); }).join(","))];
  const blob = new Blob([lines.join("\n")], { type: "text/csv" }), a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = `google-${id}-${RG.from}-${RG.to}.csv`; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------------------------------------------------------------- sections
function gvFilterBar(P) {
  const seg = (id, val, opts, dis) => `<div class="seg" data-f="${id}" role="group" ${dis ? `title="${esc(dis)}"` : ""}>${opts.map(([k, l]) => `<button type="button" data-v="${esc(k)}" aria-pressed="${val === k}" ${dis && k !== "all" ? "disabled" : ""}>${esc(l)}</button>`).join("")}</div>`;
  const min = GV.min == null ? P.config.min_cost_default : GV.min;
  const types = `<div class="gv-chips" role="group" aria-label="Campaign type">${GV_TYPES[GV.scope].map((t) => `<button type="button" class="chip${GV.types.includes(t) ? " on" : ""}" data-ty="${esc(t)}" aria-pressed="${GV.types.includes(t)}">${esc(t)}</button>`).join("")}</div>`;
  const skuList = [...new Set(GV.ix.C.filter((c) => c.scope !== "Excluded").flatMap((c) => [...c.gskus]))].map((k) => P.skus[k]).filter(Boolean).sort((a, b) => a.code.localeCompare(b.code));
  const skus = `<details class="gv-skusel"><summary>Product${GV.skus.length ? `: ${esc(GV.skus.join(", "))}` : ": all"}</summary><div>${skuList.map((s) => `<label><input type="checkbox" data-sku="${esc(s.code)}" ${GV.skus.includes(s.code) ? "checked" : ""}> ${esc(s.kind === "single" || s.kind === "set" ? s.code + " · " + s.label : s.label)}</label>`).join("")}${GV.skus.length ? '<button type="button" class="more-link" data-act="sku-clear">Clear</button>' : ""}</div></details>`;
  return `<div class="mv-filters gv-filters" id="gv-filters">
    ${seg("scope", GV.scope, [["perf", "Performance"], ["aw", "Awareness"]])}
    ${seg("seg", GV.seg, [["all", "Overall"], ["Brand", "Brand"], ["Non-brand", "Non-brand"]])}
    ${types}${skus}
    ${seg("status", GV.status, [["all", "All"], ["active", "Active"], ["paused", "Paused/removed"]], (P.on || {}).objects ? "" : "Status needs the status report (a pipeline addition not switched on yet)")}
    <label class="mv-min">Min cost ₹<input type="number" id="gv-min" min="0" step="100" value="${min}"></label>
    <input type="search" id="gv-q" placeholder="Search names, keywords, search terms" value="${esc(GV.q)}" aria-label="Search">
  </div>`;
}
function gvKpis(T, B, pr, ok) {
  const ids = GV_KPI[GV.scope], last = gvLast14(pr.cur), cards = [];
  const rows = ids.map((id) => {
    if (id === "g_reach") return { id, v: null, p: null, ch: null };
    const { ch, small } = gvChange(id, T, B, pr.cur.length, pr.prev.length);
    return { id, v: gvVal(id, T), p: B ? gvVal(id, B) : null, ch, small };
  });
  for (const r of rows) {
    if (r.id === "g_reach") { cards.push(`<div class="kpi-slot" data-greach="1">${kpiCard("g_reach", { loading: true }).replace("asking Meta", "asking Google")}</div>`); continue; }
    cards.push(kpiCard(r.id, { value: r.v, prev: pr.prev.length ? r.p : null, change: r.ch, small: r.small, na: r.v == null ? gvNaWhy(r.id) : null, spark: mvSpark(gvSeries(r.id, last, "c", ok)) }));
  }
  const spec = { cols: [["Metric", (r) => METRICS[r.id].label], ["This period", (r) => r.v, "_"], ["Comparison", (r) => r.p, "_"], ["Change", (r) => (r.ch == null ? null : Math.round(r.ch * 1000) / 10 + "%")]], rows };
  spec.cols[1] = ["This period", (r) => (r.v == null ? null : mVal(r.id, r.v))]; spec.cols[2] = ["Comparison", (r) => (r.p == null ? null : mVal(r.id, r.p))];
  return { html: `<div class="kpis six" id="gv-kpis">${cards.join("")}</div>`, spec };
}
function gvNaWhy(id) {
  const m = METRICS[id] && METRICS[id].gv, on = GV.ix.P.on || {};
  if (m && m.vid && !on.video) return "views come with the video report, not switched on yet";
  if (m && m.isn && !on.impression_share) return "impression share comes with its report, not switched on yet";
  if (m && m.isn) return "Search campaigns only";
  return "no base in these days";
}
async function gvKpiReach(pr, ok) {
  const camps = [...gvSum("c", pr.cur, ok, (c) => c).keys()], pcamps = pr.prev.length ? [...gvSum("c", pr.prev, ok, (c) => c).keys()] : [];
  const [a, b] = await Promise.all([gvAsk("reach", camps, pr.cur), pcamps.length ? gvAsk("reach", pcamps, pr.prev) : null]);
  for (const el of document.querySelectorAll("#gv-kpis [data-greach]")) {
    const v = a && a.reach != null ? a.reach : null, pv = b && b.reach != null ? b.reach : null;
    el.outerHTML = kpiCard("g_reach", { value: v, prev: pr.prev.length ? pv : null, change: v != null && pv ? v / pv - 1 : null, na: v == null ? (a && a.na) || "not available" : null, sub: a && a.frequency ? `Avg. frequency ${a.frequency.toFixed(2)}` : "", tipExtra: "Across campaigns an upper bound (Google cannot de-duplicate users across campaigns)." });
  }
}

// ---------------------------------------------------------------- Brand vs Non-brand
function gvSplit(pr, ok) {
  const ix = GV.ix, nc = pr.cur.length, np = pr.prev.length;
  const by = (days) => gvSum("c", days, ok, (c) => ix.C[c].seg);
  const A = by(pr.cur), Bm = np ? by(pr.prev) : new Map();
  const tot = gvZero(); for (const s of A.values()) gvMerge(tot, s);
  const brandSearch = (days) => gvSum("c", days, (c) => ok(c) && ix.C[c].sub === "Brand Search");
  const bs = brandSearch(pr.cur), bsB = np ? brandSearch(pr.prev) : null;
  const panel = (seg) => {
    const s = A.get(seg) || gvZero(), b = Bm.get(seg) || null;
    const share = (f) => (tot[f] ? s[f] / tot[f] : null);
    const roas = gvChange("g_roas", s, b, nc, np), cpa = gvChange("g_cpa", s, b, nc, np);
    const line = (l, v, extra = "") => `<div class="gv-pl"><span>${l}</span><b>${v}</b>${extra}</div>`;
    let more = "";
    if (seg === "Brand") {
      const isv = gvVal("g_is", bs), abs = gvVal("g_abs", bs), W = ix.P.config.watchlist;
      const na = ix.P.on && ix.P.on.impression_share ? "no Brand Search impressions in these days" : "impression share report not switched on yet";
      more = line(mHead("g_is", "Brand Search impr. share"), isv == null ? `<span class="na" title="${esc(na)}">—</span>` : `<span class="${isv < W.brand_is_below ? "gv-amber" : ""}">${esc(mFormat("percent", isv))}</span>`, bsB ? ` <small>${mPpHtml(isv != null && gvVal("g_is", bsB) != null ? isv - gvVal("g_is", bsB) : null, "higher")}</small>` : "")
        + line(mHead("g_abs", "Abs. top impr. share"), abs == null ? `<span class="na" title="${esc(na)}">—</span>` : `<span class="${abs < W.brand_abs_top_below ? "gv-amber" : ""}">${esc(mFormat("percent", abs))}</span>`, bsB ? ` <small>${mPpHtml(abs != null && gvVal("g_abs", bsB) != null ? abs - gvVal("g_abs", bsB) : null, "higher")}</small>` : "");
    } else {
      more = line(mHead("g_leak", "Brand-term share of conv. value"), `<span id="gv-leak"><span class="na">…</span></span>`)
        + line("Conversions from hero SKUs", gvHeroShare(pr, ok));
    }
    return `<div class="gv-panel"><h3>${seg}</h3>
      ${line("Share of cost", esc(mFormat("percent", share("cost")) ?? "—"))}
      ${line("Share of conv. value", esc(mFormat("percent", share("value")) ?? "—"))}
      ${line(mHead("g_roas"), esc(gvF("g_roas", gvVal("g_roas", s))), np ? ` <small>${deltaHtml(roas.ch, "g_roas", roas.small)}</small>` : "")}
      ${line(mHead("g_cpa"), esc(gvF("g_cpa", gvVal("g_cpa", s))), np ? ` <small>${deltaHtml(cpa.ch, "g_cpa", cpa.small)}</small>` : "")}
      ${more}</div>`;
  };
  const b = A.get("Brand") || gvZero(), n = A.get("Non-brand") || gvZero();
  const pc = (x, t) => (t ? mFormat("percent", x / t) : "—");
  const summary = tot.cost ? `Brand drives <b>${pc(b.value, tot.value)}</b> of Google conv. value on <b>${pc(b.cost, tot.cost)}</b> of cost. Non-brand ROAS <b>${esc(gvF("g_roas", gvVal("g_roas", n)))}</b> vs Brand <b>${esc(gvF("g_roas", gvVal("g_roas", b)))}</b>.` : "No cost in these days.";
  const rows = ["Brand", "Non-brand"].map((seg) => ({ seg, s: A.get(seg) || gvZero() }));
  const spec = { cols: [["Segment", (r) => r.seg], ["Cost", (r) => r.s.cost, "g_cost"], ["Share of cost", (r) => (tot.cost ? r.s.cost / tot.cost : null), "g_ctr"], ["Conv. value", (r) => r.s.value, "g_value"], ["Share of conv. value", (r) => (tot.value ? r.s.value / tot.value : null), "g_ctr"], ["Platform ROAS", (r) => gvVal("g_roas", r.s), "g_roas"], ["CPA", (r) => gvVal("g_cpa", r.s), "g_cpa"]], rows };
  return { html: `<p class="gv-sum">${summary}</p><div class="cols-2 gv-split">${panel("Brand")}${panel("Non-brand")}</div>`, spec };
}
/* Non-brand conversions on the hero SKUs vs the rest, from the product report */
function gvHeroShare(pr, ok) {
  const ix = GV.ix;
  if (!ix.P.has_products) return `<span class="na" title="Needs the Shopping product report (a pipeline addition not switched on yet)">—</span>`;
  const heroes = new Set((ix.P.config.hero_skus || []).map(gvSkuIdx));
  let h = 0, all = 0;
  for (const d of pr.cur) for (const i of ix.by.m[d]) { const r = ix.rows.m[i]; if (r.src !== 0 || !ok(r[1]) || ix.C[r[1]].seg !== "Non-brand") continue; all += r[5] || 0; if (heroes.has(r.sku)) h += r[5] || 0; }
  return all ? `${esc(mFormat("percent", h / all))} <span class="sub">(${esc((ix.P.config.hero_skus || []).join(", "))}); new products and others ${esc(mFormat("percent", 1 - h / all))}</span>` : '<span class="na">no product-attributed conversions</span>';
}
/* Brand leakage: the share of non-brand conversion value from queries with a
   brand term — PMax search insights (asked of Google) and the search terms
   of non-brand Search campaigns. */
async function gvLeakage(pr, ok) {
  const ix = GV.ix, rx = gvBrandRx(), el = () => document.getElementById("gv-leak");
  const pmax = [...gvSum("c", pr.cur, (c) => ok(c) && ix.C[c].seg === "Non-brand" && ix.C[c].type === "PMax", (c) => c).keys()];
  const res = pmax.length ? await gvAsk("insights", pmax, pr.cur) : { campaigns: {} };
  const rows = [];
  if (res && res.campaigns) for (const [cid, list] of Object.entries(res.campaigns)) for (const [label, impr, clicks, conv, value] of list) rows.push({ src: "PMax insight", camp: cid, label, impr, clicks, conv, value, brand: !!(rx && label && rx.test(label)) });
  const S = gvSearchIx();
  if (S) {
    const gs = new Set(ix.G.filter((g) => ix.C[g.camp].seg === "Non-brand" && ix.C[g.camp].type === "Search" && ok(g.camp)).map((g) => g.i));
    const per = gvSum(null, pr.cur, (t) => gs.has(S.T[t].grp), (t) => t, { rows: S.tr, by: S.tby });
    for (const [t, s] of per) rows.push({ src: "Search term", camp: ix.C[ix.G[S.T[t].grp].camp].id, label: S.T[t].term, impr: s.impr, clicks: s.clicks, conv: s.conv, value: s.value, brand: !!(rx && rx.test(S.T[t].term)) });
  }
  GV.leak = { rows, na: !rows.length ? (res && res.na) || "no query data for non-brand campaigns in these days" : null };
  const e = el();
  if (!e) return;
  if (!rows.length) { e.innerHTML = `<span class="na" title="${esc(GV.leak.na)}">—</span> <span class="sub">${esc(GV.leak.na)}</span>`; return; }
  const tv = rows.reduce((t, r) => t + r.value, 0), bv = rows.filter((r) => r.brand).reduce((t, r) => t + r.value, 0);
  const share = tv ? bv / tv : null, amber = share != null && share > (ix.P.config.leakage_amber || 0.1);
  GV.leak.share = share;
  e.innerHTML = `<button type="button" class="more-link ${amber ? "gv-amber" : ""}" data-open="leak:all" title="Open the matching terms">${esc(mFormat("percent", share) ?? "—")}</button>${amber ? ' <span class="gv-amber sub">above ' + esc(mFormat("percent", ix.P.config.leakage_amber || 0.1)) + "</span>" : ""}`;
}

// ---------------------------------------------------------------- what's working
function gvSegAvg(days, ok) {
  const ix = GV.ix, m = gvSum("c", days, ok, (c) => ix.C[c].seg), out = {};
  for (const [k, s] of m) out[k] = gvVal("g_roas", s);
  return out;
}
function gvWorking(pr, ok) {
  const ix = GV.ix, W = ix.P.config.working, nc = pr.cur.length, np = pr.prev.length;
  const avg = gvSegAvg(pr.cur, ok), C = gvSum("c", pr.cur, ok, (c) => c), CB = np ? gvSum("c", pr.prev, ok, (c) => c) : new Map();
  const scale = [], fix = [], cut = [];
  if (GV.scope === "perf") {
    for (const [ci, s] of C) {
      const c = ix.C[ci], roas = gvVal("g_roas", s), t = gvTarget("g_roas", c.sub), ref = t || (avg[c.seg] != null ? avg[c.seg] : null);
      if (roas == null || ref == null) continue;
      const lb = gvVal("g_lost_budget", s);
      if (roas >= (t ? t : ref * W.scale_vs_avg) && ((lb != null && lb > W.lost_budget_above) || c.limited) && s.cost > 0)
        scale.push({ open: `camp:${c.id}`, name: c.name, cost: s.cost, why: `ROAS ${mFormat("ratio", roas)}${lb != null && lb > W.lost_budget_above ? ` · losing ${mFormat("percent", lb)} IS to budget` : " · limited by budget"}`, roas });
      if (s.cost >= W.min_cost && roas < W.fix_below * ref) {
        const b = CB.get(ci), causes = [];
        const lr = gvVal("g_lost_rank", s); if (lr != null && lr > 0.2) causes.push(`Lost IS (rank) ${mFormat("percent", lr)}`);
        if (b) { const ct = gvChange("g_ctr", s, b, nc, np), cv = gvChange("g_cvr", s, b, nc, np); if (ct.ch != null && ct.ch < -0.2) causes.push(`CTR ${mFormat("pp", gvVal("g_ctr", s) - gvVal("g_ctr", b))}`); if (cv.ch != null && cv.ch < -0.2) causes.push(`conv. rate ${mFormat("pp", gvVal("g_cvr", s) - gvVal("g_cvr", b))}`); }
        const S = gvSearchIx();
        if (S && c.type === "Search") { const low = S.K.filter((k) => c.groups.includes(k.grp) && k.qs != null && k.qs <= 5); if (low.length) { const part = ["qsCtr", "qsRel", "qsLp"].map((f, j) => [["expected CTR", "ad relevance", "landing page"][j], low.filter((k) => k[f] === "BELOW_AVERAGE").length]).sort((a, b) => b[1] - a[1])[0]; causes.push(`low Quality Score${part[1] ? ` (${part[0]} below average)` : ""}`); } }
        fix.push({ open: `camp:${c.id}`, name: c.name, cost: s.cost, why: `ROAS ${mFormat("ratio", roas)} vs ${t ? "target" : c.seg + " average"} ${mFormat("ratio", ref)}${causes.length ? " · " + causes.join(", ") : ""}` });
      }
    }
    // ad groups and asset groups too, once the period has them
    const G = gvSum("g", pr.cur, (g) => ok(ix.G[g].camp), (g) => g);
    for (const [gi, s] of G) {
      const g = ix.G[gi], c = ix.C[g.camp], roas = gvVal("g_roas", s), t = gvTarget("g_roas", c.sub), ref = t || avg[c.seg];
      if (roas == null || ref == null || s.cost < W.min_cost || roas >= W.fix_below * ref || c.groups.length < 2) continue;
      fix.push({ open: `grp:${g.kind}~${g.id}`, name: `${g.name}`, sub: c.name, cost: s.cost, why: `ROAS ${mFormat("ratio", roas)} vs ${t ? "target" : c.seg + " average"} ${mFormat("ratio", ref)}` });
    }
    const S = gvSearchIx();
    if (S) {
      const T = gvSum(null, pr.cur, (t) => ok(ix.G[S.T[t].grp].camp), (t) => t, { rows: S.tr, by: S.tby });
      for (const [ti, s] of T) if (s.cost >= W.min_cost && !s.conv) { const t = S.T[ti]; cut.push({ open: `term:${ti}`, name: `'${t.term}'`, sub: t.kwText ? `matched ${t.kwText}` : "", cost: s.cost, why: `${mCompactInr(s.cost)} spent · 0 conv` }); }
      const K = gvSum(null, pr.cur, (k) => ok(ix.G[S.K[k].grp].camp), (k) => k, { rows: S.kr, by: S.kby });
      for (const [ki, s] of K) if (s.cost >= W.min_cost && !s.conv) { const k = S.K[ki]; cut.push({ open: `kw:${k.id}`, name: `[${GV_MATCH[k.match] || "?"}] ${k.text}`, sub: "keyword", cost: s.cost, why: `${mCompactInr(s.cost)} spent · 0 conv` }); }
    }
  }
  const sortCost = (a, b) => b.cost - a.cost;
  scale.sort((a, b) => b.roas - a.roas); fix.sort(sortCost); cut.sort(sortCost);
  const on = ix.P.on || {};
  const col = (title, cls, list, empty) => `<div class="gv-wcol ${cls}"><h3>${title} <span class="sub">${list.length}</span></h3>${list.length ? `<ul class="mv-watch">${list.slice(0, W.max_items).map((w) => `<li><button type="button" class="mv-wbtn" data-open="${esc(w.open)}"><span class="mv-wn" title="${esc(w.name)}">${esc(mvMid(w.name, 46))}${w.sub ? `<br><span class="sub">${esc(mvMid(w.sub, 46))}</span>` : ""}</span><span class="mv-wm">${esc(w.why)}</span></button></li>`).join("")}</ul>` : `<p class="sub">${empty}</p>`}</div>`;
  const html = GV.scope === "aw" ? '<p class="sub">Scale, Fix and Cut judge return on spend, so they are for Performance campaigns only.</p>'
    : `<div class="gv-work">${col("Scale", "scale", scale, on.impression_share || on.objects ? "Nothing beating its target or segment average with budget headroom." : "Headroom needs Lost IS (budget) or the budget-limited status: reports not switched on yet.")}${col("Fix", "fix", fix, "Nothing above ₹" + inGroup.format(W.min_cost) + " under " + Math.round(W.fix_below * 100) + "% of its target or segment average.")}${col("Cut / negate", "cut", cut, gvSearchIx() ? "No search term or keyword with ₹" + inGroup.format(W.min_cost) + "+ cost and no conversion." : "Needs the keyword and search-term reports (pipeline additions not switched on yet).")}</div>`;
  const rows = [...scale.map((x) => ({ ...x, kind: "Scale" })), ...fix.map((x) => ({ ...x, kind: "Fix" })), ...cut.map((x) => ({ ...x, kind: "Cut" }))];
  return { html, spec: { cols: [["Column", (r) => r.kind], ["Item", (r) => r.name], ["Under", (r) => r.sub || ""], ["Cost", (r) => r.cost, "g_cost"], ["Why", (r) => r.why]], rows } };
}

// ---------------------------------------------------------------- Product × Campaign-type matrix
function gvMatrix(pr, ok) {
  const ix = GV.ix, id = GV.mx, nc = pr.cur.length, np = pr.prev.length;
  const subsHere = GV_SUBS.filter((st) => st !== "Non-brand Search" || ix.C.some((c) => c.sub === st && c.scope === "Performance"));
  const cells = new Map(), cellsB = new Map(), src = new Map();
  const visit = (days, into, mark) => { for (const d of days) for (const i of ix.by.m[d]) { const r = ix.rows.m[i]; if (!ok(r[1])) continue; const k = `${r.sku}|${ix.C[r[1]].sub}`; let s = into.get(k); if (!s) into.set(k, (s = gvZero())); gvAdd(s, r); if (mark) { const m = src.get(k) || new Set(); m.add(r.src); src.set(k, m); } } };
  visit(pr.cur, cells, true); if (np) visit(pr.prev, cellsB, false);
  const rowsBy = new Map();
  for (const [k, s] of cells) { const [sk, st] = k.split("|"); if (!subsHere.includes(st)) continue; const r = rowsBy.get(sk) || rowsBy.set(sk, { sk: +sk, tot: gvZero(), totB: gvZero(), src: new Set() }).get(sk); gvMerge(r.tot, s); for (const x of src.get(k) || []) r.src.add(x); }
  for (const [k, s] of cellsB) { const [sk, st] = k.split("|"); if (!subsHere.includes(st)) continue; const r = rowsBy.get(sk); if (r) gvMerge(r.totB, s); }
  const colTot = {}, colTotB = {}, all = gvZero(), allB = gvZero();
  for (const [k, s] of cells) { const st = k.split("|")[1]; if (!subsHere.includes(st)) continue; gvMerge(colTot[st] || (colTot[st] = gvZero()), s); gvMerge(all, s); }
  for (const [k, s] of cellsB) { const st = k.split("|")[1]; if (!subsHere.includes(st)) continue; gvMerge(colTotB[st] || (colTotB[st] = gvZero()), s); gvMerge(allB, s); }
  const min = GV.min == null ? ix.P.config.min_cost_default : GV.min;
  const ORDER = { single: 0, set: 1, multi: 2, brand: 3, sets: 4, offer: 5, unmapped: 6, notproduct: 7, other: 8 };
  const list = [...rowsBy.values()].filter((r) => r.tot.cost > 0).sort((a, b) => (ORDER[ix.P.skus[a.sk].kind] - ORDER[ix.P.skus[b.sk].kind]) || b.tot.cost - a.tot.cost);
  const shown = GV.more ? list : list.filter((r) => r.tot.cost >= min), hidden = list.length - shown.length;
  const mark = (set) => (!set || !set.size ? "" : `<i class="gv-src" title="${set.has(0) && set.has(1) ? "Product feed (P) plus what the feed does not attribute, kept on the campaign name's product (N)" : set.has(0) ? "From the Shopping product report (P)" : "From the campaign or ad group name (N)"}">${set.has(0) && set.has(1) ? "P+N" : set.has(0) ? "P" : "N"}</i>`);
  const cell = (s, b, sku, st, srcSet) => {
    if (!s || !s.cost) return '<td class="mx-empty">–</td>';
    const v = gvVal(id, s), { ch, small } = b ? gvChange(id, s, b, nc, np) : { ch: null, small: false };
    const tcls = st ? gvTargetCls(id, v, st, s.cost) : s.cost < gvGrey() ? "mv-muted" : "";
    return `<td class="${tcls}"><button type="button" class="mx" data-xf="${esc(sku || "")}|${esc(st || "")}" title="${s.cost < gvGrey() ? "Cost under " + mCompactInr(gvGrey()) + ": too little to judge" : "Filter the explorer to this"}"><b>${esc(gvF(id, v, true))}</b>${id !== "g_cost" ? `<span class="sub">${esc(mCompactInr(s.cost))}</span>` : ""}${np ? `<span>${deltaHtml(ch, id, small || s.cost < gvGrey())}</span>` : ""}${mark(srcSet)}</button></td>`;
  };
  const head = `<tr><th class="text" scope="col">Product</th>${subsHere.map((st) => `<th scope="col"><button type="button" class="mv-hbtn" data-xf="|${esc(st)}">${esc(st)}</button></th>`).join("")}<th scope="col">All</th></tr>`;
  let body = "";
  for (const r of shown) {
    const sk = ix.P.skus[r.sk];
    body += `<tr><td class="text"><button type="button" class="mv-hbtn" data-xf="${esc(sk.code)}|">${esc(mvMid(gvSkuLabel(r.sk), 34))}</button></td>${subsHere.map((st) => cell(cells.get(`${r.sk}|${st}`), cellsB.get(`${r.sk}|${st}`), sk.code, st, src.get(`${r.sk}|${st}`))).join("")}${cell(r.tot, np ? r.totB : null, sk.code, "", r.src)}</tr>`;
  }
  if (hidden) body += `<tr class="recon-toggle"><td class="text" colspan="${subsHere.length + 2}"><button type="button" class="more-link" data-act="more">${GV.more ? "Hide" : "Show"} ${hidden} product${hidden === 1 ? "" : "s"} under ₹${inGroup.format(min)}</button></td></tr>`;
  body += `<tr class="total"><td class="text">All products</td>${subsHere.map((st) => cell(colTot[st], np ? colTotB[st] : null, "", st, null)).join("")}${cell(all, np ? allB : null, "", "", null)}</tr>`;
  const sw = `<div class="seg" id="gv-mx" role="group" aria-label="Matrix metric">${GV_MATRIX.map((m) => `<button type="button" data-m="${m}" aria-pressed="${GV.mx === m}">${esc(METRICS[m].short || METRICS[m].label)}</button>`).join("")}</div>`;
  const tgt = Object.entries(ix.P.config.targets || {}).filter(([k, v]) => k !== "_about" && v && (v.roas || v.cpa));
  const html = `<div class="table-wrap"><table class="matrix mv-matrix gv-matrix"><thead>${head}</thead><tbody>${body}</tbody></table></div><p class="legend-note">Each cell: ${esc(METRICS[id].label)}${id !== "g_cost" ? ", cost" : ""} and the change against the comparison; <b>P</b> = from the Shopping product report, <b>N</b> = from the campaign or ad group name${ix.P.has_products ? "" : " (the product report is not switched on yet, so every cell is N)"}. Colour: ${tgt.length ? "against the sub-type's target where set, else " : ""}the change's direction; grey under ${esc(mCompactInr(gvGrey()))} of cost. Click a cell, product or column to filter the explorer.</p>`;
  const flat = [];
  for (const [k, s] of cells) { const [sk, st] = k.split("|"); if (subsHere.includes(st)) flat.push({ sku: gvSkuLabel(+sk), st, s, src: [...(src.get(k) || [])].map((x) => (x ? "N" : "P")).join("+") }); }
  const spec = { cols: [["Product", (r) => r.sku], ["Campaign type", (r) => r.st], ["Source", (r) => r.src], ["Cost", (r) => r.s.cost, "g_cost"], ["Conv. value", (r) => r.s.value, "g_value"], ["Platform ROAS", (r) => gvVal("g_roas", r.s), "g_roas"], ["Conversions", (r) => r.s.conv, "g_conv"], ["CPA", (r) => gvVal("g_cpa", r.s), "g_cpa"], ["Conv. rate", (r) => gvVal("g_cvr", r.s), "g_cvr"]], rows: flat.sort((a, b) => b.s.cost - a.s.cost) };
  return { sw, html, spec };
}

// ---------------------------------------------------------------- watchlist
function gvWatch(pr, ok) {
  const ix = GV.ix, W = ix.P.config.watchlist, nc = pr.cur.length, np = pr.prev.length, out = [];
  const C = gvSum("c", pr.cur, ok, (c) => c), CB = np ? gvSum("c", pr.prev, ok, (c) => c) : new Map();
  const lastDays = pr.cur.slice(-W.no_conv_days);
  for (const [ci, s] of C) {
    const c = ix.C[ci], b = CB.get(ci), push = (metric, val, ref, why) => out.push({ open: `camp:${c.id}`, name: c.name, cost: s.cost, metric, val, ref, why });
    if (GV.scope === "perf" && s.cost > 0 && ix.P.skus[c.sku].kind === "other" && !c.groups.some((g) => ix.P.skus[ix.G[g].sku].kind !== "other")) push("Product", "Other", "no product code", "The campaign and ad group names carry no known product code: add it to config.json meta_view.sku_codes or fix the name.");
    if (c.sub === "Brand Search") {
      const isv = gvVal("g_is", s), abs = gvVal("g_abs", s);
      if (abs != null && abs < W.brand_abs_top_below) push("Abs. top IS", mFormat("percent", abs), `under ${mFormat("percent", W.brand_abs_top_below)}`, "Brand demand is leaking to competitors (abs. top impression share low).");
      if (isv != null && isv < W.brand_is_below) push("Impr. share", mFormat("percent", isv), `under ${mFormat("percent", W.brand_is_below)}`, "Brand demand is leaking to competitors (impression share low).");
      if (b) { const cp = gvVal("g_cpc", s), pc = gvVal("g_cpc", b); if (cp != null && pc && cp / pc - 1 > W.brand_cpc_rise) push("CPC", mFormat("currency2", cp), `was ${mFormat("currency2", pc)}`, `Brand Search CPC up more than ${Math.round(W.brand_cpc_rise * 100)}%: someone may be bidding on the brand.`); }
    }
    if (GV.scope !== "perf" || s.cost < W.min_cost) continue;
    const lb = gvVal("g_lost_budget", s), roas = gvVal("g_roas", s), t = gvTarget("g_roas", c.sub);
    if (lb != null && lb > W.lost_budget_above && roas != null && t && roas >= t) push("Lost IS (budget)", mFormat("percent", lb), `ROAS ${mFormat("ratio", roas)} ≥ target`, "The budget is capping a winner.");
    const recent = gvSum("c", lastDays, (x) => x === ci);
    if (lastDays.length >= W.no_conv_days && recent.cost >= W.min_cost / 2 && !s.conv) push("Conversions", "0", `${mCompactInr(s.cost)} spent`, `Cost of at least ${mCompactInr(W.min_cost)} and no conversion in the period, still spending in the last ${W.no_conv_days} days.`);
  }
  const S = gvSearchIx();
  if (S) {
    const K = gvSum(null, pr.cur, (k) => ok(ix.G[S.K[k].grp].camp), (k) => k, { rows: S.kr, by: S.kby });
    for (const [ki, s] of K) { const k = S.K[ki]; if (k.qs != null && k.qs <= W.qs_at_most && s.cost >= W.min_cost) out.push({ open: `kw:${k.id}`, name: `[${GV_MATCH[k.match] || "?"}] ${k.text}`, cost: s.cost, metric: "Quality Score", val: String(k.qs), ref: `≤ ${W.qs_at_most}`, why: "Low Quality Score on a keyword with real cost: see its three components in the drawer." }); }
    const T = gvSum(null, pr.cur, (t) => ok(ix.G[S.T[t].grp].camp), (t) => t, { rows: S.tr, by: S.tby });
    for (const [ti, s] of T) if (s.cost >= W.min_cost && !s.conv) out.push({ open: `term:${ti}`, name: `'${S.T[ti].term}'`, cost: s.cost, metric: "Search term", val: "0 conv", ref: `${mCompactInr(s.cost)} spent`, why: "A negative-keyword candidate (see Cut)." });
  }
  out.sort((a, b) => b.cost - a.cost);
  const html = out.length ? `<ul class="mv-watch">${out.slice(0, 8).map((w) => `<li><button type="button" class="mv-wbtn" data-open="${esc(w.open)}"><span class="mv-wn" title="${esc(w.name)}">${esc(mvMid(w.name, 50))}</span><span class="mv-wm">${esc(w.metric)} <b>${esc(w.val)}</b> <span class="sub">${esc(w.ref)}</span></span></button><span class="tip" tabindex="0" data-tip="Why flagged: ${esc(w.why)}">i</span></li>`).join("")}</ul>${out.length > 8 ? `<p class="sub">${out.length - 8} more flagged; the eight with the most cost are shown.</p>` : ""}` : '<p class="sub">Nothing flagged in these days.</p>';
  return { html, spec: { cols: [["Item", (r) => r.name], ["Cost", (r) => r.cost, "g_cost"], ["Flag", (r) => r.metric], ["Value", (r) => r.val], ["Reference", (r) => r.ref], ["Why", (r) => r.why]], rows: out } };
}

// ---------------------------------------------------------------- explorer
/* Rows are open by default down to the ad groups / asset groups; their
   keyword, search-term, product and asset tabs open on click. */
function gvOpen(key, lvl) { return GV.exp.has(key) || (GV.expAll && (lvl ? lvl !== "grp" : !/(^|\/)grp:/.test(key))); }
function gvToggle(key) {
  if (GV.expAll) { // materialise the default before changing one row
    const T = GV._tree; GV.exp = new Set(T ? [...T.nodes.values()].filter((n) => n.lvl !== "grp").map((n) => n.key) : []); GV.expAll = false;
  }
  if (GV.exp.has(key)) GV.exp.delete(key); else GV.exp.add(key);
}
function gvKeyOf(lvl, ci) { const C = GV.ix.C[ci]; return lvl === "type" ? C.type : lvl === "seg" ? C.seg : lvl === "sku" ? C.sku : ci; }
function gvLabel(lvl, k) {
  const ix = GV.ix;
  if (lvl === "camp") return ix.C[k].name;
  if (lvl === "grp") return ix.G[k].name;
  if (lvl === "sku") return gvSkuLabel(k);
  return String(k);
}
function gvTree(pr, ok) {
  const ix = GV.ix, levels = GV_GROUPS[GV.g], top = levels.filter((l) => l !== "grp"), nodes = new Map(), kids = new Map();
  const node = (parent, lvl, k, depth) => {
    const key = (parent ? parent + "/" : "") + lvl + ":" + k;
    let n = nodes.get(key);
    if (!n) { n = { key, lvl, k, depth, a: gvZero(), b: gvZero(), camps: new Set() }; nodes.set(key, n); (kids.get(parent) || kids.set(parent, []).get(parent)).push(n); }
    return n;
  };
  const visit = (days, which) => {
    for (const d of days) for (const i of ix.by.c[d]) {
      const r = ix.rows.c[i]; if (!ok(r[1])) continue;
      let path = "";
      top.forEach((lvl, depth) => { const n = node(path, lvl, gvKeyOf(lvl, r[1]), depth); gvAdd(n[which], r); n.camps.add(r[1]); path = n.key; });
    }
    for (const d of days) for (const i of ix.by.g[d]) {
      const r = ix.rows.g[i], ci = ix.G[r[1]].camp; if (!ok(ci)) continue;
      let path = ""; for (const lvl of top) path = (path ? path + "/" : "") + lvl + ":" + gvKeyOf(lvl, ci);
      if (!nodes.has(path)) continue;
      const n = node(path, "grp", r[1], top.length); gvAdd(n[which], r); n.camps.add(ci);
    }
  };
  visit(pr.cur, "a"); if (pr.prev.length) visit(pr.prev, "b");
  return { nodes, kids, levels };
}
function gvColsNow() {
  const set = GV_COLS[GV.scope], list = GV.cols === "custom" ? (GV.custom.length ? GV.custom : set.eff) : set[GV.cols] || set.eff;
  return GV.scope === "aw" ? list.filter((c) => !GV_PERF_ONLY.has(c)) : list;
}
function gvDot(st, primary, limited) {
  const p = primary || "";
  const cls = !st && !p ? "unk" : limited ? "warn" : p === "LEARNING" ? "learn" : p === "LIMITED" ? "warn" : (p === "ELIGIBLE" || (!p && st === "ENABLED")) ? "on" : "off";
  const t = !st && !p ? "status not read (the status report is not switched on yet)" : limited ? "limited by budget" : (p || st).replace(/_/g, " ").toLowerCase();
  return `<i class="mv-dot ${cls}" title="${esc(t)}"></i>`;
}
function gvTags(n, levels) {
  const ix = GV.ix, cs = [...n.camps], out = [];
  const add = (dim, f) => { if (levels.includes(dim)) return; const set = new Set(cs.map(f)); out.push(set.size === 1 ? [...set][0] : `mixed ${dim}`); };
  add("seg", (c) => ix.C[c].seg); add("type", (c) => ix.C[c].type);
  if (!levels.includes("sku")) out.push(n.lvl === "grp" ? ix.P.skus[ix.G[n.k].sku].code : new Set(cs.map((c) => ix.C[c].sku)).size === 1 ? ix.P.skus[ix.C[cs[0]].sku].code : "mixed SKU");
  return out.map((t) => `<span class="mv-tag">${esc(t)}</span>`).join("");
}
// validation, shown as a warning on the row and listed in Data health
function gvValid(n, pr) {
  const ix = GV.ix, V = ix.P.config.validation, out = [];
  if (n.lvl === "camp") {
    const C = ix.C[n.k];
    if (C.sub === "Other" && n.a.cost > 0) out.push("Cost with no segment or type: the campaign name matches no rule in taxonomy.google_groups");
    if (C.groups.length) {
      const days = pr.cur.filter((d) => d >= ix.treeFrom), gs = new Set(C.groups);
      const pc = gvSum("c", days, (c) => c === n.k).cost, cc = gvSum("g", days, (g) => gs.has(g)).cost;
      if (Math.abs(pc - cc) > Math.max(100, pc * 0.01)) out.push(`Ad groups / asset groups add up to ${mCompactInr(cc)}, the campaign to ${mCompactInr(pc)}`);
    }
  }
  if (n.lvl === "grp" && n.a.clicks >= 20 && n.a.conv > n.a.clicks * V.conv_per_click) out.push(`Conversions above clicks × ${V.conv_per_click} (view-through and cross-device conversions can do this)`);
  return out;
}
function gvExplorer(pr, ok) {
  const ix = GV.ix, T = (GV._tree = gvTree(pr, ok)), cols = gvColsNow(), nc = pr.cur.length, np = pr.prev.length, last = gvLast14(pr.cur);
  const prim = GV.scope === "aw" ? "g_cost" : "g_roas", min = GV.min == null ? ix.P.config.min_cost_default : GV.min;
  const sortKey = (n) => (GV.sort.col && METRICS[GV.sort.col] ? gvVal(GV.sort.col, n.a) ?? -Infinity : n.a.cost);
  const sorted = (list) => [...list].sort((x, y) => (GV.sort.col === "name" ? gvLabel(x.lvl, x.k).localeCompare(gvLabel(y.lvl, y.k)) * GV.sort.dir : (sortKey(y) - sortKey(x)) * (GV.sort.col ? -GV.sort.dir : 1)));
  const cellOf = (id, s, b, sub) => {
    const v = gvVal(id, s), { ch, small } = np ? gvChange(id, s, b, nc, np) : { ch: null, small: false };
    const under = !np ? "" : GV.cmpv ? `<span class="sub">${esc(gvF(id, gvVal(id, b), true))}</span>` : deltaHtml(ch, id, small);
    return `<td class="${gvTargetCls(id, v, sub, s.cost)}"><span class="mv-v">${esc(gvF(id, v, true))}</span>${under ? `<br><small>${under}</small>` : ""}</td>`;
  };
  const rows = [];
  const emit = (n) => {
    if (n.a.cost < min && !gvOpen(n.key)) return;
    const children = T.kids.get(n.key) || [], open = gvOpen(n.key, n.lvl), label = gvLabel(n.lvl, n.k), warn = gvValid(n, pr);
    const isGrp = n.lvl === "grp", G = isGrp ? ix.G[n.k] : null, C = n.lvl === "camp" ? ix.C[n.k] : isGrp ? ix.C[G.camp] : null;
    const lvlName = isGrp ? (G.kind === "asg" ? "Asset group" : "Ad group") : GV_LVL[n.lvl];
    const canOpen = isGrp || children.length;
    const dot = n.lvl === "camp" ? gvDot(C.status, C.primary, C.limited) : isGrp ? gvDot(G.status, G.primary, false) : "";
    const drKey = n.lvl === "camp" ? `camp:${C.id}` : isGrp ? `grp:${G.kind}~${G.id}` : null;
    const name = `<span class="mv-ind" style="--d:${n.depth}"></span>${canOpen ? `<button type="button" class="mv-chev" data-tog="${esc(n.key)}" aria-label="${open ? "Collapse" : "Expand"}">${open ? "▾" : "▸"}</button>` : '<span class="mv-chev"></span>'}${dot}<span class="mv-name" title="${esc(label)}">${esc(mvMid(label, 40 - n.depth * 3))}</span>${warn.length ? ` <span class="mv-warn" title="${esc(warn.join("; "))}">⚠</span>` : ""}<span class="mv-lvl">${lvlName}</span>`;
    const sub = C && (n.lvl === "camp" || isGrp) ? C.sub : null;
    const spark = n.lvl === "camp" ? mvSpark(gvSeries(prim, last, "c", (c) => c === n.k)) : isGrp ? mvSpark(gvSeries(prim, last, "g", (g) => g === n.k)) : mvSpark(gvSeries(prim, last, "c", (c) => n.camps.has(c) && ok(c)));
    rows.push(`<tr class="mv-row${GV.dr && drKey === `${GV.dr.lvl}:${GV.dr.id}` ? " open-dr" : ""}" data-k="${esc(n.key)}" ${drKey ? `data-dr="${esc(drKey)}"` : ""} tabindex="0">
      <td class="text mv-ncell">${name}<div class="mv-tags">${gvTags(n, T.levels.slice(0, n.depth + 1))}</div></td>${cols.map((c) => cellOf(c, n.a, n.b, sub)).join("")}<td class="mv-tr">${spark}</td></tr>`);
    if (open && isGrp) rows.push(`<tr class="gv-panelrow"><td colspan="${cols.length + 2}">${gvPanel(n, pr)}</td></tr>`);
    if (open) for (const c of sorted(children)) emit(c);
  };
  for (const n of sorted(T.kids.get("") || [])) emit(n);
  const tot = gvZero(), totB = gvZero(); for (const n of T.kids.get("") || []) { gvMerge(tot, n.a); gvMerge(totB, n.b); }
  const sortBtn = (c, l) => `<button type="button" class="mv-sort" data-sort="${c}">${l}${GV.sort.col === c ? (GV.sort.dir < 0 ? " ▼" : " ▲") : ""}</button>`;
  const head = `<tr><th class="text" scope="col">${sortBtn("name", GV_GROUP_NAMES.find((x) => x[0] === GV.g)[1])}</th>${cols.map((c) => `<th scope="col">${sortBtn(c, esc(METRICS[c].short || METRICS[c].label))} ${mTip(c)}</th>`).join("")}<th scope="col">Trend <span class="sub">${esc(METRICS[prim].label)}, 14 days</span></th></tr>`;
  const total = `<tr class="total mv-total"><td class="text">Total <span class="sub">(filters in view)</span></td>${cols.map((c) => cellOf(c, tot, totB, null)).join("")}<td class="mv-tr">${mvSpark(gvSeries(prim, last, "c", ok))}</td></tr>`;
  const note = pr.early ? `<p class="legend-note">Ad group and asset group detail starts ${esc(dayLabel(ix.P.tree_from))}; campaign rows cover the whole period.</p>` : "";
  // Table mode: every campaign and ad group / asset group in view, one row each
  const all = [...T.nodes.values()].filter((n) => (n.lvl === "camp" || n.lvl === "grp") && n.a.cost >= min).sort((a, b) => b.a.cost - a.a.cost)
    .map((n) => ({ lvl: n.lvl === "camp" ? "Campaign" : ix.G[n.k].kind === "asg" ? "Asset group" : "Ad group", name: gvLabel(n.lvl, n.k), camp: n.lvl === "grp" ? ix.C[ix.G[n.k].camp].name : "", tags: [...n.camps].map((c) => `${ix.C[c].seg} · ${ix.C[c].type} · ${ix.P.skus[n.lvl === "grp" ? ix.G[n.k].sku : ix.C[c].sku].code}`)[0], n }));
  const spec = { cols: [["Level", (r) => r.lvl], ["Name", (r) => r.name], ["Campaign", (r) => r.camp], ["Tags", (r) => r.tags], ...cols.map((c) => [METRICS[c].label, (r) => gvVal(c, r.n.a), c])], rows: all };
  return { html: `<div class="table-wrap mv-xwrap"><table class="mv-x" id="gv-x"><thead>${head}</thead><tbody>${rows.join("") || `<tr><td class="text na" colspan="${cols.length + 2}">No campaigns above the minimum cost with these filters.</td></tr>`}${total}</tbody></table></div>${note}`, spec, tot };
}

// ---------------------------------------------------------------- level 3: tabs inside an ad group / asset group
const GV_TABS = { Search: [["kw", "Keywords"], ["terms", "Search terms"], ["ads", "Ads"]], PMax: [["prod", "Products"], ["assets", "Assets"], ["ins", "Search insights"]], "Demand Gen": [["ads", "Ads"], ["assets", "Assets"]], Video: [["ads", "Ads"]] };
function gvPanel(n, pr) {
  const ix = GV.ix, G = ix.G[n.k], C = ix.C[G.camp], tabs = GV_TABS[C.type] || [["ads", "Ads"]];
  const cur = GV.tabs[n.key] && tabs.some((t) => t[0] === GV.tabs[n.key]) ? GV.tabs[n.key] : tabs[0][0];
  const nav = `<div class="seg gv-ptabs" role="tablist">${tabs.map(([k, l]) => `<button type="button" role="tab" data-ptab="${esc(n.key)}" data-v="${k}" aria-pressed="${cur === k}">${l}</button>`).join("")}</div>`;
  const body = cur === "kw" ? gvKwTable(G, pr) : cur === "terms" ? gvTermTable(G, pr) : cur === "ads" ? gvAdTable(G, pr) : cur === "prod" ? gvProdTable(C, pr, G) : cur === "assets" ? gvAssetTable(G, pr) : gvInsTable(C, pr, G);
  return `<div class="gv-panel3">${nav}${body}</div>`;
}
const gvNotOn = (what) => `<p class="na">Data unavailable: ${esc(what)} is a pipeline addition that is not switched on yet (config google_ads.reports).</p>`;
const gvEff = () => (GV.scope === "aw" ? ["g_cost", "g_impr", "g_clicks", "g_ctr"] : ["g_cost", "g_value", "g_roas", "g_conv", "g_cpa", "g_clicks", "g_ctr", "g_cpc"]);
function gvMiniTable(cols, rows, o = {}) {
  const head = cols.map((c) => `<th class="${c.text ? "text" : ""}" scope="col">${c.head || esc(c.label)}</th>`).join("");
  const body = rows.map((r) => `<tr class="${r._cls || ""}" ${r._open ? `data-open="${esc(r._open)}" tabindex="0"` : ""}>${cols.map((c) => `<td class="${c.text ? "text" : ""}">${c.render(r)}</td>`).join("")}</tr>`).join("");
  return `<div class="table-wrap gv-mini" style="max-height:${o.maxHeight || "44vh"}"><table><thead><tr>${head}</tr></thead><tbody>${body || `<tr><td class="text na" colspan="${cols.length}">${esc(o.empty || "Nothing in these days.")}</td></tr>`}</tbody></table></div>`;
}
const gvMetricCols = (ids, dec) => ids.map((id) => ({ label: METRICS[id].short || METRICS[id].label, head: mHead(id, METRICS[id].short || METRICS[id].label), render: (r) => { const v = gvVal(id, r.s); return esc(dec && id === "g_conv" && v != null ? mFormat("decimal1", v) : gvF(id, v, true)); } }));
const gvBadge = (m) => `<span class="gv-badge" title="${esc((m || "").replace(/_/g, " ").toLowerCase())} match">${esc(GV_MATCH[m] || "?")}</span>`;
function gvQsCell(k) { return k.qs == null ? '<span class="na" title="No Quality Score yet (too little traffic)">—</span>' : `<b>${k.qs}</b>/10`; }
function gvKwTable(G, pr) {
  const ix = GV.ix, S = gvSearchIx();
  if (!(ix.P.on || {}).keywords) return gvNotOn("the keyword report");
  if (!S) return '<p class="empty">Loading keywords…</p>';
  const per = gvSum(null, pr.cur, (k) => S.K[k].grp === G.i, (k) => k, { rows: S.kr, by: S.kby });
  const rows = [...per.entries()].map(([k, s]) => ({ k: S.K[k], s, _open: `kw:${S.K[k].id}` })).sort((a, b) => b.s.cost - a.s.cost);
  return gvMiniTable([{ label: "Keyword", text: true, render: (r) => `${gvBadge(r.k.match)} <b>${esc(r.k.text)}</b> <span class="sub">${esc((r.k.status || "").toLowerCase())}</span>` }, { label: "QS", render: (r) => gvQsCell(r.k) }, ...gvMetricCols(["g_is", "g_lost_rank"]), ...gvMetricCols(gvEff(), true)], rows, { empty: "No keyword had impressions in these days." });
}
function gvTermTable(G, pr) {
  const ix = GV.ix, S = gvSearchIx(), rx = gvBrandRx(), C = ix.C[G.camp];
  if (!(ix.P.on || {}).search_terms) return gvNotOn("the search-term report");
  if (!S) return '<p class="empty">Loading search terms…</p>';
  const per = gvSum(null, pr.cur, (t) => S.T[t].grp === G.i, (t) => t, { rows: S.tr, by: S.tby });
  let rows = [...per.entries()].map(([t, s]) => ({ t: S.T[t], s, ti: t, _open: `term:${t}` })).sort((a, b) => b.s.cost - a.s.cost);
  const f = GV.tf;
  if (f === "waste") rows = rows.filter((r) => r.s.cost > 0 && !r.s.conv);
  if (f === "conv") rows = rows.filter((r) => r.s.conv > 0 && r.t.status !== "ADDED");
  if (f === "brand") rows = rows.filter((r) => rx && rx.test(r.t.term));
  const chips = `<div class="filter-row">${[["all", "All"], ["waste", "Wasted (cost, 0 conv)"], ["conv", "Converting but not a keyword"], ["brand", "Brand terms"]].map(([k, l]) => `<button type="button" class="chip${GV.tf === k ? " on" : ""}" data-tf="${k}">${l}</button>`).join("")}</div>`;
  // the gap: Google withholds low-volume terms, so terms never add up to the ad group
  const grp = gvSum("g", pr.cur.filter((d) => d >= ix.treeFrom), (g) => g === G.i), tt = gvZero(); for (const s of per.values()) gvMerge(tt, s);
  const gap = { t: { term: "Other / hidden terms", kwText: "", match: null, status: null }, s: (() => { const z = gvZero(); for (const f2 of ["cost", "impr", "clicks", "conv", "value"]) { z[f2] = Math.max(0, grp[f2] - tt[f2]); z.has[f2] = 1; } z.n = 1; return z; })(), _cls: "gv-gap" };
  const conv = C.pure ? gvEff() : gvEff().filter((x) => !["g_conv", "g_value", "g_roas", "g_cpa"].includes(x));
  return chips + gvMiniTable([{ label: "Search term", text: true, render: (r) => r._cls ? `<b>${esc(r.t.term)}</b> <span class="sub">Google withholds low-volume terms; this is the ad group total minus the terms shown, not missing data</span>` : `<b>${esc(r.t.term)}</b><br><span class="sub">${r.t.kwText ? `${gvBadge(r.t.match)} matched ${esc(r.t.kwText)}` : "no keyword"}</span>` }, { label: "Status", render: (r) => esc(r.t.status ? { ADDED: "Added", EXCLUDED: "Excluded", NONE: "None", ADDED_EXCLUDED: "Added & excluded" }[r.t.status] || r.t.status : "") }, ...gvMetricCols(conv, true)], f === "all" ? [...rows, gap] : rows, { empty: "No search term in these days with this filter." }) + (C.pure ? "" : '<p class="legend-note">This campaign counts other actions besides purchase, and search terms have no purchase split: their conversions are not shown.</p>');
}
function gvAdTable(G, pr) {
  const ix = GV.ix, per = gvSum("a", pr.cur, (a) => ix.A[a].grp === G.i, (a) => a);
  const rows = G.ads.map((a) => ({ a: ix.A[a], s: per.get(a) || gvZero(), _open: `ad:${ix.A[a].id}` })).filter((r) => r.s.n).sort((x, y) => y.s.cost - x.s.cost);
  const vid = ix.C[G.camp].type === "Video" || ix.C[G.camp].type === "Demand Gen";
  return gvMiniTable([{ label: "Ad", text: true, render: (r) => `<b title="${esc(r.a.name)}">${esc(mvMid(r.a.name, 44))}</b><br><span class="sub">${esc(r.a.type)}</span>` }, { label: "Ad strength", render: (r) => esc(r.a.strength ? r.a.strength.replace(/_/g, " ").toLowerCase() : "—") }, ...gvMetricCols(vid ? [...gvEff().slice(0, 5), "g_views", "g_view_rate"] : gvEff())], rows, { empty: "No ad had impressions in these days." });
}
async function gvNeed(page) { if (state.pages[page]) return; try { await loadPage(page); } catch (e) { state.pages[page] = { error: e.message }; } if (state.tab === "marketing") gvRedraw(); }
function gvProdTable(C, pr, G) {
  const ix = GV.ix;
  if (!(ix.P.on || {}).products) return gvNotOn("the Shopping product report");
  const PR = gvProdIx();
  if (!PR) { gvNeed("google_products"); return '<p class="empty">Loading products…</p>'; }
  const per = gvSum(null, pr.cur, (p) => PR.items[p].camp === C.i, (p) => p, PR);
  const rows = [...per.entries()].map(([p, s]) => ({ p: PR.items[p], s, _open: `prod:${PR.items[p].i}` })).sort((a, b) => b.s.cost - a.s.cost);
  return `${G && C.groups.length > 1 ? '<p class="legend-note">Google reports products per campaign, not per asset group: these are the whole campaign\'s.</p>' : ""}` + gvMiniTable([{ label: "Product", text: true, render: (r) => `<b>${esc(gvSkuLabel(r.p.sku))}</b><br><span class="sub" title="${esc(r.p.title)}">${esc(mvMid(r.p.item, 40))}</span>` }, ...gvMetricCols(["g_cost", "g_clicks", "g_conv", "g_value", "g_roas", "g_cpa"], true)], rows, { empty: "No product had impressions in these days." });
}
function gvAssetTable(G, pr, adIdx) {
  const ix = GV.ix;
  if (!(ix.P.on || {}).assets) return gvNotOn("the asset report");
  const AS = gvAssetIx();
  if (!AS) { gvNeed("google_assets"); return '<p class="empty">Loading assets…</p>'; }
  const mine = (x) => (adIdx != null ? AS.items[x].pk === "ad" && AS.items[x].parent === adIdx : G.kind === "asg" ? AS.items[x].pk === "asg" && AS.items[x].parent === G.i : AS.items[x].pk === "ad" && ix.A[AS.items[x].parent] && ix.A[AS.items[x].parent].grp === G.i);
  const days = pr.cur.filter((d) => ix.P.dates[d] >= (ix.P.assets_from || ""));
  const per = gvSum(null, days, mine, (x) => x, AS);
  const rows = [...per.entries()].map(([x, s]) => ({ x: AS.items[x], s })).sort((a, b) => (a.x.field || "").localeCompare(b.x.field || "") || b.s.impr - a.s.impr);
  const labels = rows.reduce((m, r) => { const l = r.x.label || "No label"; m[l] = (m[l] || 0) + 1; return m; }, {});
  return `<p class="legend-note">${Object.entries(labels).map(([l, c]) => `${esc(l.replace(/_/g, " ").toLowerCase())}: <b>${c}</b>`).join(" · ")}. Google gives no Best / Good / Low labels through the API today, so assets are ranked by impressions. An asset's numbers are those of the combinations it served in: they overlap and never add up to the ${G.kind === "asg" ? "asset group" : "ad"}.${days.length < pr.cur.length ? ` Asset data starts ${esc(dayLabel(ix.P.assets_from))}.` : ""}</p>` + gvMiniTable([{ label: "Asset", text: true, render: (r) => `<span class="gv-badge">${esc((r.x.field || r.x.type || "").replace(/_/g, " ").toLowerCase())}</span> ${esc(mvMid(r.x.text || r.x.id, 60))}` }, { label: "Label", render: (r) => esc(r.x.label ? r.x.label.replace(/_/g, " ").toLowerCase() : "—") }, ...gvMetricCols(["g_impr", "g_clicks", "g_ctr"])], rows, { empty: "No asset had impressions in these days." });
}
function gvInsTable(C, pr, G) {
  const id = `gv-ins-${C.i}`;
  setTimeout(async () => {
    const res = await gvAsk("insights", [C.i], pr.cur), el = document.getElementById(id);
    if (!el) return;
    const list = res && res.campaigns ? res.campaigns[C.id] || [] : null;
    if (!list) { el.innerHTML = `<p class="na">Data unavailable: ${esc((res && res.na) || "no answer")}</p>`; return; }
    const rx = gvBrandRx(), tv = list.reduce((t, r) => t + r[4], 0);
    const rows = list.map(([label, impr, clicks, conv, value]) => ({ label, impr, clicks, conv, value, brand: !!(rx && label && rx.test(label)) })).sort((a, b) => b.value - a.value || b.clicks - a.clicks);
    el.innerHTML = gvMiniTable([{ label: "Query category", text: true, render: (r) => `${r.label ? esc(r.label) : '<span class="sub">Other / unlabelled (Google groups low-volume queries here)</span>'}${r.brand ? ' <span class="mv-tag gv-amber">brand term</span>' : ""}` }, { label: "Impr.", render: (r) => esc(mFormat("count", r.impr)) }, { label: "Clicks", render: (r) => esc(mFormat("count", r.clicks)) }, { label: "Conv.", render: (r) => esc(mFormat("decimal1", r.conv)) }, { label: "Conv. value", render: (r) => esc(mFormat("currency", r.value)) }, { label: "Share of value", render: (r) => esc(tv ? mFormat("percent", r.value / tv) : "—") }], rows.slice(0, 60)) + `<p class="legend-note">Search insights cover the Search part of Performance Max only, as period totals per campaign (no cost, no daily detail).${G && C.groups.length > 1 ? " Per campaign, not per asset group." : ""}</p>`;
  }, 0);
  return `<div id="${id}"><p class="empty">Asking Google for search insights…</p></div>`;
}

// ---------------------------------------------------------------- drawer
/* Any entity: what to sum, its name, parent, campaign and the breadcrumb. */
function gvEnt(lvl, id) {
  const ix = GV.ix;
  const campOf = (ci) => ({ lvl: "camp", id: ix.C[ci].id, name: ix.C[ci].name });
  const grpOf = (gi) => ({ lvl: "grp", id: `${ix.G[gi].kind}~${ix.G[gi].id}`, name: ix.G[gi].name });
  if (lvl === "camp") { const ci = ix.C.findIndex((c) => c.id === id); if (ci < 0) return null; return { lvl, id, ci, name: ix.C[ci].name, kind: "c", ok: (c) => c === ci, crumbs: [], parent: null }; }
  if (lvl === "grp") { const [k, gid] = id.split("~"), gi = ix.G.findIndex((g) => g.kind === k && g.id === gid); if (gi < 0) return null; const ci = ix.G[gi].camp; return { lvl, id, gi, ci, name: ix.G[gi].name, kind: "g", ok: (g) => g === gi, crumbs: [campOf(ci)], parent: { kind: "c", ok: (c) => c === ci, name: "campaign" } }; }
  if (lvl === "ad") { const ai = ix.A.findIndex((a) => a.id === id); if (ai < 0) return null; const gi = ix.A[ai].grp, ci = ix.A[ai].camp; return { lvl, id, ai, gi, ci, name: ix.A[ai].name, kind: "a", ok: (a) => a === ai, crumbs: [campOf(ci), grpOf(gi)], parent: { kind: "g", ok: (g) => g === gi, name: "ad group" } }; }
  const S = gvSearchIx();
  if (lvl === "kw" && S) { const ki = S.K.findIndex((k) => k.id === id); if (ki < 0) return null; const gi = S.K[ki].grp, ci = ix.G[gi].camp; return { lvl, id, ki, gi, ci, name: `[${GV_MATCH[S.K[ki].match] || "?"}] ${S.K[ki].text}`, src: { rows: S.kr, by: S.kby }, ok: (k) => k === ki, crumbs: [campOf(ci), grpOf(gi)], parent: { kind: "g", ok: (g) => g === gi, name: "ad group" } }; }
  if (lvl === "term" && S) { const ti = +id; if (!S.T[ti]) return null; const gi = S.T[ti].grp, ci = ix.G[gi].camp, kw = S.T[ti].kw; return { lvl, id, ti, gi, ci, name: `'${S.T[ti].term}'`, src: { rows: S.tr, by: S.tby }, ok: (t) => t === ti, crumbs: [campOf(ci), grpOf(gi), ...(kw != null ? [{ lvl: "kw", id: S.K[kw].id, name: S.K[kw].text }] : [])], parent: { kind: "g", ok: (g) => g === gi, name: "ad group" } }; }
  const PR = gvProdIx();
  if (lvl === "prod" && PR) { const pi = +id; if (!PR.items[pi]) return null; const ci = PR.items[pi].camp; return { lvl, id, pi, ci, name: gvSkuLabel(PR.items[pi].sku), src: PR, ok: (p) => p === pi, crumbs: [campOf(ci)], parent: { kind: "c", ok: (c) => c === ci, name: "campaign" } }; }
  return null;
}
const gvSumE = (e, days) => gvSum(e.kind || null, days, e.ok, null, e.src);
function gvAdsUrl(e) {
  const ix = GV.ix, C = ix.C[e.ci], base = "https://ads.google.com/aw/";
  if (e.lvl === "camp") return `${base}adgroups?campaignId=${C.id}`;
  if (e.gi != null) { const G = ix.G[e.gi]; return G.kind === "asg" ? `${base}assetgroup?campaignId=${C.id}&assetGroupId=${G.id}` : `${base}${e.lvl === "kw" ? "keywords" : e.lvl === "term" ? "searchterms" : "ads"}?campaignId=${C.id}&adGroupId=${G.id}`; }
  return `${base}campaigns?campaignId=${C.id}`;
}
function gvDrawer(pr) {
  let el = document.getElementById("gv-drawer");
  if (!GV.dr) { if (el) el.remove(); document.body.classList.remove("mv-dr-open"); return; }
  if (GV.dr.lvl === "leak") return gvLeakDrawer(el);
  if ((GV.dr.lvl === "kw" || GV.dr.lvl === "term") && !gvSearchIx()) return;
  if (GV.dr.lvl === "prod" && !gvProdIx()) { gvNeed("google_products"); return; }
  const ix = GV.ix, e = gvEnt(GV.dr.lvl, GV.dr.id);
  if (!e) { GV.dr = null; gvToUrl(); if (el) el.remove(); return; }
  if (!el) { el = document.createElement("aside"); el.id = "gv-drawer"; el.className = "mv-drawer"; el.setAttribute("role", "dialog"); document.body.appendChild(el); }
  document.body.classList.add("mv-dr-open");
  const C = ix.C[e.ci], T = gvSumE(e, pr.cur), B = pr.prev.length ? gvSumE(e, pr.prev) : null;
  const crumb = [...e.crumbs.map((c) => `<button type="button" data-gdr="${esc(c.lvl)}:${esc(c.id)}">${esc(mvMid(c.name, 36))}</button>`), `<span>${esc(mvMid(e.name, 48))}</span>`].join(" › ");
  const tags = [C.type, C.seg, C.sub, ix.P.skus[e.gi != null ? ix.G[e.gi].sku : C.sku].code].map((t) => `<span class="mv-tag">${esc(t)}</span>`).join("");
  let meta = "";
  if (e.lvl === "camp") meta = `${gvDot(C.status, C.primary, C.limited)} ${esc(C.status ? (C.primary || C.status).replace(/_/g, " ").toLowerCase() : "status not read")} · ${C.budgetDay ? `budget ₹${inGroup.format(C.budgetDay)} a day` : C.budgetTotal ? `budget ₹${inGroup.format(C.budgetTotal)} for the flight` : "budget not read"} · ${esc(C.bidding ? C.bidding.replace(/_/g, " ").toLowerCase() : "bidding not read")}${C.troas ? ` (target ROAS ${mFormat("ratio", C.troas)})` : ""}`;
  else if (e.gi != null && e.lvl === "grp") { const G = ix.G[e.gi]; meta = `${gvDot(G.status, G.primary, false)} ${esc(G.status ? G.status.toLowerCase() : "status not read")}${G.strength ? ` · ad strength ${esc(G.strength.toLowerCase())}` : ""}`; }
  else if (e.lvl === "kw") { const k = gvSearchIx().K[e.ki]; meta = `${gvBadge(k.match)} ${esc((k.match || "").toLowerCase())} match · Quality Score ${gvQsCell(k)} · ${esc((k.status || "").toLowerCase())}`; }
  else if (e.lvl === "ad") { const a = ix.A[e.ai]; meta = `${esc(a.type)}${a.strength ? ` · ad strength ${esc(a.strength.replace(/_/g, " ").toLowerCase())}` : ""}${a.url ? ` · <a href="${esc(a.url)}" target="_blank" rel="noopener">landing page ↗</a>` : ""}`; }
  else if (e.lvl === "prod") { const p = gvProdIx().items[e.pi]; meta = `<span title="${esc(p.title)}">${esc(p.item)}</span>`; }
  const kp = GV_KPI[GV.scope].map((id) => {
    if (id === "g_reach") return kpiCard("g_reach", { value: null, na: "reach is shown for the whole view" });
    const { ch, small } = B ? gvChange(id, T, B, pr.cur.length, pr.prev.length) : {};
    const v = gvVal(id, T);
    return kpiCard(id, { value: v, prev: B ? gvVal(id, B) : null, change: ch, small, na: v == null ? gvNaWhy(id) : null });
  }).join("");
  const ids = Object.keys(METRICS).filter((x) => METRICS[x].gv && !(GV.scope === "aw" && GV_PERF_ONLY.has(x)) && (C.type === "Search" || !METRICS[x].gv.isn));
  const msel = (i) => `<select data-gdm="${i}" aria-label="Metric ${i + 1}">${i ? '<option value="">— none —</option>' : ""}${ids.map((x) => `<option value="${x}" ${GV.dm[i] === x ? "selected" : ""}>${esc(METRICS[x].label)}</option>`).join("")}</select>`;
  const seg = (attr, val, opts) => `<div class="seg" ${attr} role="group">${opts.map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${val === v}">${l}</button>`).join("")}</div>`;
  const ctl = `${msel(0)}${msel(1)}${seg("data-gdg", GV.dg, [["d", "Daily"], ["w", "Weekly"]])}${seg("data-gdrg", GV.drange, [["picked", "Picked dates"], ["14", "14d"], ["30", "30d"], ["90", "90d"]])}${seg("data-gdv", GV.dview, [["chart", "Chart"], ["table", "Table"]])}`;
  el.innerHTML = `<div class="mv-dhead"><div class="mv-crumb">${crumb}</div><button type="button" class="ask-iconbtn x" data-act="close-gdr" aria-label="Close">×</button></div>
    <div class="mv-dmeta">${meta} ${tags} <a href="${esc(gvAdsUrl(e))}" target="_blank" rel="noopener" class="sec-link" title="Opens Google Ads (pick the Asaya account if asked)">Open in Google Ads ↗</a></div>
    <div class="kpis six mv-dkpis">${kp}</div>
    <div class="mv-dctl">${ctl}</div>
    <div id="gv-dtrend">${GV.dview === "chart" ? '<div class="chart-box mv-dchart"><canvas id="c-gv-dr" aria-label="Trend"></canvas></div>' : ""}</div>
    <p class="legend-note" id="gv-dleg"></p>
    ${gvDrawerExtra(e, pr, T)}`;
  gvDrawChart(e, pr);
}
function gvDrawerExtra(e, pr, T) {
  const ix = GV.ix, C = ix.C[e.ci];
  if (e.lvl === "camp") {
    const per = gvSum("g", pr.cur, (g) => ix.G[g].camp === e.ci, (g) => g);
    const rows = [...per.entries()].map(([g, s]) => ({ g: ix.G[g], s })).sort((a, b) => b.s.cost - a.s.cost);
    const days = pr.cur.length, lb = gvVal("g_lost_budget", T);
    const util = C.budgetDay && days ? T.cost / days / C.budgetDay : null;
    return `<h3>Budget</h3><p>${util != null ? `Spent <b>${esc(mFormat("percent", util))}</b> of the daily budget on average (₹${inGroup.format(Math.round(T.cost / days))} a day of ₹${inGroup.format(C.budgetDay)}).` : "Budget utilisation needs the status report (budget)."} ${C.type === "Search" ? `Lost IS (budget): <b>${esc(gvF("g_lost_budget", lb))}</b>.` : ""}${C.limited ? " Google marks it <b>limited by budget</b>." : ""}</p>
      <h3>${C.type === "PMax" ? "Asset groups" : "Ad groups"} in this campaign</h3>${gvMiniTable([
        { label: C.type === "PMax" ? "Asset group" : "Ad group", text: true, render: (r) => `<button type="button" class="more-link" data-gdr="grp:${esc(r.g.kind)}~${esc(r.g.id)}" title="${esc(r.g.name)}">${esc(mvMid(r.g.name, 38))}</button>` },
        { label: "Cost", render: (r) => esc(mCompactInr(r.s.cost)) },
        { label: "Share of cost", render: (r) => esc(mFormat("percent", T.cost ? r.s.cost / T.cost : null) ?? "–") },
        ...(GV.scope === "aw" ? [] : [{ label: "Share of conv. value", render: (r) => { const sc = T.cost ? r.s.cost / T.cost : 0, sv = T.value ? r.s.value / T.value : null; return `<span class="${sv != null && sv < sc * 0.5 && sc > 0.1 ? "down" : ""}">${esc(mFormat("percent", sv) ?? "–")}</span>`; } }, { label: "Platform ROAS", render: (r) => esc(gvF("g_roas", gvVal("g_roas", r.s))) }]),
      ], rows, { empty: pr.early ? "Ad group detail starts " + dayLabel(ix.P.tree_from) + "." : "No ad group or asset group detail in these days." })}<p class="legend-note">A child taking a much bigger share of cost than of conv. value is shown in red.</p>`;
  }
  if (e.lvl === "grp") {
    const G = ix.G[e.gi];
    if (G.kind === "asg") return `<h3>Products (the campaign's)</h3>${gvProdTable(C, pr, G)}<h3>Assets</h3>${gvAssetTable(G, pr)}<h3>Search insight categories (the campaign's)</h3>${gvInsTable(C, pr, G)}`;
    return C.type === "Search" ? `<h3>Keywords</h3>${gvKwTable(G, pr)}<h3>Search terms</h3>${gvTermTable(G, pr)}` : `<h3>Ads</h3>${gvAdTable(G, pr)}`;
  }
  if (e.lvl === "kw") {
    const S = gvSearchIx(), k = S.K[e.ki], lab = (x) => (x ? x.replace(/_/g, " ").toLowerCase() : "—");
    const cls = (x) => (x === "BELOW_AVERAGE" ? "down" : x === "ABOVE_AVERAGE" ? "up" : "flat");
    const per = gvSum(null, pr.cur, (t) => S.T[t].kw === e.ki, (t) => t, { rows: S.tr, by: S.tby });
    const rows = [...per.entries()].map(([t, s]) => ({ t: S.T[t], s, ti: t })).sort((a, b) => b.s.cost - a.s.cost);
    return `<h3>Quality Score ${k.qs != null ? `${k.qs}/10` : ""}</h3><p class="sub">Today's values (Google keeps no Quality Score history).</p><ul class="notes">${[["Expected CTR", k.qsCtr], ["Ad relevance", k.qsRel], ["Landing page experience", k.qsLp]].map(([l, v]) => `<li>${l}: <b class="${cls(v)}">${esc(lab(v))}</b></li>`).join("")}</ul>
      <h3>Search terms it matched</h3>${gvMiniTable([{ label: "Search term", text: true, render: (r) => `<button type="button" class="more-link" data-gdr="term:${r.ti}"><b>${esc(r.t.term)}</b></button> ${gvCopyTags(r.t.term)}` }, ...gvMetricCols(["g_cost", "g_clicks", "g_conv", "g_value"], true)], rows, { empty: (ix.P.on || {}).search_terms ? "No search term in these days." : "Needs the search-term report (not switched on yet)." })}<p class="legend-note">The tags only copy the term (as [exact] or -negative) for you to paste into Google Ads: nothing is written to the account from here.</p>`;
  }
  if (e.lvl === "term") {
    const S = gvSearchIx(), t = S.T[e.ti], same = S.T.filter((x) => x.term === t.term && x.grp === t.grp && x.kw != null);
    return `<h3>Matched keyword${same.length > 1 ? "s" : ""}</h3><ul class="notes">${same.map((x) => `<li>${gvBadge(S.K[x.kw].match)} <button type="button" class="more-link" data-gdr="kw:${esc(S.K[x.kw].id)}">${esc(S.K[x.kw].text)}</button> <span class="sub">(${esc((x.match || "").replace(/_/g, " ").toLowerCase())} match)</span></li>`).join("") || "<li>No keyword recorded.</li>"}</ul><p>${gvCopyTags(t.term)}</p><p class="legend-note">The tags only copy the term; nothing is written to Google Ads from here.</p>`;
  }
  if (e.lvl === "ad") return `<h3>Assets</h3>${gvAssetTable(ix.G[e.gi], pr, e.ai)}`;
  return "";
}
const gvCopyTags = (term) => `<button type="button" class="chip gv-copy" data-copy="[${esc(term)}]" title="Copy as an exact-match keyword">Add as exact</button><button type="button" class="chip gv-copy" data-copy="-[${esc(term)}]" title="Copy as an exact negative keyword">Add as negative</button>`;
function gvLeakDrawer(el) {
  const L = GV.leak;
  if (!el) { el = document.createElement("aside"); el.id = "gv-drawer"; el.className = "mv-drawer"; el.setAttribute("role", "dialog"); document.body.appendChild(el); }
  document.body.classList.add("mv-dr-open");
  const rows = L && L.rows ? L.rows.filter((r) => r.brand).sort((a, b) => b.value - a.value) : [];
  const tv = L && L.rows ? L.rows.reduce((t, r) => t + r.value, 0) : 0, lab = L && L.rows ? L.rows.filter((r) => r.label).reduce((t, r) => t + r.value, 0) : 0, bv = rows.reduce((t, r) => t + r.value, 0);
  el.innerHTML = `<div class="mv-dhead"><div class="mv-crumb"><span>Brand leakage into non-brand</span></div><button type="button" class="ask-iconbtn x" data-act="close-gdr" aria-label="Close">×</button></div>
    <p>Brand-term share of non-brand conv. value: <b>${esc(mFormat("percent", tv ? bv / tv : null) ?? "—")}</b> of all query value; <b>${esc(mFormat("percent", lab ? bv / lab : null) ?? "—")}</b> of the value whose query category Google names (it groups low-volume queries under no label).</p>
    <p class="sub">Brand terms: ${esc((GV.ix.P.config.brand_terms || []).join(", "))}. ${esc(GV.ix.P.config.brand_terms_note || "")}</p>
    ${gvMiniTable([{ label: "Query", text: true, render: (r) => `<b>${esc(r.label)}</b><br><span class="sub">${esc(r.src)} · ${esc(mvMid((GV.ix.C.find((c) => c.id === r.camp) || {}).name || r.camp, 40))}</span>` }, { label: "Clicks", render: (r) => esc(mFormat("count", r.clicks)) }, { label: "Conv.", render: (r) => esc(mFormat("decimal1", r.conv)) }, { label: "Conv. value", render: (r) => esc(mFormat("currency", r.value)) }], rows, { maxHeight: "70vh", empty: L && L.na ? L.na : "No brand-term query in these days." })}`;
}
let gvChart = null;
function gvDrawChart(e, pr) {
  const ix = GV.ix, P = ix.P, C = ix.C[e.ci];
  const end = Math.max(...pr.cur);
  const days = GV.drange === "picked" ? pr.cur : Array.from({ length: +GV.drange }, (_, i) => end - +GV.drange + 1 + i).filter((d) => d >= 0);
  const cmpDays = GV.drange === "picked" ? pr.prev : days.map((d) => d - days.length).filter((d) => d >= 0);
  const bucket = (list) => {
    if (GV.dg === "d") return list.map((d) => ({ lab: dayLabel(P.dates[d]), days: [d], sale: RG.eng.phaseOf(P.dates[d]) === "sale" }));
    const out = new Map();
    for (const d of list) { const dt = new Date(P.dates[d] + "T00:00:00Z"), mon = new Date(dt - ((dt.getUTCDay() + 6) % 7) * 864e5).toISOString().slice(0, 10); const b = out.get(mon) || out.set(mon, { lab: "w/c " + dayLabel(mon), days: [], sale: false }).get(mon); b.days.push(d); if (RG.eng.phaseOf(P.dates[d]) === "sale") b.sale = true; }
    return [...out.values()];
  };
  const B1 = bucket(days), B2 = bucket(cmpDays), [m1, m2] = GV.dm;
  const series = (id, bs) => bs.map((b) => gvVal(id, gvSumE(e, b.days)));
  const s1 = series(m1, B1), s1b = B2.length ? series(m1, B2).slice(0, B1.length) : [], s2 = m2 ? series(m2, B1) : [];
  const parent = e.parent ? gvSum(e.parent.kind, days, e.parent.ok) : gvSum("c", days, (c) => gvCampOk(c));
  const pv = gvVal(m1, parent), pname = e.parent ? e.parent.name : "all campaigns in view", tg = gvTarget(m1, C.sub);
  GV.tables.drawer = { cols: [["Period", (r) => r.lab], [METRICS[m1].label, (r) => r.v1, m1], [METRICS[m1].label + " (comparison)", (r) => r.v1b, m1], ...(m2 ? [[METRICS[m2].label, (r) => r.v2, m2]] : [])], rows: B1.map((b, i) => ({ lab: b.lab, v1: s1[i], v1b: s1b[i] ?? null, v2: s2[i] ?? null })) };
  const leg = document.getElementById("gv-dleg");
  if (GV.dview === "table") {
    const host = document.getElementById("gv-dtrend");
    if (host) host.innerHTML = gvFlat(GV.tables.drawer, "drawer") + '<button type="button" class="more-link gv-csv" data-csv="drawer">CSV ↓</button>';
    if (leg) leg.textContent = `${GV.dg === "d" ? "Daily" : "Weekly"}; the comparison lined up period by period.`;
    return;
  }
  const el = document.getElementById("c-gv-dr");
  if (!el) return;
  if (!window.Chart) { el.parentElement.innerHTML = '<p class="na">Charts could not load.</p>'; return; }
  const ds = [{ label: METRICS[m1].label, data: s1, borderColor: css("--accent"), backgroundColor: css("--accent"), borderWidth: 2.5, pointRadius: 0, tension: 0.25, yAxisID: "y" }];
  if (B2.length) ds.push({ label: METRICS[m1].label + " (comparison)", data: s1b, borderColor: css("--accent"), borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0, tension: 0.25, yAxisID: "y" });
  if (pv != null) ds.push({ label: `${pname} (${gvF(m1, pv, true)})`, data: B1.map(() => pv), borderColor: css("--muted"), borderDash: [2, 3], borderWidth: 1, pointRadius: 0, yAxisID: "y" });
  if (tg) ds.push({ label: `target (${gvF(m1, tg, true)})`, data: B1.map(() => tg), borderColor: css("--good"), borderDash: [8, 4], borderWidth: 1.2, pointRadius: 0, yAxisID: "y" });
  if (m2) ds.push({ label: METRICS[m2].label, data: s2, borderColor: css("--series-1"), backgroundColor: css("--series-1"), borderWidth: 2, pointRadius: 0, tension: 0.25, yAxisID: "y2" });
  const sale = B1.map((b) => b.sale);
  const shade = { id: "saleShade", beforeDatasetsDraw(ch) { const { ctx: c, chartArea: a, scales: { x } } = ch; c.save(); c.fillStyle = css("--warn-bg"); sale.forEach((s, i) => { if (!s) return; const w = (a.right - a.left) / Math.max(1, sale.length); c.fillRect(x.getPixelForValue(i) - w / 2, a.top, w, a.bottom - a.top); }); c.restore(); } };
  if (gvChart) { try { gvChart.destroy(); } catch (err) { /* gone */ } }
  const unitOf = (id) => ({ currency: "inr", currency2: "inr", count: "int", percent: "pct", ratio: "x", decimal: "x" }[METRICS[id].format] || "int");
  const y = axisOpts(unitOf(m1)), y2 = { ...axisOpts(m2 ? unitOf(m2) : "int"), position: "right", grid: { display: false } };
  gvChart = new Chart(el, { type: "line", data: { labels: B1.map((b) => b.lab), datasets: ds }, plugins: [shade],
    options: { responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: "index", intersect: false },
      plugins: { legend: { display: true, position: "bottom", labels: { boxWidth: 10, font: { size: 11 }, color: css("--ink-2") } },
        tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${gvF(c.dataset.yAxisID === "y2" ? m2 : m1, c.parsed.y, true)}` } } },
      scales: { x: { ticks: { color: css("--muted"), maxRotation: 0, autoSkipPadding: 12, font: { size: 11 } }, grid: { display: false } }, y, ...(m2 ? { y2 } : {}) } } });
  if (leg) leg.textContent = `${GV.dg === "d" ? "Daily" : "Weekly"} · shaded: sale days · dashed: the comparison period, lined up day by day · dotted: the ${pname} over the same days${tg ? " · green dashes: the target" : ""}.`;
}

// ---------------------------------------------------------------- the tab
function gvDraw() {
  const host = document.getElementById("gv-body");
  if (!host) return;
  const P = state.pages.google_ads;
  if (!P || !P.crows) { host.innerHTML = '<section class="card"><p class="na">Data unavailable: the Google view is built with the next refresh.</p></section>'; return; }
  gvIndex(P);
  GV.tables = {};
  const pr = gvPeriod();
  if (!pr || !pr.cur.length) { host.innerHTML = gvFilterBar(P) + `<section class="card"><p class="na">Data unavailable: Google data covers ${esc(rgSpan(P.dates[0], P.dates[P.dates.length - 1]))}; pick dates inside it.</p></section>`; gvBind(); return; }
  const ok = gvCampOk, okx = (c) => gvCampOk(c) && gvXOk(c);
  const T = gvSum("c", pr.cur, ok), B = pr.prev.length ? gvSum("c", pr.prev, ok) : null;
  const K = gvKpis(T, B, pr, ok), X = gvExplorer(pr, okx), M = GV.scope === "perf" ? gvMatrix(pr, ok) : null, Wk = gvWorking(pr, ok), Wt = gvWatch(pr, ok);
  const SP = GV.scope === "perf" && GV.seg === "all" ? gvSplit(pr, ok) : null;
  const chips = [GV.xf.sku ? `<button type="button" class="chip" data-xclear="sku">Product: ${esc(GV.xf.sku)} ✕</button>` : "", GV.xf.st ? `<button type="button" class="chip" data-xclear="st">Type: ${esc(GV.xf.st)} ✕</button>` : ""].join("");
  const presets = `<div class="seg" id="gv-cols" role="group" aria-label="Columns">${GV_PRESET_NAMES.map(([k, l]) => `<button type="button" data-v="${k}" aria-pressed="${GV.cols === k}">${l}</button>`).join("")}</div>`;
  const groupSel = `<select id="gv-g" aria-label="Group by">${GV_GROUP_NAMES.map(([k, l]) => `<option value="${k}" ${GV.g === k ? "selected" : ""}>${l}</option>`).join("")}</select>`;
  const custom = GV.cols === "custom" ? `<details class="mv-picker"><summary>Pick columns (${GV.custom.length}/8)</summary><div>${Object.keys(METRICS).filter((x) => METRICS[x].gv && !(GV.scope === "aw" && GV_PERF_ONLY.has(x))).map((x) => `<label><input type="checkbox" data-gcc="${x}" ${GV.custom.includes(x) ? "checked" : ""}> ${esc(METRICS[x].label)}</label>`).join("")}</div></details>` : "";
  const missing = pr.missing.length ? `<p class="legend-note">Google data is not available for ${esc(rgListDays(pr.missing))}; those days are left out.</p>` : "";
  const un = Object.values(P.unavailable || {});
  const anyClosed = !GV.expAll;
  const xctl = `<button type="button" class="rg-btn" data-expall="${anyClosed ? "1" : "0"}">${anyClosed ? "Expand all" : "Collapse all"}</button>${groupSel}${presets}<label class="mv-cv"><input type="checkbox" id="gv-cv" ${GV.cmpv ? "checked" : ""}> Show comparison values</label>`;
  host.innerHTML = gvFilterBar(P) + `
    ${gvSecT("kpis", GV.scope === "aw" ? "Awareness" : "Performance", "the campaigns in view; per-day comparison against the matched period", K.html + missing + (un.length ? `<p class="legend-note">${un.map(esc).join(" · ")}</p>` : ""), K.spec, { comp: "google-kpis" })}
    ${SP ? gvSecT("split", "Brand vs Non-brand", "blended Google ROAS hides the split: what brand demand and non-brand prospecting each return", SP.html, SP.spec, { comp: "google-split" }) : ""}
    <div class="cols-2 mv-top">
      ${gvSecT("working", "What's working", "Scale · Fix · Cut, from the rules in config; click any item", Wk.html, Wk.spec, { comp: "google-working" })}
      ${gvSecT("watch", "Watchlist", "rule-based flags, the eight with the most cost", Wt.html, Wt.spec, { comp: "google-watchlist" })}
    </div>
    ${M ? gvSecT("matrix", "Product × Campaign type", "each product in each campaign type; P = product feed, N = name", M.html, M.spec, { ctl: M.sw, comp: "google-matrix" }) : ""}
    ${gvSecT("explorer", "Explorer", "drill down: campaign › ad group / asset group › keywords, search terms, ads, products, assets; click a row for its detail", (chips ? `<div class="filter-row">${chips}</div>` : "") + custom + `<div id="gv-xh">${X.html}</div>`, X.spec, { ctl: xctl, comp: "google-explorer", id: "gv-explorer" })}
    <p class="legend-note mv-foot">${esc(P.attribution_note)}. Ratios are worked out from summed numbers at every level, never averaged. Comparisons are per day against the phase-matched period.</p>`;
  gvBind();
  if (GV.scope === "aw") gvKpiReach(pr, ok);
  if (SP) gvLeakage(pr, ok);
  gvDrawer(pr);
}
function gvRedraw() { gvToUrl(); destroyCharts(); gvDraw(); }
function gvBind() {
  const host = document.getElementById("gv-body");
  if (!host || host.dataset.bound) return;
  host.dataset.bound = "1";
  host.addEventListener("click", (ev) => {
    const t = ev.target;
    const f = t.closest(".seg[data-f] button[data-v]");
    if (f) { const k = f.closest(".seg").dataset.f; GV[k] = f.dataset.v; if (k === "scope") { GV.dm = GV.scope === "aw" ? ["g_cost", "g_cpm"] : ["g_roas", "g_cost"]; GV.dr = null; GV.types = GV.types.filter((x) => GV_TYPES[GV.scope].includes(x)); } return gvRedraw(); }
    const ty = t.closest("[data-ty]"); if (ty) { const v = ty.dataset.ty; GV.types = GV.types.includes(v) ? GV.types.filter((x) => x !== v) : [...GV.types, v]; return gvRedraw(); }
    if (t.closest('[data-act="sku-clear"]')) { GV.skus = []; return gvRedraw(); }
    const vt = t.closest("[data-vt]"); if (vt) { if (vt.dataset.v === "t") GV.vt.add(vt.dataset.vt); else GV.vt.delete(vt.dataset.vt); return gvRedraw(); }
    const csv = t.closest("[data-csv]"); if (csv) return gvCsv(csv.dataset.csv);
    const fs = t.closest("[data-fsort]"); if (fs) { const [id, j] = fs.dataset.fsort.split(":"), cur = GV.fsort[id]; GV.fsort[id] = cur && cur[0] === +j ? [+j, -cur[1]] : [+j, -1]; return gvRedraw(); }
    const mx = t.closest("#gv-mx button[data-m]"); if (mx) { GV.mx = mx.dataset.m; return gvRedraw(); }
    const xf = t.closest("[data-xf]"); if (xf) { const [sku, st] = xf.dataset.xf.split("|"); GV.xf = { sku: sku || null, st: st || null }; gvRedraw(); document.getElementById("gv-explorer")?.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
    const xc = t.closest("[data-xclear]"); if (xc) { GV.xf[xc.dataset.xclear] = null; return gvRedraw(); }
    const pc = t.closest("#gv-cols button[data-v]"); if (pc) { GV.cols = pc.dataset.v; return gvRedraw(); }
    const so = t.closest("[data-sort]"); if (so) { const c = so.dataset.sort; GV.sort = GV.sort.col === c ? { col: c, dir: -GV.sort.dir } : { col: c, dir: -1 }; return gvRedraw(); }
    const tg = t.closest("[data-tog]"); if (tg) { gvToggle(tg.dataset.tog); return gvRedraw(); }
    const ea = t.closest("[data-expall]"); if (ea) { GV.expAll = ea.dataset.expall === "1"; GV.exp = new Set(); return gvRedraw(); }
    const ptab = t.closest("[data-ptab]"); if (ptab) { GV.tabs[ptab.dataset.ptab] = ptab.dataset.v; return gvRedraw(); }
    const tf = t.closest("[data-tf]"); if (tf) { GV.tf = tf.dataset.tf; return gvRedraw(); }
    if (t.closest('[data-act="more"]')) { GV.more = !GV.more; return gvRedraw(); }
    const cp = t.closest("[data-copy]"); if (cp) return gvCopy(cp);
    const op = t.closest("[data-open]"); if (op) { const v = op.dataset.open; GV.dr = { lvl: v.split(":")[0], id: v.split(":").slice(1).join(":") }; return gvRedraw(); }
    const row = t.closest("tr.mv-row[data-dr]");
    if (row && !t.closest("a,button,input,select")) { const v = row.dataset.dr; GV.dr = { lvl: v.split(":")[0], id: v.split(":").slice(1).join(":") }; return gvRedraw(); }
  });
  host.addEventListener("change", (ev) => {
    const t = ev.target;
    if (t.id === "gv-g") { GV.g = t.value; GV.exp = new Set(); GV.expAll = true; return gvRedraw(); }
    if (t.id === "gv-cv") { GV.cmpv = t.checked; return gvRedraw(); }
    if (t.id === "gv-min") { GV.min = Math.max(0, +t.value || 0); return gvRedraw(); }
    if (t.dataset.sku) { const v = t.dataset.sku; GV.skus = t.checked ? [...new Set([...GV.skus, v])] : GV.skus.filter((x) => x !== v); return gvRedraw(); }
    if (t.dataset.gcc) { const x = t.dataset.gcc; GV.custom = t.checked ? [...new Set([...GV.custom, x])].slice(0, 8) : GV.custom.filter((y) => y !== x); return gvRedraw(); }
  });
  let qt = null;
  host.addEventListener("input", (ev) => { if (ev.target.id === "gv-q") { clearTimeout(qt); qt = setTimeout(() => { GV.q = ev.target.value.trim(); gvRedraw(); const q = document.getElementById("gv-q"); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }, 300); } });
  host.addEventListener("keydown", (ev) => {
    const row = ev.target.closest && ev.target.closest("tr.mv-row, tr[data-open]");
    if (!row) return;
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") { ev.preventDefault(); const sib = ev.key === "ArrowDown" ? row.nextElementSibling : row.previousElementSibling; if (sib && sib.tabIndex >= 0) sib.focus(); }
    else if (ev.key === "Enter" && row.dataset.k) { ev.preventDefault(); const k = row.dataset.k; gvToggle(k); gvRedraw(); document.querySelector(`#gv-x tr.mv-row[data-k="${CSS.escape(k)}"]`)?.focus(); }
    else if (ev.key === " " || (ev.key === "Enter" && row.dataset.open)) { ev.preventDefault(); const v = row.dataset.dr || row.dataset.open; if (v) { GV.dr = { lvl: v.split(":")[0], id: v.split(":").slice(1).join(":") }; gvRedraw(); } }
  });
}
async function gvCopy(btn) {
  const text = btn.dataset.copy;
  try { await navigator.clipboard.writeText(text); } catch (e) { const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); } catch (e2) { /* nothing */ } ta.remove(); }
  const old = btn.textContent; btn.textContent = "Copied"; setTimeout(() => { btn.textContent = old; }, 1200);
}
// the drawer lives outside the tab body
document.addEventListener("click", (ev) => {
  const d = ev.target.closest && ev.target.closest("#gv-drawer");
  if (!d) return;
  if (ev.target.closest("[data-act='close-gdr']")) { GV.dr = null; return gvRedraw(); }
  const j = ev.target.closest("[data-gdr]"); if (j) { const v = j.dataset.gdr; GV.dr = { lvl: v.split(":")[0], id: v.split(":").slice(1).join(":") }; return gvRedraw(); }
  const r = ev.target.closest("[data-gdrg] button[data-v]"); if (r) { GV.drange = r.dataset.v; return gvRedraw(); }
  const g = ev.target.closest("[data-gdg] button[data-v]"); if (g) { GV.dg = g.dataset.v; return gvRedraw(); }
  const v = ev.target.closest("[data-gdv] button[data-v]"); if (v) { GV.dview = v.dataset.v; return gvRedraw(); }
  const cp = ev.target.closest("[data-copy]"); if (cp) return gvCopy(cp);
  const csv = ev.target.closest("[data-csv]"); if (csv) return gvCsv(csv.dataset.csv);
  const fs = ev.target.closest("[data-fsort]"); if (fs) { const [id, j] = fs.dataset.fsort.split(":"), cur = GV.fsort[id]; GV.fsort[id] = cur && cur[0] === +j ? [+j, -cur[1]] : [+j, -1]; return gvRedraw(); }
  const op = ev.target.closest("tr[data-open]"); if (op && !ev.target.closest("button,a")) { const x = op.dataset.open; GV.dr = { lvl: x.split(":")[0], id: x.split(":").slice(1).join(":") }; return gvRedraw(); }
  const tf = ev.target.closest("[data-tf]"); if (tf) { GV.tf = tf.dataset.tf; return gvRedraw(); }
});
document.addEventListener("change", (ev) => {
  const s = ev.target.closest && ev.target.closest("#gv-drawer select[data-gdm]");
  if (!s) return;
  const i = +s.dataset.gdm; GV.dm[i] = s.value; GV.dm = GV.dm.filter(Boolean).slice(0, 2); if (!GV.dm.length) GV.dm = ["g_cost"];
  gvRedraw();
});
document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && GV.dr && document.getElementById("gv-drawer")) { GV.dr = null; gvRedraw(); } });
/* Entry point from Marketing › Google. The keyword and search-term page is
   small and feeds Cut and the watchlist, so it loads with the view; products
   and assets load when a tab needs them. */
async function gvRender(host) {
  gvFromUrl();
  host.innerHTML = '<div id="gv-body"><p class="empty">Loading the Google view…</p></div>';
  try {
    await loadPage("google_ads");
    const on = (state.pages.google_ads && state.pages.google_ads.on) || {};
    if (on.keywords || on.search_terms) { try { await loadPage("google_search"); } catch (e) { /* the view still draws; Cut says why */ } }
  } catch (e) { document.getElementById("gv-body").innerHTML = `<section class="card"><p class="na">Data unavailable: ${esc(e.message)}</p></section>`; return; }
  if (state.tab !== "marketing") return;
  gvDraw();
}

/* Data health › Google classification: tag coverage of cost, names to fix,
   the purchase-only split, the validation rules, the report switches, and
   the tie-out to the Google cost and Performance / Awareness split every tab
   uses (Marketing › Channels). */
function gvHealth(P, D) {
  if (!P || !P.crows) return '<p class="na">Data unavailable: the Google view is built with the next refresh.</p>';
  const ix = gvIndex(P), last = P.dates.length - 1, days = Array.from({ length: Math.min(30, P.dates.length) }, (_, i) => last - i).reverse();
  const per = gvSum("c", days, () => true, (c) => c), tot = [...per.values()].reduce((t, s) => t + s.cost, 0);
  const pc = (v) => mFormat("percent", tot ? v / tot : null);
  const costWhere = (f) => [...per.entries()].filter(([c]) => f(ix.C[c])).reduce((t, [, s]) => t + s.cost, 0);
  const tagged = costWhere((c) => c.sub !== "Other" && c.type !== "Other"), other = [...per.entries()].filter(([c, s]) => s.cost > 0 && (ix.C[c].sub === "Other"));
  const skuOther = [...per.entries()].filter(([c, s]) => s.cost > 0 && ix.C[c].scope === "Performance" && ix.P.skus[ix.C[c].sku].kind === "other" && !ix.C[c].groups.some((g) => ix.P.skus[ix.G[g].sku].kind !== "other"));
  const cover = `<p>Over the last ${days.length} days <b>${pc(tagged)}</b> of Google cost carries a segment and a campaign type (${["Brand", "Non-brand"].map((k) => `${k} <b>${pc(costWhere((c) => c.seg === k))}</b>`).join(" · ")}; ${GV_SUBS.concat(["YouTube"]).map((k) => `${esc(k)} <b>${pc(costWhere((c) => c.sub === k))}</b>`).join(" · ")}). Scope: Performance <b>${pc(costWhere((c) => c.scope === "Performance"))}</b> · Awareness <b>${pc(costWhere((c) => c.scope === "Awareness"))}</b>.</p>`;
  const list = (rows, why) => rows.length ? gvMiniTable([{ label: "Campaign", text: true, render: (r) => esc(mvMid(r.name, 60)) }, { label: "Cost", render: (r) => esc(mCompactInr(r.cost)) }], rows.sort((a, b) => b.cost - a.cost).slice(0, 25), {}) + `<p class="legend-note">${esc(why)}</p>` : '<p class="sub">None.</p>';
  // purchase only
  const oc = [...per.entries()].filter(([, s]) => s.oconv > 0);
  const purchase = P.purchase_only ? `<p>Conversions and conv. value count the <b>purchase action only</b> (${esc((P.conv_levels || []).join(", "))}). Other actions recorded in Google's Conversions column, kept apart: ${oc.length ? oc.map(([c, s]) => `${esc(mvMid(ix.C[c].name, 48))} <b>${esc(mFormat("decimal1", s.oconv))}</b>`).join("; ") : "none"}.</p>` : '<p class="na">The purchase split (conv_split) is not read yet: Conversions show Google\'s Conversions column as is, which can include an awareness campaign\'s add-to-cart.</p>';
  // validation
  const V = P.config.validation, tdays = days.filter((d) => d >= ix.treeFrom);
  let mism = 0, over = 0;
  for (const C of ix.C) { if (!C.groups.length) continue; const gs = new Set(C.groups), a = gvSum("c", tdays, (c) => c === C.i).cost, b = gvSum("g", tdays, (g) => gs.has(g)).cost; if (Math.abs(a - b) > Math.max(100, a * 0.01)) mism++; }
  for (const [, s] of gvSum("g", days, () => true, (g) => g)) if (s.clicks >= 20 && s.conv > s.clicks * V.conv_per_click) over++;
  const valid = `<ul class="notes"><li>Ad groups and asset groups add up to their campaign's cost: <b>${mism ? mism + " campaign" + (mism === 1 ? "" : "s") + " differ" : "every campaign ties"}</b> (search terms are exempt: Google withholds low-volume terms).</li><li>Conversions above clicks × ${V.conv_per_click} at ad group level: <b>${over}</b> (a warning: view-through and cross-device conversions can do this).</li><li>Campaigns with cost but no segment or type: <b>${other.length}</b>.</li></ul>`;
  // tie-out against the cost every other tab uses
  let tie = "";
  if (D && D.values) {
    const di = new Map(D.dates.map((d, i) => [d, i])); let worst = 0, n = 0, worstSplit = 0;
    for (const d of days) {
      const i = di.get(P.dates[d]); if (i == null) continue;
      const theirs = D.values.google_spend ? D.values.google_spend[i] : null; if (theirs == null) continue;
      const mine = gvSum("c", [d], (c) => ix.C[c].scope !== "Excluded").cost; n++; worst = Math.max(worst, Math.abs(mine - theirs));
      const tp = D.values.google_perf_spend ? D.values.google_perf_spend[i] : null;
      if (tp != null) worstSplit = Math.max(worstSplit, Math.abs(gvSum("c", [d], (c) => ix.C[c].scope === "Performance").cost - tp));
    }
    const good = worst < 1 && worstSplit < 1;
    tie = `<div class="ck"><span class="spill ${good ? "ok" : "late"}"><i></i>${good ? "Google cost ties to Marketing › Channels" : "Google cost differs from Marketing › Channels"}</span><span class="why">${n} days compared; largest daily difference ${esc(mFormat("currency", worst))} in total, ${esc(mFormat("currency", worstSplit))} in Performance cost. The Brand Search / Brand PMax / Non-brand PMax / Demand Gen split is the Marketing tree's own rule (taxonomy.google_groups).</span></div>`;
  }
  const on = P.on || {};
  const flags = `<p class="sub">Reports (config google_ads.reports): ${["conv_split", "impression_share", "objects", "keywords", "search_terms", "products", "assets", "video"].map((k) => `${k.replace(/_/g, " ")} <b>${on[k] ? "on" : "off"}</b>`).join(" · ")}.${Object.values(P.unavailable || {}).length ? " Last run: " + Object.values(P.unavailable).map(esc).join("; ") : ""}</p>`;
  return `${tie}${cover}${purchase}<h3>Validation</h3>${valid}${flags}
    <details class="steps"><summary>Type: ${other.length} campaign${other.length === 1 ? "" : "s"} with cost and no segment or type</summary>${list(other.map(([c, s]) => ({ name: ix.C[c].name, cost: s.cost })), "Add a rule to config.json taxonomy.google_groups, or fix the name.")}</details>
    <details class="steps"><summary>Product: ${skuOther.length} Performance campaign${skuOther.length === 1 ? "" : "s"} Other (no product code in the campaign or ad group name)</summary>${list(skuOther.map(([c, s]) => ({ name: ix.C[c].name, cost: s.cost })), "Add the code to config.json meta_view.sku_codes, or fix the name. Brand campaigns are Brand (all products), not Other.")}</details>`;
}
