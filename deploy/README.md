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

While you're on that page, copy your **developer token**.

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

```shell
cp deploy/config.env.example deploy/config.env
```

Open `deploy/config.env` and paste in four values: the project ID, the developer
token, and the OAuth client ID and secret. Add your manager (MCC) customer ID
only if your access to the ads account goes through a manager account.

This file is gitignored, so the secrets stay on your machine.

## Step 3 — Deploy

Install the [gcloud CLI](https://cloud.google.com/sdk/docs/install) if you don't
have it, sign in, then:

```shell
gcloud auth login
./deploy/cloudrun.sh
```

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

## Troubleshooting

| What you see | What it means |
|---|---|
| `redirect_uri_mismatch` at sign-in | Step 4 was missed, or the URI doesn't match exactly. It must end in `/auth/callback`. |
| *"developer token is only approved for use with test accounts"* | Explorer access hasn't been granted yet. Check the API Center. |
| `USER_PERMISSION_DENIED` for a customer ID | Access is via a manager account — set `GOOGLE_ADS_LOGIN_CUSTOMER_ID` in `deploy/config.env` and re-run the script. |
| Signed in fine, but every query fails | The Google account you signed in with may not have access to that Google Ads account. |
| Customer ID rejected | Use digits only: `1234567890`, not `123-456-7890`. |
