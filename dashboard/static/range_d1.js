/* D-1 as a management report, read top to bottom:
   summary → overview → traffic → checkout funnel → revenue & basket → products
   → new vs repeat → spend & ROAS, then the day-by-day table and the drill-down
   as detail. Every section follows the picked dates, the sale / BAU block and
   the Performance / Awareness / All switch, and opens with one plain sentence
   that says what moved. Inlined after range_basket.js, inside the closure. */

const D1_MODE_TEXT = {
  perf: "Performance: the team's D-1 sheet (whole-store sessions and revenue, performance sessions, sales-campaign spend).",
  all: "All campaigns: as Performance. Spends, RoAS and CPS stay on performance spend: awareness and Reach spend are never in RoAS.",
  aw: "Awareness: awareness traffic only, the orders and revenue credited to it by UTM, and awareness spend.",
};
const D1_F = {
  perf: [["sessions", "Overall sessions", "int"], ["report_perf_sessions", "Perf. sessions", "int"], ["atc", "ATC", "int"], ["ic", "Checkout started (IC)", "int"], ["sh_orders", "Orders", "int"], ["sh_sales", "Revenue", "inr"], ["sh_aov", "AOV", "inr"],
    ["atc_rate", "Sessions → ATC %", "pct"], ["atc_to_ic", "ATC → IC %", "pct"], ["sh_ic_to_order", "IC → orders %", "pct"], ["sh_cvr", "CVR % (on sessions)", "pct"], ["sh_perf_cvr", "CVR % (on perf)", "pct"],
    ["perf_all_spend", "Spends", "inr"], ["sh_roas", "RoAS", "x"], ["cps", "CPS", "inr2"]],
  aw: [["sessions", "Awareness sessions", "int"], ["atc", "ATC", "int"], ["ic", "Checkout started (IC)", "int"], ["orders", "Orders credited", "int"], ["gmv", "Revenue credited", "inr"], ["aov", "AOV", "inr"],
    ["atc_rate", "Sessions → ATC %", "pct"], ["atc_to_ic", "ATC → IC %", "pct"], ["ic_to_order", "IC → orders %", "pct"], ["cvr", "CVR %", "pct"],
    ["spend", "Awareness spend", "inr"], ["cps_ad", "Cost / session", "inr2"]],
};
// the same sheet in the All view: RoAS is only ever on performance spend
D1_F.all = D1_F.perf.slice();
// the headline tiles: what management reads first
const D1_TILES = {
  perf: ["sessions", "sh_orders", "sh_sales", "sh_aov", "sh_cvr", "perf_all_spend", "sh_roas"],
  all: ["sessions", "sh_orders", "sh_sales", "sh_aov", "sh_cvr", "perf_all_spend", "sh_roas"],
  aw: ["sessions", "orders", "gmv", "atc_rate", "cvr", "spend", "cps_ad"],
};
const D1 = { section: null };

const d1All = () => RG.engAll || (RG.engAll = createRangeEngine(RG.raw, "all"));
const d1Eng = () => (RG.mode === "aw" ? RG.eng : d1All());
const d1IsRate = (u, k) => u === "pct" || u === "x" || u === "inr2" || RG_RATES.includes(k) || ["aov", "sh_aov"].includes(k);
const d1Sign = (v) => (v > 0 ? "+" : v < 0 ? "−" : "±");
// a change written out: "+12,345", "−0.70 pp", "+0.03x", "+Rs 12"
function d1Abs(d, unit) {
  if (d == null || !isFinite(d)) return '<span class="flat">–</span>';
  const a = Math.abs(d);
  const t = unit === "pct" ? `${(a * 100).toFixed(2)} pp` : unit === "x" ? `${a.toFixed(2)}x` : unit === "inr2" ? `Rs ${a.toFixed(2)}` : unit === "inr" ? fmt(a, "inr") : fmt(Math.round(a), "int");
  return `<span class="flat">${d1Sign(d)}${esc(t)}</span>`;
}
// change between two windows: rates directly, counts per day when the periods differ in length
function d1Diff(cur, prev, k, unit, nc, np) {
  if (cur == null || prev == null) return null;
  if (d1IsRate(unit, k) || nc === np) return cur - prev;
  return cur / Math.max(nc, 1) - prev / Math.max(np, 1);
}
function d1Pct(cur, prev, k, unit, nc, np) {
  if (cur == null || prev == null || prev === 0) return null;
  if (d1IsRate(unit, k) || nc === np) return cur / prev - 1;
  return cur / Math.max(nc, 1) / (prev / Math.max(np, 1)) - 1;
}
const d1Pp = (a, b) => (a == null || b == null ? null : a - b);
const d1Word = (d, up = "up", down = "down") => (d == null ? "" : d >= 0 ? up : down);
const d1Move = (d) => (d == null ? "with nothing to compare" : Math.abs(d) < 0.0005 ? "flat" : `${d > 0 ? "up" : "down"} ${Math.abs(d * 100).toFixed(1)}%`);
const d1P = (d) => (d == null ? "n/a" : `${d >= 0 ? "+" : "−"}${Math.abs(d * 100).toFixed(1)}%`);
const d1PP = (d) => (d == null ? "n/a" : `${d >= 0 ? "+" : "−"}${Math.abs(d * 100).toFixed(1)} pp`);
const d1Money = (v) => (v == null ? "n/a" : fmt(v, "inr", true));
const d1N = (v) => (v == null ? "n/a" : fmt(Math.round(v), "int"));

