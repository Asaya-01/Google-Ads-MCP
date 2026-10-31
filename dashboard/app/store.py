"""JSON storage for page snapshots, caches and refresh status.

Production uses a Cloud Storage bucket (SNAPSHOT_BUCKET). Setting STORE_DIR
instead uses a local directory, for development and the offline preview.
Nothing is written to BigQuery.
"""

from __future__ import annotations

import json
import pathlib

from . import settings


class LocalStore:
    def __init__(self, root: str):
        self.root = pathlib.Path(root)

    def get_json(self, path: str):
        p = self.root / path
        return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None

    def get_text(self, path: str):
        p = self.root / path
        return p.read_text(encoding="utf-8") if p.exists() else None

    def put_json(self, path: str, obj) -> None:
        p = self.root / path
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(
            json.dumps(obj, separators=(",", ":"), default=str),
            encoding="utf-8",
        )

    def list(self, prefix: str) -> list[str]:
        base = self.root / prefix
        if not base.exists():
            return []
        return sorted(
            str(p.relative_to(self.root)) for p in base.rglob("*.json")
        )


class GCSStore:
    def __init__(self, bucket: str):
        from google.cloud import storage

        self.bucket = storage.Client().bucket(bucket)

    def get_json(self, path: str):
        blob = self.bucket.blob(path)
        if not blob.exists():
            return None
        return json.loads(blob.download_as_text())

    def get_text(self, path: str):
        blob = self.bucket.blob(path)
        return blob.download_as_text() if blob.exists() else None

    def put_json(self, path: str, obj) -> None:
        blob = self.bucket.blob(path)
        blob.cache_control = "no-store"
        blob.upload_from_string(
            json.dumps(obj, separators=(",", ":"), default=str),
            content_type="application/json",
        )

    def list(self, prefix: str) -> list[str]:
        return sorted(b.name for b in self.bucket.list_blobs(prefix=prefix))


def default_store():
    local = settings.env("STORE_DIR")
    if local:
        return LocalStore(local)
    bucket = settings.env("SNAPSHOT_BUCKET")
    if not bucket:
        raise RuntimeError(
            "Set SNAPSHOT_BUCKET (Cloud Storage) or STORE_DIR (local)."
        )
    return GCSStore(bucket)
