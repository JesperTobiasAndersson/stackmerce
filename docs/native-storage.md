# Native storage strategy

This app stores merchant campaign configuration on Shopify discount owners.
It does not use the app database for campaign data.

## Storage owner

Campaign data is stored on the Shopify automatic app discount created by
`discountAutomaticAppCreate`.

The owner is the discount node, not the shop, app installation, product, or
customer.

This matters because Shopify Functions run with the discount as the function
owner and can read the discount metafields at checkout time.

## Metafields

The app writes two JSON metafields to each automatic app discount.

| Namespace | Key | Purpose |
| --- | --- | --- |
| `$app:discount-campaign` | `campaign_config` | Full campaign configuration used by the embedded admin UI and discount function. |
| `$app:discount-campaign` | `input_variables` | Function input query variables, currently `selectedCollectionIds` for Shopify's `inAnyCollection` check. |

The namespace uses Shopify's app-reserved `$app:` prefix so other apps cannot
write into the same namespace.

## Campaign config shape

The canonical TypeScript model lives in `app/campaign-config.ts`.

`campaign_config` includes:

- `version`
- `id`
- `name`
- `status`
- `productDiscount`
- `shippingDiscount`
- `conditions`

`conditions` includes:

- `minimumCartSubtotal`
- `productIds`
- `collectionIds`
- `startsAt`
- `endsAt`

## Input variables shape

`input_variables` mirrors only the values required by the GraphQL input query
variable system:

```json
{
  "selectedCollectionIds": ["gid://shopify/Collection/123"]
}
```

This is separate from `campaign_config` because Shopify Functions input query
variables require top-level JSON keys that match query variable names.

## Session storage

Campaigns are not stored in the app runtime at all.

The remaining app-owned persistence is Shopify session storage.

- Local development uses a small file-backed session store.
- Production on Google Cloud uses Firestore.

No custom campaign tables are required for the MVP.

For cost optimization, this removes the need for a managed PostgreSQL database.
On Google Cloud, Firestore is a better fit than Cloud SQL for this app because
it stays compatible with Cloud Run scale-to-zero and charges mostly per actual
session reads and writes.

## Read/write paths

Admin UI read/write:

- `app/campaign-storage.server.ts`
- `app/shopify-api.server.ts`
- `discountAutomaticAppCreate`
- `discountAutomaticAppUpdate`
- `discountNodes`
- `discountNode`

Function runtime read:

- `extensions/discount-function-js/src/cart_lines_discounts_generate_run.graphql`
- `extensions/discount-function-js/src/cart_delivery_options_discounts_generate_run.graphql`
- `extensions/discount-function-js/src/campaign_config.js`

## Storage abstraction

Routes should use `app/campaign-storage.server.ts` for campaign load/save
operations.

`app/shopify-api.server.ts` remains the lower-level Shopify Admin API module.
Keeping the route layer behind the storage abstraction lets the app change
campaign persistence later without rewriting UI routes or form actions.

## Operational notes

When new metafields or function input variables are added, existing campaigns
must be saved once from the app UI so Shopify receives the updated metafield
payload.

If a future feature needs data that should be shared across campaigns, prefer a
Shopify-native owner first, such as app installation metafields or metaobjects.
Use external persistence only when Shopify-native storage cannot support the
query, ownership, or runtime access pattern.