function d1Section(n, title, sub, insight, body, id) {
  return `<section class="card d1-sec" ${id ? `id="${id}"` : ""}>
    <div class="section-head"><h2><span class="d1-n">${n}</span> ${esc(title)}</h2>${sub ? `<span class="sub">${sub}</span>` : ""}</div>
    ${insight ? `<div class="d1-insight">${insight}</div>` : ""}${body}</section>`;
}
const d1Th = (g) => [g.prev && g.prev.length ? (g.prevSpan ? rgSpan(g.prevSpan[0], g.prevSpan[1]) : "Comparison") : null, g.curSpan ? rgSpan(g.curSpan[0], g.curSpan[1]) : "Selected"];

// ---------------------------------------------------------------- 1 · overview
function d1Overview(g) {
  const F = D1_F[RG.mode] || D1_F.perf, w = g.w, pw = g.pw, nc = g.cur.length, np = g.prev ? g.prev.length : 0;
  const byKey = Object.fromEntries(F.map((f) => [f[0], f]));
  const tiles = (D1_TILES[RG.mode] || D1_TILES.perf).map((k) => byKey[k] || [k, k, "int"]).map(([k, l, u]) => {
    const v = w[k], ch = pw ? g.change(k) : null;
    if (v == null) return `<div class="tile"><div class="label">${esc(l)}</div><div class="na">Data unavailable: ${esc(rgNa(w, k) || "not available")}</div></div>`;
    return `<div class="tile"><div class="label">${esc(l)}</div><div class="value">${esc(fmt(v, u, true))}</div><div class="foot">${pw ? `${deltaHtml(ch, RG_NEUTRAL.has(k) || /spend|cps/.test(k) ? "spend" : k)}<span>vs ${esc(fmt(pw[k], u, true) ?? "n/a")}</span>` : "<span>no comparison</span>"}</div></div>`;
  }).join("");
  const [hp, hc] = d1Th(g);
  const cols = [{ label: "Metric", text: true, render: (r) => esc(r.l) }];
  if (pw) cols.push({ label: hp, render: (r) => cell(pw[r.k], r.u, rgNa(pw, r.k)) });
  cols.push({ label: hc, render: (r) => cell(w[r.k], r.u, rgNa(w, r.k)) });
  if (pw) {
    cols.push({ label: nc !== np ? "Δ (per day)" : "Δ", render: (r) => d1Abs(d1Diff(w[r.k], pw[r.k], r.k, r.u, nc, np), r.u) });
    cols.push({ label: "Δ %", render: (r) => deltaHtml(g.change(r.k), /spend|cps/.test(r.k) ? "spend" : r.k) });
  }
  const tbl = table(cols, F.map(([k, l, u]) => ({ k, l, u })));
  // the sentence
  const rk = RG.mode === "aw" ? "gmv" : "sh_sales", ok = RG.mode === "aw" ? "orders" : "sh_orders", ak = RG.mode === "aw" ? "aov" : "sh_aov";
  let s = "";
  if (w[rk] != null) {
    s = `<b>Revenue ${d1Money(w[rk])}${pw ? `, ${d1Move(g.change(rk))}` : ""}</b>`;
    if (pw) s += `: orders ${d1Move(g.change(ok))}, AOV ${d1Move(g.change(ak))}, sessions ${d1Move(g.change("sessions"))}${nc !== np ? " (per day)" : ""}.`;
    else s += ` from ${d1N(w[ok])} orders.`;
    const conv = RG.mode === "aw" ? "cvr" : "sh_cvr";
    if (pw && g.change(conv) != null) {
      const dc = d1Pp(w[conv], pw[conv]);
      s += Math.abs(dc) < 0.0005 ? ` Conversion held at ${fmt(w[conv], "pct")}.` : ` Conversion moved ${d1PP(dc)} (${fmt(pw[conv], "pct")} → ${fmt(w[conv], "pct")}).`;
    }
  }
  const body = `<div class="tiles">${tiles}</div>${statusStrip()}${g.note ? `<div class="banner">${esc(g.note)}</div>` : ""}<h3 class="d1-h3">Metric comparison</h3>${tbl}
    <p class="legend-note">${esc(D1_MODE_TEXT[RG.mode] || "")}${RG.mode === "aw" ? "" : " Orders and Revenue are Shopify's own Sales report; Spends are all channels on sales campaigns; RoAS is revenue ÷ Spends; CPS is Spends ÷ overall sessions."}${nc !== np && pw ? " The periods differ in length, so changes compare per-day averages." : ""}</p>`;
  return { html: d1Section(1, "Overview", esc(rgVsText(g, "cur")) + (pw ? ` · compared with ${esc(rgVsText(g, "prev"))}` : ""), s, body), line: s };
}

