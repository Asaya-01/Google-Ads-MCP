"""Secret Manager access. Secrets never live in code, config or logs.

For local development a secret can be supplied as an environment variable:
secret "shopify-client-id" reads SECRET_SHOPIFY_CLIENT_ID.
"""

from __future__ import annotations

import os
from functools import lru_cache

from . import settings


@lru_cache(maxsize=32)
def get_secret(name: str) -> str | None:
    """The latest version of a secret, or None when it does not exist yet."""
    local = os.environ.get("SECRET_" + name.upper().replace("-", "_"))
    if local:
        return local
    from google.api_core import exceptions
    from google.cloud import secretmanager

    client = secretmanager.SecretManagerServiceClient()
    path = f"projects/{settings.config()['gcp']['project']}/secrets/{name}/versions/latest"
    try:
        return (
            client.access_secret_version(name=path)
            .payload.data.decode("utf-8")
            .strip()
        )
    except (exceptions.NotFound, exceptions.FailedPrecondition):
        return None
