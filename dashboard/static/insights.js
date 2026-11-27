/* Trends and insights for the range tabs (Overview, Funnel, Marketing).
   Inlined into app.html inside the dashboard closure. Every insight is a rule
   on the numbers already on the page, never written by a model, and each one
   says what moved, why the data says it moved and what to look at next.

   The maths is on the engine's own basis: counts as per-day averages (so
   unequal periods compare fairly), rates as they are. Comparisons inherit the
   engine's phase matching (sale with sale, BAU with BAU); an insight is
   skipped when its comparison base is too small to mean anything. */

/* why each tab exists: one line above its insights */
const TAB_WHY = {
  overview: "Is the business on track today, and what is driving it? Sales = traffic × conversion × basket size, so every movement below is traced to one of those three, and to what it cost.",
  funnel: "Where are we losing buyers? Each step from visit to order is a different fix: landing page and offer (add to cart), cart and shipping (checkout start), checkout and payment (order).",
  marketing: "Is spend buying sales at a return worth scaling? Blended ROAS uses Shopify's sales, so it is the store-level truth; platform ROAS is what each platform claims for itself.",
};

const insPct = (x) => (x == null || !Number.isFinite(x) ? "n/a" : `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(1)}%`);
const insInr = (x) => (x == null ? "n/a" : (x < 0 ? "−" : "+") + mCompactInr(Math.abs(x)).replace(/^−/, ""));
const insPerDay = (w, k) => (w && w[k] != null ? w[k] / Math.max(w.days, 1) : null);
const insRate = (c, p) => (c != null && p ? c / p - 1 : null);
function insList(items, why) {
  const li = items.filter(Boolean).map((x) => `<li class="ins-${x.tone || "info"}"><span class="ins-tag">${esc(x.tag)}</span><span>${x.html}</span></li>`).join("");
  return `${why ? `<p class="ins-why">${esc(why)}</p>` : ""}${li ? `<ul class="ins">${li}</ul>` : '<p class="na">Nothing moved enough against the comparison to call out.</p>'}`;
}
const insN = (x) => (Math.abs(x) < 10 ? x.toFixed(1) : String(Math.round(x)));
const insSmall = (g) => !g.pw || (g.pw.orders != null && g.pw.orders < METRIC_RULES.min_orders);

/* Sales = sessions × CVR × AOV, so the change in sales a day splits exactly
   into the three (log shares): which lever moved the top line. */
function insSalesBridge(g) {
  const w = g.w, p = g.pw;
  const s1 = insPerDay(w, "sessions"), s0 = insPerDay(p, "sessions"), c1 = w.cvr, c0 = p.cvr, a1 = w.aov, a0 = p.aov;
  const g1 = insPerDay(w, "gmv"), g0 = insPerDay(p, "gmv");
  if (![s1, s0, c1, c0, a1, a0, g1, g0].every((x) => x != null && x > 0)) return null;
  const lt = Math.log(g1 / g0);
  if (Math.abs(lt) < 0.005) return null;
  const parts = [["traffic (sessions)", Math.log(s1 / s0)], ["conversion (CVR)", Math.log(c1 / c0)], ["basket size (AOV)", Math.log(a1 / a0)]]
    .map(([l, x]) => ({ l, x, inr: (g1 - g0) * (x / lt) }));
  const main = [...parts].sort((x, y) => Math.abs(y.inr) - Math.abs(x.inr))[0];
  const against = parts.filter((x) => Math.sign(x.inr) !== Math.sign(g1 - g0) && Math.abs(x.inr) > Math.abs(g1 - g0) * 0.2);
  const next = main.l.startsWith("traffic") ? "Check whether the extra visits are paid (Perf sessions) or organic, and whether they converted as well as before."
    : main.l.startsWith("conversion") ? "Open the Funnel tab: the step whose rate moved most is where to look."
    : "Check offers and bundles: AOV moves with discount depth and pack mix.";
  return { tag: "Sales bridge", tone: g1 >= g0 ? "good" : "bad",
    html: `Total sales ${esc(mCompactInr(g1))} a day against ${esc(mCompactInr(g0))} (${insPct(g1 / g0 - 1)}). By lever: ${parts.map((x) => `${esc(x.l)} <b>${esc(insInr(x.inr))}</b>`).join(", ")} a day. <b>${esc(main.l[0].toUpperCase() + main.l.slice(1))}</b> drove most of it${against.length ? `; ${against.map((x) => esc(x.l)).join(" and ")} pulled the other way` : ""}. ${esc(next)}` };
}
/* ROAS: did sales keep pace with spend? The marginal return on the extra
   spend is the number that decides whether to keep scaling. */
