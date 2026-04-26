# Deployment and Environments

This app should run with separate development and production environments. Do not reuse the same Shopify app, database, or billing settings across both.

## Environments

| Area | Development | Production |
| --- | --- | --- |
| Shopify app | Development/public test app | Production public app |
| Billing | Test billing | Real billing |
| Session storage | Local file | Firestore |
| App URL | Shopify CLI tunnel | Stable hosted URL |
| Plan override | Allowed | Never set |

## Recommended Production Target

For the current codebase, the cheapest safe production target is:

- Hosting: a scale-to-zero container host from the repo `Dockerfile`
- Persistence: Firestore for Shopify sessions
- Secrets: platform-managed secrets

For Google Cloud production, use `Cloud Run + Firestore`, not `Cloud Run + Cloud SQL`. The discount logic already runs inside Shopify Functions, so your app server mostly exists for embedded admin pages, auth, billing, and webhooks.

## Lowest-Cost Architecture Direction

If your goal is near-zero driftkostnad, optimize in this order:

1. Keep campaign data in Shopify-native storage. This app already does that.
2. Use Firestore instead of a managed SQL database for session storage.
3. Run the admin app on a platform that truly scales to zero.

Today the remaining non-Shopify infrastructure cost is driven by session persistence, not by campaign storage.

## Environment Variables

Use the example files as references:

- `.env.development.example`
- `.env.production.example`
- `.env.cloudrun.example`

Development:

```shell
SHOPIFY_BILLING_TEST=true
NODE_ENV=development
APP_PLAN_OVERRIDE=free
SESSION_STORAGE_BACKEND=file
SESSION_STORAGE_FILE=.data/shopify-sessions.json
```

Production:

```shell
SHOPIFY_BILLING_TEST=false
NODE_ENV=production
SESSION_STORAGE_BACKEND=firestore
FIRESTORE_SESSION_COLLECTION=shopify_sessions
```

Do not set `APP_PLAN_OVERRIDE` in production. The app also ignores it when `NODE_ENV=production`, but keeping it unset avoids confusion.

## Shopify App Configs

Current working config:

- `shopify.app.toml`

Development reference:

- `shopify.app.development.toml`

Production template:

- `shopify.app.production.example.toml`

For production, create a separate public app in Shopify Partners, copy the production example, replace the `client_id`, `application_url`, and `redirect_urls`, then link it with Shopify CLI.

```shell
shopify app config link
shopify app config use
shopify app config validate
```

Use `shopify app config use` to switch between dev and production configs before deploying. Always check the selected config before running deploy.

## Development Workflow

```shell
npm run dev
```

The Shopify CLI updates tunnel URLs for dev when `automatically_update_urls_on_dev = true`.

Use `APP_PLAN_OVERRIDE` only for local UI testing. Remove it when testing real Shopify billing state.

The default runtime persistence target is:

- development: local JSON session file
- production: Firestore

## Cloud Run Setup

Use this only if you prefer the most familiar path over the cheapest one.

1. Create or select a GCP project.
2. Enable these APIs:
   - Cloud Run Admin API
   - Cloud Build API
   - Artifact Registry API
   - Secret Manager API
3. Create an Artifact Registry Docker repository.
4. Create a Firestore database in the same GCP project.
5. Store these values in Secret Manager:
   - `shopify-api-key`
   - `shopify-api-secret`
6. Set the production app URL in Shopify to the final Cloud Run URL or your custom domain.

### Firestore

Cloud Run can use Firestore through Application Default Credentials from its service account. No database connection string is required.

Use a dedicated collection such as `shopify_sessions`.

### Build and Deploy

The repo includes `cloudbuild.yaml` for a simple container build and Cloud Run deployment.
For a scripted GCP setup flow, use `scripts/gcp-production.ps1` and the
runbook in `docs/gcp-production-runbook.md`.

Run from the repo root:

```shell
gcloud builds submit --config cloudbuild.yaml
```

The default substitutions in `cloudbuild.yaml` should be edited before first production deploy:

- `_SERVICE_NAME`
- `_REGION`
- `_SERVICE_ACCOUNT`
- `_CONCURRENCY`
- `_CPU`
- `_MEMORY`
- `_TIMEOUT`
- `_MAX_INSTANCES`
- `_IMAGE_URI`
- `_SHOPIFY_APP_URL`
- `_FIRESTORE_SESSION_COLLECTION`
- `_SCOPES`
- secret names if they differ from the defaults

The provided `cloudbuild.yaml` keeps `min-instances=0` and sets a small
`max-instances` cap for cost control. Adjust `_MAX_INSTANCES` only if traffic
or webhook concurrency requires it.

Recommended low-cost defaults in this repo:

- `--cpu-throttling`: request-based billing
- `--no-cpu-boost`: lower startup spend, slower cold starts
- `_CPU=0.5`
- `_MEMORY=512Mi`
- `_CONCURRENCY=1`
- `_TIMEOUT=60s`
- `_MAX_INSTANCES=3`

## Production Checklist

1. Create or select the production public app in Shopify Partners.
2. Set the production app URL to the Cloud Run URL or custom domain.
3. Set redirect URLs for the production domain.
4. Configure production environment variables and secrets in Cloud Run.
5. Set `SHOPIFY_BILLING_TEST=false`.
6. Ensure `APP_PLAN_OVERRIDE` is not set.
7. Ensure the Cloud Run service account can access Firestore.
   Recommended: grant `roles/datastore.user` on the project.
8. Use a dedicated Cloud Run service account instead of the default compute account.
9. Deploy the app container to your chosen host.
10. Validate and deploy Shopify config:

```shell
shopify app config validate
shopify app deploy
```

## Verification

Before submitting to the Shopify App Store:

- Install the production app on a test store.
- Confirm Free plan limitations.
- Approve Pro billing and confirm paid features unlock.
- Approve Enterprise billing and confirm unlimited active discounts.
- Cancel or downgrade and confirm Free limitations return.
- Create, edit, activate, deactivate, and delete discounts.
- Confirm webhooks are registered after deploy.
