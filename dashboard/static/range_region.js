/* Region: where orders come from. A map of India coloured by the metric you
   pick (hover a state for its numbers, click it to zoom in), the place you are
   looking at (All India > state > city) with its five headline numbers, the
   ranked states or cities, and the products bought there.

   Numbers are Shopify's own Sales report by the shipping address, the same
   as D-1: Revenue is Total sales, Orders counts cancelled orders too. Items
   and basket size leave out gifts and merch, as on the Products tab. Changes
   compare per-day averages when the periods differ in length; sale days are
   compared with sale days, BAU with BAU, like every other tab.
   Inlined after range_d1.js, inside the dashboard closure. */

const RGN = { metric: "sales", state: null, city: null, sort: { k: "sales", d: -1 }, psort: { k: "sales", d: -1 }, allRows: false, sku: {}, vb: null, anim: 0 };
const RGN_METRICS = [["sales", "Total sales"], ["orders", "Orders"], ["aov", "AOV"], ["paid", "Items"], ["basket", "Items per order"]];
const RGN_RATE = new Set(["aov", "basket", "share"]);
const RGN_MIN_ORDERS = 20; // a place needs this many orders before its AOV or basket size is ranked

const rgnFmt = (v, k, compact) => {
  if (v == null || !isFinite(v)) return "–";
  if (k === "sales" || k === "aov") return fmt(v, "inr", compact);
  if (k === "basket") return v.toFixed(2);
  if (k === "share") return (v * 100).toFixed(1) + "%";
  return fmt(Math.round(v), "int");
};
const rgnPct = (d) => (d == null || !isFinite(d) ? "–" : `${d >= 0 ? "+" : "−"}${Math.abs(d * 100).toFixed(1)}%`);

// ---------------------------------------------------------------- sums
function rgnPlaces(days) {
  const P = state.pages.region_days, set = new Set(days || []), skuSet = new Set(P.sku_days || []);
  const city = new Map(), st = new Map();
  const add = (m, k) => m.get(k) || m.set(k, { orders: 0, sales: 0, qty: 0, paid: 0, paidDays: new Set(), days: new Set() }).get(k);
  for (const [di, ci, o, s, q, paid] of P.rows) {
    const d = P.dates[di];
    if (!set.has(d)) continue;
    for (const a of [add(city, ci), add(st, P.cities[ci].s), add(st, -1)]) {
      a.orders += o; a.sales += s; a.qty += q; a.days.add(d);
      if (paid != null && skuSet.has(d)) { a.paid += paid; a.paidDays.add(d); }
    }
  }
  const noSku = (days || []).filter((d) => !skuSet.has(d));
  return { city, st, all: st.get(-1) || { orders: 0, sales: 0, qty: 0, paid: 0, paidDays: new Set(), days: new Set() }, noSku };
}
// the value of one metric for one place; items and basket only when the product detail covers every day
function rgnVal(a, k, noSku) {
  if (!a) return null;
  if (k === "sales") return a.sales;
  if (k === "orders") return a.orders;
  if (k === "aov") return a.orders ? a.sales / a.orders : null;
  if (noSku && noSku.length) return null;
  if (k === "paid") return a.paid;
  if (k === "basket") return a.ipo !== undefined ? a.ipo : a.orders ? a.paid / a.orders : null;
  return null;
}
function rgnChange(k, a, b, nc, np, noSkuA, noSkuB) {
  const x = rgnVal(a, k, noSkuA), y = rgnVal(b, k, noSkuB);
  if (x == null || y == null || !y) return null;
  return RGN_RATE.has(k) ? x / y - 1 : (x / Math.max(nc, 1)) / (y / Math.max(np, 1)) - 1;
}
function rgnProducts(days, scope) {
  const P = state.pages.region_days, set = new Set(days || []), m = new Map();
  const add = (pi, o, s, q) => { const a = m.get(pi) || m.set(pi, { orders: 0, sales: 0, qty: 0 }).get(pi); a.orders += o; a.sales += s; a.qty += q; };
  if (scope.city != null) {
    const rows = (RGN.sku[scope.key] || {}).rows || [];
    for (const [di, ci, pi, o, s, q] of rows) if (ci === scope.city && set.has(P.dates[di])) add(pi, o, s, q);
  } else {
    for (const [di, si, pi, o, s, q] of (RGN.sku.all || {}).rows || []) if ((scope.state == null || si === scope.state) && set.has(P.dates[di])) add(pi, o, s, q);
  }
  return m;
}