function insRoas(g) {
  const w = g.w, p = g.pw;
  const s1 = insPerDay(w, "perf_all_spend"), s0 = insPerDay(p, "perf_all_spend"), r1 = insPerDay(w, "store_gmv"), r0 = insPerDay(p, "store_gmv");
  if (![s1, s0, r1, r0].every((x) => x != null && x > 0) || w.roas == null || p.roas == null) return null;
  const ds = s1 - s0, dr = r1 - r0, sp = s1 / s0 - 1, rp = r1 / r0 - 1;
  let html = `Blended ROAS ${esc(mFormat("ratio", w.roas))} against ${esc(mFormat("ratio", p.roas))}: spend ${insPct(sp)} a day, sales ${insPct(rp)} a day.`;
  let tone = w.roas >= p.roas ? "good" : "bad";
  if (Math.abs(ds) >= Math.max(1000, s0 * 0.05)) {
    const m = dr / ds;
    if (ds > 0) html += m >= w.roas ? ` The extra ${esc(mCompactInr(ds))} a day of spend returned ${esc(mFormat("ratio", m))} at the margin, better than the average: room to keep scaling.`
      : m > 0 ? ` The extra ${esc(mCompactInr(ds))} a day of spend returned only ${esc(mFormat("ratio", m))} at the margin, below the ${esc(mFormat("ratio", w.roas))} average: returns are diminishing, so scale only the campaigns above it.`
      : ` Spend rose ${esc(mCompactInr(ds))} a day while sales fell: the extra spend bought nothing at store level. Check which channel took it (Marketing).`;
    else html += dr >= 0 ? ` Spend came down ${esc(mCompactInr(-ds))} a day without losing sales: that spend was not earning.` : ` Cutting ${esc(mCompactInr(-ds))} a day of spend cost ${esc(mCompactInr(-dr))} a day in sales (${esc(mFormat("ratio", dr / ds))} each rupee).`;
  }
  return { tag: "Return on spend", tone, html };
}
/* Mix: a CVR drop with a steady Perf CVR is cheaper traffic, not a worse site. */
function insMix(g, onFunnel) {
  const w = g.w, p = g.pw;
  if ([w.cvr, p.cvr, w.perf_cvr, p.perf_cvr, w.sessions, p.sessions, w.report_perf_sessions, p.report_perf_sessions].some((x) => x == null || !x)) return null;
  const cv = insRate(w.cvr, p.cvr), pv = insRate(w.perf_cvr, p.perf_cvr), sh1 = w.report_perf_sessions / w.sessions, sh0 = p.report_perf_sessions / p.sessions;
  if (Math.abs(cv) < 0.05) return null;
  if (cv < 0 && pv > -0.03) return { tag: "Traffic mix", tone: "warn", html: `CVR fell ${insPct(cv)} but Perf CVR held (${insPct(pv)}): the drop is the traffic mix, not the site. Perf sessions are ${esc(mFormat("percent", sh1))} of all sessions against ${esc(mFormat("percent", sh0))}; non-performance (awareness, organic, direct) visits convert less.` };
  if (cv < 0 && pv < -0.05) return { tag: "Conversion", tone: "bad", html: `CVR fell ${insPct(cv)} and Perf CVR fell too (${insPct(pv)}): bought traffic is converting worse, so this is a site, offer or audience problem, not mix. ${onFunnel ? "The step rates below show where." : "The Funnel tab shows which step."}` };
  if (cv > 0 && pv > 0.03) return { tag: "Conversion", tone: "good", html: `CVR ${insPct(cv)} and Perf CVR ${insPct(pv)}: both the overall and the bought traffic convert better.` };
  return null;
}
/* Anomalies: a day far from the period's own pattern (within the same kind of day). */
function insAnomaly(g) {
  const e = RG.eng, days = g.cur.filter((d) => e.phaseOf(d) && e.phaseOf(d) !== "mixed");
  if (days.length < 7) return null;
  const out = [];
  for (const [k, id] of [["cvr", "cvr"], ["aov", "aov"], ["roas", "blended_roas"]]) {
    const pts = days.map((d) => ({ d, v: e.windowOf([d])[k], ph: e.phaseOf(d) })).filter((x) => x.v != null);
    for (const ph of ["bau", "sale"]) {
      const xs = pts.filter((x) => x.ph === ph);
      if (xs.length < 6) continue;
      const mean = xs.reduce((a, x) => a + x.v, 0) / xs.length, sd = Math.sqrt(xs.reduce((a, x) => a + (x.v - mean) ** 2, 0) / xs.length);
      if (!sd) continue;
      for (const x of xs) { const z = (x.v - mean) / sd; if (Math.abs(z) >= 2.2) out.push({ ...x, z, mean, id }); }
    }
  }
  if (!out.length) return null;
  out.sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
  const a = out[0], m = METRICS[a.id];
  return { tag: "Outlier day", tone: "warn", html: `<b>${esc(dayLabel(a.d))}</b>: ${esc(m.label)} ${esc(mVal(a.id, a.v))} against a ${a.ph === "sale" ? "sale" : "BAU"}-day average of ${esc(mVal(a.id, a.mean))} in these dates (${a.z > 0 ? "high" : "low"}, ${Math.abs(a.z).toFixed(1)}σ). One-off days distort period averages: check that day's campaigns, stock and site changes before reading the trend.${out.length > 1 ? ` ${out.length - 1} more outlier${out.length > 2 ? "s" : ""} in the period.` : ""}` };
}
function insOverview(g) {
  if (!g.pw) return insList([{ tag: "Comparison", tone: "info", html: "Pick a comparison period in the date bar to see what is driving the numbers." }], TAB_WHY.overview);
  const items = insSmall(g) ? [{ tag: "Comparison", tone: "warn", html: `The comparison has only ${esc(String(g.pw.orders || 0))} orders: too few for the changes to mean much.` }]
    : [insSalesBridge(g), insRoas(g), insMix(g), insAnomaly(g)];
  if (g.note) items.push({ tag: "Basis", tone: "info", html: esc(g.note) });
  return insList(items, TAB_WHY.overview);
}

