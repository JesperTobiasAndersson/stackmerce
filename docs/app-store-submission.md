# App Store submission checklist

Everything the code already handles is marked done. The rest are Partner
Dashboard / hosting tasks that only the app owner can complete.

## Code (done)

- [x] Embedded app, session-token auth, latest App Bridge on every page.
- [x] UI built on Polaris web components (v1.0) with title-bar actions,
      contextual save bar, toasts, modals, and the native resource picker.
- [x] Discount function registers `ui.paths`, so the app is listed under
      Discounts > Create discount and its discounts open the app editor.
- [x] Compliance webhooks (`customers/data_request`, `customers/redact`,
      `shop/redact`) acknowledged; the app stores no customer data.
- [x] `app/uninstalled` deletes the shop's session.
- [x] Scopes limited to `read_discounts,write_discounts,read_shipping,read_markets`.
- [x] Billing: Pro/Enterprise with 7-day trials; **test charges are used
      automatically on development stores** (`shop.plan.partnerDevelopment`),
      which is what Shopify's reviewers install from.
- [x] English and Swedish UI, following the admin's `locale`.
- [x] Friendly not-found/error pages on the discount routes.

## Hosting (owner)

- [ ] Billing must stay enabled on the GCP project (`discount-494316`); the
      old deployment disappeared when the billing account was closed.
- [ ] Decide the final domain (the Cloud Run URL or a custom domain such as
      `discount.stackmerce.app`) **before** submitting. Changing
      `application_url` after approval triggers another review. Update
      `shopify.app.toml`, `_SHOPIFY_APP_URL` in `cloudbuild.yaml`, redeploy,
      `shopify app deploy`.
- [ ] Consider Neon Launch to avoid auto-suspend cold starts (they add ~0.5 s
      to the first admin load after idle, which counts against Core Web Vitals).
- [ ] Set up a Cloud Logging alert on Cloud Run 5xx responses (or add Sentry) so a
      failing save or checkout function config is noticed.

## Partner Dashboard (owner)

- [ ] Final app name. "Discount" alone is a generic category word and is
      likely to be rejected; something like "Stackmerce Discounts" passes the
      naming rules (no "Shopify" in the name).
- [ ] App icon 1200×1200, 3–6 screenshots of the Polaris UI, optional demo video.
- [ ] Listing copy in English (and Swedish if you list it as supported).
- [ ] Pricing section that matches the code exactly: Free ($0), Pro
      ($14.90/30 days), Enterprise ($39.90/30 days), 7-day free trial on both
      paid plans. Note Shopify now prefers "Shopify App Pricing" for new
      public apps; the Billing API used here is still accepted.
- [ ] Privacy policy URL, support email/URL, emergency developer contact.
- [ ] Scope justification: `read_shipping` → shipping-method targeting,
      `read_markets` → market targeting.
- [ ] Reviewer instructions: discounts are automatic (no codes); Free allows
      one active discount; paid plans can be tried on a development store
      because the app issues test charges there.

## Final verification on a fresh development store

1. Install → the Overview shows the three-step setup guide.
2. Create a percentage discount, save with the save bar → toast, list row
   shows the summary text.
3. Activate from the list → toast; Shopify Admin > Discounts shows it Active.
4. Checkout on the storefront applies it.
5. Discounts > Create discount lists "Automatic discount campaign"; opening
   an existing app discount from that page lands in the editor; saving
   returns to Shopify's Discounts page.
6. Plans → Start free trial → approve (test charge) → back on Plans with the
   confirmation; Pro-only fields unlock in the editor.
7. Downgrade to Free → modal → cancelled; over-limit banner appears if more
   than one discount is active.
8. Switch the admin language to Swedish → app renders in Swedish.
9. Delete a discount; open its old URL → friendly not-found page.
10. Uninstall → reinstall works.
