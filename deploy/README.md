# Deploying to Cloud Run — the simple path

This puts the Google Ads MCP server on Google Cloud Run so it works in Claude on
the web and on your phone, the same way the Meta Ads and Shopify connectors do.

Total hands-on time is about 30 minutes, plus waiting for Explorer access.

---

## Before you start: get Explorer access

In Google Ads: **Tools → API Center**. If it says **Test access**, click
**Apply for access** to move up to **Explorer**.

This matters more than anything else here. Test access can only read *test*
accounts full of dummy data — it will never see the real account, no matter how
perfectly everything else is configured. Approval can take a few days, so apply
first and do the rest while you wait.

When asked what you're building, the honest answer is the simple one:

> Internal reporting only. We are a D2C brand using the API to pull performance
> data for our own Google Ads account into internal dashboards and weekly
> reports. We do not build software for other advertisers and do not manage
> third-party accounts.

### Finding the developer token

The token lives in the **manager (MCC) account**, not in the client account —
API Center only appears for manager accounts. If you can see the access level
but no token, you are almost certainly looking at the client account.

1. In Google Ads, switch the account selector to the **manager account**.
2. **Admin → API Center** (older UI: the tools icon → **Setup → API Center**).
3. Scroll the whole page. The token sits in its own card labelled **Developer
   token**, separate from the access-level card — roughly 22 characters, usually
   masked with a copy button next to it.

---

## Step 1 — Create the OAuth client

It must be type **Web application**. A Desktop client will not work here — this
server signs users in through a browser redirect, which desktop clients don't
support.

1. Go to Cloud Console → **APIs & Services → Credentials**, with the right
   project selected.
2. **Create credentials → OAuth client ID → Web application**.
3. Name it `Asaya Google Ads MCP`, then **Create**.
4. Copy the **Client ID** and **Client secret**.

Leave the redirect URI empty for now — the address doesn't exist until after
the first deploy. Step 4 comes back to it.

If it makes you configure an **OAuth consent screen** first: choose **Internal**
if your account is on a Google Workspace domain, otherwise **External** and add
your own email under test users.

## Step 2 — Fill in the config

If you're using Cloud Shell, Step 3 creates this file for you — skip ahead and
fill it in there. Otherwise:

```shell
cp deploy/config.env.example deploy/config.env
```

Either way, `deploy/config.env` needs four values: the project ID, the developer
token, and the OAuth client ID and secret. Add your manager (MCC) customer ID
only if your access to the ads account goes through a manager account.

This file is gitignored and must stay that way — **this repository is public**,
so a committed developer token or client secret would be exposed to anyone.
Never use `git add -f` on it.

## Step 3 — Deploy

**Easiest route: Google Cloud Shell.** It runs in your browser, already has
`gcloud` installed and already signed in as you — nothing to install locally.

