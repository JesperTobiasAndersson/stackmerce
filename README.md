# Discount App

Shopify embedded app for automatic discount campaigns built with React Router
and Shopify Functions.

## Architecture

- Campaign configuration is stored in Shopify metafields on app-managed
  automatic discounts. Discount logic runs inside a Shopify Function at
  checkout, so the app server only serves the embedded admin, auth, billing,
  and webhooks.
- Local development uses file-backed session storage.
- Production runs on Vercel with Shopify sessions in Neon Postgres.

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

## Production on Vercel

See [docs/deployment.md](docs/deployment.md) for the full setup. In short:

1. Connect the Neon integration in Vercel (sets `DATABASE_URL`).
2. Set `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`, `SCOPES`,
   `SHOPIFY_BILLING_TEST=false`, `SESSION_STORAGE_BACKEND=neon`.
3. Run `npm run db:migrate` once against the production database.
4. Deploy, then update `shopify.app.toml` with the Vercel domain and run
   `shopify app deploy`.

Storage details are in [docs/native-storage.md](docs/native-storage.md).
