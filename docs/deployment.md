# Deployment and Environments

The admin app runs on Google Cloud Run (project `discount-494316`, region
`europe-west3`). Shopify sessions live in Neon Postgres (`eu-central-1`, next
to the Cloud Run region). Campaign data lives in Shopify metafields, so there
is nothing else to host.

## Environments

| Area | Development | Production |
| --- | --- | --- |
| Shopify app config | `shopify.app.development.toml` | `shopify.app.toml` |
| Billing | Test charges | Real charges (test charges on dev stores) |
| Session storage | Local JSON file | Neon Postgres |
| App URL | Shopify CLI tunnel | `https://discount-app-437971048935.europe-west3.run.app` |
| Plan override | Allowed | Never set |

## Cost profile

The service is configured for the smallest possible bill without slow loads:

- `min-instances=0`: nothing runs, nothing is billed, while the app is idle.
- Request-based billing (CPU only allocated while a request is in flight).
- `concurrency=80`: one instance serves many merchants; instances are rarely
  added. `max-instances=3` caps the worst case.
- `cpu=1`, `memory=512Mi`: the smallest size that keeps Node responsive.
- `--cpu-boost`: extra CPU only during startup, billed for that second or so;
  it roughly halves cold starts (~0.5 s measured), which matters for Shopify's
  Core Web Vitals check.
- Artifact Registry keeps the three newest images and deletes the rest.
- Neon free tier auto-suspends after 5 minutes idle; the first query after
  that adds ~0.3–0.5 s. Move to Neon Launch if that shows up in the vitals.

At a few thousand admin page views a month this sits inside Google's free tier.

## Secrets and settings

Secrets (Secret Manager, read by the runtime service account
`discount-app-run@discount-494316.iam.gserviceaccount.com`):

| Secret | Value |
| --- | --- |
| `shopify-api-key` | Client ID from the Partner Dashboard |
| `shopify-api-secret` | Client secret from the Partner Dashboard |
| `database-url` | Neon connection string (pooled) |

Non-secret settings are substitutions in `cloudbuild.yaml`:
`_SHOPIFY_APP_URL`, `_SCOPES`, `_REGION`, `_MAX_INSTANCES`. The deploy step
sets `NODE_ENV=production`, `SESSION_STORAGE_BACKEND=neon`,
`SHOPIFY_BILLING_TEST=false`.

To rotate a secret:

```powershell
gcloud secrets versions add shopify-api-secret --data-file=secret.txt
npm run deploy:cloudrun   # new revision picks up :latest
```

## Deploying

```shell
npm run deploy:cloudrun
```

That runs `gcloud builds submit --config cloudbuild.yaml` with the short git
SHA as the image tag: Cloud Build builds the Docker image, pushes it, and
deploys a new Cloud Run revision. Expect ~5–10 minutes; the image build
dominates.

Requirements on the machine running it: `gcloud` logged in
(`gcloud auth login`), project set (`gcloud config set project discount-494316`),
and billing enabled on the project. Nothing else — Docker is not needed
locally.

The database table is created once with:

```shell
DATABASE_URL=<neon url> npm run db:migrate
```

## Changing the app URL

If you attach a custom domain (Cloud Run > Domain mappings, or a load
balancer) or move regions:

1. Update `_SHOPIFY_APP_URL` in `cloudbuild.yaml` and redeploy.
2. Update `application_url` and `redirect_urls` in `shopify.app.toml`.
3. `shopify app deploy` so Shopify sends merchants to the new URL.

Do this before App Store submission; a URL change after approval means a new
review.

## Development Workflow

```shell
npm run dev
```

The Shopify CLI updates tunnel URLs for dev when
`automatically_update_urls_on_dev = true` in `shopify.app.development.toml`.

Use `APP_PLAN_OVERRIDE` only for local UI testing. Remove it when testing
real Shopify billing state.

## Production Checklist

1. Billing enabled on `discount-494316` (the service disappears if the billing
   account closes).
2. Secrets present in Secret Manager; `npm run db:migrate` run against Neon.
3. `npm run deploy:cloudrun` succeeded; the service URL answers.
4. `shopify.app.toml` URLs match the service URL; `shopify app deploy` run.
5. `APP_PLAN_OVERRIDE` unset (it is ignored in production anyway).

See [app-store-submission.md](app-store-submission.md) for the listing and
verification steps.
