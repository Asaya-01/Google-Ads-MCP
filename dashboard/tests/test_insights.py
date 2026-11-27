"""Rule-based insights and absolute deltas (made-up numbers): each rule
names the right driver and direction, and stays quiet when it should."""

import json
import subprocess

from app import settings

HARNESS = r"""
const vm = require("vm"), fs = require("fs");
const ctx = { console, Intl, Math, Number, Object, JSON, Array, String, Set, Map, Date };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(process.argv[1] + "/metrics.js", "utf8"), ctx);
vm.runInContext(`
  const esc = (s) => String(s ?? "");
  const dayLabel = (d) => d;
  const css = () => "";
  var RG = { eng: { phaseOf: () => "bau", windowOf: (l) => ({}), isRate: (k) => ["cvr","aov","roas","perf_cvr","atc_rate","atc_to_ic","ic_to_order","cps"].includes(k) } };
  globalThis.METRIC_RULES = METRIC_RULES; globalThis.METRICS = METRICS;
` + fs.readFileSync(process.argv[1] + "/insights.js", "utf8") + `
  globalThis.T = { insSalesBridge, insRoas, insMix, insFunnel, insOverview, mAbsDelta };
`, ctx);
const T = ctx.T, out = {};
const W = (o) => ({ days: 7, ...o });
// sales up 10% a day, all of it from traffic (CVR and AOV flat)
const g1 = { w: W({ sessions: 7700, orders: 77, gmv: 77000, cvr: 0.01, aov: 1000 }), pw: W({ sessions: 7000, orders: 70, gmv: 70000, cvr: 0.01, aov: 1000 }), cur: [], prev: [] };
out.bridge = T.insSalesBridge(g1);
// spend +50%, sales +10%: marginal ROAS below average
const g2 = { w: W({ perf_all_spend: 105000, store_gmv: 231000, roas: 2.2 }), pw: W({ perf_all_spend: 70000, store_gmv: 210000, roas: 3.0 }) };
out.roas = T.insRoas(g2);
// CVR down, Perf CVR flat: traffic mix
const g3 = { w: W({ cvr: 0.009, perf_cvr: 0.02, sessions: 10000, report_perf_sessions: 4000 }), pw: W({ cvr: 0.011, perf_cvr: 0.02, sessions: 8000, report_perf_sessions: 4400 }) };
out.mix = T.insMix(g3);
// checkout → order fell: the biggest leak
const g4 = { w: W({ orders: 70, atc_rate: 0.08, atc_to_ic: 0.4, ic_to_order: 0.4, cvr: 0.01, perf_cvr: 0.02, sessions: 7000, report_perf_sessions: 3500 }),
             pw: W({ orders: 80, atc_rate: 0.08, atc_to_ic: 0.4, ic_to_order: 0.5, cvr: 0.0114, perf_cvr: 0.0229, sessions: 7000, report_perf_sessions: 3500 }), note: null };
out.funnel = T.insFunnel(g4);
out.flat = T.insSalesBridge({ w: g1.pw, pw: g1.pw });
out.small = T.insOverview({ w: g1.w, pw: W({ orders: 3 }), cur: [], prev: [] });
out.abs = [T.mAbsDelta("cvr", 0.037, 0.045), T.mAbsDelta("total_sales", 449000, 576000), T.mAbsDelta("blended_roas", 1.68, 1.43), T.mAbsDelta("cvr", 0.0084, 0.00841)];
console.log(JSON.stringify(out));
"""


def run():
    done = subprocess.run(["node", "-e", HARNESS, str(settings.STATIC_DIR)], capture_output=True, text=True, check=True)
    return json.loads(done.stdout)


def test_insight_rules_name_the_right_driver():
    o = run()
    assert o["bridge"]["tone"] == "good" and "<b>Traffic (sessions)</b> drove most of it" in o["bridge"]["html"]
    assert "+10.0%" in o["bridge"]["html"]
    assert o["roas"]["tone"] == "bad" and "diminishing" in o["roas"]["html"]
    assert "0.60x" in o["roas"]["html"]  # marginal: +3,000 sales a day for +5,000 spend a day
    assert o["mix"]["tag"] == "Traffic mix" and "not the site" in o["mix"]["html"]
    assert "Checkout → order" in o["funnel"] and "Biggest leak" in o["funnel"] and "<b>2.5</b> fewer orders a day" in o["funnel"]
    assert o["flat"] is None
    assert "too few" in o["small"]


def test_absolute_deltas_use_each_metrics_unit():
    assert run()["abs"] == ["Δ −0.8 pp", "Δ −₹1.27L", "Δ +0.25x", "Δ 0.0 pp"]


def test_the_insights_file_is_inlined():
    html = settings.app_fragment()
    assert "__INSIGHTS__" not in html and "function insOverview(g)" in html and 'id="today-chip"' in html


