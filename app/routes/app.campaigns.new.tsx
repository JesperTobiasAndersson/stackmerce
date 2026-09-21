import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  Link,
  redirect,
  useActionData,
  useLoaderData,
  useLocation,
  useNavigation,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import styles from "../components/campaign-form.module.css";
import {
  CampaignForm,
  emptyCampaignFormInput,
  type ResourceSearchData,
} from "../components/campaign-form";
import { getCurrentPlan } from "../billing.server";
import {
  campaignInputFromForm,
  validateCampaignInput,
} from "../campaign-form.server";
import {
  loadActiveCampaignCount,
  saveNewCampaign,
} from "../campaign-storage.server";
import {
  entitlementForPlan,
  validateCampaignEntitlements,
  type AppPlan,
} from "../entitlements";
import type {
  ShopifyMarketSummary,
  ShopifyShippingMethodSummary,
} from "../shopify-api.server";
import {
  getCurrencyInfo,
  listCollections,
  listMarkets,
  listProducts,
  listShippingMethods,
} from "../shopify-api.server";
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
  const formData = await request.formData();
  const campaign = campaignInputFromForm(formData);
  const [plan, activeCampaignCount] = await Promise.all([
    getCurrentPlan(admin, session.shop),
    loadActiveCampaignCount(admin),
  ]);
  const errors = [
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
      errors: [error instanceof Error ? error.message : "Could not save campaign."],
    };
  }

  return redirect("/app/campaigns?saved=created");
};

export default function NewCampaign() {
  const data = useLoaderData<typeof loader>() as NewCampaignLoaderData;
  const entitlements = entitlementForPlan(data.plan);
  const actionData = useActionData<typeof action>();
  const location = useLocation();
  const navigation = useNavigation();

  return (
    <s-page heading="Create discount">
      <s-section>
        <Link
          className={styles.backButton}
          to={{ pathname: "/app/campaigns", search: location.search }}
        >
          &lt; Back to discounts
        </Link>

        <div className={styles.pageHeader}>
          <h1 className={styles.pageTitle}>Create a new discount</h1>
          <p className={styles.sectionDescription}>
            Build product, order, and shipping discounts with optional conditions
            and schedules.
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
          initialValues={emptyCampaignFormInput()}
          isSaving={navigation.state === "submitting"}
          markets={data.markets}
          mode="create"
          plan={data.plan}
          shippingMethods={data.shippingMethods}
          submitLabel="Save discount"
        />
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
