"""Moves the GeoLift job's files to and from the dashboard's bucket
(SNAPSHOT_BUCKET), and appends the run to cache/awareness/run_log.json."""
import datetime as dt
import json
import os
import pathlib
import sys

from google.cloud import storage

WORK = pathlib.Path(os.environ.get("WORK", "/work"))
bucket = storage.Client().bucket(os.environ["SNAPSHOT_BUCKET"])
IN = {"cache/awareness/panel_state.csv": "panel_state.csv", "cache/awareness/panel_city.csv": "panel_city.csv",
      "cache/awareness/r_input.json": "r_input.json", "cache/awareness/geolift/tests.json": "prev_tests.json"}
OUT = ["tests.json", "testability.json", "power_curves.json"]


def download():
    for src, dst in IN.items():
        b = bucket.blob(src)
        if b.exists():
            b.download_to_filename(str(WORK / dst))
        elif not dst.startswith("prev_"):
            sys.exit(f"missing {src}: run the Awareness job first")


def upload(mode, status, seconds, error):
    out = WORK / "out"
    rows = 0
    for name in OUT:
        p = out / name
        if p.exists():
            bucket.blob(f"cache/awareness/geolift/{name}").upload_from_filename(str(p), content_type="application/json")
            rows += 1
    for p in (out / "plots").glob("*.png"):
        bucket.blob(f"cache/awareness/geolift/plots/{p.name}").upload_from_filename(str(p), content_type="image/png")
    log_blob = bucket.blob("cache/awareness/run_log.json")
    log = json.loads(log_blob.download_as_text()) if log_blob.exists() else {"runs": []}
    log["runs"] = [{"job": f"geolift-{mode}", "run_time": dt.datetime.now(dt.timezone.utc).isoformat(), "status": status,
                    "rows": rows, "duration_s": int(seconds), "error": error or None}] + log.get("runs", [])[:199]
    log_blob.upload_from_string(json.dumps(log), content_type="application/json")


if __name__ == "__main__":
    download() if sys.argv[1] == "download" else upload(*sys.argv[2:6])
