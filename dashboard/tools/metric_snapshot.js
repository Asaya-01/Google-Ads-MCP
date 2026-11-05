#!/usr/bin/env node
/* Snapshot of every metric the dashboard shows, for fixed date ranges, so a
   refactor can prove no number moved.

   node tools/metric_snapshot.js <pages dir> <out.json> <from> <to> <cmp_from> <cmp_to> [<from> <to> <cmp_from> <cmp_to> ...]

   <pages dir> holds the built pages (days.json, channel_days.json, ...).
   The output is business data: write it outside the repository. */
const fs = require("fs");
const path = require("path");
const engine = require(path.join(__dirname, "..", "static", "range_engine.js"));

const [dir, out, ...ranges] = process.argv.slice(2);
if (!dir || !out || ranges.length < 4 || ranges.length % 4) {
  console.error("usage: metric_snapshot.js <pages dir> <out.json> <from> <to> <cmp_from> <cmp_to> ...");
  process.exit(2);
}
const page = (n) => { try { return JSON.parse(fs.readFileSync(path.join(dir, n + ".json"), "utf8")); } catch (e) { return null; } };
const days = page("days"), ch = page("channel_days"), slab = page("slab_days"), prod = page("product_days");
const round = (v) => (typeof v === "number" ? Math.round(v * 1e6) / 1e6 : v);
const clean = (w) => Object.fromEntries(Object.entries(w || {}).filter(([, v]) => typeof v === "number" || v === null).map(([k, v]) => [k, round(v)]));

function sums(list, rows, key, vals) {
  const set = new Set(list), o = {};
  for (const r of rows || []) {
    if (!set.has(r[0])) continue;
    const k = key(r);
    const a = (o[k] = o[k] || vals.map(() => 0));
    vals.forEach((i, j) => { a[j] += r[i] || 0; });
  }
  for (const k in o) o[k] = o[k].map(round);
  return o;
}
function breakdowns(list) {
  return {
    channel: ch ? sums(list, ch.rows, (r) => `${ch.channels[r[1]]}|${ch.kinds[r[2]]}`, [3, 4, 5, 6]) : null,
    slab: slab ? sums(list, slab.rows, (r) => String(r[1]), [2, 3, 4, 5]) : null,
    product: prod ? sums(list, prod.rows, (r) => prod.names[r[1]].id, [2, 3]) : null,
  };
}

const snap = {};
for (let i = 0; i < ranges.length; i += 4) {
  const [a, b, ca, cb] = ranges.slice(i, i + 4);
  const key = `${a}..${b} vs ${ca}..${cb}`;
  snap[key] = {};
  for (const mode of ["perf", "all", "aw"]) {
    const e = engine(days, mode);
    const c = e.compare(a, b, { mode: "custom", from: ca, to: cb });
    snap[key][mode] = {
      whole: clean(c.w),
      groups: c.groups.map((g) => ({
        phase: g.phase, cur: g.cur, prev: g.prev,
        w: clean(g.w), pw: clean(g.pw),
        ...(mode === "perf" ? { cur_breakdowns: breakdowns(g.cur), prev_breakdowns: breakdowns(g.prev || []) } : {}),
      })),
    };
  }
}
fs.writeFileSync(out, JSON.stringify(snap, null, 1));
console.log("wrote", out, Object.keys(snap).length, "range pairs");
