/* Where the money went and what came back, one level at a time:
   channel › funnel stage › product › campaign › ad set › ad.
   Meta: TOF / MOF / BOF / Catalog, then the product (UAS, ITB, ...), both read
   from the ad name where ad-level detail exists, else the campaign name.
   Google: Brand Search / Brand PMax / Non-brand PMax (› product) / Demand Gen.
   Affiliate and CRM come from the spend sheets. Every row opens what is under it.
   Inlined after range_tabs.js's helpers, inside the dashboard closure. */

const TR = { open: new Set(), group: "funnel", flash: null };
const TR_STAGES = ["TOF", "MOF", "BOF", "Catalog"];
const TR_LAST = new Set(["p:OFFER", "p:CATALOG", "p:SETS", "p:UNMAPPED", "gap"]);
try { const s = sessionStorage.getItem("asaya-tree-group"); if (s === "funnel" || s === "campaign") TR.group = s; } catch (e) { /* storage blocked */ }

const trZero = () => ({ spend: 0, value: 0, results: 0, clicks: 0, impr: 0, pspend: 0, pvalue: 0 });
function trInto(a, m, kind, f) {
  a.spend += m[0] * f; a.value += m[1] * f; a.results += m[2] * f; a.clicks += m[3] * f; a.impr += (m[4] || 0) * f;
  if (kind === "perf") { a.pspend += m[0] * f; a.pvalue += m[1] * f; }
}
// rows by date, built once per page
function trByDate(rows, page, slot) {
  if (page[slot]) return page[slot];
  const m = new Map();
  for (const r of rows) (m.get(r[0]) || m.set(r[0], []).get(r[0])).push(r);
  Object.defineProperty(page, slot, { value: m, enumerable: false });
  return m;
}
// add one row's numbers along a path; levels above `from` are left alone
function trAdd(map, path, m, which, kind, f = 1, from = 0) {
  let parent = null;
  path.forEach((seg, i) => {
    let n = map.get(seg.k);
    if (!n) {
      n = { key: (parent ? parent.key + "|" : "") + seg.k, k: seg.k, label: seg.label, sub: seg.sub || null, chip: seg.chip || null, note: seg.note || null, order: seg.order ?? 50, level: i, kinds: new Set(), kids: new Map(), a: trZero(), p: trZero(), splits: new Set() };
      map.set(seg.k, n);
    }
    if (i >= from) { n.kinds.add(kind); trInto(which === "cur" ? n.a : n.p, m, kind, f); if (which === "prev") n.hasPrev = true; }
    if (seg.split) n.splits.add(seg.split);
    parent = n; map = n.kids;
  });
}
const trLab = (cd, code) => (cd.labels && cd.labels[code]) || code;
function trMid(cd, c, stage, prod) { // the levels between the channel and the campaign, one list per product
  const lab = (code) => ({ k: "p:" + code, label: trLab(cd, code), order: TR_LAST.has("p:" + code) ? 90 : 50 });
  if (c.kind === "social") return [[{ k: "social", label: "Reach & Amazon", order: 80, note: "The Reach and Amazon campaigns. Counted in total spend, kept out of Performance and Awareness." }]];
  if (c.kind === "awareness") {
    const goal = { k: "aw:" + (c.goal || c.group || "Other"), label: "Awareness · " + (c.goal || c.group || "Other"), order: 70 };
    return (prod && prod.length ? prod : ["UNMAPPED"]).map((p) => [goal, lab(p)]);
  }
  const st = { k: "st:" + stage, label: stage, order: TR_STAGES.indexOf(stage) };
  return (prod && prod.length ? prod : ["UNMAPPED"]).map((p) => [st, lab(p)]);
}