ENGINE = r"""
const E = require(process.argv[1] + "/range_engine.js");
const days = ["2026-11-01", "2026-11-02"], n = 2;
const v = (a) => a;
const D = { dates: days, phase: ["bau", "bau"], reasons: [], na: {}, fields: [], values: {} };
const set = (k, arr) => { D.fields.push(k); D.values[k] = arr; };
set("sh_orders", [100, 100]); set("sh_sales", [80000, 80000]); set("orders", [98, 98]); set("gmv", [79000, 79000]);
set("new_orders", [60, 60]); set("repeat_orders", [36, 36]); set("sessions", [10000, 10000]); set("report_perf_sessions", [5000, 5000]);
set("perf_all_spend", [40000, 40000]);
for (const [c, o, s, nw] of [["app_ios", 1, 500, 1], ["app_android", 4, 2500, 3], ["app", 5, 3000, 4], ["web", 95, 77000, 56]]) {
  set("sh_orders_" + c, [o, o]); set("sh_sales_" + c, [s, s]); set("orders_" + c, [o, o]); set("gmv_" + c, [s, s]);
  set("new_orders_" + c, [nw, nw]); set("repeat_orders_" + c, [o - nw, o - nw]);
}
const out = {};
for (const ch of ["all", "web", "app", "app_android"]) {
  const w = E(D, "perf", ch).windowOf(days);
  out[ch] = { orders: w.orders, gmv: w.gmv, cvr: w.cvr, roas: w.roas, cpnc: w.cpnc, new: w.new_orders, na_roas: !!w.na.perf_all_spend, na_sessions: !!w.na.sessions };
}
console.log(JSON.stringify(out));
"""


def test_the_channel_view_reads_its_own_orders_and_never_mixes():
    o = json.loads(subprocess.run(["node", "-e", ENGINE, str(settings.STATIC_DIR)], capture_output=True, text=True, check=True).stdout)
    assert o["all"]["orders"] == 200 and o["web"]["orders"] == 190 and o["app"]["orders"] == 10 and o["app_android"]["orders"] == 8
    assert o["web"]["orders"] + o["app"]["orders"] == o["all"]["orders"]
    assert o["web"]["cvr"] == 190 / 20000  # web orders over web (all) sessions
    assert o["all"]["cpnc"] == 80000 / 120 and o["all"]["roas"] == 160000 / 80000
    # no app sessions and no channel spend: blank with a reason, never a number
    assert o["app"]["cvr"] is None and o["app"]["na_sessions"] and o["app"]["roas"] is None
    assert o["web"]["roas"] is None and o["web"]["na_roas"] and o["web"]["cpnc"] is None


PACE = r"""
const vm = require("vm"), fs = require("fs");
const ctx = { console, Intl, Math, Number, Object, JSON, Array, String, Set, Map, Date };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(process.argv[1] + "/metrics.js", "utf8"), ctx);
const dates = []; for (let d = 1; d <= 10; d++) dates.push(`2026-11-${String(d).padStart(2, "0")}`);
const plan = {}; for (let d = 1; d <= 30; d++) plan[`2026-11-${String(d).padStart(2, "0")}`] = { store: [10000, d >= 27 ? 60000 : 30000] };
vm.runInContext(`
  const esc = (s) => String(s ?? ""); const dayLabel = (d) => d; const inGroup = new Intl.NumberFormat("en-IN");
  var state = { pages: { plan_days: { days: ${JSON.stringify(plan)} } } };
  var RG = { channel: "all", raw: { dates: ${JSON.stringify(dates)}, values: { sh_sales: ${JSON.stringify(dates.map(() => 27000))}, perf_all_spend: ${JSON.stringify(dates.map(() => 11000))} } } };
` + fs.readFileSync(process.argv[1] + "/insights.js", "utf8") + `
  globalThis.out = { pace: rgPacing(), products: insProducts({ names: [{ id: "1", label: "UAS" }, { id: "2", label: "ITB" }],
    rows: [["a", 0, 20, 20000], ["a", 1, 10, 8000], ["b", 0, 10, 10000], ["b", 1, 10, 8000]] }, { cur: ["a"], prev: ["b"], pw: {}, note: null }) };
`, ctx);
console.log(JSON.stringify(ctx.out));
"""


def test_pacing_projects_on_the_plans_shape_and_products_name_the_driver():
    o = json.loads(subprocess.run(["node", "-e", PACE, str(settings.STATIC_DIR)], capture_output=True, text=True, check=True).stdout)
    html = o["pace"]["html"]
    # 10 days at 27K against 30K planned = 90%; the plan's 20 remaining days hold 16 x 30K + 4 x 60K = 7.2L
    # projected = 2.7L + 0.9 x 7.2L = 9.18L against 10.2L planned (90%)
    assert "₹9.18L" in html and "₹10.2L" in html and "90.0%" in html and "Behind plan" in html
    assert "₹37.5K a day for the 20 days left" in html  # (10.2L - 2.7L) / 20
    assert "Spend is running at 110.0% of its plan while sales are at 90.0%" in html
    p = o["products"]
    assert "<b>UAS</b> +₹10.0K a day" in p and "Volume drove it" in p