// ---------------------------------------------------------------- the map
function rgnClasses(values) {
  // quantile bins over the states that have orders: Maharashtra alone would wash out a linear scale
  const v = values.filter((x) => x != null && x > 0).sort((a, b) => a - b);
  if (!v.length) return { cut: [], cls: () => -1 };
  const n = Math.min(6, v.length), cut = [];
  for (let i = 1; i < n; i++) cut.push(v[Math.floor((i * v.length) / n)]);
  return { cut, n, lo: v[0], hi: v[v.length - 1], cls: (x) => (x == null || x <= 0 ? -1 : cut.filter((c) => x >= c).length) };
}
function rgnMapHtml(M, vals, bins) {
  const P = state.pages.region_days;
  const sIndex = new Map(); P.states.forEach((s, i) => s.map.forEach((id) => sIndex.set(id, i)));
  const paths = M.states.map((sh) => {
    const si = sIndex.get(sh.id), c = si == null ? -1 : bins.cls(vals[si]);
    const sel = RGN.state === si ? " sel" : "";
    const name = si == null ? sh.name : P.states[si].name;
    return `<path d="${sh.d}" data-s="${si ?? ""}" class="rgn-st c${c}${sel}" tabindex="0" role="button" aria-label="${esc(name)}"></path>`;
  }).join("");
  const n = bins.n || 0, steps = [];
  for (let i = 0; i < n; i++) steps.push(`<span class="c${i}"></span>`);
  const lab = (x) => rgnFmt(x, RGN.metric, true);
  return `<div class="rgn-map" id="rgn-map">
      <svg viewBox="${RGN.vb || M.viewBox}" data-full="${M.viewBox}" role="group" aria-label="Map of India by state">${paths}</svg>
      <div class="rgn-tip" id="rgn-tip" hidden></div>
      ${RGN.state != null ? '<button type="button" class="rgn-back" data-crumb="all" aria-label="Back to all of India">← All India</button>' : ""}
    </div>
    <div class="rgn-legend">${n ? `<span>${esc(lab(bins.lo))}</span><span class="rgn-ramp">${steps.join("")}</span><span>${esc(lab(bins.hi))}</span>` : ""}<span class="rgn-none"><i></i> ${RGN_RATE.has(RGN.metric) ? `under ${RGN_MIN_ORDERS} orders` : "no orders"}</span></div>
    <p class="rgn-attr">${esc(M.attribution || "")}</p>`;
}
// zoom the map to a state, or back out to India: the viewBox eases between the two
function rgnZoom(svg, target) {
  const parse = (s) => s.split(/[ ,]+/).map(Number);
  const from = parse(svg.getAttribute("viewBox")), to = parse(target);
  const t0 = performance.now(), dur = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 450;
  cancelAnimationFrame(RGN.anim);
  const step = (t) => {
    const k = dur ? Math.min(1, (t - t0) / dur) : 1, e = 1 - Math.pow(1 - k, 3);
    svg.setAttribute("viewBox", from.map((v, i) => v + (to[i] - v) * e).map((v) => v.toFixed(1)).join(" "));
    if (k < 1) RGN.anim = requestAnimationFrame(step);
  };
  RGN.anim = requestAnimationFrame(step);
  RGN.vb = target;
}
function rgnFocusBox(svg, si) {
  const full = svg.dataset.full.split(" ").map(Number);
  const els = [...svg.querySelectorAll(`path[data-s="${si}"]`)];
  if (!els.length) return svg.dataset.full;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const el of els) { const b = el.getBBox(); x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.width); y1 = Math.max(y1, b.y + b.height); }
  // keep some of the neighbours in view, and never zoom in further than a 140-unit box
  const w = Math.max(x1 - x0, 140), h = Math.max(y1 - y0, 140), pad = Math.max(w, h) * 0.22;
  const size = Math.max(w * full[3] / full[2], h) + pad * 2, sw = size * full[2] / full[3];
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  return `${(cx - sw / 2).toFixed(1)} ${(cy - size / 2).toFixed(1)} ${sw.toFixed(1)} ${size.toFixed(1)}`;
}

