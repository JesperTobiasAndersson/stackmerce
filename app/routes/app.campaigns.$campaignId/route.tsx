import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  redirect,
  useActionData,
  useFetcher,
  useLoaderData,
  useLocation,
  useNavigation,
  useRouteError,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { CampaignForm } from "../../components/campaign-form";
import { DiscountRouteError } from "../../components/route-error";
import { getCurrentPlan } from "../../billing.server";
import type { CampaignConfig } from "../../campaign-config";
import {
  afterSaveUrl,
  campaignInputFromForm,
  validateCampaignInput,
} from "../../campaign-form.server";
import {
  deleteCampaignById,
  loadActiveCampaignCount,
  loadCampaign,
  saveCampaign,
  type CampaignDetail,
  type CampaignFormInput,
} from "../../campaign-storage.server";
import { validateCampaignEntitlements, type AppPlan } from "../../entitlements";
import { rawError, type FormError } from "../../form-errors";
import { resolveLocale } from "../../i18n";
import { useTranslation } from "../../i18n/react";
import { flag } from "../../lib/polaris";
import type {
  ShopifyCollectionSummary,
  ShopifyMarketSummary,
  ShopifyProductSummary,
  ShopifyShippingMethodSummary,
} from "../../shopify-api.server";
import {
  campaignInputFromConfig,
  getCollectionsByIds,
  getCurrencyInfo,
  getProductsByIds,
  listMarkets,
  listShippingMethods,
} from "../../shopify-api.server";
import { authenticate } from "../../shopify.server";

const DELETE_MODAL_ID = "delete-campaign-modal";

type CampaignEditLoaderData = {
  campaign: Pick<CampaignDetail, "id" | "name" | "status">;
  initialValues: CampaignFormInput;
  selectedProducts: ShopifyProductSummary[];
  selectedCollections: ShopifyCollectionSummary[];
  excludedProducts: ShopifyProductSummary[];
  excludedCollections: ShopifyCollectionSummary[];
  shippingMethods: ShopifyShippingMethodSummary[];
  markets: ShopifyMarketSummary[];
  defaultCurrency: string;
  availableCurrencies: string[];
  plan: AppPlan;
  activeCampaignCount: number;
};

export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const campaignId = decodeCampaignId(params.campaignId);
  const campaign = await loadCampaignOr404(admin, campaignId);
  const { conditions } = campaign.config;
  const [
    currencyInfo,
    selectedProducts,
    selectedCollections,
    excludedProducts,
    excludedCollections,
    shippingMethods,
    markets,
    plan,
    activeCampaignCount,
  ] = await Promise.all([
    getCurrencyInfo(admin, session.shop),
    getProductsByIds(admin, conditions.productIds ?? []),
    getCollectionsByIds(admin, conditions.collectionIds ?? []),
    getProductsByIds(admin, conditions.excludedProductIds ?? []),
    getCollectionsByIds(admin, conditions.excludedCollectionIds ?? []),
    listShippingMethods(admin, session.shop),
    listMarkets(admin, session.shop),
    getCurrentPlan(admin, session.shop),
    loadActiveCampaignCount(admin),
  ]);

  return {
    campaign: { id: campaign.id, name: campaign.name, status: campaign.status },
    // The form status reflects what the merchant can see in the list, which
    // also accounts for the discount being deactivated inside Shopify Admin.
    initialValues: campaignInputFromConfig(campaign.config, {
      status: campaign.status,
    }),
    selectedProducts,
    selectedCollections,
    excludedProducts,
    excludedCollections,
    shippingMethods,
    markets,
    defaultCurrency: currencyInfo.defaultCurrency,
    availableCurrencies: availableCurrenciesForCampaign(
      currencyInfo.availableCurrencies,
      campaign.config,
    ),
    plan,
    activeCampaignCount,
  } satisfies CampaignEditLoaderData;
};

