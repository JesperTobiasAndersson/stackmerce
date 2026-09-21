import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  redirect,
  useActionData,
  useLoaderData,
  useLocation,
  useNavigation,
  useRouteError,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { CampaignForm, emptyCampaignFormInput } from "../components/campaign-form";
import { DiscountRouteError } from "../components/route-error";
import { getCurrentPlan } from "../billing.server";
import {
  afterSaveUrl,
  campaignInputFromForm,
  validateCampaignInput,
} from "../campaign-form.server";
import { loadActiveCampaignCount, saveNewCampaign } from "../campaign-storage.server";
import { validateCampaignEntitlements, type AppPlan } from "../entitlements";
import { rawError, type FormError } from "../form-errors";
import { resolveLocale } from "../i18n";
import { useTranslation } from "../i18n/react";
import type {
  ShopifyMarketSummary,
  ShopifyShippingMethodSummary,
} from "../shopify-api.server";
import { getCurrencyInfo, listMarkets, listShippingMethods } from "../shopify-api.server";
import { authenticate } from "../shopify.server";

type NewCampaignLoaderData = {
  plan: AppPlan;
  activeCampaignCount: number;
  defaultCurrency: string;
  availableCurrencies: string[];
  shippingMethods: ShopifyShippingMethodSummary[];
  markets: ShopifyMarketSummary[];
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const [currencyInfo, shippingMethods, markets, plan, activeCampaignCount] =
    await Promise.all([
      getCurrencyInfo(admin, session.shop),
      listShippingMethods(admin, session.shop),
      listMarkets(admin, session.shop),
      getCurrentPlan(admin, session.shop),
      loadActiveCampaignCount(admin),
    ]);

  return {
    plan,
    activeCampaignCount,
    defaultCurrency: currencyInfo.defaultCurrency,
    availableCurrencies: currencyInfo.availableCurrencies,
    shippingMethods,
    markets,
  } satisfies NewCampaignLoaderData;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const locale = resolveLocale(request);
  const formData = await request.formData();
  const campaign = campaignInputFromForm(formData);
  const [plan, activeCampaignCount] = await Promise.all([
    getCurrentPlan(admin, session.shop),
    loadActiveCampaignCount(admin),
  ]);
  const errors: FormError[] = [
    ...validateCampaignInput(campaign),
    ...validateCampaignEntitlements({ activeCampaignCount, input: campaign, plan }),
  ];

  if (errors.length) {
    return { errors };
  }

  try {
    await saveNewCampaign(admin, campaign);
  } catch (error) {
    return {
      errors: [
        error instanceof Error
          ? rawError(error.message)
          : ({ field: null, key: "error.save.failed" } satisfies FormError),
      ],
    };
  }

  return redirect(afterSaveUrl(request, "created", locale));
};

export default function NewCampaign() {
  const data = useLoaderData<typeof loader>() as NewCampaignLoaderData;
  const actionData = useActionData<typeof action>();
  const { t } = useTranslation();
  const { search } = useLocation();
  const navigation = useNavigation();

  return (
    <s-page heading={t("editor.createTitle")}>
      <s-link href={`/app/campaigns${search}`} slot="breadcrumb-actions">
        {t("editor.back")}
      </s-link>

      <CampaignForm
        activeCampaignCount={data.activeCampaignCount}
        availableCurrencies={data.availableCurrencies}
        defaultCurrency={data.defaultCurrency}
        errors={actionData?.errors ?? []}
        initialValues={emptyCampaignFormInput()}
        isSaving={navigation.state === "submitting"}
        markets={data.markets}
        mode="create"
        plan={data.plan}
        shippingMethods={data.shippingMethods}
      />
    </s-page>
  );
}

export function ErrorBoundary() {
  return <DiscountRouteError error={useRouteError()} />;
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
