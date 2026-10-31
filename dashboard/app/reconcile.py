"""Completeness cross-checks: our copy of D-1 against the source system's own
total. A difference beyond the tolerance means a partial sync, so the day is
not marked complete (when the rule says so) and the Data health tab shows it."""

from __future__ import annotations

from . import rules


def compare(key: str, label: str, unit: str, ours, theirs, rule: dict) -> dict:
    row = {
        "key": key,
        "label": label,
        "unit": unit,
        "ours": ours,
        "theirs": theirs,
        "block": bool(rule.get("block")),
        "ok": None,
        "diff": None,
        "diff_pct": None,
        "note": None,
    }
    if ours is None or theirs is None:
        row["note"] = "Not checked: the figure was not available"
        return row
    diff = ours - theirs
    allowed = max(rule["min_abs"], rule["pct"] * abs(theirs))
    row.update(
        diff=diff,
        diff_pct=rules.ratio(diff, theirs),
        ok=abs(diff) <= allowed,
    )
    if not row["ok"]:
        shown = (
            (lambda v: f"Rs {v:,.0f}")
            if unit == "inr"
            else (lambda v: f"{v:,.0f}")
        )
        row["note"] = (
            f"{label}: we have {shown(ours)}, the source reports "
            f"{shown(theirs)} ({diff / theirs:+.1%})"
            if theirs
            else f"{label}: we have {shown(ours)}, the source reports 0"
        )
    return row


def failed(checks: list[dict]) -> dict[str, str]:
    """{check key: message} for the failed checks that block completion."""
    return {
        f"reconcile_{c['key']}": c["note"]
        for c in checks
        if c["ok"] is False and c["block"]
    }
