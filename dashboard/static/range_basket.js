/* Basket size: how many orders, and how much of the sales, came from baskets of
   1, 2, 3, 4 and 5+ items. A basket is the order's items with gifts, merch,
   books and gummies left out, so a free gift never turns a buy-one into a
   buy-two. 1 item is the single-product price, 2 is the "buy 2" offer, 3 the
   "buy 3" and so on, whatever the offer is that day. Sale days are compared
   with sale days and BAU with BAU, like everything else. Inlined after
   range_tree.js, inside the dashboard closure. */

const BK_LABEL = (n, top) => (n === 0 ? "Gifts or merch only" : n >= top ? `${top}+ items` : n === 1 ? "1 item · single" : `${n} items · buy ${n}`);

function bkSum(p, days) {
  const set = new Set(days || []), m = new Map();
  // sales are the orders' own value (total price), so a basket's AOV is real
  for (const [d, slab, orders, units, items, gmv] of p.rows) {
    const sales = gmv == null ? items : gmv;
    if (!set.has(d)) continue;
    const a = m.get(slab) || m.set(slab, { orders: 0, units: 0, sales: 0 }).get(slab);
    a.orders += orders; a.units += units; a.sales += sales;
  }
  return m;
}

function bkHtml(g) {
  const p = state.pages.slab_days;
  if (!p || p.na || !p.rows) return `<p class="na">Data unavailable: ${esc((p && p.na) || "basket size has not been built yet")}.</p>`;
  const have = new Set(p.days);
  const miss = (list) => (list || []).filter((d) => !have.has(d));
  const missCur = miss(g.cur), missPrev = g.prev ? miss(g.prev) : [];
  if (missCur.length === (g.cur || []).length) return `<p class="na">Data unavailable: no basket data for ${esc(rgListDays(g.cur))}.</p>`;
  const cur = bkSum(p, (g.cur || []).filter((d) => have.has(d)));
  const prev = g.prev && g.prev.length && missPrev.length < g.prev.length ? bkSum(p, g.prev.filter((d) => have.has(d))) : null;
  const nCur = (g.cur || []).filter((d) => have.has(d)).length, nPrev = prev ? g.prev.filter((d) => have.has(d)).length : 0;
  const slabs = [...new Set([...cur.keys(), ...(prev ? prev.keys() : [])])].sort((a, b) => a - b);
  const tot = (m) => { const t = { orders: 0, units: 0, sales: 0 }; if (m) for (const a of m.values()) { t.orders += a.orders; t.units += a.units; t.sales += a.sales; } return t; };
  const tc = tot(cur), tp = prev ? tot(prev) : null;
  const pct = (v, t) => (t ? v / t : null);
  const pc = (v) => (v == null ? '<span class="na">–</span>' : esc((v * 100).toFixed(1) + "%"));
  // a change in mix, in percentage points; not good or bad, so not coloured
  const pp = (a, b) => mPpHtml(a == null || b == null ? null : a - b);
  const rows = slabs.filter((s) => s !== 0 || (cur.get(0) || {}).orders).map((s) => {
    const a = cur.get(s) || { orders: 0, units: 0, sales: 0 }, b = prev ? prev.get(s) || { orders: 0, units: 0, sales: 0 } : null;
    const so = pct(a.orders, tc.orders), sp = b ? pct(b.orders, tp.orders) : null;
    const ss = pct(a.sales, tc.sales), ssp = b ? pct(b.sales, tp.sales) : null;
    return { s, label: BK_LABEL(s, p.top), a, b, so, sp, ss, ssp, aov: a.orders ? a.sales / a.orders : null, paov: b && b.orders ? b.sales / b.orders : null,
      dOrders: b && b.orders ? rgAvgChange(a.orders, nCur, b.orders, nPrev) : null };
  });
  const bar = (v) => (v == null ? "" : `<span class="bk-bar" style="width:${Math.max(2, Math.round(v * 100))}%"></span>`);
  const cols = [
    { label: mHead("items_per_order", "Basket"), text: true, render: (r) => esc(r.label) },
    { label: "Orders", render: (r) => esc(fmt(r.a.orders, "int")) },
    { label: "Δ orders", render: (r) => (prev ? deltaHtml(r.dOrders, "orders") : '<span class="flat">–</span>') },
    { label: "Share of orders", render: (r) => `<span class="bk-cell">${bar(r.so)}${pc(r.so)}</span>${r.sp != null ? `<br><span class="sub">vs ${esc((r.sp * 100).toFixed(1))}% · ${pp(r.so, r.sp)}</span>` : ""}` },
    { label: "Sales", render: (r) => esc(fmt(r.a.sales, "inr")) },
    { label: "Share of sales", render: (r) => `${pc(r.ss)}${r.ssp != null ? `<br><span class="sub">vs ${esc((r.ssp * 100).toFixed(1))}% · ${pp(r.ss, r.ssp)}</span>` : ""}` },
    { label: "AOV", render: (r) => (r.aov == null ? '<span class="na">–</span>' : esc(fmt(r.aov, "inr")) + (r.paov != null ? `<br><span class="sub">vs ${esc(fmt(r.paov, "inr"))}</span>` : "")) },
    { label: "Items", render: (r) => (r.a.units == null ? '<span class="flat">–</span>' : esc(fmt(r.a.units, "int"))) },
  ];
  const total = { label: "All orders placed", _class: "total", a: tc, so: 1, sp: tp ? 1 : null, ss: 1, ssp: tp ? 1 : null, aov: tc.orders ? tc.sales / tc.orders : null, paov: tp && tp.orders ? tp.sales / tp.orders : null,
    b: tp, dOrders: tp && tp.orders ? rgAvgChange(tc.orders, nCur, tp.orders, nPrev) : null };
  // reconcile to the headline (Shopify's own Orders and Total sales): collapsed by default
  const days = (g.cur || []).filter((d) => have.has(d));
  const W = days.length ? (RG.engAll || (RG.engAll = createRangeEngine(RG.raw, "all"))).windowOf(days) : null;
  let recon = "";
  if (W && W.orders != null && W.gmv != null) {
    const rid = "bk" + ++trRid;
    const line = (r, cls) => `<tr class="${cls}" data-rid="${rid}" hidden>${cols.map((c) => `<td class="${c.text ? "text" : ""}">${c.render(r)}</td>`).join("")}</tr>`;
    recon = `<tr class="recon-toggle" data-recon="${rid}" tabindex="0" role="button" aria-expanded="false"><td class="text" colspan="${cols.length}">▸ Reconcile to Shopify: cancellations, returns and edits</td></tr>`
      + line({ label: "Cancellations, returns and edits", a: { orders: W.orders - tc.orders, units: null, sales: W.gmv - tc.sales }, so: null, ss: null, aov: null, b: null, dOrders: null }, "recon")
      + line({ label: "Total · Shopify's report (the headline)", a: { orders: W.orders, units: null, sales: W.gmv }, so: null, ss: null, aov: W.orders ? W.gmv / W.orders : null, b: null, dOrders: null }, "total recon");
  }
  const warn = [missCur.length ? `Basket data is missing for ${rgListDays(missCur)}, which are left out.` : "", g.prev && missPrev.length ? `Comparison days without basket data (${rgListDays(missPrev)}) are left out too.` : ""].filter(Boolean).join(" ");
  return (warn ? `<div class="banner">${esc(warn)}</div>` : "") + table(cols, [...rows, total], { full: true }).replace("</tbody>", recon + "</tbody>");
}
