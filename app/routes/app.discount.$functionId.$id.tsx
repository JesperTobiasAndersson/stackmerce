import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

/**
 * Entry point registered in the discount function's `ui.paths.details`.
 * Shopify Admin opens this URL when a merchant clicks one of the app's
 * discounts in Discounts; `:id` is the numeric discount id.
 */
export const loader = ({ params, request }: LoaderFunctionArgs) => {
  const id = String(params.id || "").trim();

  if (!/^\d+$/.test(id)) {
    throw new Response("Discount id is required.", { status: 400 });
  }

  const url = new URL(request.url);
  url.searchParams.set("returnTo", "discounts");
  const campaignId = encodeURIComponent(`gid://shopify/DiscountAutomaticNode/${id}`);

  throw redirect(`/app/campaigns/${campaignId}?${url.searchParams.toString()}`);
};
