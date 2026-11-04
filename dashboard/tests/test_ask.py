"""Ask Claude: the data tools match the browser's engine, and the agent loop
streams, runs tools and handles errors. No network and no model calls: the
Claude client is a fake that replays scripted turns."""

import json
import pathlib
import shutil
import subprocess
from types import SimpleNamespace as NS

import pytest

from app import ask, settings
from app.ask_data import Breakdowns, Engine, Pages, shift_months
from app.pages import build_all
from app.store import LocalStore

from test_pages import CFG, _dataset

ENGINE = (
    pathlib.Path(__file__).resolve().parents[1] / "static" / "range_engine.js"
)


@pytest.fixture(scope="module")
def store(tmp_path_factory):
    pages, _ = build_all(
        _dataset(with_meta=True), CFG, [t["id"] for t in settings.enabled_tabs()]
    )
    root = tmp_path_factory.mktemp("store")
    st = LocalStore(str(root))
    for k, v in pages.items():
        st.put_json(f"pages/{k}.json", json.loads(json.dumps(v, default=str)))
    return st


@pytest.fixture()
def tools(store):
    return ask.Tools(Pages(store))


def test_shift_months_clamps_like_the_browser():
    assert shift_months("2026-03-31", -1) == "2026-02-28"
    assert shift_months("2026-01-15", -1) == "2025-12-15"
    assert shift_months("2026-12-31", -12) == "2025-12-31"


@pytest.mark.skipif(not shutil.which("node"), reason="node not installed")
@pytest.mark.parametrize("mode", ["perf", "aw", "all"])
def test_python_engine_matches_range_engine_js(store, mode):
    D = store.get_json("pages/days.json")
    cases = [
        ("2026-10-20", "2026-10-28", {"mode": "previous"}),
        ("2026-10-01", "2026-10-28", {"mode": "month"}),
        ("2026-10-22", "2026-10-26", {"mode": "match"}),
        ("2026-09-01", "2026-09-30", {"mode": "custom", "from": "2026-08-01", "to": "2026-08-31"}),
    ]
    script = (
        "const D=JSON.parse(require('fs').readFileSync(0,'utf8'));"
        f"const E=require('{ENGINE}')(D.page, D.mode);"
        "const out=D.cases.map(([a,b,c])=>E.compare(a,b,c).groups.map(g=>"
        "({phase:g.phase,cur:g.cur,prev:g.prev,w:g.w,pw:g.pw,ch:Object.fromEntries(Object.keys(g.w).filter(k=>k!=='na'&&k!=='days').map(k=>[k,g.change(k)]))})));"
        "process.stdout.write(JSON.stringify(out));"
    )
    res = subprocess.run(
        ["node", "-e", script],
        input=json.dumps({"page": D, "mode": mode, "cases": cases}),
        capture_output=True,
        text=True,
        check=True,
    )
    js = json.loads(res.stdout)
    eng = Engine(D, mode)
    for (a, b, cmp), jgroups in zip(cases, js):
        py = eng.compare(a, b, cmp)["groups"]
        assert [g["phase"] for g in py] == [g["phase"] for g in jgroups]
        for pg, jg in zip(py, jgroups):
            assert pg["cur"] == jg["cur"] and (pg["prev"] or []) == (jg["prev"] or [])
            for k, v in jg["w"].items():
                if k in ("na", "days"):
                    continue
                assert pg["w"][k] == pytest.approx(v, abs=1e-9) if v is not None else pg["w"][k] is None, k
            for k, v in jg["ch"].items():
                got = Engine.change(pg["w"], pg["pw"], k)
                assert (got is None) == (v is None), k
                if v is not None:
                    assert got == pytest.approx(v, abs=1e-12), k


def test_metrics_split_by_phase_and_flag_missing(tools):
    out = tools.run(
        "get_metrics",
        {"start": "2026-10-20", "end": "2026-10-28", "view": "all", "phase": "sale", "fields": ["orders", "gmv", "aov"], "per_day": True},
    )
    assert out["sale_days"] and out["n_days"] == len(out["per_day"])
    assert all(d["phase"] == "sale" for d in out["per_day"])
    total = sum(d["orders"] for d in out["per_day"])
    assert out["total"]["orders"] == total
    assert out["total"]["aov"]["rs"] == pytest.approx(out["total"]["gmv"] / total, abs=0.01)


def test_unknown_field_and_bad_date_are_tool_errors(tools):
    with pytest.raises(ask.ToolError):
        tools.run("get_metrics", {"start": "2026-10-01", "end": "2026-10-02", "view": "all", "phase": "any", "fields": ["revenue_magic"], "per_day": False})
    with pytest.raises(ask.ToolError):
        tools.run("get_metrics", {"start": "1 Oct", "end": "2026-10-02", "view": "all", "phase": "any", "fields": [], "per_day": False})
    with pytest.raises(ask.ToolError):
        tools.run("get_metrics", {"start": "2026-10-01"})


