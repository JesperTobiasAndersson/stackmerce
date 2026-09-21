import { isRouteErrorResponse, useLocation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { useTranslation } from "../i18n/react";

/**
 * Error boundary for the discount routes. Shopify's own thrown responses
 * (auth bounces) still go through `boundary.error`; everything else gets a
 * merchant-friendly page instead of React Router's raw error screen.
 */
export function DiscountRouteError({ error }: { error: unknown }) {
  const { t } = useTranslation();
  const { search } = useLocation();
  const notFound = isRouteErrorResponse(error) && error.status === 404;

  if (isRouteErrorResponse(error) && !notFound && error.status !== 500) {
    return boundary.error(error);
  }

  return (
    <s-page heading={notFound ? t("editor.notFound.heading") : t("editor.error.heading")}>
      <s-link href={`/app/campaigns${search}`} slot="breadcrumb-actions">
        {t("editor.back")}
      </s-link>
      <s-section>
        <s-stack direction="block" gap="base">
          <s-paragraph>
            {notFound ? t("editor.notFound.text") : t("editor.error.text")}
          </s-paragraph>
          <s-stack direction="inline" gap="base">
            <s-button href={`/app/campaigns${search}`} variant="primary">
              {t("common.viewDiscounts")}
            </s-button>
          </s-stack>
        </s-stack>
      </s-section>
    </s-page>
  );
}