// ---------------------------------------------------------------- 2 · traffic
function d1Collect(dim, days) {
  const m = new Map(), set = new Set(days || []);
  const src = (state.pages.drill_days || {})[dim];
  const keep = (k) => RG.mode === "all" || k === 3 || (RG.mode === "aw" ? k === 1 : k === 0);
  for (const r of src ? src.rows : []) {
    if (!set.has(r[0]) || !keep(r[2])) continue;
    const a = m.get(r[1]) || m.set(r[1], { sessions: 0, perf_sessions: 0, atc: 0, ic: 0, orders: 0, gmv: 0, converted: 0 }).get(r[1]);
    a.sessions += r[3]; a.perf_sessions += r[4]; a.atc += r[5]; a.ic += r[6]; a.orders += r[7]; a.gmv += r[8]; a.converted += r[9];
  }
  return m;
}
function d1Traffic(g) {
  const dd = state.pages.drill_days;
  if (!dd || !dd.channel) return { html: d1Section(2, "Traffic by channel", "", "", '<p class="na">Data unavailable: the channel data appears after the next refresh.</p>'), line: "" };
  const nc = g.cur.length, np = g.prev ? g.prev.length : 0, hasP = np > 0;
  const C = d1Collect("channel", g.cur), P = hasP ? d1Collect("channel", g.prev) : new Map();
  const z = { sessions: 0, orders: 0, gmv: 0 };
  const rows = [...new Set([...C.keys(), ...P.keys()])].map((i) => {
    const a = C.get(i) || z, b = P.get(i) || z;
    return { name: dd.channel.names[i].key, a, b, dS: hasP ? d1Diff(a.sessions, b.sessions, "s", "int", nc, np) : null, pS: hasP ? d1Pct(a.sessions, b.sessions, "s", "int", nc, np) : null, pO: hasP ? d1Pct(a.orders, b.orders, "o", "int", nc, np) : null };
  }).filter((r) => r.a.sessions || r.b.sessions).sort((x, y) => y.a.sessions - x.a.sessions);
  const tot = rows.reduce((t, r) => ({ s: t.s + r.a.sessions, ps: t.ps + r.b.sessions, o: t.o + r.a.orders, po: t.po + r.b.orders }), { s: 0, ps: 0, o: 0, po: 0 });
  const [hp, hc] = d1Th(g);
  const cols = [{ label: "Channel (UTM)", text: true, render: (r) => esc(r.name) }];
  if (hasP) cols.push({ label: `Sessions · ${hp}`, render: (r) => esc(d1N(r.b.sessions)) });
  cols.push({ label: `Sessions · ${hc}`, render: (r) => esc(d1N(r.a.sessions)) });
  if (hasP) cols.push({ label: nc !== np ? "Δ / day" : "Δ", render: (r) => d1Abs(r.dS, "int") }, { label: "Δ %", render: (r) => deltaHtml(r.pS, "sessions") });
  cols.push({ label: "Share", render: (r) => esc(tot.s ? `${((r.a.sessions / tot.s) * 100).toFixed(1)}%` : "–") });
  cols.push({ label: "Orders", render: (r) => esc(d1N(r.a.orders)) + (hasP ? `<br><span class="sub">${deltaHtml(r.pO, "orders")}</span>` : "") });
  cols.push({ label: "CVR", render: (r) => esc(r.a.sessions ? fmt(r.a.orders / r.a.sessions, "pct") : "–") });
  let s = "";
  if (hasP && rows.length) {
    const tdS = d1Diff(tot.s, tot.ps, "s", "int", nc, np);
    const lead = [...rows].sort((x, y) => (tdS >= 0 ? y.dS - x.dS : x.dS - y.dS))[0];
    const shareOf = tdS ? Math.round((lead.dS / tdS) * 100) : null;
    const what = RG.mode === "aw" ? "Awareness sessions" : RG.mode === "all" ? "Sessions" : "Sessions outside awareness";
    s = `<b>${what} ${d1Move(d1Pct(tot.s, tot.ps, "s", "int", nc, np))}</b>${nc !== np ? " per day" : ""}; <b>${esc(lead.name)}</b> ${lead.dS >= 0 ? "added" : "lost"} the most (${d1Sign(lead.dS)}${d1N(Math.abs(lead.dS))}${shareOf != null && shareOf > 0 && shareOf <= 300 ? `, ${shareOf}% of the change` : ""}).`;
    const oc = d1Pct(tot.o, tot.po, "o", "int", nc, np);
    if (oc != null) s += ` Orders credited to them ${d1Move(oc)}.`;
  } else if (rows.length) s = `<b>${esc(rows[0].name)}</b> brought the most sessions (${d1N(rows[0].a.sessions)}, ${((rows[0].a.sessions / tot.s) * 100).toFixed(0)}% of all).`;
  const note = RG.mode === "all" ? "" : `<p class="legend-note">${RG.mode === "aw" ? "Awareness campaigns only." : "Everything that is not awareness or social."} Orders are the ones each channel is credited with by UTM.</p>`;
  return { html: d1Section(2, "Traffic by channel", "", s, table(cols, rows) + note), line: s };
}

