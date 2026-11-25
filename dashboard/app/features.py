"""Feature flags and the admin role.

Flags start from config.json `features` (all off by default) and can be
overridden at run time by `config/flags.json` in the dashboard's bucket, so a
feature is switched off in seconds without a deploy:

  echo '{"today_fixes_v2": false}' | gsutil cp - gs://<bucket>/config/flags.json

A flag that is off leaves the page and the jobs exactly as they were.

Admin is a field on the person's access-list document in Firestore
(`dashboard_allowlist/<email>`: `role: "admin"`); no email is ever kept in the
repository. Today only one action needs it: uploading the GoKwik checkout CSV.

  python -m app.features admin name@company.com      # grant
  python -m app.features admin name@company.com --off
"""

from __future__ import annotations

import argparse
import time

from . import settings

FLAGS_PATH = "config/flags.json"
TTL = 60
_cache: dict = {"at": 0.0, "flags": None}
_admin_cache: dict[str, tuple[bool, float]] = {}


def defaults() -> dict[str, bool]:
    f = settings.config().get("features") or {}
    return {k: bool(v) for k, v in f.items() if not k.startswith("_")}


def flags(store=None, fresh: bool = False) -> dict[str, bool]:
    """The flags in force: config.json's, with the bucket's override on top.
    A missing or unreadable override means the config's values."""
    if not fresh and _cache["flags"] is not None and time.time() - _cache["at"] < TTL:
        return dict(_cache["flags"])
    out = defaults()
    try:
        if store is None:
            from .store import default_store

            store = default_store()
        over = store.get_json(FLAGS_PATH) or {}
        out.update({k: bool(v) for k, v in over.items() if k in out})
    except Exception:  # never fail a page or a job over the override file
        pass
    _cache.update(at=time.time(), flags=out)
    return dict(out)


def on(name: str, store=None) -> bool:
    return bool(flags(store).get(name))


def is_admin(email: str) -> bool:
    email = (email or "").lower()
    dev = settings.env("DEV_ADMIN_EMAIL")
    if dev and settings.env("STORE_DIR"):
        return email == dev.lower()
    hit = _admin_cache.get(email)
    if hit and time.time() - hit[1] < TTL:
        return hit[0]
    try:
        from google.cloud import firestore

        from .main import ALLOWLIST_COLLECTION

        doc = (
            firestore.Client(project=settings.config()["gcp"]["project"])
            .collection(ALLOWLIST_COLLECTION)
            .document(email)
            .get()
        )
        ok = bool(doc.exists and (doc.to_dict() or {}).get("role") == "admin")
    except Exception:
        ok = False
    _admin_cache[email] = (ok, time.time())
    return ok


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("action", choices=["admin"])
    p.add_argument("email")
    p.add_argument("--off", action="store_true")
    a = p.parse_args(argv)
    from google.cloud import firestore

    from .main import ALLOWLIST_COLLECTION

    ref = firestore.Client(project=settings.config()["gcp"]["project"]).collection(ALLOWLIST_COLLECTION).document(a.email.strip().lower())
    if not ref.get().exists:
        print(f"{a.email} is not on the access list: add them first (python -m app.allowlist add …)")
        return 1
    ref.set({"role": None if a.off else "admin"}, merge=True)
    print(f"{a.email}: {'not admin' if a.off else 'admin'} (takes effect within a minute)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
