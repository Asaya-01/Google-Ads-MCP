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
/* Cost per new customer: acquisition getting dearer can hide behind a healthy ROAS. */
function insCac(g) {
  const w = g.w, p = g.pw;
  if (!w.cpnc || !p.cpnc || !w.roas || !p.roas) return null;
  const c = w.cpnc / p.cpnc - 1, r = w.roas / p.roas - 1;
  if (Math.abs(c) < 0.08) return null;
  const sh = w.new_orders && w.orders ? w.new_orders / w.orders : null, shp = p.new_orders && p.orders ? p.new_orders / p.orders : null;
  const why = c > 0 && r >= -0.03 ? "ROAS held while each new customer cost more: sales are leaning on repeat buyers, which does not grow the customer base."
    : c > 0 ? "Each new customer costs more and ROAS fell too: acquisition is getting less efficient; check audiences and offers on the prospecting campaigns."
    : "Acquisition got cheaper: if it holds, there is room to put more into prospecting.";
  return { tag: "New customers", tone: c > 0 ? "bad" : "good", html: `Cost per new customer ${esc(mFormat("currency", w.cpnc))} against ${esc(mFormat("currency", p.cpnc))} (${insPct(c)})${sh != null && shp != null ? `; first-time customers are ${esc(mFormat("percent", sh))} of orders against ${esc(mFormat("percent", shp))}` : ""}. ${esc(why)}` };
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
/* App views have no sessions: sales a day = orders × AOV instead. */
function insOrderBridge(g) {
  const w = g.w, p = g.pw, o1 = insPerDay(w, "orders"), o0 = insPerDay(p, "orders"), a1 = w.aov, a0 = p.aov, g1 = insPerDay(w, "gmv"), g0 = insPerDay(p, "gmv");
  if (![o1, o0, a1, a0, g1, g0].every((x) => x != null && x > 0)) return null;
  const lt = Math.log(g1 / g0);
  if (Math.abs(lt) < 0.005) return null;
  const oi = (g1 - g0) * (Math.log(o1 / o0) / lt), ai = (g1 - g0) * (Math.log(a1 / a0) / lt);
  const nw = w.new_orders != null && w.orders ? w.new_orders / w.orders : null, np = p.new_orders != null && p.orders ? p.new_orders / p.orders : null;
  return { tag: "Sales bridge", tone: g1 >= g0 ? "good" : "bad",
    html: `Total sales ${esc(mCompactInr(g1))} a day against ${esc(mCompactInr(g0))} (${insPct(g1 / g0 - 1)}): more or fewer orders <b>${esc(insInr(oi))}</b>, basket size <b>${esc(insInr(ai))}</b> a day.${nw != null ? ` ${esc(mFormat("percent", nw))} of these orders are first-time customers${np != null ? ` (against ${esc(mFormat("percent", np))})` : ""}.` : ""} Shopify records no app sessions, so app conversion needs the app's own analytics.` };
}
function insOverview(g) {
  if (!g.pw) return insList([{ tag: "Comparison", tone: "info", html: "Pick a comparison period in the date bar to see what is driving the numbers." }], TAB_WHY.overview);
  const items = insSmall(g) ? [{ tag: "Comparison", tone: "warn", html: `The comparison has only ${esc(String(g.pw.orders || 0))} orders: too few for the changes to mean much.` }]
    : [RG.channel.startsWith("app") ? insOrderBridge(g) : insSalesBridge(g), insRoas(g), insCac(g), insMix(g), insAnomaly(g)];
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
    if (v == null) return `<div class="trend"><div class="trend-h"><span class="trend-n">${mHead(id)}</span><span class="trend-v">n/a</span></div><p class="na trend-na">${esc(rgNa(g.w, k) || "not available for these dates")}</p></div>`;
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

/* Month pacing: where the store will land this month against the media
   plan. Actuals are Shopify's Total sales and the dashboard's Performance
   spend (as on the cards); targets are the plan's daily Total sales and
   spend. The projection keeps the plan's own shape for the days left (sale
   bursts stay big) at the month-to-date achievement rate. Whole store only:
   the plan is not split by app vs web. */
function rgPacing() {
  const P = state.pages.plan_days, D = RG.raw;
  if (!P || !P.days || !D) return null;
  const di = new Map(D.dates.map((d, i) => [d, i])), val = (f, d) => (di.has(d) && D.values[f] ? D.values[f][di.get(d)] : null);
  // the last day with Shopify's Total sales in
  let last = null;
  for (let i = D.dates.length - 1; i >= 0 && !last; i--) if (D.values.sh_sales && D.values.sh_sales[i] != null) last = D.dates[i];
  if (!last) return null;
  const month = last.slice(0, 7), mDays = Object.keys(P.days).filter((d) => d.startsWith(month)).sort();
  if (!mDays.length) return { html: `<p class="na">The media plan has no targets for ${esc(new Date(month + "-01T00:00:00Z").toLocaleString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }))}.</p>` };
  const done = mDays.filter((d) => d <= last), left = mDays.filter((d) => d > last);
  const tgt = (list, j) => list.reduce((a, d) => a + (((P.days[d] || {}).store || [])[j] || 0), 0);
  const act = (f, list) => { let t = 0; for (const d of list) { const v = val(f, d); if (v == null) return null; t += v; } return t; };
  const tS = tgt(mDays, 1), tSdone = tgt(done, 1), tSleft = tS - tSdone, tP = tgt(mDays, 0), tPdone = tgt(done, 0), tPleft = tP - tPdone;
  const aS = act("sh_sales", done), aP = act("perf_all_spend", done);
  if (!tS || aS == null || !tSdone) return null;
  const ach = aS / tSdone, projS = aS + ach * tSleft;
  const achP = aP != null && tPdone ? aP / tPdone : null, projP = achP != null ? aP + achP * tPleft : null;
  const needDay = left.length ? Math.max(0, tS - aS) / left.length : null, planDay = left.length ? tSleft / left.length : null;
  const mName = new Date(month + "-01T00:00:00Z").toLocaleString("en-IN", { month: "long", timeZone: "UTC" });
  const card = (label, v, sub, tone) => `<div class="pace"><span class="pace-l">${esc(label)}</span><span class="pace-v ${tone || ""}">${esc(v)}</span><span class="pace-s">${sub}</span></div>`;
  const pr = projS / tS, tone = pr >= 0.98 ? "up" : pr >= 0.9 ? "flat" : "down";
  const proasT = tP ? tS / tP : null, proas = projP ? projS / projP : null;
  const cards = [
    card(`Projected ${mName} Total sales`, mCompactInr(projS), `against the <b>${esc(mCompactInr(tS))}</b> plan: <b class="${tone}">${esc(mFormat("percent", pr))}</b>`, tone),
    card("Month to date", mCompactInr(aS), `${esc(mFormat("percent", ach))} of the plan to ${esc(dayLabel(last))} (${esc(mCompactInr(tSdone))})`, ach >= 0.98 ? "up" : ach >= 0.9 ? "flat" : "down"),
    left.length ? card("Needed a day from here", mCompactInr(needDay), `against ${esc(mCompactInr(planDay))} a day planned for the ${left.length} day${left.length === 1 ? "" : "s"} left`, needDay > planDay * 1.05 ? "down" : "up") : card("Month", "complete", "every planned day has actuals", ""),
    projP != null ? card("Projected spend", mCompactInr(projP), `against the ${esc(mCompactInr(tP))} plan (${esc(mFormat("percent", projP / tP))})${proas && proasT ? `; ROAS ${esc(mFormat("ratio", proas))} against ${esc(mFormat("ratio", proasT))} planned` : ""}`, "") : "",
  ].join("");
  const verdict = pr >= 0.98 ? `On track: at the month-to-date rate the store lands at ${esc(mCompactInr(projS))}, ${esc(mFormat("percent", pr))} of the ${esc(mCompactInr(tS))} plan.`
    : `Behind plan: at the month-to-date rate the store lands at ${esc(mCompactInr(projS))}, ${esc(mCompactInr(tS - projS))} short of the ${esc(mCompactInr(tS))} plan. Closing the gap needs ${esc(mCompactInr(needDay))} a day for the ${left.length} day${left.length === 1 ? "" : "s"} left, ${esc(mFormat("percent", planDay ? needDay / planDay - 1 : null))} above the plan for those days.`;
  const spendNote = achP != null && ach ? (achP > ach + 0.05 ? ` Spend is running at ${esc(mFormat("percent", achP))} of its plan while sales are at ${esc(mFormat("percent", ach))}: more is being spent per rupee of sales than planned.` : achP < ach - 0.05 ? ` Spend is at ${esc(mFormat("percent", achP))} of its plan against sales at ${esc(mFormat("percent", ach))}: sales are coming cheaper than planned, so there is room to spend.` : "") : "";
  return { html: `<div class="paces">${cards}</div><p class="ins-why" style="margin-top:10px">${verdict}${spendNote}</p>
    <p class="legend-note">Whole store (the plan is not split by app vs web). Actuals: Shopify's Total sales and Performance spend to ${esc(dayLabel(last))}; plan: the media plan's Target vs Achieved tab. The projection applies the month-to-date achievement rate to the plan's remaining days, so planned sale days stay big.</p>` };
}

/* Products: which products drove the change in product revenue a day, and
   whether through volume or price. product_days rows: [date, product index,
   units, revenue, ...]; products grouped by house code (product map). */
TAB_WHY.products = "Which products are carrying the business, and which are slipping? A product's revenue moves with units sold and price per unit (offers, packs, discounts), and a product that suddenly drops to nothing usually means stock or a listing problem, not demand.";
function insProducts(pd, g) {
  if (!pd || !g.pw) return insList([], TAB_WHY.products);
  const keyOf = (i) => { const n = pd.names[i], pm = n && typeof pmProduct === "function" ? pmProduct(n.id) : null; return pm ? `${pm.code} · ${pm.name}` : (n ? n.label : "a product"); };
  const agg = (days) => { const set = new Set(days), m = new Map(); for (const r of pd.rows) { if (!set.has(r[0])) continue; const k = keyOf(r[1]); const a = m.get(k) || m.set(k, { u: 0, r: 0 }).get(k); a.u += r[2] || 0; a.r += r[3] || 0; } return m; };
  const A = agg(g.cur), B = agg(g.prev || []), dc = Math.max(g.cur.length, 1), dp = Math.max((g.prev || []).length, 1);
  const tot = (m, d) => [...m.values()].reduce((x, a) => x + a.r, 0) / d;
  const t1 = tot(A, dc), t0 = tot(B, dp);
  if (!t0) return insList([], TAB_WHY.products);
  const rows = [...new Set([...A.keys(), ...B.keys()])].map((k) => { const a = A.get(k) || { u: 0, r: 0 }, b = B.get(k) || { u: 0, r: 0 }; return { k, r1: a.r / dc, r0: b.r / dp, u1: a.u / dc, u0: b.u / dp }; })
    .map((x) => ({ ...x, d: x.r1 - x.r0 })).sort((x, y) => Math.abs(y.d) - Math.abs(x.d));
  const items = [], net = t1 - t0;
  const movers = rows.filter((x) => Math.abs(x.d) >= Math.max(500, t0 * 0.01)).slice(0, 3);
  if (movers.length) {
    items.push({ tag: "Biggest movers", tone: net >= 0 ? "good" : "bad", html: `Product revenue ${esc(mCompactInr(t1))} a day against ${esc(mCompactInr(t0))} (${insPct(t1 / t0 - 1)}). ${movers.map((x) => `<b>${esc(x.k)}</b> ${esc(insInr(x.d))} a day`).join(", ")}${Math.abs(net) > 1 ? `: together ${esc(mFormat("percent", Math.abs(movers.reduce((s, x) => s + x.d, 0) / net)))} of the net change` : ""}.` });
    const m = movers[0];
    if (m.u0 && m.u1 && m.r0 && m.r1) {
      const uv = m.u1 / m.u0 - 1, pv = (m.r1 / m.u1) / (m.r0 / m.u0) - 1;
      items.push({ tag: "Volume or price", tone: "info", html: `<b>${esc(m.k)}</b>: units ${insPct(uv)} a day, revenue per unit ${insPct(pv)}. ${Math.abs(uv) >= Math.abs(pv) ? "Volume drove it: look at traffic and ads behind this product." : "Price per unit drove it: offer depth, packs and bundles changed what each sale is worth."}` });
    }
  }
  const gone = rows.filter((x) => x.r0 >= Math.max(1000, t0 * 0.02) && x.r1 < x.r0 * 0.1).slice(0, 2);
  if (gone.length) items.push({ tag: "Dropped away", tone: "bad", html: `${gone.map((x) => `<b>${esc(x.k)}</b> (${esc(mCompactInr(x.r0))} a day before, ${esc(mCompactInr(x.r1))} now)`).join(", ")} nearly stopped selling. A drop this sharp is usually stock, a paused listing or a removed ad, not demand: check inventory and the product page.` });
  const top = [...rows].sort((x, y) => y.r1 - x.r1)[0];
  if (top && t1) {
    const s1 = top.r1 / t1, s0 = t0 ? top.r0 / t0 : null;
    if (s1 >= 0.35) items.push({ tag: "Concentration", tone: "warn", html: `<b>${esc(top.k)}</b> is ${esc(mFormat("percent", s1))} of product revenue${s0 != null ? ` (against ${esc(mFormat("percent", s0))})` : ""}. One product carrying this much makes the month depend on its stock, ads and reviews.` });
  }
  if (g.note) items.push({ tag: "Basis", tone: "info", html: esc(g.note) });
  return insList(items, TAB_WHY.products);
}

/* Retention: is the share of new customers who come back moving, and which
   first products drive it? The picked cohort against the same number of days
   just before, each at a milestone both have fully had time to reach. */
TAB_WHY.retention = "Repeat buying decides what a customer is worth: acquisition is paid once, repeats are mostly free. A falling repeat rate quietly raises the true cost of every new customer, so it is read here against the cohort just before, at the same milestone.";
function insRetention(e, A, B) {
  const len = B - A + 1, pA = A - len, pB = A - 1;
  if (pA < 0) return insList([{ tag: "Comparison", tone: "info", html: "There is no earlier cohort of the same length in the data to compare with." }], TAB_WHY.retention);
  const x1 = e.computeBrand(A, B, null), x0 = e.computeBrand(pA, pB, null);
  const h = [90, 60, 30].find((m) => x1.cb[m] >= 50 && x0.cb[m] >= 50);
  if (!h) return insList([{ tag: "Too early", tone: "info", html: "The customers in these dates have not all had 30 days to come back yet: pick earlier dates to compare repeat rates." }], TAB_WHY.retention);
  const r1 = x1.ch[h] / x1.cb[h], r0 = x0.ch[h] / x0.cb[h], d = r1 - r0;
  const items = [{ tag: "Repeat rate", tone: Math.abs(d) < 0.005 ? "info" : d > 0 ? "good" : "bad",
    html: `${esc(mFormat("percent", r1))} of customers new to Asaya came back within ${h} days, against ${esc(mFormat("percent", r0))} for the ${len} days before (${esc(mFormat("pp", d))}; ${inGroup.format(x1.cb[h])} and ${inGroup.format(x0.cb[h])} customers who have each had ${h} days).` }];
  // first products: who moved the rate, and did the mix shift toward products people re-buy less?
  const at = (rows) => new Map(rows.map((r) => { const m = (r.miles || []).find((z) => z.h === h); return [r.code, { name: r.name, base: m ? m.base : 0, hit: m ? m.hit : 0 }]; }));
  const P1 = at(e.compute(A, B, "sku", null)), P0 = at(e.compute(pA, pB, "sku", null));
  const B1 = [...P1.values()].reduce((s, x) => s + x.base, 0), B0 = [...P0.values()].reduce((s, x) => s + x.base, 0);
  if (B1 && B0) {
    const rows = [...P1.keys()].filter((k) => P0.has(k)).map((k) => {
      const a = P1.get(k), b = P0.get(k), ra = a.base ? a.hit / a.base : null, rb = b.base ? b.hit / b.base : null;
      return { k, name: a.name, base: a.base, ra, rb, eff: ra != null && rb != null && a.base >= 30 && b.base >= 30 ? a.base * (ra - rb) : 0, sa: a.base / B1, sb: b.base / B0 };
    });
    const mv = rows.filter((x) => Math.abs(x.eff) >= 3).sort((p, q) => Math.abs(q.eff) - Math.abs(p.eff)).slice(0, 3);
    if (mv.length) items.push({ tag: "By first product", tone: mv[0].eff < 0 ? "bad" : "good", html: mv.map((x) => `<b>${esc(x.name)}</b> ${esc(mFormat("percent", x.rb))} → ${esc(mFormat("percent", x.ra))} (about ${Math.abs(Math.round(x.eff))} ${x.eff < 0 ? "fewer" : "more"} repeat buyers)`).join("; ") + `, within ${h} days of first buying that product. A product's repeat rate moves with how well it works and how long a pack lasts, so a sharp drop is worth checking against reviews and pack size.` });
    const mix = rows.reduce((s, x) => s + (x.rb != null ? (x.sa - x.sb) * x.rb : 0), 0);
    if (Math.abs(mix) >= 0.005) items.push({ tag: "Product mix", tone: mix < 0 ? "warn" : "good", html: `New buyers' first products shifted toward products that are re-bought ${mix < 0 ? "less" : "more"} often: on its own that moves the repeat rate by about ${esc(mFormat("pp", mix))}. ${mix < 0 ? "Acquisition is leaning on products with weaker repeat: worth weighing in which products the ads push." : ""}` });
  }
  return insList(items, TAB_WHY.retention);
}
