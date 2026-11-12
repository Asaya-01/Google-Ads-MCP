#!/usr/bin/env node
/* Dashboard Plus regression check: the four headline numbers the owner
   pinned, worked out by the dashboard's own range engine from the live
   days page, BAU days only, exactly as the header's "BAU days" view shows
   them. Run before and after every Plus phase; the numbers must not move.

   node dashboard/tools/plus_regression.js <days.json> [from] [to]

   Defaults: 1 Jul – 30 Sept 2026. Compare against the figures the owner
   holds (kept out of this public repository). */
const fs = require("fs");
const path = require("path");
const engine = require(path.join(__dirname, "..", "static", "range_engine.js"));
const metrics = require(path.join(__dirname, "..", "static", "metrics.js"));

const [file, from = "2026-07-01", to = "2026-09-30"] = process.argv.slice(2);
if (!file) { console.error("usage: plus_regression.js <days.json> [from] [to]"); process.exit(2); }
const days = JSON.parse(fs.readFileSync(file, "utf8"));
const e = engine(days, "perf");
const c = e.compare(from, to, { mode: "custom", from, to });
const g = c.groups.find((x) => x.phase === "bau");
if (!g) { console.error("no BAU days in", from, to); process.exit(1); }
const w = g.w, M = metrics.METRICS, f = (id, v) => metrics.mFormat(M[id].format, v, id === "total_sales");
const out = {
  range: `${from} .. ${to}, BAU days (${g.cur.length})`,
  total_sales: f("total_sales", w[M.total_sales.field]),
  orders: f("orders", w[M.orders.field]),
  sessions: metrics.mFormat("count", w.sessions),
  blended_roas: f("blended_roas", w[M.blended_roas.field]),
};
console.log(JSON.stringify(out, null, 1));