function trBuild(g) {
  const P = state.pages, cd = P.campaign_days, mt = P.meta_tree, gt = P.google_tree;
  const roots = new Map(), funnel = TR.group === "funnel";
  const sets = [["cur", g.cur || []], ["prev", g.prev || []]];
  const info = { metaAd: { cur: 0, prev: 0 }, gTree: { cur: 0, prev: 0 } };
  // ---------------------------------------------------------------- Meta
  const META = { k: "meta", label: "Meta", chip: null, order: 0 };
  if (cd && cd.meta) {
    const cdBy = trByDate(cd.meta.rows, cd, "_metaBy");
    const adBy = mt && mt.rows ? trByDate(mt.rows, mt, "_by") : new Map();
    for (const [which, days] of sets) {
      for (const d of days) {
        const seen = new Set(), rows = adBy.get(d) || []; // campaigns this day has ad-level rows for
        if (rows.length) info.metaAd[which]++;
        for (const r of rows) {
          const ad = mt.ads[r[1]], set = mt.adsets[ad.s], c = mt.campaigns[set.c];
          seen.add(`${c.account}|${c.id}`);
          if (!rgKeep(c.kind || c.awareness)) continue;
          const camp = { k: `c:${c.account}|${c.id}`, label: c.name, sub: c.account, order: 50 };
          const prods = c.kind === "social" ? [null] : ad.prod || ["UNMAPPED"];
          const split = prods.length > 1 ? prods.map((x) => trLab(cd, x).split(" · ")[0]).join(" + ") : null;
          const tail = [camp, { k: `s:${ad.s}`, label: set.name, chip: "Ad set" }, { k: `a:${r[1]}`, label: ad.name, chip: "Ad", split }];
          if (!funnel) { trAdd(roots, [META, ...tail], r.slice(2), which, c.kind || "perf"); continue; }
          const mids = trMid(cd, c, ad.stage, ad.prod);
          for (const mid of mids) trAdd(roots, [META, ...mid, ...tail], r.slice(2), which, c.kind || "perf", 1 / mids.length);
        }
        // campaigns with no ad-level detail that day: the campaign name decides
        for (const r of cdBy.get(d) || []) {
          const c = cd.meta.names[r[1]];
          if (seen.has(`${c.account}|${c.id}`) || !rgKeep(c.kind || c.awareness)) continue;
          const camp = { k: `c:${c.account}|${c.id}`, label: c.name, sub: c.account, order: 50 };
          if (!funnel) { trAdd(roots, [META, camp], r.slice(2), which, c.kind || "perf"); continue; }
          const mids = trMid(cd, c, c.stage || "TOF", c.prod);
          for (const mid of mids) trAdd(roots, [META, ...mid, camp], r.slice(2), which, c.kind || "perf", 1 / mids.length);
        }
      }
    }
  }
  // ---------------------------------------------------------------- Google
  const GOOGLE = { k: "google", label: "Google Ads", order: 1 };
  if (cd && cd.google) {
    const by = trByDate(cd.google.rows, cd, "_gBy");
    const skuGroups = new Set(cd.google_sku_groups || []);
    const midOf = (c) => {
      if (!funnel) return [[]];
      if (c.kind === "awareness") return [[{ k: "aw:" + c.group, label: "Awareness · " + c.group, order: 70 }]];
      const grp = { k: "gg:" + c.group, label: c.group, order: ["Brand Search", "Brand PMax", "Non-brand PMax", "Demand Gen", "YouTube", "Non-brand Search"].indexOf(c.group) + 1 || 60 };
      if (!skuGroups.has(c.group)) return [[grp]];
      return (c.prod && c.prod.length ? c.prod : ["UNMAPPED"]).map((p) => [grp, { k: "p:" + p, label: trLab(cd, p), order: TR_LAST.has("p:" + p) ? 90 : 50 }]);
    };
    const campPaths = new Map(); // google id -> [paths]
    for (const [which, days] of sets) {
      for (const d of days) {
        for (const r of by.get(d) || []) {
          const c = cd.google.names[r[1]];
          if (!rgKeep(c.kind || c.awareness)) continue;
          const mids = midOf(c);
          const camp = { k: `g:${c.id}`, label: c.name, sub: "ID " + c.id, order: 50 };
          campPaths.set(c.id, mids.map((mid) => [GOOGLE, ...mid, camp]));
          for (const mid of mids) trAdd(roots, [GOOGLE, ...mid, camp], r.slice(2), which, c.kind || "perf", 1 / mids.length);
        }
      }
    }
    // ad groups / asset groups and ads hang under their campaign; they do not
    // change the campaign's own numbers (Google reports those separately)
    if (gt && gt.group_rows) {
      const gBy = trByDate(gt.group_rows, gt, "_by"), aBy = trByDate(gt.ad_rows || [], gt, "_aBy");
      for (const [which, days] of sets) {
        for (const d of days) {
          const grows = gBy.get(d) || [];
          if (grows.length) info.gTree[which]++;
          for (const r of grows) {
            const grp = gt.groups[r[1]], c = gt.campaigns[grp.c], paths = campPaths.get(String(c.id));
            if (!paths) continue;
            const seg = { k: `gg${r[1]}`, label: grp.name, chip: grp.kind === "asset_group" ? "Asset group" : "Ad group", note: grp.kind === "asset_group" ? "Performance Max reports spend per asset group, not per ad, so there is nothing below this." : null };
            for (const p of paths) trAdd(roots, [...p, seg], r.slice(2), which, c.kind || "perf", 1 / paths.length, p.length);
          }
          for (const r of aBy.get(d) || []) {
            const ad = gt.ads[r[1]], grp = gt.groups[ad.g], c = gt.campaigns[grp.c], paths = campPaths.get(String(c.id));
            if (!paths) continue;
            const gseg = { k: `gg${ad.g}`, label: grp.name, chip: "Ad group" };
            for (const p of paths) trAdd(roots, [...p, gseg, { k: `ga${r[1]}`, label: ad.name, chip: ad.type || "Ad" }], r.slice(2), which, c.kind || "perf", 1 / paths.length, p.length + 1);
          }
        }
      }
    }
  }
  // ----------------------------------------------- what the platforms' rows miss
  const w = g.w, pw = g.pw;
  for (const [node, key] of [[roots.get("meta"), "meta_spend"], [roots.get("google"), "google_spend"]]) {
    if (!node || w[key] == null) continue;
    const gap = w[key] - node.a.spend;
    if (gap > Math.max(1, Math.abs(w[key]) * 0.002)) {
      node.kids.set("gap", { key: node.key + "|gap", k: "gap", label: "Not broken down by campaign", sub: "days with account-level data only", level: 1, order: 99, kinds: new Set(["mixed"]), kids: new Map(), a: { ...trZero(), spend: gap, value: null, results: null, clicks: null, impr: null, pspend: null }, p: trZero(), splits: new Set() });
      node.a.spend += gap;
    }
  }
  // ---------------------------------------------------------------- sheets
  if (RG.mode !== "aw") {
    // a sheet-fed row sums the days the sheet has; the others say so ("12 of 20 days")
    const e = RG.eng;
    const sheet = (k, label, sk, rk, order, note, hasRev = true) => {
      const need = hasRev ? [sk, rk] : [sk];
      const win = (list, whole) => {
        if (!list || !list.length) return null;
        const ok = list.filter((d) => e.hasAll(d, need));
        if (!ok.length) return { w: null, ok: 0, of: list.length };
        return { w: ok.length === list.length ? whole : e.windowOf(ok), ok: ok.length, of: list.length };
      };
      const c = win(g.cur, w), pp = pw ? win(g.prev, pw) : null;
      const v = (x, f) => (x && x.w && f ? x.w[f] : null);
      const part = c && c.ok && c.ok < c.of ? `${c.ok} of ${c.of} days (the sheet has no data for the rest)` : null;
      return { key: k, k, label, level: 0, order, sheet: true, kinds: new Set(["perf"]), kids: new Map(), splits: new Set(),
        note: [note, part].filter(Boolean).join(" · "), sub: part,
        a: { spend: v(c, sk), value: hasRev ? v(c, rk) : null, pspend: v(c, sk), pvalue: hasRev ? v(c, rk) : null, results: null, clicks: null, impr: null },
        p: pp ? { spend: v(pp, sk), value: hasRev ? v(pp, rk) : null, pspend: v(pp, sk), pvalue: hasRev ? v(pp, rk) : null } : trZero(), hasPrev: !!(pp && pp.ok),
        days: c ? c.ok : 0, pdays: pp ? pp.ok : 0,
        na: !c || !c.ok ? (w.na[sk] || (hasRev && w.na[rk]) || "not in the sheet for these days") : null };
    };
    roots.set("affiliate", sheet("affiliate", "Affiliate", "affiliate_spend", "affiliate_revenue", 2, "From the affiliate sheet: spend and the sales the affiliates are credited with."));
    roots.set("reddit", sheet("reddit", "Reddit (performance)", "reddit_spend", null, 2.5, "From the media-plan sheet until the Reddit bot loads BigQuery, all counted as performance spend. Up to 31 Oct it includes the traffic campaigns (the team's rule then); from 1 Nov it is sales campaigns only. No revenue is reported there, so no ROAS.", false));
    const crm = sheet("crm", "CRM", "crm_spend", "crm_revenue", 3, "Flow + broadcast, from the CRM sheets.");
    const f = sheet("crm|flow", "Flows", "crm_flow_spend", "crm_flow_revenue", 0), b = sheet("crm|broadcast", "Broadcasts", "crm_broadcast_spend", "crm_broadcast_revenue", 1);
    f.level = b.level = 1; f.chip = b.chip = "CRM"; f.sub = b.sub = null;
    crm.kids.set("flow", f); crm.kids.set("broadcast", b);
    roots.set("crm", crm);
  }
  return { roots, info };
}

