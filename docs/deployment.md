# Deployment and Environments

The admin app runs on Vercel. Shopify sessions live in Neon Postgres. Campaign
data lives in Shopify metafields, so there is nothing else to host.

## Environments

| Area | Development | Production |
| --- | --- | --- |
| Shopify app config | `shopify.app.development.toml` | `shopify.app.toml` |
| Billing | Test billing | Real billing |
| Session storage | Local JSON file | Neon Postgres |
| App URL | Shopify CLI tunnel | Vercel production domain |
| Plan override | Allowed | Never set |

## Environment Variables

Reference files:

- `.env.development.example`
- `.env.production.example`

Development:

```shell
SHOPIFY_BILLING_TEST=true
NODE_ENV=development
APP_PLAN_OVERRIDE=free
SESSION_STORAGE_BACKEND=file
SESSION_STORAGE_FILE=.data/shopify-sessions.json
```

Production (Vercel project settings):

```shell
SHOPIFY_API_KEY=...
SHOPIFY_API_SECRET=...
SHOPIFY_APP_URL=https://<your-vercel-domain>
SCOPES=read_discounts,write_discounts,read_shipping,read_markets
SHOPIFY_BILLING_TEST=false
SESSION_STORAGE_BACKEND=neon
DATABASE_URL=<set by the Neon integration>
```

`NODE_ENV=production` is set by Vercel. Do not set `APP_PLAN_OVERRIDE` in
production; the app ignores it there anyway.

## First-time Vercel setup

1. Create a Neon database. The easiest path is the Neon integration in the
   Vercel Marketplace, which creates the database and injects `DATABASE_URL`
   into the project. Pick the Neon region closest to the Vercel function
   region. `vercel.json` pins functions to `arn1` (Stockholm) to match the
   previous europe-north1 deployment; change both together if your merchants
   are elsewhere.
2. Import the repository into Vercel. The `@vercel/react-router` preset in
   `react-router.config.ts` is picked up automatically; the build command is
   `npm run build`.
3. Add the Shopify environment variables listed above.
4. Run the session table migration once against the production database:

   ```shell
   vercel env pull .env.vercel.local
   DATABASE_URL=$(grep DATABASE_URL .env.vercel.local | cut -d= -f2-) npm run db:migrate
   ```

   Migrations are idempotent, so re-running them is safe.
5. Deploy. Copy the production domain Vercel assigns (or attach a custom
   domain).
6. Put that domain in `shopify.app.toml` (`application_url` and
   `redirect_urls`) and in the `SHOPIFY_APP_URL` env var, then:

   ```shell
   shopify app config validate
   shopify app deploy
   ```

   `shopify app deploy` also publishes the discount function extension and
   registers the webhooks.

## Preview deployments

Vercel preview URLs change per branch. Shopify only accepts requests from the
URLs in the app config, so previews cannot be opened inside Shopify Admin
without updating the config. Use `npm run dev` with a dev store for feature
work and treat previews as build checks only.

## Development Workflow

```shell
npm run dev
```

The Shopify CLI updates tunnel URLs for dev when
`automatically_update_urls_on_dev = true` in `shopify.app.development.toml`.

Use `APP_PLAN_OVERRIDE` only for local UI testing. Remove it when testing
real Shopify billing state.

## Production Checklist

1. Neon database created and `DATABASE_URL` present in Vercel.
2. `npm run db:migrate` run against production.
3. `SHOPIFY_BILLING_TEST=false`, `APP_PLAN_OVERRIDE` unset.
4. `shopify.app.toml` URLs match the Vercel domain.
5. `shopify app deploy` run after the Vercel deploy.

## Verification

Before submitting to the Shopify App Store:

- Install the production app on a test store.
- Confirm Free plan limitations and the upgrade prompts.
- Start a Pro trial, confirm paid features unlock and the trial badge shows.
- Approve Enterprise billing and confirm unlimited active discounts.
- Downgrade to Free and confirm the over-limit banner and Free limitations.
- Create, edit, activate, deactivate, and delete discounts; confirm the
  status in Shopify Admin > Discounts matches the app.
- Confirm webhooks are registered after deploy.
