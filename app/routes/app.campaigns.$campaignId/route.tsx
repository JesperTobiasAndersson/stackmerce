import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  Form,
  Link,
  redirect,
  useActionData,
  useLoaderData,
  useLocation,
  useNavigation,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useEffect, useState } from "react";

import styles from "../../components/campaign-form.module.css";
import {
  CampaignForm,
  type ResourceSearchData,
} from "../../components/campaign-form";
import { getCurrentPlan } from "../../billing.server";
import type { CampaignConfig } from "../../campaign-config";
import {
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
import {
  entitlementForPlan,
  validateCampaignEntitlements,
  type AppPlan,
} from "../../entitlements";
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
  listCollections,
  listMarkets,
  listProducts,
  listShippingMethods,
} from "../../shopify-api.server";
import { authenticate } from "../../shopify.server";

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
  const url = new URL(request.url);
  const resource = url.searchParams.get("resource");
  const query = String(url.searchParams.get("query") || "").trim();

  if (resource === "products") {
    const products =
      query.length < 2 ? [] : (await listProducts(admin, { first: 20, query })).nodes;

    return { resource, products } satisfies ResourceSearchData;
  }

  if (resource === "collections") {
    const collections =
      query.length < 2
        ? []
        : (await listCollections(admin, { first: 20, query })).nodes;

    return { resource, collections } satisfies ResourceSearchData;
  }

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
      return redirect("/app/campaigns?saved=deleted");
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

  return redirect("/app/campaigns?saved=updated");
};

export default function CampaignEdit() {
  const data = useLoaderData<typeof loader>() as CampaignEditLoaderData;
  const entitlements = entitlementForPlan(data.plan);
  const actionData = useActionData<typeof action>();
  const location = useLocation();
  const navigation = useNavigation();
  const [deleteConfirmationOpen, setDeleteConfirmationOpen] = useState(false);
  const isDeleting =
    navigation.state === "submitting" &&
    String(navigation.formData?.get("_action") || "") === "delete";
  const isSaving = navigation.state === "submitting" && !isDeleting;

  useEffect(() => {
    if (isDeleting) {
      setDeleteConfirmationOpen(false);
    }
  }, [isDeleting]);

  return (
    <s-page heading={`Edit ${data.campaign.name}`}>
      <s-section>
        <Link
          className={styles.backButton}
          to={{ pathname: "/app/campaigns", search: location.search }}
        >
          &lt; Back to discounts
        </Link>

        <div className={styles.pageHeader}>
          <h1 className={styles.pageTitle}>Edit discount</h1>
          <p className={styles.sectionDescription}>
            Update product, order, and shipping discounts with optional
            conditions and schedules.
          </p>
          <p className={styles.planNotice}>
            Current plan: {entitlements.name} ({entitlements.priceLabel})
          </p>
        </div>

        <CampaignForm
          activeCampaignCount={data.activeCampaignCount}
          availableCurrencies={data.availableCurrencies}
          defaultCurrency={data.defaultCurrency}
          errors={actionData?.errors ?? []}
          initialExcludedCollections={data.excludedCollections}
          initialExcludedProducts={data.excludedProducts}
          initialSelectedCollections={data.selectedCollections}
          initialSelectedProducts={data.selectedProducts}
          initialValues={data.initialValues}
          isSaving={isSaving}
          markets={data.markets}
          mode="edit"
          plan={data.plan}
          secondaryActions={
            <button
              className={styles.deleteButton}
              onClick={() => setDeleteConfirmationOpen(true)}
              type="button"
            >
              Delete discount
            </button>
          }
          shippingMethods={data.shippingMethods}
          submitLabel="Save changes"
        />

        {deleteConfirmationOpen ? (
          <div
            aria-labelledby="delete-campaign-title"
            aria-modal="true"
            className={styles.modalBackdrop}
            role="dialog"
          >
            <div className={styles.modal}>
              <div className={styles.modalHeader}>
                <h2 className={styles.modalTitle} id="delete-campaign-title">
                  Delete discount?
                </h2>
                <button
                  aria-label="Close delete confirmation"
                  className={styles.modalClose}
                  disabled={isDeleting}
                  onClick={() => setDeleteConfirmationOpen(false)}
                  type="button"
                >
                  ×
                </button>
              </div>
              <p className={styles.modalText}>
                This will permanently delete &quot;{data.campaign.name}&quot;. This
                action cannot be undone.
              </p>
              <div className={styles.modalActions}>
                <button
                  className={styles.secondaryButton}
                  disabled={isDeleting}
                  onClick={() => setDeleteConfirmationOpen(false)}
                  type="button"
                >
                  Cancel
                </button>
                <Form method="post">
                  <input name="_action" type="hidden" value="delete" />
                  <button
                    className={styles.dangerButton}
                    disabled={isDeleting}
                    type="submit"
                  >
                    {isDeleting ? "Deleting..." : "Delete discount"}
                  </button>
                </Form>
              </div>
            </div>
          </div>
        ) : null}
      </s-section>
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