// ---------------------------------------------------------------- columns
function trCols() {
  const n0 = (v, u) => (v == null ? null : fmt(v, u));
  const spend = ["Spend", (n) => n0(n.a.spend, "inr")];
  const dsp = ["Δ spend", null, "dspend"];
  const share = ["Share", null, "share"];
  const val = ["Platform revenue", (n) => n0(n.a.value, "inr")];
  const roas = ["Platform ROAS", null, "roas"];
  const dr = ["Δ ROAS", null, "droas"];
  const res = ["Platform purchases", (n) => (n.a.results == null ? null : fmt(Math.round(n.a.results), "int"))];
  const cpa = ["Cost / purchase", (n) => (n.a.results ? fmt(n.a.spend / n.a.results, "inr") : null)];
  const impr = ["Impr.", (n) => (n.a.impr ? fmt(Math.round(n.a.impr), "int") : null)];
  const cpm = ["CPM", (n) => (n.a.impr ? fmt((n.a.spend / n.a.impr) * 1000, "inr") : null)];
  const clicks = ["Clicks", (n) => (n.a.clicks ? fmt(Math.round(n.a.clicks), "int") : null)];
  const ctr = ["CTR", (n) => (n.a.impr ? fmt(n.a.clicks / n.a.impr, "pct") : null)];
  const cpc = ["CPC", (n) => (n.a.clicks ? fmt(n.a.spend / n.a.clicks, "inr") : null)];
  if (RG.mode === "aw") return [spend, dsp, share, impr, cpm, clicks, ctr, cpc];
  if (RG.mode === "perf") return [spend, dsp, share, val, roas, dr, res, cpa, ctr];
  return [spend, dsp, share, val, roas, dr, impr, ctr];
}
const trRoas = (a) => (a && a.pspend && a.pvalue != null ? a.pvalue / a.pspend : null);
function trCell(n, col, parent, g, total) {
  const [, f, special] = col;
  if (special === "dspend") return g.pw && n.hasPrev && n.a.spend != null && n.p.spend ? deltaHtml(rgAvgChange(n.a.spend, n.days || g.w.days, n.p.spend, n.pdays || g.pw.days), "spend") : '<span class="flat">–</span>';
  if (special === "share") {
    const base = parent ? parent.a.spend : total;
    return n.a.spend != null && base ? `${((n.a.spend / base) * 100).toFixed(1)}%${parent ? "" : ""}` : '<span class="na">–</span>';
  }
  if (special === "roas") {
    if (n.k === "reddit") return '<span class="sub">No platform attribution</span>';
    const r = trRoas(n.a);
    if (r == null) return n.na ? `<span class="cell-na" title="Data unavailable: ${esc(n.na)}">n/a</span>` : '<span class="na">–</span>';
    const mixed = n.kinds.size > 1 && n.kinds.has("perf");
    const pr = n.hasPrev ? trRoas(n.p) : null;
    return esc(fmt(r, "x")) + (pr != null ? `<br><span class="sub">vs ${esc(fmt(pr, "x"))}</span>` : "") + (mixed ? `<br><span class="sub">sales campaigns only</span>` : "");
  }
  if (special === "droas") {
    const r = trRoas(n.a), pr = n.hasPrev ? trRoas(n.p) : null;
    return g.pw && r != null && pr ? deltaHtml(r / pr - 1, "roas", (n.p.pspend || 0) < METRIC_RULES.min_spend) : '<span class="flat">–</span>';
  }
  const v = f(n);
  if (v == null) return n.na ? `<span class="cell-na" title="Data unavailable: ${esc(n.na)}">n/a</span>` : '<span class="na">–</span>';
  return esc(v);
}
const trSorted = (m) => [...m.values()].sort((x, y) => (x.order - y.order) || ((y.a.spend || 0) - (x.a.spend || 0)));