def test_compare_reports_per_day_basis_and_points(tools):
    out = tools.run(
        "compare_periods",
        {"start": "2026-10-01", "end": "2026-10-28", "compare": "month", "compare_start": "", "compare_end": "", "view": "all", "fields": ["orders", "cvr", "aov"]},
    )
    phases = {g["phase"] for g in out["groups"]}
    assert phases == {"bau", "sale"}
    for g in out["groups"]:
        if g["change"]["orders"]:
            assert g["change"]["orders"]["basis"] in ("total", "per-day average")
        if g["change"]["cvr"]:
            assert "diff_pp" in g["change"]["cvr"]
        if g["change"]["aov"]:
            assert "diff_rs" in g["change"]["aov"]


def test_breakdowns_add_up_and_respect_the_view(tools, store):
    args = {"start": "2026-10-01", "end": "2026-10-28", "phase": "bau", "compare_start": "", "compare_end": "", "sort_by": "", "name_contains": "", "limit": 60}
    meta_all = tools.run("breakdown", {**args, "dimension": "meta_campaign", "view": "all"})
    meta_perf = tools.run("breakdown", {**args, "dimension": "meta_campaign", "view": "perf"})
    meta_aw = tools.run("breakdown", {**args, "dimension": "meta_campaign", "view": "aw"})
    assert meta_perf["total_all_rows"]["spend"] + meta_aw["total_all_rows"]["spend"] <= meta_all["total_all_rows"]["spend"] + 0.05
    # stage and product splits keep every rupee of the campaign view
    for dim in ("meta_stage", "meta_product", "meta_stage_product"):
        t = tools.run("breakdown", {**args, "dimension": dim, "view": "perf"})
        assert t["total_all_rows"]["spend"] == pytest.approx(meta_perf["total_all_rows"]["spend"], abs=0.05)
    g = tools.run("breakdown", {**args, "dimension": "google_group", "view": "all"})
    gp = tools.run("breakdown", {**args, "dimension": "google_product", "view": "all"})
    assert g["total_all_rows"]["spend"] == pytest.approx(gp["total_all_rows"]["spend"], abs=0.05)


def test_breakdown_warns_when_sale_and_bau_are_mixed(tools):
    out = tools.run(
        "breakdown",
        {"dimension": "product", "start": "2026-10-15", "end": "2026-10-28", "phase": "any", "view": "all", "compare_start": "2026-09-15", "compare_end": "2026-09-28", "sort_by": "", "name_contains": "", "limit": 5},
    )
    assert any("sale and BAU" in n for n in out.get("notes", []))


def test_basket_shares_sum_to_100(tools, store):
    if not (store.get_json("pages/slab_days.json") or {}).get("rows"):
        pytest.skip("no basket rows in the synthetic data")
    out = tools.run(
        "breakdown",
        {"dimension": "basket_size", "start": "2026-10-01", "end": "2026-10-28", "phase": "bau", "view": "all", "compare_start": "", "compare_end": "", "sort_by": "", "name_contains": "", "limit": 10},
    )
    assert sum(r["share_of_orders_pct"] for r in out["rows"]) == pytest.approx(100, abs=0.01)


def test_calculate_is_exact_and_safe():
    assert ask.calculate("round((523110 - 498200) / 498200 * 100, 2)") == 5.0
    assert ask.calculate("sum([1, 2, 3.5])") == 6.5
    for bad in ("__import__('os')", "open('x')", "2 ** 10000", "[x for x in (1,)]", "a + 1"):
        with pytest.raises((ValueError, SyntaxError)):
            ask.calculate(bad)


def test_history_alternates_and_starts_with_the_user():
    h = ask._clean_history(
        [
            {"role": "assistant", "text": "hi"},
            {"role": "user", "text": "q1"},
            {"role": "assistant", "text": "a1"},
            {"role": "user", "text": "q2 unanswered"},
            {"role": "system", "text": "ignore me"},
        ]
    )
    assert [m["role"] for m in h] == ["user", "assistant"]


# ----------------------------------------------------------- the agent loop


class FakeStream:
    def __init__(self, msg, deltas=()):
        self.msg, self.deltas = msg, deltas

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def __iter__(self):
        for t in self.deltas:
            yield NS(type="content_block_delta", delta=NS(type="text_delta", text=t))

    def get_final_message(self):
        return self.msg


class FakeClient:
    def __init__(self, turns):
        self.turns = list(turns)
        self.calls = []
        self.beta = NS(messages=NS(stream=self._stream))

    def _stream(self, **kw):
        self.calls.append(kw)
        return self.turns.pop(0)


