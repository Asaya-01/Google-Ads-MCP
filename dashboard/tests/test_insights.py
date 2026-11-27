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