/* Funnel: which step cost (or won) the most orders against the comparison,
   holding the other steps at today's rates. */
function insFunnel(g) {
  if (!g.pw) return insList([], TAB_WHY.funnel);
  if (insSmall(g)) return insList([{ tag: "Comparison", tone: "warn", html: "The comparison has too few orders for step changes to mean much." }], TAB_WHY.funnel);
  const w = g.w, p = g.pw, o = insPerDay(w, "orders");
  const steps = [["atc_rate", "Sessions → add to cart", "landing pages, offer and traffic quality"], ["atc_to_ic", "Add to cart → checkout", "cart, shipping fee and offer messaging"], ["ic_to_order", "Checkout → order", "payment, COD rules and GoKwik"]]
    .map(([k, l, where]) => ({ k, l, where, c: w[k], p: p[k] })).filter((x) => x.c && x.p)
    .map((x) => ({ ...x, d: o * (1 - x.p / x.c) })); // orders a day gained (+) or lost (−) by this step's rate change
  if (!steps.length || o == null) return insList([], TAB_WHY.funnel);
  const worst = [...steps].sort((a, b) => a.d - b.d)[0], best = [...steps].sort((a, b) => b.d - a.d)[0];
  const items = [];
  if (worst.d < -0.5) items.push({ tag: "Biggest leak", tone: "bad", html: `<b>${esc(worst.l)}</b> fell from ${esc(mFormat("percent", worst.p))} to ${esc(mFormat("percent", worst.c))}: about <b>${insN(-worst.d)}</b> fewer orders a day than at the comparison's rate. Look at ${esc(worst.where)}.` });
  if (best.d > 0.5 && best !== worst) items.push({ tag: "Biggest gain", tone: "good", html: `<b>${esc(best.l)}</b> rose from ${esc(mFormat("percent", best.p))} to ${esc(mFormat("percent", best.c))}: about <b>${insN(best.d)}</b> more orders a day.` });
  const mix = insMix(g, true); if (mix) items.push(mix);
  if (g.note) items.push({ tag: "Basis", tone: "info", html: esc(g.note) });
  return insList(items, TAB_WHY.funnel);
}