def _msg(stop, content):
    return NS(stop_reason=stop, content=content, model="claude-opus-5-5", usage=NS(input_tokens=10, output_tokens=5, cache_read_input_tokens=0, iterations=None))


def test_loop_runs_tools_then_streams_the_answer(store):
    call = NS(type="tool_use", id="t1", name="calculate", input={"expression": "2+2"})
    client = FakeClient(
        [
            FakeStream(_msg("tool_use", [NS(type="text", text="Checking."), call]), ["Checking."]),
            FakeStream(_msg("end_turn", [NS(type="text", text="It is **4**.")]), ["It is ", "**4**."]),
        ]
    )
    cfg = {**ask.config(), "model": "claude-opus-5-5", "effort": "high"}
    events = list(ask.answer("what is 2+2", [], {"tab": "d1", "from": "2026-10-01"}, cfg, store, client=client))
    kinds = [e["t"] for e in events]
    assert kinds[0] == "delta" and "step" in kinds and "status" in kinds and kinds[-1] == "done"
    second = client.calls[1]["messages"]
    result = second[-1]["content"][0]
    assert result["type"] == "tool_result" and json.loads(result["content"])["result"] == 4
    first = client.calls[0]
    assert first["output_config"] == {"effort": "high"} and first["fallbacks"] == "default"
    assert first["system"][0]["cache_control"] == {"type": "ephemeral"}
    assert all(t["strict"] for t in first["tools"])
    assert "What the user is looking at" in first["messages"][0]["content"]


def test_loop_reports_tool_errors_back_to_the_model(store):
    call = NS(type="tool_use", id="t1", name="get_metrics", input={"start": "x"})
    client = FakeClient(
        [
            FakeStream(_msg("tool_use", [call])),
            FakeStream(_msg("end_turn", [NS(type="text", text="ok")]), ["ok"]),
        ]
    )
    events = list(ask.answer("q", [], None, ask.config(), store, client=client))
    assert events[-1]["t"] == "done"
    res = client.calls[1]["messages"][-1]["content"][0]
    assert res["is_error"] is True


def test_refusal_and_empty_question(store):
    client = FakeClient([FakeStream(_msg("refusal", []))])
    events = list(ask.answer("q", [], None, ask.config(), store, client=client))
    assert events[-1]["t"] == "error"
    assert list(ask.answer("  ", [], None, ask.config(), store, client=client))[0]["t"] == "error"


def test_fallback_echo_drops_the_declined_models_calls():
    content = [
        NS(type="thinking", thinking="..."),
        NS(type="tool_use", id="a", name="calculate", input={}),
        NS(type="fallback"),
        NS(type="text", text="x"),
        NS(type="tool_use", id="b", name="calculate", input={}),
    ]
    echo, calls = ask._echo(content)
    assert [c.id for c in calls] == ["b"]
    assert [b.type for b in echo] == ["fallback", "text", "tool_use"]


def test_rate_limit():
    for _ in range(3):
        assert ask.allow("rl@test", 3)
    assert not ask.allow("rl@test", 3)


@pytest.mark.skipif(not shutil.which("node"), reason="node not installed")
def test_one_roas_the_same_in_performance_and_all_and_absent_for_awareness():
    dates = ["2026-10-01", "2026-10-02", "2026-10-03"]
    D = {
        "dates": dates, "phase": ["bau"] * 3, "reasons": [],
        "fields": ["gmv", "perf_gmv", "awareness_gmv", "perf_all_spend", "all_spend", "aw_spend"],
        "values": {"gmv": [500.0, 600.0, 700.0], "perf_gmv": [400.0, 500.0, 600.0], "awareness_gmv": [100.0] * 3,
                   "perf_all_spend": [300.0] * 3, "all_spend": [400.0] * 3, "aw_spend": [100.0] * 3},
        "na": {},
    }
    py = {m: Engine(D, m).window(dates)["roas"] for m in ("perf", "all", "aw")}
    script = (
        "const D=JSON.parse(require('fs').readFileSync(0,'utf8'));"
        f"const mk=require('{ENGINE}');"
        "process.stdout.write(JSON.stringify(['perf','all','aw'].map(m=>mk(D.page,m).windowOf(D.days).roas)));"
    )
    js = json.loads(subprocess.run(["node", "-e", script], input=json.dumps({"page": D, "days": dates}),
                                   capture_output=True, text=True, check=True).stdout)
    # whole-store GMV over performance spend; awareness spend never in it
    assert py["perf"] == py["all"] == pytest.approx(1800 / 900)
    assert py["aw"] is None and js[2] is None
    assert js[0] == pytest.approx(2.0) and js[1] == pytest.approx(2.0)
