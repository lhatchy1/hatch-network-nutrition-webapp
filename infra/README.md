# Migros CORS proxy — Cloudflare Worker setup

Migros doesn't set `Access-Control-Allow-Origin` headers, so the
`food.hatchnetwork.ch` PWA can't fetch their product API directly from
the browser. The free `corsproxy.io` service used to bridge this, but
its free tier now 403s preflighted POSTs from public origins.

The fix is a tiny Cloudflare Worker that proxies the request and adds
the CORS headers. Source lives in [`migros-cors-worker.js`](./migros-cors-worker.js).

It's free (well under Cloudflare's 100k/day free-tier limit), takes
about 3 minutes to deploy, and locks itself down to the Migros product
endpoint plus the configured origins — it's not an open relay.

## One-time deploy

1. Sign in at https://dash.cloudflare.com (create a free account if
   you don't have one).
2. Sidebar → **Workers & Pages** → **Create** → **Hello World** → give
   it a name like `migros-cors` and click **Deploy**.
3. After the "Hello World" deploy lands, click **Edit code** (or
   "Continue to project" → "Quick edit").
4. Replace the entire `worker.js` contents with the contents of
   [`migros-cors-worker.js`](./migros-cors-worker.js). Click **Save and
   deploy**.
5. Copy the worker's public URL — it looks like
   `https://migros-cors.<your-account>.workers.dev`.

## Wire it into the app

The worker URL goes into the `VITE_MIGROS_PROXY` env var. It must end
with `?url=` so the app can append the encoded target URL.

**Local dev** (`.env`, not committed):

```
VITE_MIGROS_PROXY=https://migros-cors.<your-account>.workers.dev/?url=
```

**Production** (so the GitHub Pages deploy uses it too):

- Repo Settings → Secrets and variables → Actions → **New
  repository secret**.
- Name: `VITE_MIGROS_PROXY`
- Value: `https://migros-cors.<your-account>.workers.dev/?url=`
- The deploy workflow at `.github/workflows/deploy.yml` already
  passes this variable through to the Vite build.

Push any commit (or trigger the workflow manually) to rebuild with the
new env var baked in.

## Verifying it works

Open the live site, go to **Ingredients**, paste a Migros product URL
like `https://www.migros.ch/en/product/212412400000`, and you should
see a single hit with the parsed name and macros. If the worker URL is
wrong or the env var didn't make it into the build, the app falls
back to `corsproxy.io` and the request will fail with the same CORS
error as before — that's the signal to double-check the env var.

## Updating the allowed origins

If you ever serve the app from a different domain, edit
`ALLOWED_ORIGINS` at the top of `migros-cors-worker.js` and redeploy
the worker (same Edit code → Save and deploy path as the initial
setup).