// ---------------------------------------------------------------- 3 · checkout funnel
function d1Funnel(g) {
  const w = g.w, pw = g.pw, nc = g.cur.length, np = g.prev ? g.prev.length : 0;
  const ok = RG.mode === "aw" ? "orders" : "sh_orders";
  const steps = [["atc", "Added to cart"], ["ic", "Checkout started (IC)"], ["gk_address", "Address landed"], ["gk_payment", "Payment step reached"], [ok, "Orders"]];
  const rows = steps.map(([k, l], i) => {
    const prevK = i ? steps[i - 1][0] : null;
    const rate = (W) => (W && prevK && W[k] != null && W[prevK] ? W[k] / W[prevK] : null);
    return { k, l, cur: w[k], prev: pw ? pw[k] : null, r: rate(w), pr: rate(pw), from: i ? steps[i - 1][1] : null };
  });
  const [hp, hc] = d1Th(g);
  const cols = [{ label: "Step", text: true, render: (r) => esc(r.l) }];
  if (pw) cols.push({ label: hp, render: (r) => cell(r.prev, "int", rgNa(pw, r.k)) });
  cols.push({ label: hc, render: (r) => cell(r.cur, "int", rgNa(w, r.k)) });
  if (pw) cols.push({ label: "Δ %", render: (r) => deltaHtml(d1Pct(r.cur, r.prev, r.k, "int", nc, np), r.k) });
  cols.push({ label: "Step rate", render: (r) => (r.r == null ? '<span class="flat">–</span>' : esc(fmt(r.r, "pct")) + (r.pr != null ? `<br><span class="sub">vs ${esc(fmt(r.pr, "pct"))}</span>` : "")) });
  if (pw) cols.push({ label: "Δ rate", render: (r) => (r.r == null || r.pr == null ? '<span class="flat">–</span>' : `<span class="${r.r >= r.pr ? "up" : "down"}">${esc(d1PP(r.r - r.pr))}</span>`) });
  let s = "";
  const moved = rows.filter((r) => r.r != null && r.pr != null);
  if (moved.length) {
    const worst = [...moved].sort((x, y) => (x.r - x.pr) - (y.r - y.pr))[0], best = [...moved].sort((x, y) => (y.r - y.pr) - (x.r - x.pr))[0];
    s = worst.r - worst.pr < 0
      ? `<b>The biggest leak is ${esc(worst.from)} → ${esc(worst.l)}</b>: ${fmt(worst.pr, "pct")} → ${fmt(worst.r, "pct")} (${d1PP(worst.r - worst.pr)}).${best.r - best.pr > 0 ? ` ${esc(best.from)} → ${esc(best.l)} improved the most (${d1PP(best.r - best.pr)}).` : ""}`
      : `<b>Every step held or improved</b>; the most at ${esc(best.from)} → ${esc(best.l)} (${d1PP(best.r - best.pr)}).`;
  } else if (rows[4].r != null) s = `<b>${fmt(rows[4].r, "pct")} of payment-step visitors ordered.</b>`;
  return { html: d1Section(3, "Checkout funnel", "add to cart through to order, GoKwik for the checkout steps", s, table(cols, rows)), line: s };
}

// ---------------------------------------------------------------- 4 · revenue, AOV and basket
function d1Basket(g) {
  const p = state.pages.slab_days;
  if (!p || !p.rows || p.na) return { html: d1Section(4, "Revenue & AOV", "", "", `<p class="na">Data unavailable: ${esc((p && p.na) || "basket size has not been built yet")}.</p>`), line: "" };
  const sum = (days) => { const set = new Set(days || []), m = new Map(); for (const [d, slab, o, u, sales] of p.rows) { if (!set.has(d)) continue; const a = m.get(slab) || m.set(slab, { o: 0, s: 0 }).get(slab); a.o += o; a.s += sales; } return m; };
  const nc = g.cur.length, np = g.prev ? g.prev.length : 0, hasP = np > 0;
  const C = sum(g.cur), P = hasP ? sum(g.prev) : new Map();
  const tot = (m) => [...m.values()].reduce((t, a) => ({ o: t.o + a.o, s: t.s + a.s }), { o: 0, s: 0 });
  const tc = tot(C), tp = tot(P);
  const rows = [...new Set([...C.keys(), ...P.keys()])].filter((k) => k > 0).sort((a, b) => a - b).map((k) => {
    const a = C.get(k) || { o: 0, s: 0 }, b = P.get(k) || { o: 0, s: 0 };
    return { k, l: BK_LABEL(k, p.top), a, b, mix: tc.s ? a.s / tc.s : null, pmix: tp.s ? b.s / tp.s : null };
  });
  const [hp, hc] = d1Th(g);
  const cols = [{ label: "Basket", text: true, render: (r) => esc(r.l) }];
  if (hasP) cols.push({ label: `Revenue · ${hp}`, render: (r) => `${esc(d1Money(r.b.s))}<br><span class="sub">${esc(r.pmix == null ? "–" : (r.pmix * 100).toFixed(1) + "% of revenue")}</span>` });
  cols.push({ label: `Revenue · ${hc}`, render: (r) => `${esc(d1Money(r.a.s))}<br><span class="sub">${esc(r.mix == null ? "–" : (r.mix * 100).toFixed(1) + "% of revenue")}</span>` });
  if (hasP) cols.push({ label: "Δ %", render: (r) => deltaHtml(d1Pct(r.a.s, r.b.s, "s", "inr", nc, np), "gmv") }, { label: "Δ mix", render: (r) => d1Abs(d1Pp(r.mix, r.pmix), "pct") });
  cols.push({ label: "Orders", render: (r) => esc(d1N(r.a.o)) }, { label: "AOV", render: (r) => esc(r.a.o ? fmt(r.a.s / r.a.o, "inr") : "–") });
  const aov = tc.o ? tc.s / tc.o : null, paov = tp.o ? tp.s / tp.o : null;
  let s = "";
  if (hasP && rows.length) {
    const shift = [...rows].sort((x, y) => (y.mix - y.pmix) - (x.mix - x.pmix));
    const up = shift[0], down = shift[shift.length - 1];
    s = `<b>AOV ${d1Money(aov)}, ${d1Move(paov ? aov / paov - 1 : null)}</b> (from ${d1Money(paov)}). ${esc(up.l)} gained the most revenue share (${d1PP(up.mix - up.pmix)})${down !== up && down.mix - down.pmix < 0 ? `, at the expense of ${esc(down.l.toLowerCase())} (${d1PP(down.mix - down.pmix)})` : ""}.`;
  } else if (aov != null) s = `<b>AOV ${d1Money(aov)}</b>; ${rows.length ? `${esc(rows[0].l.toLowerCase())} baskets brought ${((rows[0].mix || 0) * 100).toFixed(0)}% of revenue` : ""}.`;
  return { html: d1Section(4, "Revenue & AOV", "basket mix · whole store · items exclude freebies, merch, books and gummies", s, table(cols, rows)), line: s, whole: true };
}