// ---------------------------------------------------------------- the table
function trHtml(g, opts = {}) {
  const { roots, info } = trBuild(g);
  TR.last = { roots, g };
  const list = trSorted(roots).filter((n) => (n.a.spend > 0.5 || n.sheet) && (!opts.only || opts.only.includes(n.k)));
  if (!list.length) return `<p class="na">No ${RG.mode === "aw" ? "awareness" : RG.mode === "perf" ? "performance" : ""} spend on these days.</p>`;
  const total = list.reduce((t, n) => t + (n.a.spend || 0), 0);
  const cols = trCols();
  const out = [];
  const nDays = (g.cur || []).length;
  const emit = (n, parent) => {
    const kids = trSorted(n.kids).filter((k) => k.a.spend > 0.5 || k.sheet);
    const can = kids.length > 0 || !!n.note, open = TR.open.has(n.key);
    const name = `<span class="tw" aria-hidden="true">${can ? (open ? "▾" : "▸") : "·"}</span>${n.chip ? `<span class="chip">${esc(n.chip)}</span> ` : ""}${esc(n.label)}${n.splits && n.splits.size ? ` <span class="sub">split across ${esc([...n.splits].join(", "))}</span>` : ""}${n.sub ? `<br><span class="sub tsub">${esc(n.sub)}</span>` : ""}`;
    out.push(`<tr class="tr-l${Math.min(n.level, 5)} ${open ? "open" : ""} ${TR.flash === n.key ? "flash" : ""}" ${can ? `data-k="${esc(n.key)}" tabindex="0" role="button" aria-expanded="${open}"` : ""}><td class="text">${name}</td>${cols.map((c) => `<td>${trCell(n, c, parent, g, total)}</td>`).join("")}</tr>`);
    if (!open) return;
    if (n.note) out.push(`<tr class="tr-note tr-l${Math.min(n.level + 1, 5)}"><td class="text" colspan="${cols.length + 1}">${esc(n.note)}</td></tr>`);
    if (n.k === "meta" && TR.group === "funnel") {
      const c = info.metaAd.cur;
      const why = !c ? "Stage and product come from the campaign names for these days (ad-level detail does not reach back this far)." : c < nDays ? `Stage and product come from the ad names on ${c} of the ${nDays} days, and from the campaign names on the rest (ad-level detail runs from ${rgFmtDay(state.pages.meta_tree.from, true)}).` : "Stage and product come from each ad's name: MOF_ and BOF_ ads count as MOF and BOF even inside a TOF-named offer campaign. An ad naming two products counts half to each.";
      out.push(`<tr class="tr-note tr-l1"><td class="text" colspan="${cols.length + 1}">${esc(why)}</td></tr>`);
    }
    kids.forEach((k) => emit(k, n));
  };
  list.forEach((n) => emit(n, null));
  // the whole store: Shopify GMV over all spend
  if (RG.mode !== "aw" && opts.totalRow !== false && !opts.only) {
    const w = g.w, pw = g.pw, orv = w.roas, opv = pw ? pw.roas : null;
    out.push(`<tr class="total"><td class="text">All channels<br><span class="sub">Blended ROAS: Total sales ÷ Performance spend${RG.mode === "all" ? " (awareness and Reach left out)" : ""}</span></td>${cols.map(([l]) => {
      if (l === "Spend") return `<td>${cell(w.all_spend, "inr", w.na.all_spend)}</td>`;
      if (l === "Δ spend") return `<td>${pw && w.all_spend != null && pw.all_spend != null ? deltaHtml(rgAvgChange(w.all_spend, w.days, pw.all_spend, pw.days), "spend") : '<span class="flat">–</span>'}</td>`;
      if (l === "Platform revenue") return `<td>${cell(w.gmv, "inr", w.na.gmv)}<br><span class="sub">Total sales (Shopify)</span></td>`;
      if (l === "Platform ROAS") return `<td>${cell(orv, "x", rgNa(w, "roas"))}${opv != null ? `<br><span class="sub">vs ${esc(fmt(opv, "x"))}</span>` : ""}</td>`;
      if (l === "Δ ROAS") return `<td>${orv != null && opv ? deltaHtml(orv / opv - 1, "roas") : '<span class="flat">–</span>'}</td>`;
      return "<td></td>";
    }).join("")}</tr>`);
  }
  const TIP = { "Platform revenue": "platform_revenue", "Platform ROAS": "platform_roas", "Platform purchases": "platform_purchases", "Cost / purchase": "cpp" };
  const head = `<tr><th class="text" scope="col">${TR.group === "funnel" ? "Channel · stage · product · campaign · ad set · ad" : "Channel · campaign · ad set · ad"}</th>${cols.map((c) => `<th scope="col">${TIP[c[0]] ? mHead(TIP[c[0]], c[0]) : esc(c[0])}</th>`).join("")}</tr>`;
  return `<div class="table-wrap" style="max-height:${opts.maxHeight || "75vh"}"><table class="tree"><thead>${head}</thead><tbody>${out.join("")}</tbody></table></div>
    <p class="legend-note">Click a row to open what is under it. Share is of the row above. Δ compares per-day averages${RG.mode === "aw" ? "" : "; ROAS counts sales campaigns only"}.</p>`;
}

