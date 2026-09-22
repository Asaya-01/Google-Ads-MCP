# Upstream provenance

This repository is a vendored copy of Google's official Google Ads MCP server.

| | |
|---|---|
| Upstream | https://github.com/googleads/google-ads-mcp |
| Vendored commit | `7a40eae9655194a84d5291c63af817bb20d02ea8` |
| Upstream date | 2026-09-10 |
| Package version | `google-ads-mcp` 0.0.3 |
| License | Apache-2.0 (see [LICENSE](LICENSE)) |

## Local changes on top of upstream

Kept deliberately minimal so future syncs stay easy:

1. Removed `CODEOWNERS` — it referenced the `@googleads/google-ads-python-codereview`
   team, which does not exist in this organisation, so GitHub would flag the file
   as invalid on every pull request.
2. Extended `.gitignore` with `.venv/`, `.env`, `.mcp.json` and `google-ads.yaml`
   so local credentials and client config never get committed.
3. Added `UPSTREAM.md` (this file), [`SETUP.md`](SETUP.md) and
   [`.mcp.json.example`](.mcp.json.example).
4. Added a three-line banner at the top of `README.md` pointing at those two
   documents. The rest of the README is untouched.
5. `Dockerfile`: install `.[firestore]` instead of `.` so the Cloud Run
   deployment can persist OAuth tokens across cold starts. Upstream's README
   tells you to make this exact edit for a Firestore-backed deployment.
6. Added `deploy/` — `cloudrun.sh` (idempotent Cloud Run deploy),
   `config.env.example`, and a walkthrough in `deploy/README.md`.

No file under `ads_mcp/` or `tests/` has been modified.

## Syncing with upstream

```shell
git remote add upstream https://github.com/googleads/google-ads-mcp.git
git fetch upstream main
# Review what changed since the vendored commit:
git diff 7a40eae9655194a84d5291c63af817bb20d02ea8..upstream/main -- ads_mcp tests pyproject.toml
```

Apply the upstream diff, re-run the tests (see [SETUP.md](SETUP.md)), and update the
vendored-commit row in the table above.

## Known upstream issue

`tests/smoke/smoke_test.py::SmokeTest::test_tools_list_matches_golden` fails against
`fastmcp` 4.0.3. The golden file `tests/smoke/golden_tools_list.json` was generated
with an older FastMCP that parsed the `Args:` section of the `search` tool's
docstring into per-parameter JSON-schema descriptions; FastMCP 4.x leaves the full
docstring in the tool description instead. Upstream's `pyproject.toml` declares
`fastmcp>=4.0.3` with no upper bound, so the golden file is simply stale.

This is cosmetic — the tool itself is registered correctly and the server runs. It
is present in pristine upstream at the vendored commit and was not introduced here.
Regenerate the goldens with `nox -s smoke_tests` helpers
(`tests/smoke/generate_golden.py`) if you want the smoke test green locally.