// ---------------------------------------------------------------- 5 · products
function d1Products(g) {
  const pd = state.pages.product_days;
  if (!pd) return { html: "", line: "" };
  const sum = (days) => { const set = new Set(days || []), m = new Map(); for (const [d, i, u, rev] of pd.rows) { if (!set.has(d)) continue; const a = m.get(i) || m.set(i, { u: 0, r: 0 }).get(i); a.u += u; a.r += rev; } return m; };
  const nc = g.cur.length, np = g.prev ? g.prev.length : 0, hasP = np > 0;
  const C = sum(g.cur), P = hasP ? sum(g.prev) : new Map();
  const all = [...new Set([...C.keys(), ...P.keys()])].map((i) => {
    const a = C.get(i) || { u: 0, r: 0 }, b = P.get(i) || { u: 0, r: 0 };
    return { name: pd.names[i].label, a, b, dR: hasP ? d1Diff(a.r, b.r, "r", "inr", nc, np) : null, pR: hasP ? d1Pct(a.r, b.r, "r", "inr", nc, np) : null, pU: hasP ? d1Pct(a.u, b.u, "u", "int", nc, np) : null };
  });
  const rows = all.filter((r) => r.a.r || r.b.r).sort((x, y) => Math.max(y.a.r, y.b.r) - Math.max(x.a.r, x.b.r)).slice(0, 12);
  const [hp, hc] = d1Th(g);
  const cols = [{ label: "Product", text: true, render: (r) => esc(r.name) }];
  if (hasP) cols.push({ label: `Revenue · ${hp}`, render: (r) => esc(d1Money(r.b.r)) });
  cols.push({ label: `Revenue · ${hc}`, render: (r) => esc(d1Money(r.a.r)) });
  if (hasP) cols.push({ label: "Δ %", render: (r) => deltaHtml(r.pR, "gmv") });
  if (hasP) cols.push({ label: `Units · ${hp}`, render: (r) => esc(d1N(r.b.u)) });
  cols.push({ label: `Units · ${hc}`, render: (r) => esc(d1N(r.a.u)) });
  if (hasP) cols.push({ label: "Δ %", render: (r) => deltaHtml(r.pU, "units") });
  let s = "";
  const movers = all.filter((r) => r.dR != null && (r.a.r || r.b.r));
  if (hasP && movers.length) {
    const fall = [...movers].sort((x, y) => x.dR - y.dR)[0], rise = [...movers].sort((x, y) => y.dR - x.dR)[0];
    const bits = [];
    if (fall.dR < 0) bits.push(`<b>${esc(fall.name)}</b> fell the most (${d1P(fall.pR)}, ${d1Sign(fall.dR)}${d1Money(Math.abs(fall.dR))}${nc !== np ? " a day" : ""})`);
    if (rise.dR > 0) bits.push(`<b>${esc(rise.name)}</b> grew the most (${d1P(rise.pR)}, +${d1Money(rise.dR)}${nc !== np ? " a day" : ""})`);
    s = bits.join("; ") + (bits.length ? "." : "");
  } else if (rows.length) s = `<b>${esc(rows[0].name)}</b> was the top seller (${d1Money(rows[0].a.r)}).`;
  return { html: d1Section(5, "Products", "top 12 by revenue · whole store", s, table(cols, rows)), line: s, whole: true };
}

// ---------------------------------------------------------------- 6 · new vs repeat
function d1Retention(g) {
  const e = d1All(), W = e.windowOf(g.cur), PW = g.prev && g.prev.length ? e.windowOf(g.prev) : null;
  const nc = g.cur.length, np = g.prev ? g.prev.length : 0;
  const val = (X, k) => {
    if (!X) return null;
    const known = (X.new_orders ?? 0) + (X.repeat_orders ?? 0), rev = (X.new_gmv ?? 0) + (X.repeat_gmv ?? 0);
    return { new_aov: X.new_orders ? X.new_gmv / X.new_orders : null, repeat_aov: X.repeat_orders ? X.repeat_gmv / X.repeat_orders : null,
      rep_share: known && X.repeat_orders != null ? X.repeat_orders / known : null, rep_rev_share: rev && X.repeat_gmv != null ? X.repeat_gmv / rev : null }[k] ?? X[k];
  };
  const R = [["new_orders", "New-customer orders", "int"], ["repeat_orders", "Repeat orders", "int"], ["new_gmv", "New-customer revenue", "inr"], ["repeat_gmv", "Repeat revenue", "inr"],
    ["new_aov", "New-customer AOV", "inr"], ["repeat_aov", "Repeat AOV", "inr"], ["rep_share", "Repeat share of orders", "pct"], ["rep_rev_share", "Repeat share of revenue", "pct"]];
  const RATE = new Set(["new_aov", "repeat_aov", "rep_share", "rep_rev_share"]);
  const [hp, hc] = d1Th(g);
  const cols = [{ label: "Metric", text: true, render: (r) => esc(r.l) }];
  if (PW) cols.push({ label: hp, render: (r) => cell(val(PW, r.k), r.u, rgNa(PW, r.k)) });
  cols.push({ label: hc, render: (r) => cell(val(W, r.k), r.u, rgNa(W, r.k)) });
  if (PW) {
    cols.push({ label: nc !== np ? "Δ (per day)" : "Δ", render: (r) => d1Abs(RATE.has(r.k) ? d1Pp(val(W, r.k), val(PW, r.k)) : d1Diff(val(W, r.k), val(PW, r.k), r.k, r.u, nc, np), r.u) });
    cols.push({ label: "Δ %", render: (r) => deltaHtml(RATE.has(r.k) ? d1Pct(val(W, r.k), val(PW, r.k), r.k, "x", 1, 1) : d1Pct(val(W, r.k), val(PW, r.k), r.k, r.u, nc, np), "orders") });
  }
  let s = "";
  if (W.new_orders == null) s = "";
  else if (PW && PW.new_orders != null) {
    const pn = d1Pct(W.new_orders, PW.new_orders, "n", "int", nc, np), pr = d1Pct(W.repeat_orders, PW.repeat_orders, "r", "int", nc, np);
    const who = pn != null && pr != null ? (pn < 0 && pr >= 0 ? "<b>The change is a new-customer story</b>: " : pr < 0 && pn >= 0 ? "<b>The change is a repeat-customer story</b>: " : "") : "";
    s = `${who}${who ? "new" : "New"}-customer orders ${d1Move(pn)}, repeat orders ${d1Move(pr)}${nc !== np ? " (per day)" : ""}; repeat customers placed ${fmt(val(W, "rep_share"), "pct")} of orders (was ${fmt(val(PW, "rep_share"), "pct")}).`;
  } else s = `<b>${fmt(val(W, "rep_share"), "pct")} of orders were from repeat customers.</b>`;
  return { html: d1Section(6, "New vs repeat customers", "whole store · a customer's first valid order is new", s, table(cols, R.map(([k, l, u]) => ({ k, l, u })))), line: s, whole: true };
}

