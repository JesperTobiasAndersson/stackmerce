# Discount App

Shopify embedded app for automatic discount campaigns built with React Router
and Shopify Functions.

## Architecture

- Campaign configuration is stored in Shopify metafields on app-managed
  automatic discounts. Discount logic runs inside a Shopify Function at
  checkout, so the app server only serves the embedded admin, auth, billing,
  and webhooks.
- Local development uses file-backed session storage.
- Production runs on Google Cloud Run (scale to zero) with Shopify sessions in
  Neon Postgres.

## Local development

Use [.env.development.example](.env.development.example) as the reference.

```shell
npm install
npm run dev
```

Discount function tests:

```shell
npm test
```

## Production on Google Cloud Run

See [docs/deployment.md](docs/deployment.md) for the full setup. In short:

1. Secrets `shopify-api-key`, `shopify-api-secret`, and `database-url` (Neon)
   live in Secret Manager; non-secret settings are in `cloudbuild.yaml`.
2. Run `npm run db:migrate` once against the Neon database.
3. `npm run deploy:cloudrun` builds the image and deploys it.
4. After a URL change, update `shopify.app.toml` and run `shopify app deploy`.

Storage details are in [docs/native-storage.md](docs/native-storage.md).
The App Store submission checklist is in [docs/app-store-submission.md](docs/app-store-submission.md).