// ---------------------------------------------------------------- pieces
function rgnTiles(a, b, nc, np, noA, noB) {
  const t = (k, label, sub) => {
    const v = rgnVal(a, k, noA), ch = b ? rgnChange(k, a, b, nc, np, noA, noB) : null;
    const why = v == null && (k === "paid" || k === "basket") ? "product detail fills in over the next refreshes" : "no orders";
    return `<div class="tile rgn-tile${RGN.metric === k ? " on" : ""}"><div class="label">${esc(label)}</div>
      ${v == null ? `<div class="na">${esc(why)}</div>` : `<div class="value">${esc(rgnFmt(v, k, true))}</div>`}
      <div class="foot">${b ? (ch == null ? "<span>–</span>" : deltaHtml(ch, k === "sales" ? "gmv" : k)) : "<span>no comparison</span>"}${b && rgnVal(b, k, noB) != null ? `<span>vs ${esc(rgnFmt(rgnVal(b, k, noB), k, true))}</span>` : ""}</div>
      ${sub ? `<div class="foot sub">${sub}</div>` : ""}</div>`;
  };
  const per = a && a.orders && nc > 1 ? `${esc(rgnFmt(a.sales / nc, "sales", true))} a day` : "";
  return `<div class="rgn-tiles">${t("sales", "Total sales", per)}${t("orders", "Orders")}${t("aov", "AOV")}${t("paid", "Items", "gifts &amp; merch left out")}${t("basket", "Items per order", a && a.ipo !== undefined ? "as on Products" : "by shipping address")}</div>`;
}
function rgnRank(list, k, total) {
  // ranked bars of the top places by the chosen metric
  const rate = RGN_RATE.has(k);
  const pool = list.filter((r) => r.v != null && (!rate || r.a.orders >= RGN_MIN_ORDERS)).sort((x, y) => y.v - x.v).slice(0, 8);
  if (!pool.length) return '<p class="na">No places with enough orders to rank.</p>';
  const max = pool[0].v || 1;
  return `<ol class="rgn-rank">${pool.map((r) => `<li><button type="button" data-${r.kind}="${r.i}">
      <span class="rgn-rn">${esc(r.name)}</span><span class="rgn-rv">${esc(rgnFmt(r.v, k, true))}${!rate && total ? `<small>${((r.v / total) * 100).toFixed(1)}%</small>` : ""}</span>
      <span class="rgn-rb"><i style="width:${Math.max(2, (r.v / max) * 100).toFixed(1)}%"></i></span></button></li>`).join("")}</ol>
    ${rate ? `<p class="legend-note">Places with ${RGN_MIN_ORDERS}+ orders, so a handful of orders cannot top the list.</p>` : ""}`;
}
function rgnSortable(cols, rows, sortState, id, rowAttr) {
  const s = sortState, sorted = [...rows].sort((x, y) => {
    const a = x[s.k], b = y[s.k];
    if (typeof a === "string" || typeof b === "string") return s.d * String(a || "").localeCompare(String(b || ""));
    return s.d * ((a ?? -Infinity) - (b ?? -Infinity));
  });
  const head = cols.map((c) => `<th class="${c.text ? "text" : ""}" scope="col">${c.sort === false ? esc(c.label) : `<button type="button" class="rgn-sort${s.k === c.k ? " on" : ""}" data-sort="${c.k}" data-table="${id}">${esc(c.label)}${s.k === c.k ? (s.d < 0 ? " ↓" : " ↑") : ""}</button>`}</th>`).join("");
  const body = sorted.map((r) => `<tr ${rowAttr(r)}>${cols.map((c) => `<td class="${c.text ? "text" : ""}">${c.render(r)}</td>`).join("")}</tr>`).join("");
  return `<div class="table-wrap rgn-table"><table><thead><tr>${head}</tr></thead><tbody>${body || `<tr><td colspan="${cols.length}" class="text na">No orders in these dates.</td></tr>`}</tbody></table></div>`;
}
const rgnDelta = (d, k) => (d == null ? '<span class="flat">–</span>' : deltaHtml(d, k));