export const action = async ({ params, request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const locale = resolveLocale(request);
  const campaignId = decodeCampaignId(params.campaignId);
  const formData = await request.formData();
  const actionType = String(formData.get("_action") || "update");

  if (actionType === "delete") {
    try {
      await deleteCampaignById(admin, campaignId);
      return redirect(afterSaveUrl(request, "deleted", locale));
    } catch (error) {
      return {
        errors: [
          error instanceof Error
            ? rawError(error.message)
            : ({ field: null, key: "error.delete.failed" } satisfies FormError),
        ],
      };
    }
  }

  const campaign = campaignInputFromForm(formData);
  const [plan, existingCampaign, activeCampaignCount] = await Promise.all([
    getCurrentPlan(admin, session.shop),
    loadCampaignOr404(admin, campaignId),
    loadActiveCampaignCount(admin),
  ]);
  const errors: FormError[] = [
    ...validateCampaignInput(campaign),
    ...validateCampaignEntitlements({
      activeCampaignCount,
      currentCampaignIsActive: existingCampaign.status === "active",
      input: campaign,
      plan,
    }),
  ];

  if (errors.length) {
    return { errors };
  }

  try {
    await saveCampaign(admin, campaignId, campaign, existingCampaign);
  } catch (error) {
    return {
      errors: [
        error instanceof Error
          ? rawError(error.message)
          : ({ field: null, key: "error.save.failed" } satisfies FormError),
      ],
    };
  }

  return redirect(afterSaveUrl(request, "updated", locale));
};

export default function CampaignEdit() {
  const data = useLoaderData<typeof loader>() as CampaignEditLoaderData;
  const actionData = useActionData<typeof action>();
  const { t } = useTranslation();
  const { search } = useLocation();
  const navigation = useNavigation();
  const deleteFetcher = useFetcher<typeof action>();
  const isDeleting = deleteFetcher.state !== "idle";
  const isSaving = navigation.state === "submitting";
  const errors: FormError[] = [
    ...(actionData?.errors ?? []),
    ...(deleteFetcher.data?.errors ?? []),
  ];

  return (
    <s-page heading={data.campaign.name}>
      <s-link href={`/app/campaigns${search}`} slot="breadcrumb-actions">
        {t("editor.back")}
      </s-link>
      <s-button
        command="--show"
        commandFor={DELETE_MODAL_ID}
        disabled={flag(isDeleting)}
        slot="secondary-actions"
        tone="critical"
      >
        {t("common.delete")}
      </s-button>

      <CampaignForm
        activeCampaignCount={data.activeCampaignCount}
        availableCurrencies={data.availableCurrencies}
        defaultCurrency={data.defaultCurrency}
        errors={errors}
        initialExcludedCollections={data.excludedCollections}
        initialExcludedProducts={data.excludedProducts}
        initialSelectedCollections={data.selectedCollections}
        initialSelectedProducts={data.selectedProducts}
        initialValues={data.initialValues}
        isSaving={isSaving}
        markets={data.markets}
        mode="edit"
        plan={data.plan}
        shippingMethods={data.shippingMethods}
      />

      <s-modal heading={t("editor.delete.heading")} id={DELETE_MODAL_ID}>
        <s-paragraph>{t("list.delete.text", { name: data.campaign.name })}</s-paragraph>
        <s-button
          command="--hide"
          commandFor={DELETE_MODAL_ID}
          loading={flag(isDeleting)}
          onClick={() => deleteFetcher.submit({ _action: "delete" }, { method: "post" })}
          slot="primary-action"
          tone="critical"
          variant="primary"
        >
          {t("list.delete.confirm")}
        </s-button>
        <s-button command="--hide" commandFor={DELETE_MODAL_ID} slot="secondary-actions">
          {t("common.cancel")}
        </s-button>
      </s-modal>
    </s-page>
  );
}

export function ErrorBoundary() {
  return <DiscountRouteError error={useRouteError()} />;
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

function decodeCampaignId(campaignId: string | undefined) {
  if (!campaignId) {
    throw new Response("Discount id is required.", { status: 400 });
  }

  return decodeURIComponent(campaignId);
}

/** A deleted or foreign discount renders the not-found page, not a crash. */
async function loadCampaignOr404(
  admin: Parameters<typeof loadCampaign>[0],
  campaignId: string,
) {
  try {
    return await loadCampaign(admin, campaignId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/not found|not managed/i.test(message)) {
      throw new Response(message, { status: 404 });
    }

    throw error;
  }
}

/** Keep currencies the campaign already uses selectable even if the shop dropped them. */
function availableCurrenciesForCampaign(
  availableCurrencies: string[],
  config: CampaignConfig,
) {
  return Array.from(
    new Set(
      [
        ...availableCurrencies,
        config.productDiscount.fixedAmount?.currencyCode,
        config.orderDiscount?.fixedAmount?.currencyCode,
        config.orderDiscount?.maximumDiscountAmount?.currencyCode,
        config.shippingDiscount.fixedAmount?.currencyCode,
        config.conditions.minimumCartSubtotal?.currencyCode,
      ].filter((code): code is string => Boolean(code)),
    ),
  );
}
