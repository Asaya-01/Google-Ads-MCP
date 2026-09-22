# Setup — Google Ads MCP for Asaya

Step-by-step install for connecting the Google Ads MCP server to an MCP client
(Claude Code, Claude Desktop, Cursor, VS Code). The upstream
[README](README.md) is the full reference; this file is the short path that
matches how we run it.

> **Deploying to Cloud Run instead?** That's the setup that makes the tools
> available in Claude on the web and on mobile. Follow
> [`deploy/README.md`](deploy/README.md) — it replaces steps 1 and 2 below and
> needs a **Web application** OAuth client rather than a Desktop one.

Everything below is read-only against Google Ads — the server exposes `search`,
`get_resource_metadata` and `list_accessible_customers`, and no write tools.

---

## What you need before starting

| Thing | Where it comes from |
|---|---|
| A Google Cloud project | https://console.cloud.google.com — note the **project ID** |
| Google Ads API enabled in that project | https://console.cloud.google.com/apis/library/googleads.googleapis.com |
| A Google Ads **developer token** | Google Ads UI → Tools → API Center. Needs at least *Explorer* access to query production accounts |
| Your Google Ads **customer ID** | Top-right of the Google Ads UI, formatted `123-456-7890`. Strip the hyphens when using it: `1234567890` |
| Manager (MCC) **customer ID**, if applicable | Only needed if your access to the ads account is through a manager account |
| Python 3.10+ and `pipx` | https://pipx.pypa.io/stable/#install-pipx |

> The developer token and credentials are secrets. Keep them out of this
> repository — `.gitignore` already excludes `.env`, `.mcp.json` and
> `google-ads.yaml`.

---

## 1. Authenticate (Application Default Credentials)

This is the simplest option for running the server locally. Install the
[gcloud CLI](https://cloud.google.com/sdk/docs/install), then create an OAuth
desktop client in your Cloud project, download its JSON, and run:

```shell
gcloud auth application-default login \
  --scopes https://www.googleapis.com/auth/adwords,https://www.googleapis.com/auth/cloud-platform \
  --client-id-file=/path/to/your-oauth-client.json
```

Sign in as a Google account that **already has access to the Google Ads
account**. When it finishes, gcloud prints:

```
Credentials saved to file: [PATH_TO_CREDENTIALS_JSON]
```

Copy that path — it becomes `GOOGLE_APPLICATION_CREDENTIALS` in the next step.

The `https://www.googleapis.com/auth/adwords` scope is required; without it
every call fails with a permissions error.

---

## 2. Point your MCP client at the server

Copy [`.mcp.json.example`](.mcp.json.example) to `.mcp.json` and fill in the
placeholders:

```shell
cp .mcp.json.example .mcp.json
```

```json
{
  "mcpServers": {
    "google-ads": {
      "command": "pipx",
      "args": ["run", "--spec", "google-ads-mcp==0.0.3", "google-ads-mcp"],
      "env": {
        "GOOGLE_APPLICATION_CREDENTIALS": "PATH_TO_CREDENTIALS_JSON",
        "GOOGLE_PROJECT_ID": "YOUR_PROJECT_ID",
        "GOOGLE_ADS_DEVELOPER_TOKEN": "YOUR_DEVELOPER_TOKEN",
        "GOOGLE_ADS_LOGIN_CUSTOMER_ID": "YOUR_MANAGER_CUSTOMER_ID"
      }
    }
  }
}
```

Notes:

- **`GOOGLE_ADS_LOGIN_CUSTOMER_ID`** is only needed when you reach the ads
  account through a manager (MCC) account. Set it to the *manager's* ID, digits
  only. Drop the line entirely if you log in directly to the ads account.
- Pinning `google-ads-mcp==0.0.3` gives you a reproducible version. To run this
  repository's exact checked-in state instead, see
  [Running from this checkout](#running-from-this-checkout).
- Client config locations: `.mcp.json` in the project root for Claude Code,
  `.cursor/mcp.json` for Cursor, `.vscode/mcp.json` for VS Code + Copilot. The
  `mcpServers` block itself is identical across all of them.

Restart your MCP client, and `google-ads` should appear in its server list.

---

## 3. Check it works

Ask your client:

```
what customers do I have access to?
```

which should call `list_accessible_customers` and return customer IDs. Then
something real:

```
For customer id 1234567890, show me campaign name, cost, conversions and
conversion value for the last 7 days, by campaign.
```

If you work across several accounts, put the customer ID directly in the prompt
— it saves a round trip every time.

---

## Running from this checkout

To run the vendored source in this repository rather than the published package:

```shell
uv venv .venv
uv pip install --python .venv/bin/python .
```

Then point the client at the local entry point:

```json
{
  "mcpServers": {
    "google-ads": {
      "command": "/absolute/path/to/Google-Ads-MCP/.venv/bin/google-ads-mcp",
      "env": {
        "GOOGLE_APPLICATION_CREDENTIALS": "PATH_TO_CREDENTIALS_JSON",
        "GOOGLE_PROJECT_ID": "YOUR_PROJECT_ID",
        "GOOGLE_ADS_DEVELOPER_TOKEN": "YOUR_DEVELOPER_TOKEN"
      }
    }
  }
}
```

Run the tests with:

```shell
uv pip install --python .venv/bin/python pytest pytest-asyncio
.venv/bin/python -m pytest tests -q --ignore=tests/smoke
```

One smoke test fails against FastMCP 4.0.3 for a reason that predates this
install — see [UPSTREAM.md](UPSTREAM.md#known-upstream-issue).

---

## Limiting which tools are exposed

`ads_mcp/tools_config.yaml` controls which tool namespaces are enabled and how
they are prefixed. The bundled default enables everything. To customise, drop a
`tools_config.yaml` in the working directory or set
`GOOGLE_ADS_MCP_TOOLS_CONFIG` to an explicit path — an invalid or missing
explicit file stops the server from starting. See the
[README](README.md#configuring-and-namespacing-tools) for the schema.

---

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| *"The developer token is only approved for use with test accounts"* | The token lacks production access. Request at least Explorer access in the API Center — see [access levels](https://developers.google.com/google-ads/api/docs/access-levels). |
| Permission / scope errors on every call | ADC was created without the `adwords` scope, or the signed-in Google account has no access to the Ads account. Re-run the `gcloud auth application-default login` command in step 1. |
| `USER_PERMISSION_DENIED` on a specific customer ID | Access is via a manager account — set `GOOGLE_ADS_LOGIN_CUSTOMER_ID` to the manager's ID. |
| Server missing from the client's list | The client didn't reload the config. Restart it, and check the JSON parses. |
| Customer ID rejected | Pass digits only: `1234567890`, not `123-456-7890`. |

For anything else, upstream's issue tracker is
https://github.com/googleads/google-ads-mcp/issues.

---

## A note on data

The server hands Google Ads account data to whatever LLM or agent you connect it
to. It also adds a header to API calls so Google can collect usage data. Worth
knowing before pointing it at live account data.
