import json
import re
import shutil
import subprocess

import pytest

from app import settings


def test_the_range_picker_files_are_inlined_without_leftover_markers():
    html = settings.app_fragment()
    assert "__RANGE_" not in html
    assert "createRangeEngine" in html and "R.overview = (p)" in html
    assert ".rg-pop" in html
    assert "R.marketing = (p)" in html and "R.products = (p)" in html
    assert "R.d1 = (p)" in html
    for name in (
        "range_engine.js",
        "range_ui.js",
        "range_tabs.js",
        "range_tree.js",
        "range_basket.js",
        "range_d1.js",
        "ask.js",
    ):
        assert "</script" not in (settings.STATIC_DIR / name).read_text(
            encoding="utf-8"
        )


def test_ask_claude_is_inlined_and_mounted():
    html = settings.app_fragment()
    assert "__ASK" not in html
    assert "function askMount()" in html and ".ask-fab" in html
    assert "askMount();" in html and "/api/ask" in html


def test_the_retention_files_are_inlined_without_leftover_markers():
    html = settings.app_fragment()
    assert "__RETENTION_" not in html
    assert "createRetentionEngine" in html and "R.retention" in html
    assert ".ret-controls" in html
    # an inlined script must never contain its own closing tag
    for name in ("retention_engine.js", "retention_ui.js"):
        assert "</script" not in (settings.STATIC_DIR / name).read_text(
            encoding="utf-8"
        )


@pytest.mark.skipif(not shutil.which("node"), reason="node is not installed")
def test_every_inline_script_of_the_assembled_page_parses(tmp_path):
    html = settings.app_fragment()
    scripts = re.findall(r"<script(?![^>]*src)[^>]*>(.*?)</script>", html, re.S)
    assert len(scripts) >= 2
    for i, code in enumerate(scripts):
        f = tmp_path / f"s{i}.js"
        f.write_text(code, encoding="utf-8")
        done = subprocess.run(
            ["node", "--check", str(f)], capture_output=True, text=True
        )
        assert done.returncode == 0, done.stderr


@pytest.mark.skipif(not shutil.which("node"), reason="node is not installed")
def test_the_metric_registry_drives_names_formats_and_colours():
    """One registry: every metric has a name, definition, format, direction
    and home tab; one formatter; deltas coloured by direction, grey when
    barely moved, n/m on a tiny base, never Infinity or NaN."""
    reg = settings.STATIC_DIR / "metrics.js"
    script = f"""
const M = require({str(reg)!r});
const homes = new Set(["overview", "funnel", "marketing", "products", "retention", "region"]);
const bad = Object.entries(M.METRICS).filter(([k, m]) => !m.label || !m.def || !m.format || !["higher", "lower", "neutral"].includes(m.dir) || !homes.has(m.home)).map(([k]) => k);
console.log(JSON.stringify({{
  bad,
  inr: [M.mFormat("currency", 1234567, true), M.mFormat("currency", 456700, true), M.mFormat("currency", 61200, true), M.mFormat("currency", 1234567)],
  x: M.mFormat("ratio", 1.2), pct: M.mFormat("percent", 0.083), small: M.mFormat("percent", 0.0046),
  inf: M.mFormat("percent", Infinity), nan: M.mDeltaHtml("orders", NaN),
  up: M.mDeltaHtml("orders", 0.12), costUp: M.mDeltaHtml("cps", 0.227), flat: M.mDeltaHtml("orders", 0.01),
  neutral: M.mDeltaHtml("perf_spend", -0.3), nm: M.mDeltaHtml("orders", 4.68, {{ small: true }}),
  smallBase: M.mSmall("orders", {{ orders: 3 }}),
}}));
"""
    out = json.loads(subprocess.run(["node", "-e", script], capture_output=True, text=True, check=True).stdout)
    assert out["bad"] == []
    assert out["inr"] == ["₹12.3L", "₹4.57L", "₹61.2K", "₹12,34,567"]
    assert (out["x"], out["pct"], out["small"]) == ("1.20x", "8.3%", "0.46%")
    assert out["inf"] is None and "–" in out["nan"]
    assert 'class="up"' in out["up"] and 'class="down"' in out["costUp"]
    assert 'class="flat"' in out["flat"] and 'class="flat"' in out["neutral"]
    assert "n/m" in out["nm"] and "468" not in out["nm"] and out["smallBase"] is True