// ---------------------------------------------------------------- insights
function rgnPlaceInsights(rows, total, scopeName, child, nat) {
  const out = [];
  const byRev = [...rows].filter((r) => r.a.sales > 0).sort((x, y) => y.a.sales - x.a.sales);
  if (byRev.length && total) {
    const top = byRev[0], top3 = byRev.slice(0, 3).reduce((t, r) => t + r.a.sales, 0);
    out.push(`<b>${esc(top.name)} brings ${((top.a.sales / total) * 100).toFixed(1)}% of ${esc(scopeName)}'s revenue</b>; the top three ${child} bring ${((top3 / total) * 100).toFixed(0)}%${byRev.length > 3 ? ` (of ${byRev.length} ${child} with orders)` : ""}.`);
  }
  const moved = rows.filter((r) => r.dSales != null && r.b && r.b.orders >= RGN_MIN_ORDERS);
  if (moved.length) {
    const up = [...moved].sort((x, y) => y.dAbs - x.dAbs)[0], down = [...moved].sort((x, y) => x.dAbs - y.dAbs)[0];
    const bits = [];
    if (up.dAbs > 0) bits.push(`<b>${esc(up.name)}</b> added the most revenue (${rgnPct(up.dSales)}, +${esc(fmt(up.dAbs, "inr", true))}${up.perDay ? " a day" : ""})`);
    if (down.dAbs < 0) bits.push(`<b>${esc(down.name)}</b> lost the most (${rgnPct(down.dSales)}, −${esc(fmt(Math.abs(down.dAbs), "inr", true))}${down.perDay ? " a day" : ""})`);
    if (bits.length) out.push(bits.join("; ") + ".");
  }
  const big = rows.filter((r) => r.a.orders >= RGN_MIN_ORDERS && r.aov != null);
  if (big.length >= 3 && nat) {
    const hi = [...big].sort((x, y) => y.aov - x.aov)[0], lo = [...big].sort((x, y) => x.aov - y.aov)[0];
    out.push(`AOV runs from <b>${esc(fmt(lo.aov, "inr"))} in ${esc(lo.name)}</b> to <b>${esc(fmt(hi.aov, "inr"))} in ${esc(hi.name)}</b> (${esc(scopeName)}: ${esc(fmt(nat, "inr"))}), among ${child} with ${RGN_MIN_ORDERS}+ orders.`);
  }
  return out;
}
function rgnProductInsights(rows, total, scopeName, natShare) {
  const out = [];
  const paid = rows.filter((r) => !r.gift && r.sales > 0).sort((x, y) => y.sales - x.sales);
  if (paid.length && total) {
    const t = paid[0];
    out.push(`<b>${esc(t.name)} is ${((t.sales / total) * 100).toFixed(1)}% of product revenue in ${esc(scopeName)}</b>${natShare && natShare.has(t.p) ? ` (${(natShare.get(t.p) * 100).toFixed(1)}% across India)` : ""}.`);
  }
  if (natShare && total) {
    // what sells unusually well (or badly) here against the whole country
    const idx = paid.filter((r) => r.orders >= 10 && natShare.get(r.p)).map((r) => ({ ...r, ix: r.sales / total / natShare.get(r.p) }));
    const over = [...idx].sort((x, y) => y.ix - x.ix)[0], under = [...idx].sort((x, y) => x.ix - y.ix)[0];
    if (over && over.ix >= 1.25) out.push(`<b>${esc(over.name)} over-sells here</b>: ${(over.ix).toFixed(1)}× its share across India.`);
    if (under && under.ix <= 0.75 && under !== over) out.push(`<b>${esc(under.name)} under-sells here</b>: ${(under.ix).toFixed(2)}× its share across India.`);
  }
  const moved = rows.filter((r) => r.dSales != null && r.bOrders >= 10);
  if (moved.length) {
    const up = [...moved].sort((x, y) => y.dAbs - x.dAbs)[0], down = [...moved].sort((x, y) => x.dAbs - y.dAbs)[0];
    const bits = [];
    if (up.dAbs > 0) bits.push(`<b>${esc(up.name)}</b> grew the most (${rgnPct(up.dSales)})`);
    if (down.dAbs < 0) bits.push(`<b>${esc(down.name)}</b> fell the most (${rgnPct(down.dSales)})`);
    if (bits.length) out.push(bits.join("; ") + ".");
  }
  return out;
}
const rgnInsightBox = (pts) => (pts.length ? `<div class="d1-insight"><div class="d1-ins-h">What this says</div><ul>${pts.map((x) => `<li>${x}</li>`).join("")}</ul></div>` : "");