// the controls above the table
function trBarHtml(id) {
  return `<div class="tr-bar"><div class="seg" id="${id}-group" role="group" aria-label="Group by">
      <button type="button" data-g="funnel" aria-pressed="${TR.group === "funnel"}">Stage › product</button>
      <button type="button" data-g="campaign" aria-pressed="${TR.group === "campaign"}">Campaigns</button></div>
    <button type="button" class="rg-btn" data-tr="products">Open to products</button>
    <button type="button" class="rg-btn" data-tr="collapse">Collapse all</button></div>`;
}
function trOpenTo(depth) {
  TR.open = new Set();
  const walk = (m, d) => { for (const n of m.values()) { if (d < depth && n.kids.size) { TR.open.add(n.key); walk(n.kids, d + 1); } } };
  if (TR.last) walk(TR.last.roots, 0);
}
// wire a host element holding trBarHtml(id) and a div#id with trHtml(g)
function trBind(id, g, opts = {}) {
  const host = document.getElementById(id), bar = document.getElementById(id + "-group")?.parentElement;
  if (!host) return;
  const repaint = (focusKey) => {
    host.innerHTML = trHtml(g, opts);
    if (focusKey) { const r = host.querySelector(`tr[data-k="${CSS.escape(focusKey)}"]`); if (r) { r.focus({ preventScroll: true }); r.scrollIntoView({ block: "nearest" }); } }
    if (opts.after) opts.after();
  };
  const toggle = (row) => { const k = row.dataset.k; if (TR.open.has(k)) TR.open.delete(k); else TR.open.add(k); TR.flash = null; repaint(k); };
  host.addEventListener("click", (ev) => { const r = ev.target.closest("tr[data-k]"); if (r) toggle(r); });
  host.addEventListener("keydown", (ev) => { if ((ev.key === "Enter" || ev.key === " ") && ev.target.matches("tr[data-k]")) { ev.preventDefault(); toggle(ev.target); } });
  bar?.addEventListener("click", (ev) => {
    const b = ev.target.closest("button");
    if (!b) return;
    if (b.dataset.g) { TR.group = b.dataset.g; TR.open = new Set(); try { sessionStorage.setItem("asaya-tree-group", TR.group); } catch (e) { /* blocked */ } bar.querySelectorAll("[data-g]").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); }
    else if (b.dataset.tr === "collapse") TR.open = new Set();
    else if (b.dataset.tr === "products") trOpenTo(TR.group === "funnel" ? 2 : 1);
    repaint();
  });
  TR.repaint = repaint;
  repaint();
}

