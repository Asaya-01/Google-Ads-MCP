/* Retention engine: every metric is recomputed from the census for whatever
   acquisition window and repeat horizon is chosen.

   A port of the retention artifact's engine with the same rules:
   - [a, b] picks the ACQUISITION window; each customer is then followed for
     `hz` days from their OWN first order, reading past b up to the end of the
     data. The window end is trimmed so every member had the full horizon.
   - hz = null means "full window": no horizon, every repeat inside the data.
   - Combos stay whole; each customer counts once per product, from their first
     purchase of it inside the window.
   Pure functions, no DOM, so it can be tested in Node. */
(function (root) {
  "use strict";

  function createEngine(P) {
    const EPOCH = new Date(P.epoch + "T00:00:00Z");
    const NDAYS = P.ndays;
    const SKUS = P.skus;
    const NS = SKUS.length;
    const VARS = P.vars;
    const NV = VARS.length;
    const SKU_OF = VARS.map((v) => v.s);
    const MILES = [30, 60, 90, 120, 180];

    const PREFLAG = P.multi.map((rec) => rec[0] === "P"); // existed before the data starts
    const MULTI_V = P.multi.map((rec) =>
      rec
        .slice(1)
        .split("|")
        .map((part) => {
          const c = part.indexOf(":");
          const rest = part.slice(c + 1);
          const t = rest.indexOf("~"); // order value in rupees; absent in older censuses
          const vars = t < 0 ? rest : rest.slice(0, t);
          return [+part.slice(0, c), vars.split(",").map(Number), t < 0 ? 0 : +rest.slice(t + 1)];
        })
    );
    // the same timelines collapsed to product level
    const MULTI = MULTI_V.map((tl) =>
      tl.map(([d, vv, rev]) => {
        const st = [];
        for (const v of vv) {
          const k = SKU_OF[v];
          if (st.indexOf(k) < 0) st.push(k);
        }
        return [d, st, rev];
      })
    );
    const SINGLES_V = {};
    for (const k in P.singles) SINGLES_V[+k] = P.singles[k]; // [day, nNewToBrand, nPreExisting]
    const SINGLES = {};
    for (const k in P.singles_s) SINGLES[+k] = P.singles_s[k];
    const SB = P.sbrand;

    const dayToDate = (d) => new Date(EPOCH.getTime() + d * 86400000);
    const iso = (dt) => dt.toISOString().slice(0, 10);
    const dateToDay = (s) => Math.round((new Date(s + "T00:00:00Z") - EPOCH) / 86400000);

    function median(a) {
      if (!a.length) return null;
      const s = [...a].sort((x, y) => x - y);
      const h = s.length >> 1;
      return s.length % 2 ? s[h] : Math.round((s[h - 1] + s[h]) / 2);
    }

    const acqEnd = (b, hz) => (hz == null ? b : Math.min(b, NDAYS - hz));

    // ------------------------------------------------------------------ products
    function compute(a, b, lvl, hz) {
      const bE = acqEnd(b, hz);
      const VMODE = lvl === "variant";
      const SRC = VMODE ? MULTI_V : MULTI;
      const SRC_SING = VMODE ? SINGLES_V : SINGLES;
      const NN = VMODE ? NV : NS;
      const nameOf = (i) => (VMODE ? SKUS[VARS[i].s][1] + " — " + VARS[i].label : SKUS[i][1]);
      const codeOf = (i) => (VMODE ? "V" + i : SKUS[i][0]);
      const out = [];
      if (bE < a) return out; // nothing mature enough to measure

      const base = new Int32Array(NN), rep = new Int32Array(NN);
      const allBuy = new Int32Array(NN), newBrand = new Int32Array(NN);
      const first = new Int32Array(NN).fill(999999);
      const gaps = Array.from({ length: NN }, () => []);
      const crossN = Array.from({ length: NN }, () => new Int32Array(NN));
      const crossD = Array.from({ length: NN }, () => ({}));
      const c1 = new Int32Array(NN), c2 = new Int32Array(NN), c3 = new Int32Array(NN),
        c4 = new Int32Array(NN), c5 = new Int32Array(NN);
      const g12 = Array.from({ length: NN }, () => []), g23 = Array.from({ length: NN }, () => []),
        g34 = Array.from({ length: NN }, () => []);
      const yrSum = new Float64Array(NN), yrBase = new Float64Array(NN);
      const p2 = Array.from({ length: NN }, () => new Int32Array(NN));
      const p2d = Array.from({ length: NN }, () => ({}));
      const p3 = Array.from({ length: NN }, () => new Int32Array(NN));
      const mB = {}, mH = {};
      for (const h of MILES) { mB[h] = new Int32Array(NN); mH[h] = new Int32Array(NN); }
      const lateB = new Int32Array(NN), lateH = new Int32Array(NN), anyH = new Int32Array(NN);
      const OBS = hz == null ? Infinity : hz;

      for (let m = 0; m < SRC.length; m++) {
        const tl = SRC[m]; // FULL history, not clipped to the window
        const f0 = tl[0][0];
        const pre = PREFLAG[m];
        { // all buyers / new to brand, per item
          const inWin = new Set(), firstSeen = new Set();
          for (const [dd, sk] of tl) {
            for (const q of sk) {
              if (dd >= a && dd <= b) inWin.add(q);
              if (dd < a) firstSeen.add(q);
            }
          }
          for (const q of inWin) {
            allBuy[q]++;
            if (!pre && f0 >= a && f0 <= b) newBrand[q]++;
          }
        }
        // journey: the acquisition order must fall in the (trimmed) window
        if (f0 >= a && f0 <= bE) {
          const fsk = tl[0][1];
          const jtl = tl.filter((o) => o[0] - f0 <= OBS);
          let inYr = 0;
          const yrOK = NDAYS - f0 >= 365;
          if (yrOK) for (let j = 0; j < tl.length; j++) if (tl[j][0] - f0 < 365) inYr++;
          const fg = tl.length >= 2 ? tl[1][0] - f0 : null;
          for (let q = 0; q < fsk.length; q++) {
            const s0 = fsk[q];
            c1[s0]++;
            if (yrOK) { yrBase[s0]++; yrSum[s0] += inYr; }
            if (jtl.length >= 2) {
              c2[s0]++;
              const gp = jtl[1][0] - f0;
              g12[s0].push(gp);
              for (const o of jtl[1][1]) { p2[s0][o]++; (p2d[s0][o] = p2d[s0][o] || []).push(gp); }
            }
            if (jtl.length >= 3) {
              c3[s0]++;
              g23[s0].push(jtl[2][0] - jtl[1][0]);
              for (const o of jtl[2][1]) p3[s0][o]++;
            }
            if (jtl.length >= 4) { c4[s0]++; g34[s0].push(jtl[3][0] - jtl[2][0]); }
            if (jtl.length >= 5) c5[s0]++;
            // milestone matrix: each column trims the window to its own maturity
            for (const h of MILES) {
              if (f0 <= Math.min(b, NDAYS - h)) {
                mB[h][s0]++;
                if (fg != null && fg <= h) mH[h][s0]++;
              }
            }
            if (f0 <= Math.min(b, NDAYS - 180)) {
              lateB[s0]++;
              if (fg != null) { anyH[s0]++; if (fg > 180) lateH[s0]++; }
            }
          }
        }
        // per product / variant: anchored on the first purchase of that item
        const seen = new Set();
        for (let i = 0; i < tl.length; i++) {
          const dd = tl[i][0], sk = tl[i][1];
          for (const s of sk) {
            if (seen.has(s)) continue;
            seen.add(s);
            if (dd < a || dd > bE) continue; // acquired on this item outside the window
            base[s]++;
            if (dd < first[s]) first[s] = dd;
            if (i === tl.length - 1) continue;
            let hit = -1;
            for (let j = i + 1; j < tl.length; j++) {
              if (tl[j][0] - dd > OBS) break;
              if (tl[j][1].indexOf(s) >= 0) { hit = j; break; }
            }
            if (hit >= 0) { rep[s]++; gaps[s].push(tl[hit][0] - dd); }
            else {
              const nd = tl[i + 1][0], ns = tl[i + 1][1];
              if (nd - dd > OBS) continue;
              for (const o of ns) {
                if (o === s) continue;
                crossN[s][o]++;
                (crossD[s][o] = crossD[s][o] || []).push(nd - dd);
              }
            }
          }
        }
      }
      // one-time buyers: in the denominators, never in the numerators
      for (const k in SRC_SING) {
        const s = +k;
        for (const [d, cN, cP] of SRC_SING[k]) {
          const c = cN + cP;
          if (d < a || d > b) continue;
          allBuy[s] += c; newBrand[s] += cN;
          if (d <= bE) {
            base[s] += c; c1[s] += c;
            if (d < first[s]) first[s] = d;
            if (NDAYS - d >= 365) { yrBase[s] += c; yrSum[s] += c; }
          }
          for (const h of MILES) if (d <= Math.min(b, NDAYS - h)) mB[h][s] += c;
          if (d <= Math.min(b, NDAYS - 180)) lateB[s] += c;
        }
      }

      for (let s = 0; s < NN; s++) {
        if (!base[s] && !c1[s]) continue;
        const g = gaps[s];
        const bk = { "0-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
        for (const x of g) bk[x <= 30 ? "0-30" : x <= 60 ? "31-60" : x <= 90 ? "61-90" : "90+"]++;
        let tc = 0;
        const tops = [];
        for (let o = 0; o < NN; o++) if (crossN[s][o]) { tc += crossN[s][o]; tops.push([o, crossN[s][o]]); }
        tops.sort((x, y) => y[1] - x[1]);
        out.push({
          i: s, code: codeOf(s), name: nameOf(s), sku: VMODE ? VARS[s].s : s,
          base: base[s], repeat_n: rep[s],
          allBuyers: allBuy[s], newToBrand: newBrand[s], newToProduct: base[s],
          crossSell: Math.max(0, base[s] - newBrand[s]),
          rate: base[s] ? (100 * rep[s]) / base[s] : 0,
          m90_base: base[s], m90_rate: base[s] ? (100 * rep[s]) / base[s] : null,
          avg: g.length ? Math.round(g.reduce((p, c) => p + c, 0) / g.length) : null,
          med: median(g), buckets: bk, cross_n: tc,
          first: first[s], monthsLive: (NDAYS - first[s] + 1) / 30.44,
          c1: c1[s], c2: c2[s], c3: c3[s], c4: c4[s], c5: c5[s],
          g12: median(g12[s]), g23: median(g23[s]), g34: median(g34[s]),
          yrBase: yrBase[s], perYear: yrBase[s] ? yrSum[s] / yrBase[s] : null,
          miles: MILES.map((h) => ({ h, base: mB[h][s], hit: mH[h][s], rate: mB[h][s] ? (100 * mH[h][s]) / mB[h][s] : null })),
          late: {
            base: lateB[s], hit: lateH[s], any: anyH[s],
            rate: lateB[s] ? (100 * lateH[s]) / lateB[s] : null,
            anyRate: lateB[s] ? (100 * anyH[s]) / lateB[s] : null,
          },
          top: tops.slice(0, 5).map(([o, c]) => ({
            code: codeOf(o), name: nameOf(o), n: c, share: (100 * c) / tc,
            avg: Math.round(crossD[s][o].reduce((p, q) => p + q, 0) / crossD[s][o].length),
            med: median(crossD[s][o]),
          })),
          p2: (() => {
            const t = [];
            for (let o = 0; o < NN; o++) if (p2[s][o]) t.push([o, p2[s][o]]);
            t.sort((x, y) => y[1] - x[1]);
            return t.slice(0, 6).map(([o, c]) => ({ code: codeOf(o), name: nameOf(o), n: c, share: c2[s] ? (100 * c) / c2[s] : 0, med: median(p2d[s][o]) }));
          })(),
          p3: (() => {
            const t = [];
            for (let o = 0; o < NN; o++) if (p3[s][o]) t.push([o, p3[s][o]]);
            t.sort((x, y) => y[1] - x[1]);
            return t.slice(0, 5).map(([o, c]) => ({ code: codeOf(o), name: nameOf(o), n: c, share: c3[s] ? (100 * c) / c3[s] : 0 }));
          })(),
        });
      }
      out.sort((x, y) => y.base - x.base);
      return out;
    }

    // --------------------------------------------------------------------- brand
    function computeBrand(a, b, hz) {
      const bE = acqEnd(b, hz);
      const n = [0, 0, 0, 0, 0, 0];
      const g12 = [], g23 = [], g34 = [];
      const H = [30, 60, 90, 180, 365];
      const cb = {}, ch = {};
      H.forEach((h) => { cb[h] = 0; ch[h] = 0; });
      const bs = { 1: [0, 0], 2: [0, 0], 3: [0, 0] };
      const OBS = hz == null ? Infinity : hz;
      if (bE < a) return { n, g12: null, g23: null, g34: null, H, cb, ch, bs, bE, empty: true };
      for (let m = 0; m < MULTI.length; m++) {
        const tl = MULTI[m];
        const f0 = tl[0][0];
        if (PREFLAG[m]) continue; // brand cohort = genuinely new to the brand
        if (f0 < a || f0 > bE) continue;
        const jtl = tl.filter((o) => o[0] - f0 <= OBS);
        const k = Math.min(jtl.length, 5);
        for (let i = 1; i <= k; i++) n[i]++;
        if (jtl.length >= 2) g12.push(jtl[1][0] - f0);
        if (jtl.length >= 3) g23.push(jtl[2][0] - jtl[1][0]);
        if (jtl.length >= 4) g34.push(jtl[3][0] - jtl[2][0]);
        // each milestone trims the window to its own maturity
        for (const h of H) {
          if (f0 <= Math.min(b, NDAYS - h)) {
            cb[h]++;
            for (let j = 1; j < tl.length; j++) {
              const dd = tl[j][0] - f0;
              if (dd > 0 && dd <= h) { ch[h]++; break; }
            }
          }
        }
        const z = Math.min(tl[0][1].length, 3);
        if (f0 <= Math.min(b, NDAYS - 90)) {
          bs[z][0]++;
          for (let j = 1; j < tl.length; j++) {
            const dd = tl[j][0] - f0;
            if (dd > 0 && dd <= 90) { bs[z][1]++; break; }
          }
        }
      }
      for (let i = 0; i < SB.length; i++) {
        const d = SB[i][0], z = SB[i][1];
        if (d < a || d > b) continue;
        const cNew = SB[i][2];
        if (d <= bE) n[1] += cNew;
        for (const h of H) if (d <= Math.min(b, NDAYS - h)) cb[h] += cNew;
        if (d <= Math.min(b, NDAYS - 90)) bs[z][0] += cNew;
      }
      return { n, g12: median(g12), g23: median(g23), g34: median(g34), H, cb, ch, bs, bE, empty: false, winRate: n[1] ? (100 * n[2]) / n[1] : 0 };
    }

    // ------------------------------------------------------------------ variants
    function computeVariants(a, b, sk, hz) {
      const ids = [];
      for (let i = 0; i < NV; i++) if (VARS[i].s === sk) ids.push(i);
      const idset = new Set(ids);
      const subs = [...new Set(ids.map((i) => VARS[i].sub))].filter((x) => x !== "—" && x !== "Unspecified");
      const hasSub = subs.length > 0;
      const lb = {}, lm = {}, lg = {};
      subs.forEach((f) => { lb[f] = 0; lm[f] = {}; lg[f] = []; });
      const bE = acqEnd(b, hz);
      const OBS = hz == null ? Infinity : hz;
      // some fragrances or shades launched later: swap-or-stay is only measured from then on
      const launch = (P.sub_launch || {})[SKUS[sk][0]];
      const A2 = hasSub && launch ? Math.max(a, dateToDay(launch)) : a;
      for (let m = 0; m < MULTI_V.length; m++) {
        const tl = MULTI_V[m];
        if (!tl.length) continue;
        const seen = new Set();
        for (let i = 0; i < tl.length; i++) {
          for (const v of tl[i][1]) {
            if (!idset.has(v)) continue;
            const f = VARS[v].sub;
            if (!hasSub || subs.indexOf(f) < 0 || seen.has(f)) continue;
            if (tl[i][0] < A2 || tl[i][0] > bE) continue;
            seen.add(f);
            lb[f]++;
            for (let j = i + 1; j < tl.length; j++) {
              if (tl[j][0] - tl[i][0] > OBS) break;
              const nx = [...new Set(tl[j][1].filter((x) => idset.has(x)).map((x) => VARS[x].sub).filter((x) => subs.indexOf(x) >= 0))];
              if (nx.length) {
                nx.forEach((nn) => (lm[f][nn] = (lm[f][nn] || 0) + 1));
                lg[f].push(tl[j][0] - tl[i][0]);
                break;
              }
            }
          }
        }
      }
      // pack comparison
      const pk = { 1: null, 2: null };
      [1, 2].forEach((p) => {
        const sel = new Set(ids.filter((i) => VARS[i].pack === p));
        if (!sel.size) return;
        let base = 0, rep = 0, yrB = 0, yrS = 0;
        const g = [];
        for (let m = 0; m < MULTI_V.length; m++) {
          const tl = MULTI_V[m].filter((x) => x[0] >= a && x[0] <= b);
          for (let i = 0; i < tl.length; i++) {
            if (!tl[i][1].some((x) => sel.has(x))) continue;
            base++;
            const d = tl[i][0];
            if (b - d >= 365) { yrB++; for (const [dd] of tl) if (dd - d >= 0 && dd - d < 365) yrS++; }
            for (let j = i + 1; j < tl.length; j++) {
              if (tl[j][1].some((x) => sel.has(x))) { rep++; g.push(tl[j][0] - d); break; }
            }
            break;
          }
        }
        for (const k in SINGLES_V) {
          if (!sel.has(+k)) continue;
          for (const [d, c] of SINGLES_V[k]) {
            if (d >= a && d <= bE) { base += c; if (NDAYS - d >= 365) { yrB += c; yrS += c; } }
          }
        }
        pk[p] = { base, rep, rate: base ? (100 * rep) / base : 0, med: median(g), perYear: yrB ? yrS / yrB : null, yrB };
      });
      return { ids, subs, hasSub, lb, lm, lg, pk, A2 };
    }

    // ------------------------------------------------------------- revenue & LTV
    // Order value is the whole order (every line), merged the same way as the
    // timelines. A customer's value inside h days counts the first order too.
    const LTV_H = [30, 60, 90, 180, 365];

    function computeValue(a, b, hz) {
      const bE = acqEnd(b, hz);
      const OBS = hz == null ? Infinity : hz;
      const ltv = {};
      LTV_H.forEach((h) => (ltv[h] = { n: 0, rev: 0, first: 0 }));
      const size = { 1: { n: 0, first: 0, n90: 0, rev90: 0 }, 2: { n: 0, first: 0, n90: 0, rev90: 0 }, 3: { n: 0, first: 0, n90: 0, rev90: 0 } };
      const t = { cust: 0, first: 0, hzN: 0, hzFirst: 0, repOrders: 0, repRev: 0, repCust: 0 };
      for (let m = 0; m < MULTI.length; m++) {
        const tl = MULTI[m], f0 = tl[0][0];
        if (PREFLAG[m] || f0 < a || f0 > b) continue;
        t.cust++; t.first += tl[0][2];
        const z = Math.min(tl[0][1].length, 3);
        size[z].n++; size[z].first += tl[0][2];
        if (f0 <= bE) {
          t.hzN++; t.hzFirst += tl[0][2];
          let any = false;
          for (let j = 1; j < tl.length; j++) {
            if (tl[j][0] - f0 > OBS) break;
            t.repOrders++; t.repRev += tl[j][2]; any = true;
          }
          if (any) t.repCust++;
        }
        for (const h of LTV_H) {
          if (f0 > Math.min(b, NDAYS - h)) continue;
          let r = 0;
          for (let j = 0; j < tl.length; j++) if (tl[j][0] - f0 <= h) r += tl[j][2];
          ltv[h].n++; ltv[h].rev += r; ltv[h].first += tl[0][2];
          if (h === 90) { size[z].n90++; size[z].rev90 += r; }
        }
      }
      for (const [d, z, cN, , rev] of SB) {
        if (d < a || d > b) continue;
        t.cust += cN; t.first += rev;
        size[z].n += cN; size[z].first += rev;
        if (d <= bE) { t.hzN += cN; t.hzFirst += rev; }
        for (const h of LTV_H) {
          if (d > Math.min(b, NDAYS - h)) continue;
          ltv[h].n += cN; ltv[h].rev += rev; ltv[h].first += rev;
          if (h === 90) { size[z].n90 += cN; size[z].rev90 += rev; }
        }
      }
      const per = (x, n) => (n ? x / n : null);
      return {
        empty: !t.cust, bE, cust: t.cust,
        firstAov: per(t.first, t.cust),
        repAov: per(t.repRev, t.repOrders), repOrders: t.repOrders, repRev: t.repRev, repCust: t.repCust,
        hzN: t.hzN, repShare: t.hzFirst + t.repRev ? (100 * t.repRev) / (t.hzFirst + t.repRev) : null,
        hzPer: per(t.hzFirst + t.repRev, t.hzN),
        ltv: LTV_H.map((h) => ({ h, n: ltv[h].n, per: per(ltv[h].rev, ltv[h].n), first: per(ltv[h].first, ltv[h].n),
          lift: ltv[h].first ? ltv[h].rev / ltv[h].first : null })),
        size: [1, 2, 3].map((z) => ({ z, n: size[z].n, first: per(size[z].first, size[z].n), n90: size[z].n90, ltv90: per(size[z].rev90, size[z].n90) })),
      };
    }

    // monthly acquisition cohorts: value per customer once the month is fully mature
    function computeMonthly(a, b) {
      const months = new Map();
      const slot = (d) => {
        const dt = dayToDate(d), key = dt.getUTCFullYear() * 100 + dt.getUTCMonth() + 1;
        if (!months.has(key)) {
          const end = dateToDay(iso(new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0))));
          months.set(key, { key, label: dt.toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }), end, n: 0, first: 0, again90: 0, base90: 0, rev: {}, nn: {} });
          LTV_H.forEach((h) => { months.get(key).rev[h] = 0; months.get(key).nn[h] = 0; });
        }
        return months.get(key);
      };
      const add = (d, cnt, firstRev, f0, tl) => {
        const c = slot(d);
        c.n += cnt; c.first += firstRev;
        for (const h of LTV_H) {
          if (c.end > NDAYS - h) continue; // month not fully mature for this horizon
          c.nn[h] += cnt;
          let r = firstRev;
          if (tl) { r = 0; for (const o of tl) if (o[0] - f0 <= h) r += o[2]; }
          c.rev[h] += r;
        }
        if (c.end <= NDAYS - 90) {
          c.base90 += cnt;
          if (tl && tl.length > 1 && tl[1][0] - f0 <= 90) c.again90 += cnt;
        }
      };
      for (let m = 0; m < MULTI.length; m++) {
        const tl = MULTI[m], f0 = tl[0][0];
        if (PREFLAG[m] || f0 < a || f0 > b) continue;
        add(f0, 1, tl[0][2], f0, tl);
      }
      for (const [d, , cN, , rev] of SB) if (d >= a && d <= b) add(d, cN, rev, d, null);
      return [...months.values()].sort((x, y) => x.key - y.key).map((c) => ({
        key: c.key, label: c.label, n: c.n, aov: c.n ? c.first / c.n : null,
        again90: c.base90 ? (100 * c.again90) / c.base90 : null,
        ltv: LTV_H.map((h) => ({ h, per: c.nn[h] ? c.rev[h] / c.nn[h] : null })),
      }));
    }

    // per product: customers whose first order held it, and what they are worth
    function computeProductValue(a, b) {
      const acc = Array.from({ length: NS }, () => ({ n: 0, first: 0, n90: 0, r90: 0, n180: 0, r180: 0, n365: 0, r365: 0 }));
      for (let m = 0; m < MULTI.length; m++) {
        const tl = MULTI[m], f0 = tl[0][0];
        if (f0 < a || f0 > b) continue;
        const v = (h) => { let r = 0; for (const o of tl) if (o[0] - f0 <= h) r += o[2]; return r; };
        const r90 = f0 <= NDAYS - 90 ? v(90) : null, r180 = f0 <= NDAYS - 180 ? v(180) : null, r365 = f0 <= NDAYS - 365 ? v(365) : null;
        for (const s of tl[0][1]) {
          const c = acc[s];
          c.n++; c.first += tl[0][2];
          if (r90 != null) { c.n90++; c.r90 += r90; }
          if (r180 != null) { c.n180++; c.r180 += r180; }
          if (r365 != null) { c.n365++; c.r365 += r365; }
        }
      }
      for (const k in SINGLES) {
        const c = acc[+k];
        for (const [d, cN, , rev] of SINGLES[k]) {
          if (d < a || d > b) continue;
          c.n += cN; c.first += rev;
          if (d <= NDAYS - 90) { c.n90 += cN; c.r90 += rev; }
          if (d <= NDAYS - 180) { c.n180 += cN; c.r180 += rev; }
          if (d <= NDAYS - 365) { c.n365 += cN; c.r365 += rev; }
        }
      }
      const per = (x, n) => (n ? x / n : null);
      return acc.map((c, i) => ({
        i, code: SKUS[i][0], name: SKUS[i][1], n: c.n, aov: per(c.first, c.n),
        n90: c.n90, ltv90: per(c.r90, c.n90), n180: c.n180, ltv180: per(c.r180, c.n180), n365: c.n365, ltv365: per(c.r365, c.n365),
      })).filter((r) => r.n > 0);
    }

    return {
      P, EPOCH, NDAYS, SKUS, VARS, NS, NV, MILES,
      compute, computeBrand, computeVariants, computeValue, computeMonthly, computeProductValue, LTV_H, acqEnd, median,
      dayToDate, iso, dateToDay,
    };
  }

  root.createRetentionEngine = createEngine;
  if (typeof module !== "undefined" && module.exports) module.exports = createEngine;
})(typeof window !== "undefined" ? window : globalThis);