// ---------------------------------------------------------------- the tab
R.region = (p) => {
  const head = p.available ? "" : `<section class="card"><h2>Region</h2><p class="na">Data unavailable: ${esc(p.na || "region data has not been pulled yet")}. It is pulled from Shopify on the next refresh.</p></section>`;
  rgTab("region", p.available ? ["region_days", "slab_days"] : [], head, () => {
    if (!p.available) { document.getElementById("rg-body").innerHTML = ""; return; }
    const draw = async () => {
      const P = state.pages.region_days, e = RG.eng, c = e.compare(RG.from, RG.to, RG.cmp);
      const host = document.getElementById("rg-body");
      if (!c.groups.length) { host.innerHTML = `<section class="card"><p class="na">Data unavailable: no days in the data for ${esc(rgSpan(RG.from, RG.to))}.</p></section>`; return; }
      const [g, ctl] = rgPhasePick(c, "rgn-phase");
      const inData = (list) => (list || []).filter((d) => d >= P.from && d <= P.to);
      const cur = inData(g.cur), prev = inData(g.prev), nc = cur.length, np = prev.length;
      if (!nc) { host.innerHTML = `<section class="card"><p class="na">Data unavailable: region data covers ${esc(rgSpan(P.from, P.to))}.</p></section>`; return; }
      const A = rgnPlaces(cur), B = np ? rgnPlaces(prev) : null;
      const ipo = (days) => { const sl = state.pages.slab_days; if (!sl || !sl.rows) return undefined; const set = new Set(days); let o = 0, u = 0; for (const r of sl.rows) if (set.has(r[0])) { o += r[2]; u += r[3]; } return o ? u / o : undefined; };
      A.all.ipo = ipo(cur); if (B) B.all.ipo = ipo(prev);
      // a state's own page (products by city) when one is open
      const skey = RGN.state != null ? P.states[RGN.state].key : null;
      for (const key of ["all", ...(RGN.city != null && skey ? [skey] : [])]) {
        if (RGN.sku[key]) continue;
        try { RGN.sku[key] = embedded ? (embedded.pages[`region_sku/${key}`] || { rows: [] }) : await getJSON(`/api/region/${key}`); } catch (err) { RGN.sku[key] = { rows: [], na: err.message }; }
        if (state.tab !== "region") return;
      }
      const scopeName = RGN.city != null ? P.cities[RGN.city].name : RGN.state != null ? P.states[RGN.state].name : "India";
      const aScope = RGN.city != null ? A.city.get(RGN.city) : RGN.state != null ? A.st.get(RGN.state) : A.all;
      const bScope = B ? (RGN.city != null ? B.city.get(RGN.city) : RGN.state != null ? B.st.get(RGN.state) : B.all) : null;

      // map values: states by the chosen metric
      // a rate (AOV, basket size) from a handful of orders would paint a state darkest: those stay grey
      const k = RGN.metric, vals = P.states.map((_, si) => {
        const a = A.st.get(si);
        if (!a || (RGN_RATE.has(k) && a.orders < RGN_MIN_ORDERS)) return null;
        return rgnVal(a, k, A.noSku);
      });
      const bins = rgnClasses(vals);

      const prodNow = rgnProducts(cur, { state: RGN.state, city: RGN.city, key: skey });

      // the places under the scope: states (All India) or cities (a state)
      const child = RGN.state == null ? "states" : "cities";
      const placeRows = [];
      const src = RGN.state == null ? [...A.st.keys()].filter((i) => i >= 0) : [...A.city.keys()].filter((ci) => P.cities[ci].s === RGN.state);
      const prevMap = B ? (RGN.state == null ? B.st : B.city) : null;
      for (const i of src) {
        const a = RGN.state == null ? A.st.get(i) : A.city.get(i), b = prevMap ? prevMap.get(i) : null;
        const name = RGN.state == null ? P.states[i].name : P.cities[i].name;
        const dSales = b && b.sales ? (a.sales / nc) / (b.sales / np) - 1 : null;
        placeRows.push({ i, kind: RGN.state == null ? "st" : "ci", name, a, b, sales: a.sales, orders: a.orders, aov: rgnVal(a, "aov"), paid: rgnVal(a, "paid", A.noSku), basket: rgnVal(a, "basket", A.noSku),
          share: aScope && aScope.sales ? a.sales / aScope.sales : null, dSales, dAbs: b ? a.sales / nc - b.sales / np : a.sales / nc, perDay: nc !== np, v: rgnVal(a, k, A.noSku) });
      }
      const scopeTotal = RGN.state == null ? A.all.sales : (A.st.get(RGN.state) || {}).sales;
      const placeCols = [
        { k: "name", label: RGN.state == null ? "State" : "City", text: true, render: (r) => `<span class="rgn-pn">${esc(r.name)}</span>` },
        { k: "sales", label: "Total sales", render: (r) => esc(fmt(r.sales, "inr")) },
        { k: "dSales", label: np ? (nc !== np ? "Δ / day" : "Δ") : "Δ", render: (r) => rgnDelta(r.dSales, "gmv") },
        { k: "share", label: "Share", render: (r) => `<span class="rgn-share"><i style="width:${Math.max(2, Math.round((r.share || 0) * 48))}px"></i>${esc(rgnFmt(r.share, "share"))}</span>` },
        { k: "orders", label: "Orders", render: (r) => esc(rgnFmt(r.orders, "orders")) },
        { k: "aov", label: "AOV", render: (r) => esc(rgnFmt(r.aov, "aov")) },
        { k: "paid", label: "Items", render: (r) => esc(rgnFmt(r.paid, "paid")) },
        { k: "basket", label: "Items per order", render: (r) => esc(rgnFmt(r.basket, "basket")) },
      ];
      const shown = RGN.allRows ? placeRows : [...placeRows].sort((x, y) => y.sales - x.sales).slice(0, 40);
      const placeTable = rgnSortable(placeCols, shown, RGN.sort, "places", (r) => `class="rgn-row${(r.kind === "ci" && r.i === RGN.city) || (r.kind === "st" && r.i === RGN.state) ? " sel" : ""}" data-${r.kind}="${r.i}" tabindex="0"`);
      const more = placeRows.length > 40 ? `<button type="button" class="rg-btn" id="rgn-all">${RGN.allRows ? "Show the top 40" : `Show all ${placeRows.length} ${child}`}</button>` : "";

      // products in scope, with each one's share across India for the over / under-selling read
      const prodPrev = np ? rgnProducts(prev, { state: RGN.state, city: RGN.city, key: skey }) : null;
      const natNow = RGN.state != null ? rgnProducts(cur, {}) : null;
      const natTot = natNow ? [...natNow.entries()].filter(([pi]) => !P.products[pi].gift).reduce((t, [, a]) => t + a.sales, 0) : 0;
      const natShare = natNow && natTot ? new Map([...natNow.entries()].map(([pi, a]) => [pi, a.sales / natTot])) : null;
      const prodRows = [...prodNow.entries()].map(([pi, a]) => {
        const b = prodPrev ? prodPrev.get(pi) : null, pr = P.products[pi];
        return { p: pi, name: pr.name, gift: pr.gift, type: pr.type, sales: a.sales, orders: a.orders, qty: a.qty, aov: a.orders ? a.sales / a.orders : null, upo: a.orders ? a.qty / a.orders : null,
          dSales: b && b.sales ? (a.sales / nc) / (b.sales / np) - 1 : null, dAbs: b ? a.sales / nc - b.sales / np : null, bOrders: b ? b.orders : 0 };
      }).filter((r) => !r.gift); // gifts, merch, books and gummies never count, as everywhere
      const prodTot = prodRows.filter((r) => !r.gift).reduce((t, r) => t + r.sales, 0);
      prodRows.forEach((r) => (r.share = prodTot ? r.sales / prodTot : null));
      const prodCols = [
        { k: "name", label: "Product", text: true, render: (r) => esc(r.name) },
        { k: "sales", label: "Total sales", render: (r) => esc(fmt(r.sales, "inr")) },
        { k: "dSales", label: np ? (nc !== np ? "Δ / day" : "Δ") : "Δ", render: (r) => rgnDelta(r.dSales, "gmv") },
        { k: "share", label: "Share", render: (r) => `<span class="rgn-share"><i style="width:${Math.max(2, Math.round((r.share || 0) * 48))}px"></i>${esc(rgnFmt(r.share, "share"))}</span>` },
        { k: "orders", label: "Orders", render: (r) => esc(rgnFmt(r.orders, "orders")) },
        { k: "aov", label: "AOV", render: (r) => esc(rgnFmt(r.aov, "aov")) },
        { k: "qty", label: "Quantity", render: (r) => esc(rgnFmt(r.qty, "orders")) },
        { k: "upo", label: "Units per order", render: (r) => esc(rgnFmt(r.upo, "basket")) },
      ];
      const skuMissing = cur.filter((d) => !(P.sku_days || []).includes(d));
      const prodNote = skuMissing.length === nc ? `<p class="na">Product detail for these dates fills in over the next refreshes (newest days first).</p>`
        : skuMissing.length ? `<div class="banner">Product detail is missing for ${esc(rgListDays(skuMissing))}; those days are left out of this table and of Items and Items per order.</div>` : "";

      const crumbs = [`<button type="button" data-crumb="all" class="${RGN.state == null ? "on" : ""}">All India</button>`];
      if (RGN.state != null) crumbs.push(`<button type="button" data-crumb="state" class="${RGN.city == null ? "on" : ""}">${esc(P.states[RGN.state].name)}</button>`);
      if (RGN.city != null) crumbs.push(`<button type="button" data-crumb="city" class="on">${esc(P.cities[RGN.city].name)}</button>`);
      const shareOfIndia = RGN.state != null && A.all.sales ? `<span class="chip">${(((aScope || {}).sales || 0) / A.all.sales * 100).toFixed(1)}% of India's revenue</span>` : "";
      const rankList = RGN.state == null
        ? placeRows.map((r) => ({ ...r, kind: "st" }))
        : placeRows.map((r) => ({ ...r, kind: "ci" }));
      host.innerHTML = `
        ${ctl ? `<div class="d1-lead">${ctl}<span class="sub">These dates hold both sale and BAU days; this view covers the ${g.phase === "sale" ? "sale" : "BAU"} days.</span></div>` : ""}
        <section class="card rgn-hero" data-component="region-map">
          <div class="rgn-top">
            <nav class="rgn-crumbs" aria-label="Where you are">${crumbs.join('<span aria-hidden="true">›</span>')}</nav>
            <div class="seg rgn-metric" role="group" aria-label="Colour the map by">${RGN_METRICS.map(([mk, ml]) => `<button type="button" data-metric="${mk}" aria-pressed="${RGN.metric === mk}">${ml}</button>`).join("")}</div>
          </div>
          <div class="rgn-grid">
            <div class="rgn-left">${rgnMapHtml(p.map, vals, bins)}</div>
            <div class="rgn-right">
              <div class="rgn-scope"><h2>${esc(scopeName)}</h2>${shareOfIndia}<span class="sub">${esc(rgVsText(g, "cur"))}${np ? ` · vs ${esc(rgVsText(g, "prev"))}` : ""}</span></div>
              ${rgnTiles(aScope, bScope, nc, np, A.noSku, B ? B.noSku : null)}
              <h3 class="rgn-h3">Top ${child} by ${esc(RGN_METRICS.find((m) => m[0] === k)[1].toLowerCase())}</h3>
              ${rgnRank(rankList, k, RGN_RATE.has(k) ? null : scopeTotal)}
            </div>
          </div>
        </section>
        <section class="card" data-component="region-places">
          <div class="section-head"><h2>${RGN.state == null ? "States" : `Cities in ${esc(P.states[RGN.state].name)}`}</h2><span class="sub">click a row to open it · sort by any column</span></div>
          ${placeTable}${more}
          ${rgnInsightBox(rgnPlaceInsights(placeRows, scopeTotal, RGN.state == null ? "India" : P.states[RGN.state].name, child, rgnVal(RGN.state == null ? A.all : A.st.get(RGN.state), "aov")))}
        </section>
        <section class="card" data-component="region-products">
          <div class="section-head"><h2>Products · ${esc(scopeName)}</h2><span class="sub">gifts, merch, books and gummies left out</span></div>
          ${prodNote}${rgnSortable(prodCols, prodRows, RGN.psort, "products", () => "")}
          
          ${rgnInsightBox(rgnProductInsights(prodRows, prodTot, scopeName, RGN.state != null ? natShare : null))}
        </section>
        `;
      rgnBind(host, draw);
      rgPhaseBind("rgn-phase", draw);
    };
    draw();
  });
};

