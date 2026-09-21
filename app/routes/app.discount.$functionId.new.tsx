import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";

/**
 * Entry point registered in the discount function's `ui.paths.create`.
 * Shopify Admin opens this URL from Discounts > Create discount; hand the
 * merchant to the editor and remember to send them back to Shopify afterwards.
 */
export const loader = ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  url.searchParams.set("returnTo", "discounts");

  throw redirect(`/app/campaigns/new?${url.searchParams.toString()}`);
};