// ------------------------------------------ channel reconciliation
/* One row per channel: what it cost and what its platform claims, beside what
   Shopify credits it with (last click, orders placed). Channels with orders but
   no sessions sit in an expandable "Unattributed / other" group. The channel
   rows plus a collapsed "cancellations, returns and edits" row add up to
   Shopify's own Orders and Total sales, the headline. */
const TR_SPEND = {
  "Meta Ads": { spend: "meta_spend", value: "meta_perf_value", pspend: "meta_perf_spend" },
  "Google Ads": { spend: "google_spend", value: "google_perf_value", pspend: "google_perf_spend" },
  "Reddit Ads": { spend: "reddit_spend", value: null },
  Affiliate: { spend: "affiliate_spend", value: "affiliate_revenue", pspend: "affiliate_spend" },
  CRM: { spend: "crm_spend", value: "crm_revenue", pspend: "crm_spend" },
};
const TR_UNATTRIBUTED = ["Not in GoKwik", "Organic Search"];
let trRid = 0;
function trReconHtml(g, opts = {}) {
  const p = state.pages.channel_days;
  if (!p || !p.rows) return `<p class="na">Data unavailable: the channel breakdown has not been built yet.</p>`;
  const mode = opts.mode || RG.mode;
  const want = mode === "all" ? null : mode === "aw" ? p.kinds.indexOf("awareness") : p.kinds.indexOf("perf");
  const sum = (days, keep) => {
    const set = new Set(days || []), m = new Map();
    for (const r of p.rows) {
      if (!set.has(r[0]) || !keep(r[2])) continue;
      const a = m.get(r[1]) || m.set(r[1], [0, 0, 0, 0]).get(r[1]);
      a[0] += r[3]; a[1] += r[4]; a[2] += r[5]; a[3] += r[6];
    }
    return m;
  };
  const inView = (k) => want === null || k === want;
  const C = sum(g.cur, inView), P = g.prev && g.prev.length ? sum(g.prev, inView) : null;
  const w = g.w, pw = g.pw, cd = w.days, pd = pw ? pw.days : 0;
  const spendOf = (name, win) => { const s = TR_SPEND[name]; return s && win ? win[s.spend] : null; };
  const roasOf = (name, win) => { const s = TR_SPEND[name]; return s && s.value && win && win[s.pspend] ? win[s.value] / win[s.pspend] : null; };
  const mk = (label, a, b) => ({
    label, s: a[0], o: a[2], gmv: a[3], cvr: a[0] && a[2] <= a[0] ? a[2] / a[0] : null,
    spend: spendOf(label, w), pspend: pw ? spendOf(label, pw) : null,
    value: mode === "aw" || !TR_SPEND[label] || !TR_SPEND[label].value ? null : w[TR_SPEND[label].value],
    roas: mode === "aw" ? null : roasOf(label, w), proas: mode === "aw" || !pw ? null : roasOf(label, pw),
    pgmv: b ? b[3] : null, reddit: label === "Reddit Ads",
  });
  let rows = [...new Set([...C.keys(), ...(P ? P.keys() : [])])].map((i) => mk(p.channels[i], C.get(i) || [0, 0, 0, 0], P ? P.get(i) : null))
    .filter((r) => r.s || r.o || r.spend);
  // channels with spend but no Shopify rows in view still show (their spend is real)
  for (const name of Object.keys(TR_SPEND)) if (!rows.some((r) => r.label === name) && spendOf(name, w)) rows.push(mk(name, [0, 0, 0, 0], null));
  const un = rows.filter((r) => TR_UNATTRIBUTED.includes(r.label));
  rows = rows.filter((r) => !TR_UNATTRIBUTED.includes(r.label)).sort((x, y) => y.gmv - x.gmv || (y.spend || 0) - (x.spend || 0));
  const add = (list) => list.reduce((t, r) => ({ s: t.s + (r.s || 0), o: t.o + (r.o || 0), gmv: t.gmv + (r.gmv || 0) }), { s: 0, o: 0, gmv: 0 });
  const rid = "rc" + ++trRid;
  const out = [...rows];
  if (un.length) { const t = add(un); out.push({ label: "Unattributed / other", ...t, cvr: null, _grp: true, kids: un }); }
  // awareness and Reach visits are their own row in Performance, so the table adds up to the store
  if (mode === "perf") {
    const aw = add([...sum(g.cur, (k) => k !== want).values()].map((a) => ({ s: a[0], o: a[2], gmv: a[3] })));
    if (aw.s || aw.o) out.push({ label: "Awareness and Reach visits", ...aw, cvr: null, spend: null });
  }
  const placed = add(out);
  const full = !opts.compact, hasP = !!pw;
  const money = (v) => (v == null ? '<span class="na">–</span>' : esc(mFormat("currency", v)));
  const cols = [
    { label: "Channel", text: true, render: (r) => esc(r.label) },
    { label: mHead("channel_spend", "Spend"), render: (r) => money(r.spend) },
    ...(full && hasP ? [{ label: "Δ spend", render: (r) => (r.spend != null && r.pspend ? deltaHtml(rgAvgChange(r.spend, cd, r.pspend, pd), "spend", r.pspend < METRIC_RULES.min_spend) : '<span class="flat">–</span>') }] : []),
    ...(full ? [{ label: mHead("platform_revenue"), render: (r) => (r.reddit ? '<span class="sub">No platform attribution</span>' : money(r.value)) }] : []),
    { label: mHead("platform_roas"), render: (r) => (r.reddit ? '<span class="sub">No platform attribution</span>' : r.blended != null ? `${esc(mFormat("ratio", r.blended))}<br><span class="sub">Blended ROAS</span>` : r.roas == null ? '<span class="na">–</span>' : esc(mFormat("ratio", r.roas)) + (full && r.proas ? ` <span class="sub">${deltaHtml(r.roas / r.proas - 1, "roas", r.pspend < METRIC_RULES.min_spend)}</span>` : "")) },
    { label: mHead("lc_sessions", "Sessions"), render: (r) => (r.s == null ? '<span class="na">–</span>' : esc(mFormat("count", r.s))) },
    { label: mHead("lc_orders", "Orders"), render: (r) => esc(mFormat("count", Math.round(r.o)) ?? "–") },
    { label: mHead("lc_sales", "Sales (last click)"), render: (r) => money(r.gmv) + (full && hasP && r.pgmv ? ` <span class="sub">${deltaHtml(rgAvgChange(r.gmv, cd, r.pgmv, pd), "gmv")}</span>` : "") },
    { label: mHead("cvr"), render: (r) => (r.cvr == null ? '<span class="na">–</span>' : esc(mFormat("percent", r.cvr))) },
  ];
  const tr = (r, cls, extra = "") => `<tr class="${cls}" ${extra}>${cols.map((c) => `<td class="${c.text ? "text" : ""}">${c.render(r)}</td>`).join("")}</tr>`;
  const body = [];
  for (const r of out) {
    if (r._grp) {
      body.push(tr(r, "grp", `data-grp="${rid}g" tabindex="0" role="button" aria-expanded="false" title="Orders with no matching visit: no GoKwik record, or tagged differently from the visit"`));
      for (const k of r.kids) body.push(tr(k, "child", `data-parent="${rid}g" hidden`));
    } else body.push(tr(r, ""));
  }
  const ready = mode !== "aw" && w.orders != null && w.gmv != null;
  body.push(tr({ label: "Channels (orders placed)", ...placed, cvr: placed.s ? placed.o / placed.s : null, spend: w.all_spend }, "total"));
  if (ready) {
    body.push(`<tr class="recon-toggle" data-recon="${rid}" tabindex="0" role="button" aria-expanded="false"><td class="text" colspan="${cols.length}">▸ Reconcile to Shopify: cancellations, returns and edits</td></tr>`);
    body.push(tr({ label: "Cancellations, returns and edits", s: null, o: w.orders - placed.o, gmv: w.gmv - placed.gmv, cvr: null }, "recon", `data-rid="${rid}" hidden`));
    body.push(tr({ label: "Total · Shopify's report (the headline)", s: placed.s, o: w.orders, gmv: w.gmv, cvr: placed.s ? w.orders / placed.s : null, spend: w.perf_all_spend, blended: w.roas }, "total recon", `data-rid="${rid}" hidden`));
  }
  const head = `<tr>${cols.map((c) => `<th class="${c.text ? "text" : ""}" scope="col">${c.label}</th>`).join("")}</tr>`;
  const sDays = new Set(p.session_days), oDays = new Set(p.order_days);
  const missS = (g.cur || []).filter((d) => !sDays.has(d)), missO = (g.cur || []).filter((d) => !oDays.has(d));
  const note = [missS.length ? `Sessions are missing for ${rgListDays(missS)}.` : "", missO.length ? `Orders by channel are missing for ${rgListDays(missO)}.` : ""].filter(Boolean).join(" ");
  return (note ? `<div class="banner">Data unavailable: ${esc(note)}</div>` : "") + `<div class="table-wrap" ${opts.maxHeight ? `style="max-height:${opts.maxHeight}"` : ""}><table><thead>${head}</thead><tbody>${body.join("")}</tbody></table></div>`;
}
