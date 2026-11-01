/* Date-range engine: any range against any comparison, like Shopify's date
   picker, but sale days are only ever compared with sale days and BAU days with
   BAU days. Pure functions over the "days" page (per-day counts), so it can be
   tested in Node.

   - Counts are summed over the days; a count is missing (null, with a reason)
     when any day in the window lacks it. Rates are recomputed from the sums,
     never averaged across days.
   - Changes compare per-day averages for counts (so 5 days against 7 is fair)
     and the rates directly. */
(function (root) {
  "use strict";

  const DAY = 86400000;
  const toMs = (iso) => Date.parse(iso + "T00:00:00Z");
  const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
  const addDays = (s, n) => iso(toMs(s) + n * DAY);
  const diffDays = (a, b) => Math.round((toMs(b) - toMs(a)) / DAY);
  const rangeOf = (a, b) => {
    const out = [];
    for (let d = a; d <= b; d = addDays(d, 1)) out.push(d);
    return out;
  };
  const monthStart = (s) => s.slice(0, 7) + "-01";
  const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-12
  function shiftMonths(s, n) {
    // same day of the month, n months away, clamped to the month's length
    const y = +s.slice(0, 4), m = +s.slice(5, 7), d = +s.slice(8, 10);
    const t = y * 12 + (m - 1) + n, ny = Math.floor(t / 12), nm = (t % 12) + 1;
    return `${ny}-${String(nm).padStart(2, "0")}-${String(Math.min(d, daysInMonth(ny, nm))).padStart(2, "0")}`;
  }
  const ratio = (a, b) => (a == null || b == null || b === 0 ? null : a / b);
  const pctChange = (c, p) => (c == null || p == null || p === 0 ? null : (c - p) / p);

  // Thanksgiving is the 4th Thursday of November; Black Friday follows it.
  function blackFriday(year) {
    const first = new Date(Date.UTC(year, 10, 1)).getUTCDay(); // 0 = Sunday
    const thu = 1 + ((4 - first + 7) % 7) + 21;
    return `${year}-11-${String(thu + 1).padStart(2, "0")}`;
  }


  /* Performance and Awareness as two separate views of the same days. A view
     points each headline field at its split counterpart, so everything built on
     the engine (tiles, tables, charts, comparisons) reads one kind of campaign
     and nothing else: Performance is every campaign not named "awareness",
     Awareness is the ones that are. Fields with no such split (new vs repeat,
     and the affiliate and CRM spends for Awareness) say so instead of showing a
     number that belongs to something else. */
  const GK = ["ic", "gk_converted", "gk_address", "gk_payment"];
  const MODES = {
    perf: {
      alias: Object.assign(
        { sessions: "perf_sessions", atc: "perf_atc", orders: "perf_orders", gmv: "perf_gmv",
          meta_spend: "meta_perf_spend", google_spend: "google_perf_spend", spend: "perf_spend", all_spend: "perf_all_spend" },
        ...GK.map((k) => ({ [k]: "perf_" + k }))),
      blank: { new_orders: 1, repeat_orders: 1, new_gmv: 1, repeat_gmv: 1 },
      why: "not split by campaign type",
    },
    aw: {
      alias: Object.assign(
        { sessions: "awareness_sessions", perf_sessions: "awareness_sessions", atc: "awareness_atc", perf_atc: "awareness_atc",
          orders: "awareness_orders", gmv: "awareness_gmv", meta_spend: "meta_aw_spend", google_spend: "google_aw_spend",
          spend: "aw_spend", perf_spend: "aw_spend", all_spend: "aw_spend", meta_perf_spend: "meta_aw_spend",
          meta_perf_value: "meta_aw_value", google_perf_spend: "google_aw_spend", google_perf_value: "google_aw_value" },
        ...GK.map((k) => ({ [k]: "awareness_" + k }))),
      blank: { new_orders: 1, repeat_orders: 1, new_gmv: 1, repeat_gmv: 1, affiliate_spend: 1, affiliate_revenue: 1, crm_flow_spend: 1,
        crm_flow_revenue: 1, crm_broadcast_spend: 1, crm_broadcast_revenue: 1, crm_spend: 1, crm_revenue: 1, other_spend: 1, perf_all_spend: 1 },
      why: "not an awareness channel, or not split by campaign type",
    },
  };
  function applyMode(D, mode) {
    const m = MODES[mode];
    if (!m) return D; // "all": the data as it is
    const n = D.dates.length, values = {}, na = {};
    const reasons = D.reasons.concat([m.why]), why = reasons.length - 1;
    for (const k of D.fields) {
      if (m.blank[k]) { values[k] = new Array(n).fill(null); na[k] = { "*": why }; continue; }
      const src = m.alias[k] || k;
      values[k] = D.values[src] || new Array(n).fill(null);
      na[k] = D.na[src] || {};
    }
    return { ...D, values, na, reasons, mode };
  }

  function createEngine(D) {
    const dates = D.dates, FIELDS = D.fields, N = dates.length;
    const at = new Map(dates.map((d, i) => [d, i]));
    const first = dates[0], last = dates[N - 1];
    const phaseOf = (d) => (at.has(d) ? D.phase[at.get(d)] || "bau" : null);
    const noteOf = (d) => (at.has(d) && D.phase_note ? D.phase_note[at.get(d)] || null : null);

    function derive(w) {
      w.aov = ratio(w.gmv, w.orders);
      w.cvr = ratio(w.orders, w.sessions);
      w.atc_rate = ratio(w.atc, w.sessions);
      w.atc_to_ic = ratio(w.ic, w.atc);
      w.address_rate = ratio(w.gk_address, w.ic);
      w.payment_rate = ratio(w.gk_payment, w.gk_address);
      w.paid_rate = ratio(w.gk_converted, w.gk_payment);
      w.meta_sales_roas = ratio(w.meta_perf_value, w.meta_perf_spend);
      w.google_sales_roas = ratio(w.google_perf_value, w.google_perf_spend);
      w.mer = ratio(w.gmv, w.spend);
      w.perf_roas = ratio(w.gmv, w.perf_spend);
      w.overall_roas = ratio(w.gmv, w.all_spend);
      w.affiliate_roas = ratio(w.affiliate_revenue, w.affiliate_spend);
      w.crm_roas = ratio(w.crm_revenue, w.crm_spend);
      w.crm_flow_roas = ratio(w.crm_flow_revenue, w.crm_flow_spend);
      w.crm_broadcast_roas = ratio(w.crm_broadcast_revenue, w.crm_broadcast_spend);
      const known = (w.new_orders || 0) + (w.repeat_orders || 0);
      w.new_share = w.new_orders == null ? null : ratio(w.new_orders, known);
      return w;
    }

    /* Sum of the counts over `list` (dates). Days outside the data count as
       missing, with a reason. */
    function windowOf(list) {
      const w = { days: list.length, na: {} };
      for (const k of FIELDS) {
        let sum = 0, miss = null;
        for (const d of list) {
          const i = at.get(d);
          const v = i === undefined ? null : D.values[k][i];
          if (v == null) {
            if (miss === null) {
              const nk = D.na[k] || {};
              const idx = i === undefined ? undefined : nk[d] !== undefined ? nk[d] : nk["*"];
              miss = idx === undefined ? (i === undefined ? `no data for ${d}` : `not available for ${d}`) : `${D.reasons[idx]} (${d})`;
            }
          } else sum += v;
        }
        if (list.length && miss === null) w[k] = sum;
        else { w[k] = null; w.na[k] = list.length ? miss : "no days in this window"; }
      }
      return derive(w);
    }

    /* Per-day change: counts compare averages, rates compare directly. */
    const RATE_FIELDS = new Set(["aov", "cvr", "atc_rate", "atc_to_ic", "address_rate", "payment_rate", "paid_rate", "meta_sales_roas", "google_sales_roas", "mer", "perf_roas", "overall_roas", "affiliate_roas", "crm_roas", "crm_flow_roas", "crm_broadcast_roas", "new_share"]);
    function change(cur, prev, key) {
      if (!prev) return null;
      let c = cur[key], p = prev[key];
      if (c == null || p == null) return null;
      if (!RATE_FIELDS.has(key)) { c /= Math.max(cur.days, 1); p /= Math.max(prev.days, 1); }
      return pctChange(c, p);
    }

    // ------------------------------------------------------------- phases
    const inData = (list) => list.filter((d) => at.has(d));
    function runsOf(phase) { // contiguous runs of one phase, oldest first
      const runs = [];
      let cur = null;
      for (const d of dates) {
        if (phaseOf(d) === phase) {
          if (cur && diffDays(cur[cur.length - 1], d) === 1) cur.push(d);
          else runs.push((cur = [d]));
        } else cur = null;
      }
      return runs;
    }

    /* The comparison days for one phase. For "match" the days come from the
       most recent earlier days of the same phase; for the date-based modes
       they are the comparison window's days of that phase. */
    function compareDays(range, cmp, phase) {
      const [a, b] = range, len = diffDays(a, b) + 1;
      if (cmp.mode === "none") return null;
      if (cmp.mode === "match") {
        const mine = rangeOf(a, b).filter((d) => phaseOf(d) === phase).length;
        const pool = dates.filter((d) => d < a && phaseOf(d) === phase);
        const out = [];
        for (let i = pool.length - 1; i >= 0 && out.length < mine; i--) {
          // a sale is one event: stop at a gap, so two sales are never blended
          if (phase === "sale" && out.length && diffDays(pool[i], out[0]) > 7) break;
          out.unshift(pool[i]);
        }
        return out;
      }
      let ca, cb;
      if (cmp.mode === "previous") { cb = addDays(a, -1); ca = addDays(a, -len); }
      else if (cmp.mode === "month") { ca = shiftMonths(a, -1); cb = shiftMonths(b, -1); }
      else if (cmp.mode === "year") { ca = shiftMonths(a, -12); cb = shiftMonths(b, -12); }
      else { ca = cmp.from; cb = cmp.to; }
      if (!ca || !cb || ca > cb) return null;
      return rangeOf(ca, cb).filter((d) => phaseOf(d) === phase);
    }

    const EV = (D.events || []).map((e) => ({ ...e, a: e.start.slice(0, 10), b: e.end.slice(0, 10) }));
    const eventsFor = (list) => (list && list.length ? EV.filter((e) => list.some((d) => d >= e.a && d <= e.b)) : []);

    // true when every one of these fields has a value on that day
    const hasAll = (d, fields) => at.has(d) && fields.every((f) => D.values[f] && D.values[f][at.get(d)] != null);

    function span(list) {
      return list && list.length ? [list[0], list[list.length - 1]] : null;
    }

    /* One block per phase present in the range, each against the same phase
       in the comparison, plus the whole range for reference. */
    function compare(a, b, cmp) {
      const all = inData(rangeOf(a, b));
      const groups = [];
      for (const phase of ["bau", "sale"]) {
        const cur = all.filter((d) => phaseOf(d) === phase);
        if (!cur.length) continue;
        const prevDays = compareDays([a, b], cmp, phase);
        const w = windowOf(cur);
        const pw = prevDays && prevDays.length ? windowOf(prevDays) : null;
        let note = null;
        if (cmp.mode !== "none" && !pw) {
          note = phase === "sale"
            ? "There are no sale days in the comparison period, so there is nothing fair to compare these with. Try “Last matching period”."
            : "There are no BAU days in the comparison period.";
        } else if (pw && cmp.mode !== "match" && pw.days < Math.max(1, Math.round(w.days / 2))) {
          note = `Only ${pw.days} ${phase === "sale" ? "sale" : "BAU"} day${pw.days === 1 ? "" : "s"} in the comparison period against ${w.days}; changes use per-day averages.`;
        }
        if (phase === "sale" && pw && !note) {
          const mine = new Set(eventsFor(cur).map((e) => e.start)), theirs = eventsFor(prevDays);
          if (mine.size && theirs.length && theirs.every((e) => mine.has(e.start))) {
            note = "Both periods are inside the same sale, so this compares later days of that sale with earlier days of it, not two different sales. Choose “Last matching period” to compare with the previous sale.";
          }
        }
        groups.push({ phase, cur, prev: prevDays, w, pw, note, curSpan: span(cur), prevSpan: span(prevDays), curEvents: phase === "sale" ? eventsFor(cur) : [], prevEvents: phase === "sale" ? eventsFor(prevDays) : [], change: (k) => change(w, pw, k) });
      }
      const outside = rangeOf(a, b).length - all.length;
      // days when a sale went live or ended: neither BAU nor sale, so they sit out of both
      const mixed = all.filter((d) => phaseOf(d) === "mixed");
      return { groups, all, outside, mixed, w: windowOf(all) };
    }

    // ------------------------------------------------------------- presets
    function sales() {
      return runsOf("sale").slice(-4).reverse();
    }
    function presets() {
      const L = last, out = [];
      const mtd = monthStart(L), lmEnd = addDays(mtd, -1), lmStart = monthStart(lmEnd);
      const y = +L.slice(0, 4), m = +L.slice(5, 7);
      const qStart = `${y}-${String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, "0")}-01`;
      const lqEnd = addDays(qStart, -1), lqStart = `${lqEnd.slice(0, 4)}-${String(Math.floor((+lqEnd.slice(5, 7) - 1) / 3) * 3 + 1).padStart(2, "0")}-01`;
      out.push({ id: "yesterday", label: "Yesterday (D-1)", from: L, to: L, group: 0 });
      for (const n of [7, 14, 30, 90]) out.push({ id: "last" + n, label: `Last ${n} days`, from: addDays(L, -(n - 1)), to: L, group: 1 });
      out.push({ id: "mtd", label: "Month to date", from: mtd, to: L, group: 2 });
      out.push({ id: "lastmonth", label: "Last month", from: lmStart, to: lmEnd, group: 2 });
      out.push({ id: "qtd", label: "Quarter to date", from: qStart, to: L, group: 2 });
      out.push({ id: "lastq", label: "Last quarter", from: lqStart, to: lqEnd, group: 2 });
      // Black Friday and Cyber Monday: the latest ones that are already in the data
      for (const yr of [y, y - 1]) {
        const bf = blackFriday(yr), cm = addDays(bf, 3);
        if (bf >= first && bf <= L) { out.push({ id: "bf", label: "Black Friday", from: bf, to: bf, group: 3 }); }
        if (cm >= first && cm <= L) { out.push({ id: "cm", label: "Cyber Monday", from: cm, to: cm, group: 3 }); }
        if (out.some((p) => p.id === "bf" || p.id === "cm")) break;
      }
      const lab = (s) => new Date(s + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
      // sales: from the hour-by-hour detection when there is one (a sale goes live
      // in the evening, so it runs from that day to the day it ended)
      const spans = (D.events && D.events.length ? D.events : []).slice(-4).reverse().map((e) => [e.start.slice(0, 10), e.end.slice(0, 10)]);
      const runs = spans.length ? spans : sales().map((r) => [r[0], r[r.length - 1]]);
      for (const [a, b] of runs) {
        out.push({ id: "sale:" + a, label: `Sale · ${a === b ? lab(a) : lab(a) + " – " + lab(b)}`, from: a, to: b, group: 4 });
      }
      return out.map((p) => ({ ...p, from: p.from < first ? first : p.from }));
    }

    return {
      first, last, N, dates, FIELDS,
      phaseOf, noteOf, hasAll, windowOf, change, compare, presets, derive, inData,
      addDays, diffDays, rangeOf, shiftMonths, monthStart, daysInMonth, iso, toMs, runsOf,
    };
  }

  root.createRangeEngine = (D, mode) => createEngine(applyMode(D, mode));
  if (typeof module !== "undefined" && module.exports) module.exports = (D, mode) => createEngine(applyMode(D, mode));
})(typeof window !== "undefined" ? window : globalThis);
