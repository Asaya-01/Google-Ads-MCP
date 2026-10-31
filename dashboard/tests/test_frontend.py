import re
import shutil
import subprocess

import pytest

from app import settings


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