/* Marketing: return on spend, cost of traffic, and how far platforms over-claim. */
function insMarketing(g) {
  if (!g.pw) return insList([], TAB_WHY.marketing);
  const w = g.w, p = g.pw, items = [insRoas(g)];
  const c1 = w.cps, c0 = p.cps;
  if (c1 && c0 && Math.abs(c1 / c0 - 1) >= 0.08) {
    const cv = insRate(w.perf_cvr, p.perf_cvr);
    items.push({ tag: "Cost of traffic", tone: c1 > c0 ? "bad" : "good", html: `Cost per session ${esc(mFormat("currency2", c1))} against ${esc(mFormat("currency2", c0))} (${insPct(c1 / c0 - 1)})${cv != null ? `, Perf CVR ${insPct(cv)}` : ""}. ${c1 > c0 ? (cv != null && cv > c1 / c0 - 1 ? "Dearer traffic, but it converts better: the trade is paying off." : "Paying more for each visit without better conversion: check CPMs and creative fatigue on Meta.") : "Cheaper visits: check they still convert (Perf CVR) before scaling the source."}` });
  }
  const plat = [["Meta", w.meta_sales_roas], ["Google", w.google_sales_roas]].filter(([, r]) => r);
  if (plat.length && w.roas) {
    items.push({ tag: "Platform claims", tone: "info", html: `${plat.map(([n, r]) => `${esc(n)} claims ${esc(mFormat("ratio", r))}`).join(", ")} on its own spend, while every rupee of performance spend together returned ${esc(mFormat("ratio", w.roas))} in Shopify sales. Use platform ROAS to rank campaigns within a platform; use Blended ROAS to decide total spend.` });
  }
  if (g.note) items.push({ tag: "Basis", tone: "info", html: esc(g.note) });
  return insList(items, TAB_WHY.marketing);
}

/* Trend lines: one small chart per metric, each picked day against the
   comparison's days in order, with the period values and changes on top. */
function rgTrends(g, ids) {
  const cards = ids.map((id) => {
    const m = METRICS[id], k = m.field, v = g.w[k], pv = g.pw ? g.pw[k] : null;
    const ch = g.pw ? g.change(k) : null, small = mSmall(id, g.pw);
    const abs = g.pw ? rgAbs(id, k, g.w, g.pw) : "";
    return `<div class="trend"><div class="trend-h"><span class="trend-n">${mHead(id)}</span><span class="trend-v">${esc(mVal(id, v, true) ?? "n/a")}</span></div>
      <div class="trend-d">${pv != null ? `${mDeltaHtml(id, ch, { small })} <span class="kpi-vs">vs ${esc(mVal(id, pv, true))}</span>${abs && !small ? ` <span class="kpi-vs">· ${esc(abs)}</span>` : ""}` : '<span class="kpi-vs">no comparison</span>'}</div>
      <div class="trend-c"><canvas id="tr-${id}" aria-label="${esc(m.label)} by day"></canvas></div></div>`;
  }).join("");
  return `<div class="trends">${cards}</div><p class="legend-note">Each day of the picked dates (solid) against the comparison's days in the same order (dashed). Rates are each day's own; the period value above is the whole period's, so one big day weighs more.${g.note ? " " + esc(g.note) : ""}</p>`;
}
function rgTrendCharts(g, ids) {
  const e = RG.eng;
  for (const id of ids) {
    const el = document.getElementById("tr-" + id);
    if (!el) continue;
    const k = METRICS[id].field, cur = g.cur, prev = g.prev || [];
    const val = (d) => e.windowOf([d])[k];
    const ds = [{ label: "Picked days", data: cur.map(val), borderColor: css("--accent"), backgroundColor: css("--accent"), borderWidth: 2, pointRadius: cur.length > 31 ? 0 : 2, tension: 0.25, spanGaps: true }];
    if (prev.length) ds.push({ label: "Comparison", data: cur.map((_, i) => (prev[i] ? val(prev[i]) : null)), borderColor: css("--ink-2"), borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0, tension: 0.25, spanGaps: true });
    const unit = { percent: "pct", ratio: "x", currency: "inr", currency2: "inr2" }[METRICS[id].format] || "int";
    baseChart(el, { type: "line", data: { labels: cur.map((d) => dayLabel(d)), datasets: ds } }, unit);
  }
}
