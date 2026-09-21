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
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { CampaignForm } from "../../components/campaign-form";
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
  const campaign = await loadCampaign(admin, campaignId);
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
    // The form's status reflects what the merchant can see in the list, which
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
  const campaignId = decodeCampaignId(params.campaignId);
  const formData = await request.formData();
  const actionType = String(formData.get("_action") || "update");

  if (actionType === "delete") {
    try {
      await deleteCampaignById(admin, campaignId);
      return redirect(afterSaveUrl(request, "deleted"));
    } catch (error) {
      return {
        errors: [
          error instanceof Error ? error.message : "Could not delete campaign.",
        ],
      };
    }
  }

  const campaign = campaignInputFromForm(formData);
  const [plan, existingCampaign, activeCampaignCount] = await Promise.all([
    getCurrentPlan(admin, session.shop),
    loadCampaign(admin, campaignId),
    loadActiveCampaignCount(admin),
  ]);
  const errors = [
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
      errors: [error instanceof Error ? error.message : "Could not save campaign."],
    };
  }

  return redirect(afterSaveUrl(request, "updated"));
};

export default function CampaignEdit() {
  const data = useLoaderData<typeof loader>() as CampaignEditLoaderData;
  const actionData = useActionData<typeof action>();
  const { search } = useLocation();
  const navigation = useNavigation();
  const deleteFetcher = useFetcher<typeof action>();
  const isDeleting = deleteFetcher.state !== "idle";
  const isSaving = navigation.state === "submitting";
  const errors = [
    ...(actionData?.errors ?? []),
    ...(deleteFetcher.data?.errors ?? []),
  ];

  return (
    <s-page heading={data.campaign.name}>
      <s-link href={`/app/campaigns${search}`} slot="breadcrumb-actions">
        Discounts
      </s-link>
      <s-button
        command="--show"
        commandFor={DELETE_MODAL_ID}
        disabled={flag(isDeleting)}
        slot="secondary-actions"
        tone="critical"
      >
        Delete
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

      <s-modal heading="Delete discount?" id={DELETE_MODAL_ID}>
        <s-paragraph>
          This will permanently delete &quot;{data.campaign.name}&quot;. Customers
          will stop receiving it immediately. This action cannot be undone.
        </s-paragraph>
        <s-button
          command="--hide"
          commandFor={DELETE_MODAL_ID}
          loading={flag(isDeleting)}
          onClick={() => deleteFetcher.submit({ _action: "delete" }, { method: "post" })}
          slot="primary-action"
          tone="critical"
          variant="primary"
        >
          Delete discount
        </s-button>
        <s-button command="--hide" commandFor={DELETE_MODAL_ID} slot="secondary-actions">
          Cancel
        </s-button>
      </s-modal>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

function decodeCampaignId(campaignId: string | undefined) {
  if (!campaignId) {
    throw new Response("Campaign id is required.", { status: 400 });
  }

  return decodeURIComponent(campaignId);
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
