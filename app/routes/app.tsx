import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { data, Outlet, useLoaderData, useLocation, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import {
  createTranslator,
  LOCALE_PARAM,
  localeCookieHeader,
  resolveLocale,
} from "../i18n";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const locale = resolveLocale(request);
  const explicit = new URL(request.url).searchParams.has(LOCALE_PARAM);

  return data(
    // eslint-disable-next-line no-undef
    { apiKey: process.env.SHOPIFY_API_KEY || "", locale },
    // Remember the language Shopify Admin told us about so later navigations
    // that lose the query string still render in it.
    explicit ? { headers: { "Set-Cookie": localeCookieHeader(locale) } } : undefined,
  );
};

export default function App() {
  const { apiKey, locale } = useLoaderData<typeof loader>();
  const { search } = useLocation();
  const t = createTranslator(locale);

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href={`/app${search}`}>{t("nav.overview")}</s-link>
        <s-link href={`/app/campaigns${search}`}>{t("nav.discounts")}</s-link>
        <s-link href={`/app/plans${search}`}>{t("nav.plans")}</s-link>
      </s-app-nav>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