1. Open [shell.cloud.google.com](https://shell.cloud.google.com) and make sure
   the right project is selected.
2. Run:

   ```shell
   git clone https://github.com/Asaya-01/Google-Ads-MCP.git
   cd Google-Ads-MCP
   ```

3. Write the config file, then deploy — see below.

### Writing the config file

Paste this whole block **into the terminal** with your own values substituted,
then press Enter. Keep `ENDOFCONFIG` flush against the left margin with no
spaces before it, or the terminal will sit waiting at a `>` prompt.

```shell
cat > deploy/config.env <<'ENDOFCONFIG'
GOOGLE_PROJECT_ID=your-project-id
GOOGLE_ADS_DEVELOPER_TOKEN=your-developer-token
GOOGLE_ADS_MCP_OAUTH_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_ADS_MCP_OAUTH_CLIENT_SECRET=your-client-secret
GOOGLE_ADS_LOGIN_CUSTOMER_ID=your-manager-id-or-leave-blank
REGION=us-central1
SERVICE=google-ads-mcp
AR_REPO=mcp-servers
ENDOFCONFIG
```

Confirm it landed with `cat deploy/config.env` before going on.

> Prefer a text editor? `cloudshell edit deploy/config.env` opens one — but
> paste into the **editor pane**, not the terminal. Config lines pasted into a
> terminal get run as commands, which gives `command not found` errors and
> leaves the file untouched.

### Deploying

```shell
./deploy/cloudrun.sh
```

<details>
<summary>Prefer your own machine to Cloud Shell?</summary>

Install the [gcloud CLI](https://cloud.google.com/sdk/docs/install), then:

```shell
gcloud auth login
./deploy/cloudrun.sh
```

</details>

The script enables the APIs, creates the Firestore database and image
repository, builds the container, deploys it, and wires up the service's own
URL. First run takes 5–10 minutes, mostly the build. It's safe to re-run if
anything fails.

When it finishes it prints two URLs. Keep them.

## Step 4 — Add the redirect URI

Back in **APIs & Services → Credentials**, open the Web application client from
Step 1, and under **Authorised redirect URIs** add the exact callback URL the
script printed:

```
https://YOUR-SERVICE-URL.a.run.app/auth/callback
```

Save. This is the step everything else depends on — sign-in fails with a
`redirect_uri_mismatch` error if it's missing or misspelled.

## Step 5 — Connect it to Claude

In Claude: **Settings → Connectors → Add custom connector**, and paste the MCP
endpoint the script printed:

```
https://YOUR-SERVICE-URL.a.run.app/mcp
```

Sign in with the Google account that has access to the Google Ads account. Then
ask Claude:

```
what customers do I have access to?
```

If you get back a list of customer IDs, it works.

---

## Cost

At reporting volumes this is effectively free. Cloud Run scales to zero when
idle and the free tier covers well beyond occasional report pulls; Firestore
stores only sign-in tokens. The build step uses a few minutes of Cloud Build
each time you deploy.

## Notes on how this is set up

- **Firestore** holds the OAuth tokens so your sign-in survives cold starts and
  redeploys. Without it you'd re-authenticate constantly, since Cloud Run shuts
  instances down when idle. The `Dockerfile` installs the `[firestore]` extra
  for this.
- **`--allow-unauthenticated`** on the Cloud Run service is required and is not
  the same as "open to everyone". It lets Claude's servers reach the endpoint;
  who can actually read data is then decided by the Google sign-in inside the
  app, which only admits accounts that already have Google Ads access.
- **The JWT signing key** is generated once on the first deploy and written back
  into `deploy/config.env`. Keep it stable — changing it signs everyone out.
- Firestore entries are not expired automatically by this storage backend. It's
  a small amount of data, but worth a periodic cleanup if this runs for years.

## What this changes in your Google Cloud project

Useful when asking an administrator for access. Everything the deploy does is
**additive** — it creates new resources and never edits or deletes anything
that already exists in the project.

**Created:**

| Resource | Detail |
|---|---|
| 5 APIs enabled | Google Ads, Cloud Run, Cloud Build, Artifact Registry, Firestore |
| Firestore `(default)` database | Only if one does not already exist. Stores sign-in tokens, nothing else |
| Artifact Registry repo `mcp-servers` | Holds the built container image |
| Cloud Run service `google-ads-mcp` | The server itself |
| One IAM binding | Grants `roles/datastore.user` to the project's default compute service account |

**Not touched:** existing data, BigQuery datasets, other services, other IAM
bindings, and the Google Ads account itself.

Two things worth knowing before you run it:

- **The Firestore database location is permanent.** A project has exactly one
  `(default)` Firestore database and its location can never be changed. If the
  project might need Firestore elsewhere later, pick the location deliberately
  via `FIRESTORE_LOCATION`. Existing databases are left alone.
- **The IAM binding widens the default compute service account.** Other
  workloads in the project run as that same account, so they gain Firestore
  read/write too. To avoid that, create a dedicated service account, set
  `RUNTIME_SA` to it, and deploy with `--service-account`.

Also note the developer token and OAuth client secret are stored as plain
environment variables on the Cloud Run service, so anyone who can view that
service in the Cloud Console can read them. Move them to Secret Manager if that
matters for your organisation.

### The Google Ads side is read-only

The server exposes three tools — `search`, `get_resource_metadata` and
`list_accessible_customers` — and there are no mutate calls anywhere in its
source. It cannot create, pause, or edit campaigns, budgets, or any other
Google Ads entity. Connecting it cannot change your advertising.

## Permissions

Deploying needs more than read access to the Google Cloud project. The simplest
ask is the **Owner** role (`roles/owner`) on the project. Where that is too
broad, these are the individual roles required:

| Role | Why |
|---|---|
| `roles/serviceusage.serviceUsageAdmin` | Enable the APIs |
| `roles/run.admin` | Create the Cloud Run service |
| `roles/cloudbuild.builds.editor` | Build the container image |
| `roles/artifactregistry.admin` | Store the built image |
| `roles/datastore.owner` | Create the Firestore database |
| `roles/iam.serviceAccountUser` | Run the service as its service account |
| `roles/resourcemanager.projectIamAdmin` | Grant the runtime account Firestore access |
| `roles/storage.admin` | Possibly needed — see below |

`gcloud builds submit` uploads the source to a Cloud Storage staging bucket
(`gs://<project>_cloudbuild`), which `roles/cloudbuild.builds.editor` does not
grant access to. If the build step fails with *"forbidden from accessing the
bucket"*, you do **not** have to ask for another role — the script falls back
automatically to building the image locally and pushing it straight to Artifact
Registry, which `roles/artifactregistry.admin` already allows.

Force either method with `BUILD_METHOD`:

```shell
BUILD_METHOD=docker ./deploy/cloudrun.sh      # always build locally
BUILD_METHOD=cloudbuild ./deploy/cloudrun.sh  # never fall back
```

The local build needs a working Docker, which Cloud Shell has. `roles/storage.admin`
remains the alternative if you would rather use Cloud Build.

If getting these on an existing shared project is slow, creating a **new**
Google Cloud project is often faster — you are automatically its Owner. You
then need to create a new OAuth client inside that project and point
`GOOGLE_PROJECT_ID` at it. The Google Ads developer token is issued by Google
Ads, not by the Cloud project, so it carries over unchanged.

The project also needs **billing enabled**; Cloud Build and Cloud Run both
require it.

## Troubleshooting

| What you see | What it means |
|---|---|
| `AUTH_PERMISSION_DENIED` / *does not have permission to access projects instance* | Your Google account lacks the access needed to deploy into that project. The script stops and lists the exact roles to request — see [Permissions](#permissions) above. |
| `redirect_uri_mismatch` at sign-in | Step 4 was missed, or the URI doesn't match exactly. It must end in `/auth/callback`. |
| *"developer token is only approved for use with test accounts"* | Explorer access hasn't been granted yet. Check the API Center. |
| `USER_PERMISSION_DENIED` for a customer ID | Access is via a manager account — set `GOOGLE_ADS_LOGIN_CUSTOMER_ID` in `deploy/config.env` and re-run the script. |
| Signed in fine, but every query fails | The Google account you signed in with may not have access to that Google Ads account. |
| Customer ID rejected | Use digits only: `1234567890`, not `123-456-7890`. |
