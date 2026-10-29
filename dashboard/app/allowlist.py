"""Manage who can sign in to the dashboard (Firestore collection
`dashboard_allowlist`, one document per lower-case email).

  python -m app.allowlist add name@company.com
  python -m app.allowlist remove someone@example.com
  python -m app.allowlist list
"""

from __future__ import annotations

import argparse
import datetime as dt

from . import settings
from .main import ALLOWLIST_COLLECTION


def _collection():
    from google.cloud import firestore

    return firestore.Client(
        project=settings.config()["gcp"]["project"]
    ).collection(ALLOWLIST_COLLECTION)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("action", choices=["add", "remove", "list"])
    parser.add_argument("email", nargs="?")
    args = parser.parse_args(argv)
    col = _collection()
    if args.action == "list":
        for doc in col.stream():
            print(
                doc.id,
                (
                    "active"
                    if (doc.to_dict() or {}).get("active", True)
                    else "inactive"
                ),
            )
        return 0
    if not args.email:
        parser.error("an email is required")
    email = args.email.strip().lower()
    if args.action == "add":
        col.document(email).set(
            {"active": True, "added_at": dt.datetime.now(dt.timezone.utc)}
        )
        print(f"Added {email}")
    else:
        col.document(email).delete()
        print(f"Removed {email} (takes effect within 5 minutes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