function rgnBind(host, draw) {
  const P = state.pages.region_days;
  const openState = (si) => { RGN.state = si; RGN.city = null; RGN.allRows = false; draw().then(() => { const svg = host.querySelector(".rgn-map svg"); if (svg) rgnZoom(svg, rgnFocusBox(svg, si)); }); };
  const openCity = (ci) => { RGN.state = P.cities[ci].s; RGN.city = ci; draw(); };
  const toAll = () => { RGN.state = null; RGN.city = null; RGN.allRows = false; draw().then(() => { const svg = host.querySelector(".rgn-map svg"); if (svg) rgnZoom(svg, svg.dataset.full); RGN.vb = null; }); };
  // the body element lives as long as this visit to the tab: bind its clicks once
  if (!host.dataset.rgnBound) host.dataset.rgnBound = "1"; else return rgnHover(host);
  host.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-metric],[data-crumb],[data-st],[data-ci],[data-sort],#rgn-all,path[data-s]");
    if (!b) return;
    if (b.dataset.metric) { RGN.metric = b.dataset.metric; return draw(); }
    if (b.dataset.crumb === "all") return toAll();
    if (b.dataset.crumb === "state") { RGN.city = null; return draw(); }
    if (b.dataset.sort) {
      const s = b.dataset.table === "places" ? RGN.sort : RGN.psort;
      if (s.k === b.dataset.sort) s.d = -s.d; else { s.k = b.dataset.sort; s.d = b.dataset.sort === "name" ? 1 : -1; }
      return draw();
    }
    if (b.id === "rgn-all") { RGN.allRows = !RGN.allRows; return draw(); }
    if (b.dataset.s !== undefined) { if (b.dataset.s === "") return; const si = +b.dataset.s; return si === RGN.state && RGN.city == null ? toAll() : openState(si); }
    if (b.dataset.st !== undefined) return openState(+b.dataset.st);
    if (b.dataset.ci !== undefined) return openCity(+b.dataset.ci);
  });
  host.addEventListener("keydown", (ev) => {
    if ((ev.key === "Enter" || ev.key === " ") && ev.target.matches("path[data-s], tr[data-st], tr[data-ci]")) { ev.preventDefault(); ev.target.dispatchEvent(new MouseEvent("click", { bubbles: true })); }
  });
  rgnHover(host);
}
// the hover card: name and the numbers that matter, next to the pointer (the map is new on every draw)
function rgnHover(host) {
  const P = state.pages.region_days;
  const map = host.querySelector("#rgn-map"), tip = host.querySelector("#rgn-tip");
  if (!map || !tip) return;
  const c = RG.eng.compare(RG.from, RG.to, RG.cmp), [g] = rgPhasePick(c, "rgn-phase");
  const cur = (g.cur || []).filter((d) => d >= P.from && d <= P.to), A = rgnPlaces(cur);
  const show = (path, x, y) => {
    const si = path.dataset.s === "" ? null : +path.dataset.s;
    const name = si == null ? path.getAttribute("aria-label") : P.states[si].name, a = si == null ? null : A.st.get(si);
    tip.innerHTML = `<b>${esc(name)}</b>${a && a.orders ? `<dl><dt>Total sales</dt><dd>${esc(fmt(a.sales, "inr", true))} · ${((a.sales / (A.all.sales || 1)) * 100).toFixed(1)}%</dd><dt>Orders</dt><dd>${esc(fmt(a.orders, "int"))}</dd><dt>AOV</dt><dd>${esc(rgnFmt(rgnVal(a, "aov"), "aov"))}</dd>${rgnVal(a, "basket", A.noSku) != null ? `<dt>Items per order</dt><dd>${esc(rgnFmt(rgnVal(a, "basket", A.noSku), "basket"))}</dd>` : ""}</dl><small>Click to open</small>` : "<small>No orders in these dates</small>"}`;
    tip.hidden = false;
    const r = map.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
    let left = x - r.left + 14, top = y - r.top + 14;
    if (left + w > r.width) left = x - r.left - w - 14;
    if (top + h > r.height) top = y - r.top - h - 14;
    tip.style.left = Math.max(4, left) + "px"; tip.style.top = Math.max(4, top) + "px";
  };
  map.addEventListener("pointermove", (ev) => { const pth = ev.target.closest("path[data-s]"); if (pth) show(pth, ev.clientX, ev.clientY); else tip.hidden = true; });
  map.addEventListener("pointerleave", () => (tip.hidden = true));
  map.addEventListener("focusin", (ev) => { const pth = ev.target.closest("path[data-s]"); if (pth) { const b = pth.getBoundingClientRect(); show(pth, b.left + b.width / 2, b.top + b.height / 2); } });
  map.addEventListener("focusout", () => (tip.hidden = true));
}
