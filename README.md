# Discount App

Shopify embedded app for automatic discount campaigns built with React Router
and Shopify Functions.

## Architecture

- Campaign configuration is stored in Shopify metafields on app-managed
  automatic discounts.
- Local development uses file-backed session storage.
- Production on Google Cloud uses Firestore for Shopify sessions.
- The app is intended to run on Cloud Run with `min-instances=0`.

## Local development

Use [.env.development.example](.env.development.example) as the reference.

```shell
npm run dev
```

## Production on Google Cloud

Use Cloud Run for the app container and Firestore for session persistence.

Important production settings:

- `NODE_ENV=production`
- `SHOPIFY_BILLING_TEST=false`
- `SESSION_STORAGE_BACKEND=firestore`
- `FIRESTORE_SESSION_COLLECTION=shopify_sessions`

Recommended Cloud Run cost guards:

- `min-instances=0`
- `max-instances=3`
- `cpu=0.5`
- `memory=512Mi`
- `concurrency=1`
- request-based billing via `--cpu-throttling`

The deploy baseline and checklist live in [docs/deployment.md](docs/deployment.md).
The Cloud Run service account should have Firestore access, typically
`roles/datastore.user`.
For a concrete setup flow, use [docs/gcp-production-runbook.md](docs/gcp-production-runbook.md)
and [scripts/gcp-production.ps1](scripts/gcp-production.ps1).
The script already defaults to your current GCP production target in
`discount-494316` and the Cloud Run URL in this repo.

## Notes

- This setup avoids Cloud SQL for session storage to keep runtime cost low.
- Cloud Run's local filesystem should not be used for production session state.
- Webhooks, billing, auth, and embedded admin routes still require the app
  server even though discount execution runs inside Shopify Functions.
