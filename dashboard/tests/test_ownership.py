"""One tab, one job: every breakdown (table, chart, panel) is rendered on one
tab only, and Overview shows six headline numbers and no table.

Builds the pages from the synthetic dataset, serves them with the app, opens
each tab in a headless browser and reads the data-component names it drew.
Skipped where Node or Playwright are not installed."""

import json
import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.request

import pytest

from app import settings
from app.pages import build_all

from google_fixture import add_google
from test_pages import CFG, D1, START, _dataset

TABS = ["overview", "funnel", "marketing", "marketing?sub=meta", "marketing?sub=google", "products", "region", "d1"]
# The D-1 Report is a fixed management summary: its own compact versions
# (d1-*) are allowed; it never re-renders another tab's component.
SCRIPT = r"""
const { chromium } = require("playwright");
(async () => {
  const [url, tabs] = [process.argv[2], process.argv[3].split(",")];
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  await p.route(/cdnjs|accounts\.google/, (r) => r.abort());
  const out = {};
  for (const t of tabs) {
    await p.goto(url + "/#" + t);
    await p.waitForSelector("#main [data-component], #main .na", { timeout: 15000 }).catch(() => {});
    await p.waitForTimeout(800);
    out[t] = await p.evaluate(() => ({
      components: [...document.querySelectorAll("#main [data-component]")].map((e) => e.dataset.component),
      kpis: document.querySelectorAll("#main .kpi").length,
      tables: document.querySelectorAll("#main table").length,
      text: document.getElementById("main").innerText.slice(0, 300),
      mvKpiSpend: (document.querySelector('#mv-kpis [data-metric="m_spend"] .kpi-v') || {}).textContent || null,
      mvTotalSpend: (document.querySelector("#mv-x tr.mv-total td:nth-child(2) .mv-v") || {}).textContent || null,
      gvKpiCost: (document.querySelector('#gv-kpis [data-metric="g_cost"] .kpi-v') || {}).textContent || null,
      gvTotalCost: (document.querySelector("#gv-x tr.mv-total td:nth-child(2) .mv-v") || {}).textContent || null,
    }));
  }
  out._errors = errors;
  console.log(JSON.stringify(out));
  await b.close();
})();
"""


def _have_playwright() -> bool:
    if not shutil.which("node"):
        return False
    done = subprocess.run(["node", "-e", "require('playwright')"], capture_output=True)
    return done.returncode == 0


def _free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


@pytest.fixture(scope="module")
def rendered(tmp_path_factory):
    if not _have_playwright():
        pytest.skip("node and playwright are needed to render the tabs")
    root = tmp_path_factory.mktemp("store")
    data = add_google(_dataset(with_meta=True), D1, START)
    d = data["d1"]
    data["region"] = {
        "from": d, "to": d,
        "city": {d: [["Karnataka", "BANGALORE", 10, 8000.0, 30], ["Goa", "PANAJI", 3, 2400.0, 4]]},
        "sku": {d: [["Karnataka", "BANGALORE", "Roll-On", "Serum", 8, 6000.0, 9]]},
    }
    pages, _ = build_all(data, CFG, [t["id"] for t in settings.enabled_tabs()])
    for name, payload in pages.items():
        f = root / "pages" / f"{name}.json"
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(json.dumps(payload, default=str))
    (root / "status").mkdir()
    (root / "status" / "latest.json").write_text(json.dumps({"complete": True, "checks": [], "missing": {}, "unavailable": {}}))
    port = _free_port()
    env = {**os.environ, "STORE_DIR": str(root), "DEV_USER_EMAIL": "dev@local"}
    srv = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "app.main:app", "--port", str(port), "--log-level", "warning"],
        cwd=settings.STATIC_DIR.parent, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    try:
        for _ in range(60):
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{port}/api/config", timeout=1)
                break
            except Exception:
                time.sleep(0.25)
        script = root / "probe.js"
        script.write_text(SCRIPT)
        done = subprocess.run(
            ["node", str(script), f"http://127.0.0.1:{port}", ",".join(TABS)],
            capture_output=True, text=True, timeout=180,
            env={**os.environ, "NODE_PATH": os.environ.get("NODE_PATH", "")},
        )
        assert done.returncode == 0, done.stderr
        return json.loads(done.stdout.strip().splitlines()[-1])
    finally:
        srv.terminate()
        srv.wait(timeout=10)


def test_the_tabs_render_without_script_errors(rendered):
    assert rendered["_errors"] == []
    for t in TABS:
        assert rendered[t]["components"], f"{t} drew nothing: {rendered[t]['text']}"


def test_no_breakdown_is_rendered_on_two_tabs(rendered):
    seen = {}
    for t in TABS:
        for c in set(rendered[t]["components"]):
            assert c not in seen, f"{c} is on both {seen[c]} and {t}"
            seen[c] = t


def test_overview_is_seven_headline_numbers_and_no_table(rendered):
    ov = rendered["overview"]
    assert ov["kpis"] == 7  # six headline numbers + Perf CVR next to CVR
    assert ov["tables"] == 0


def test_meta_explorer_totals_equal_the_kpi_strip(rendered):
    m = rendered["marketing?sub=meta"]
    assert "meta-explorer" in m["components"] and "meta-matrix" in m["components"]
    assert m["mvKpiSpend"] and m["mvKpiSpend"] == m["mvTotalSpend"]


def test_google_explorer_totals_equal_the_kpi_strip(rendered):
    g = rendered["marketing?sub=google"]
    for c in ("google-kpis", "google-split", "google-working", "google-watchlist", "google-matrix", "google-explorer"):
        assert c in g["components"]
    assert g["gvKpiCost"] and g["gvKpiCost"] == g["gvTotalCost"]
