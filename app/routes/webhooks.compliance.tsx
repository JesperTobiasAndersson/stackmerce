import type { ActionFunctionArgs } from "react-router";

import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, shop, topic } = await authenticate.webhook(request);

  // The app stores no customer data: campaign config lives in Shopify
  // metafields and the only app-owned record is the shop's OAuth session,
  // which the app/uninstalled webhook already deletes. Acknowledge so Shopify
  // records the request as handled. Don't log the payload; it can contain
  // customer identifiers.
  const shopId =
    payload && typeof payload === "object"
      ? (payload as { shop_id?: unknown }).shop_id
      : undefined;
  console.log(`Received ${topic} compliance webhook for ${shop}`, { shopId });

  return new Response();
};