// ---------------------------------------------------------------- 7 · spend and ROAS
function d1Spend(g) {
  const e = d1All(), W = e.windowOf(g.cur), PW = g.prev && g.prev.length ? e.windowOf(g.prev) : null;
  const nc = g.cur.length, np = g.prev ? g.prev.length : 0;
  const perf = [["Meta (sales)", "meta_perf_spend", "meta_perf_value"], ["Google (sales)", "google_perf_spend", "google_perf_value"], ["Reddit", "reddit_spend", null], ["Affiliate", "affiliate_spend", "affiliate_revenue"], ["CRM (flow + broadcast)", "crm_spend", "crm_revenue"]];
  const aw = [["Meta (awareness)", "meta_aw_spend", "meta_aw_value"], ["Google (awareness)", "google_aw_spend", "google_aw_value"]];
  // one RoAS: Shopify revenue over performance spend. Awareness and Reach spend
  // are shown for what they cost, never in RoAS, and the Awareness view has none.
  const showRoas = RG.mode !== "aw";
  const keep = (r) => W[r.sk] || (PW && PW[r.sk]) || W[r.sk] == null;
  const asRows = (list) => list.map(([l, sk, vk]) => ({ l, sk, vk: showRoas ? vk : null })).filter(keep);
  const T = RG.mode === "aw" ? { l: "Awareness total", sk: "aw_spend", vk: null, _class: "total" } : { l: "Total performance spend · RoAS on Shopify revenue", sk: "perf_all_spend", vk: "sh_sales", _class: "total" };
  const rows = [...asRows(RG.mode === "aw" ? aw : perf), T];
  if (RG.mode === "all") rows.push(...asRows([...aw, ["Social (Reach)", "meta_social_spend", null]]).map((r) => ({ ...r, l: r.l + " · not in RoAS", vk: null })));
  const roas = (X, sk, vk) => (X && vk && X[sk] && X[vk] != null ? X[vk] / X[sk] : null);
  const [hp, hc] = d1Th(g);
  const cols = [{ label: "Channel", text: true, render: (r) => esc(r.l) }];
  if (PW) cols.push({ label: `Spend · ${hp}`, render: (r) => cell(PW[r.sk], "inr", rgNa(PW, r.sk)) });
  cols.push({ label: `Spend · ${hc}`, render: (r) => cell(W[r.sk], "inr", rgNa(W, r.sk)) });
  if (PW) cols.push({ label: "Δ %", render: (r) => deltaHtml(d1Pct(W[r.sk], PW[r.sk], r.sk, "inr", nc, np), "spend") });
  if (showRoas) {
    if (PW) cols.push({ label: `ROAS · ${hp}`, render: (r) => (r.vk ? cell(roas(PW, r.sk, r.vk), "x", rgNa(PW, r.vk)) : '<span class="flat" title="not in RoAS, or no revenue reported for this channel">–</span>') });
    cols.push({ label: `ROAS · ${hc}`, render: (r) => (r.vk ? cell(roas(W, r.sk, r.vk), "x", rgNa(W, r.vk)) : '<span class="flat" title="not in RoAS, or no revenue reported for this channel">–</span>') });
    if (PW) cols.push({ label: "Δ ROAS", render: (r) => deltaHtml(r.vk ? d1Pct(roas(W, r.sk, r.vk), roas(PW, r.sk, r.vk), "x", "x", 1, 1) : null, "roas") });
  }
  let s = "";
  if (W[T.sk] != null) {
    s = `<b>${RG.mode === "aw" ? "Awareness spend" : "Performance spend"} ${d1Money(W[T.sk])}${PW ? `, ${d1Move(d1Pct(W[T.sk], PW?.[T.sk], "s", "inr", nc, np))}${nc !== np ? " per day" : ""}` : ""}</b>${showRoas ? `; RoAS ${PW ? `${fmt(roas(PW, T.sk, T.vk), "x") ?? "n/a"} → ` : ""}${fmt(roas(W, T.sk, T.vk), "x") ?? "n/a"}` : ""}.`;
    const ch = rows.filter((r) => r !== T).filter((r) => PW && W[r.sk] != null && PW[r.sk] != null).map((r) => ({ ...r, d: d1Diff(W[r.sk], PW[r.sk], r.sk, "inr", nc, np) })).sort((x, y) => Math.abs(y.d) - Math.abs(x.d))[0];
    if (ch && ch.d) s += ` ${esc(ch.l)} moved spend the most (${d1Sign(ch.d)}${d1Money(Math.abs(ch.d))}${nc !== np ? " a day" : ""}).`;
  } else s = `Spend is not complete for these days: ${esc(rgNa(W, T.sk) || "")}.`;
  return { html: d1Section(7, RG.mode === "aw" ? "Awareness spend" : "Spend & ROAS", RG.mode === "aw" ? "awareness campaigns: what they cost; there is no ROAS for awareness" : "RoAS is Shopify revenue over performance spend; a channel's row is its own reported revenue over its spend", s, table(cols, rows)), line: s };
}

