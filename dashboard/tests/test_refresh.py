from app import refresh


def _row(day):
    return {"date": day, "spend": 1.0}


def test_meta_is_asked_again_when_yesterday_comes_back_empty(monkeypatch):
    calls = []

    def fake_fetch_all(token, cfg, since, until, level="ad"):
        calls.append(1)
        return [_row("2026-10-29")] + (
            [_row("2026-10-30")] if len(calls) == 3 else []
        )

    slept = []
    monkeypatch.setattr(refresh.meta, "fetch_all", fake_fetch_all)
    monkeypatch.setattr(refresh.time, "sleep", slept.append)
    rows = refresh._fetch_meta("t", {}, "2026-10-24", "2026-10-30")
    assert len(calls) == 3 and slept == [30, 60]
    assert any(r["date"] == "2026-10-30" for r in rows)


def test_meta_gives_up_after_the_retries_and_reports_what_it_has(monkeypatch):
    monkeypatch.setattr(
        refresh.meta, "fetch_all", lambda *a, **k: [_row("2026-10-29")]
    )
    monkeypatch.setattr(refresh.time, "sleep", lambda s: None)
    rows = refresh._fetch_meta("t", {}, "2026-10-24", "2026-10-30")
    assert [r["date"] for r in rows] == ["2026-10-29"]