// ---------------------------------------------------------------- detail: day by day, drill-down
function d1DayTable(g, e) {
  const F = D1_F[RG.mode] || D1_F.perf;
  const span = (s) => (s ? rgSpan(s[0], s[1]) : "no matching period");
  const fix = (w, extra) => { const na = { ...w.na }; for (const k of Object.keys(RG_DEP)) { const x = rgNa(w, k); if (x) na[k] = x; } return { ...w, ...extra, na }; };
  const dayRows = (list) => list.map((d) => fix(e.windowOf([d]), { date: d }));
  const head = `<tr><th class="text" scope="col">Day</th>${F.map(([, l]) => `<th scope="col">${esc(l)}</th>`).join("")}</tr>`;
  const rows = [];
  if (g.pw) rows.push({ _group: `Comparison · ${g.phase === "sale" ? "sale days" : "BAU days"} · ${span(g.prevSpan)}` }, ...dayRows(g.prev), fix(g.pw, { _label: "Total", _class: "total" }));
  rows.push({ _group: `Selected · ${g.phase === "sale" ? "sale days" : "BAU days"} · ${span(g.curSpan)}` }, ...dayRows(g.cur), fix(g.w, { _label: "Total", _class: "total" }));
  if (g.pw) rows.push({ _label: "Change", _class: "delta", _delta: true });
  const body = rows.map((r) => {
    if (r._group) return `<tr class="group"><td colspan="${F.length + 1}">${esc(r._group)}</td></tr>`;
    return `<tr class="${r._class || ""}"><td class="text">${r._label ? esc(r._label) : esc(dayLabel(r.date))}</td>${F.map(([k, , u]) => `<td>${r._delta ? deltaHtml(g.change(k), k) : cell(r[k], u, r.na?.[k])}</td>`).join("")}</tr>`;
  }).join("");
  return `<div class="table-wrap"><table><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}
const D1_DRILLS = [["channel", "Channel"], ["source", "Source"], ["campaign", "Campaign"], ["landing_page", "Landing page"], ["product", "Product"]];
function d1DrillTable(g) {
  const dim = state.drill, dd = state.pages.drill_days;
  if (dim !== "product" && (!dd || !dd[dim])) return '<p class="na">Data unavailable: the drill-down data appears after the next refresh.</p>';
  const cur = g.cur || [], prev = g.prev && g.prev.length ? g.prev : [], perDay = prev.length && cur.length !== prev.length;
  let C, P, nameOf, kindOf;
  if (dim === "product") {
    const pd = state.pages.product_days;
    const sum = (days) => { const set = new Set(days), m = new Map(); for (const [d, i, u, rev] of pd.rows) { if (!set.has(d)) continue; const a = m.get(i) || m.set(i, { units: 0, revenue: 0 }).get(i); a.units += u; a.revenue += rev; } return m; };
    C = sum(cur); P = prev.length ? sum(prev) : new Map(); nameOf = (i) => pd.names[i].label; kindOf = () => null;
  } else {
    C = d1Collect(dim, cur); P = prev.length ? d1Collect(dim, prev) : new Map(); nameOf = (i) => dd[dim].names[i].key; kindOf = (i) => dd[dim].names[i].kind;
  }
  const sortKey = dim === "product" ? "revenue" : "sessions", RATE = new Set(["atc_rate", "cvr"]);
  const rows = [...new Set([...C.keys(), ...P.keys()])].map((i) => {
    const c = { ...(C.get(i) || {}) }, q = { ...(P.get(i) || {}) };
    for (const side of [c, q]) { side.atc_rate = side.sessions ? side.atc / side.sessions : null; side.cvr = side.sessions ? side.orders / side.sessions : null; }
    const delta = {};
    for (const k of new Set([...Object.keys(c), ...Object.keys(q)])) delta[k] = !q[k] ? null : perDay && !RATE.has(k) ? ((c[k] ?? 0) / cur.length) / (q[k] / prev.length) - 1 : (c[k] ?? 0) / q[k] - 1;
    return { key: nameOf(i) || "(unknown)", kind: kindOf(i), current: c, prior: q, delta, _s: Math.max(c[sortKey] || 0, q[sortKey] || 0) };
  }).filter((r) => r._s > 0).sort((x, y) => y._s - x._s).slice(0, 50);
  const fields = dim === "product" ? [["units", "Units", "num"], ["revenue", "Revenue", "inr"]]
    : dim === "landing_page" ? [["sessions", "Sessions", "num"], ["atc", "ATC", "num"], ["atc_rate", "Sessions → ATC", "pct"], ["ic", "IC (GoKwik)", "num"], ["converted", "Converted (GoKwik)", "num"]]
    : [["sessions", "Sessions", "num"], ...(RG.mode === "aw" ? [] : [["perf_sessions", "Perf sessions", "num"]]), ["atc", "ATC", "num"], ["atc_rate", "Sessions → ATC", "pct"], ["ic", "IC", "num"], ["orders", "Orders", "num"], ["gmv", "Revenue", "inr"]];
  const cols = [{ label: D1_DRILLS.find((d) => d[0] === dim)[1], text: true, render: (r) => `${esc(r.key)}${dim === "campaign" && r.kind === "awareness" ? ' <span class="phase sale">Awareness</span>' : ""}` },
    ...fields.map(([k, l, u]) => ({ label: l, render: (r) => `${esc(fmt(r.current[k], u, true) ?? "–")}${prev.length ? `<br><span class="sub">${esc(fmt(r.prior[k], u, true) ?? "–")} · ${deltaHtml(r.delta[k], k)}</span>` : ""}` }))];
  const gaps = [];
  if (dd && dd.from && cur.some((d) => d < dd.from)) gaps.push(`Drill-down detail starts ${rgFmtDay(dd.from, true)}; earlier days are not in it.`);
  if (RG.mode !== "all" && dim === "product") gaps.push("Products are for the whole store: orders cannot be split by campaign type.");
  if (RG.mode !== "all" && dim === "landing_page") gaps.push("Landing-page sessions are for the whole store; IC and conversions follow the switch.");
  return (gaps.length ? `<div class="banner">${esc(gaps.join(" "))}</div>` : "") + table(cols, rows, { maxHeight: "65vh" });
}

// ---------------------------------------------------------------- the tab
R.d1 = (p) => {
  const c = p.commentary, stdFrom = p.current.start, stdTo = p.current.end;
  const stdWin = `${p.prior.start ? `${rgFmtDay(p.prior.start)}–${rgFmtDay(p.prior.end, true)}` : "no prior window"} vs ${stdFrom ? `${rgFmtDay(stdFrom)}–${rgFmtDay(stdTo, true)}` : "–"}`;
  rgTab("d1", ["slab_days", "drill_days", "product_days"], "", () => {
    const draw = () => {
      const e = d1Eng(), cmp = e.compare(RG.from, RG.to, RG.cmp);
      const host = document.getElementById("rg-body");
      if (!cmp.groups.length) { host.innerHTML = `<section class="card"><p class="na">Data unavailable: there are no days in the data for ${esc(rgSpan(RG.from, RG.to))}.</p></section>`; return; }
      const [g, ctl] = rgPhasePick(cmp, "d1-phase");
      const parts = [d1Overview(g), d1Traffic(g), d1Funnel(g), d1Basket(g), d1Products(g), d1Retention(g), d1Spend(g)];
      const onStd = RG.from === stdFrom && RG.to === stdTo && c?.text;
      const summary = `<section class="card d1-summary">
        <div class="section-head"><h2>Summary ${phaseChip(g.phase)}</h2>${ctl}<span class="sub">${esc(rgVsText(g, "cur"))}${g.pw ? ` · compared with ${esc(rgVsText(g, "prev"))}` : " · no comparison"}</span></div>
        ${cmp.groups.length > 1 ? `<div class="banner">These dates hold both sale and BAU days; this report covers the ${g.phase === "sale" ? "sale" : "BAU"} days. Switch above to see the others.</div>` : ""}
        ${cmp.mixed.length ? `<p class="legend-note">${cmp.mixed.length} day${cmp.mixed.length === 1 ? "" : "s"} when a sale went live or ended (${esc(rgListDays(cmp.mixed))}) are left out, because they are neither.</p>` : ""}
        <ol class="d1-points">${parts.map((x, i) => (x.line ? `<li value="${i + 1}"><a href="#d1-s${i + 1}">${x.whole && RG.mode !== "all" ? '<span class="chip">Whole store</span> ' : ""}${x.line}</a></li>` : "")).join("")}</ol>
        ${onStd ? `<details class="d1-commentary" open><summary>What moved, and why · written by Claude (${esc(c.model || "")})</summary><div class="commentary">${esc(c.text)}</div></details>`
          : c?.text ? `<p class="legend-note">Claude's written commentary covers ${esc(stdWin)}. <button type="button" class="rg-btn" id="d1-std">Show those dates</button></p>` : ""}
      </section>`;
      const sections = parts.map((x, i) => x.html.replace('<section class="card d1-sec"', `<section class="card d1-sec" id="d1-s${i + 1}"`)).join("");
      const detail = `
        <details class="card rg-all"><summary>Day by day · every metric for every day</summary>${d1DayTable(g, e)}</details>
        <section class="card"><div class="section-head"><h2>Drill-down</h2><span class="sub">explore any dimension for these dates · current, then comparison · Δ${g.prev && g.prev.length && g.prev.length !== g.cur.length ? " (per day)" : ""}</span></div>
          <div class="seg" role="group" aria-label="Drill-down dimension">${D1_DRILLS.map(([k, l]) => `<button type="button" data-drill="${k}" aria-pressed="${k === state.drill}">${l}</button>`).join("")}</div>
          <div id="drill">${d1DrillTable(g)}</div></section>
        <section class="card">${notes(p)}</section>`;
      host.innerHTML = summary + sections + detail;
      host.querySelectorAll("[data-drill]").forEach((b) => b.addEventListener("click", () => {
        state.drill = b.dataset.drill;
        host.querySelectorAll("[data-drill]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
        document.getElementById("drill").innerHTML = d1DrillTable(g);
      }));
      rgPhaseBind("d1-phase", draw);
      document.getElementById("d1-std")?.addEventListener("click", () => {
        RG.from = stdFrom; RG.to = stdTo; RG.preset = "custom";
        RG.cmp = p.prior.start ? { mode: "custom", from: p.prior.start, to: p.prior.end } : { mode: "none" }; RG.cmpAuto = false;
        rgChanged();
      });
    };
    draw();
  });
};
