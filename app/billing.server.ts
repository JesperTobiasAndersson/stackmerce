import type { AppPlan } from "./entitlements";
import { withRuntimeCache } from "./runtime-cache.server";

interface ShopifyAdminClient {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
}

interface ActiveSubscription {
  name?: string;
  status?: string;
  lineItems?: Array<{
    plan?: {
      pricingDetails?: {
        __typename?: string;
        price?: {
          amount?: string;
          currencyCode?: string;
        };
      };
    };
  }>;
}

interface BillingQueryResponse {
  data?: {
    currentAppInstallation?: {
      activeSubscriptions?: ActiveSubscription[];
    };
  };
}

const ACTIVE_SUBSCRIPTIONS_QUERY = `#graphql
  query ActiveAppSubscriptions {
    currentAppInstallation {
      activeSubscriptions {
        name
        status
        lineItems {
          plan {
            pricingDetails {
              __typename
              ... on AppRecurringPricing {
                price {
                  amount
                  currencyCode
                }
              }
            }
          }
        }
      }
    }
  }
`;

const PLAN_CACHE_TTL_MS = 60_000;

export async function getCurrentPlan(
  admin: ShopifyAdminClient,
  shop: string | null = null,
): Promise<AppPlan> {
  const overridePlan = planOverride();
  if (overridePlan) {
    return overridePlan;
  }

  try {
    return await withRuntimeCache(
      shop ? `plan:${shop}` : null,
      PLAN_CACHE_TTL_MS,
      async () => {
        const response = await admin.graphql(ACTIVE_SUBSCRIPTIONS_QUERY);
        const json = (await response.json()) as BillingQueryResponse;
        const activeSubscription =
          json.data?.currentAppInstallation?.activeSubscriptions?.find(
            (subscription) =>
              !subscription.status || subscription.status === "ACTIVE",
          );

        return planFromSubscription(activeSubscription);
      },
    );
  } catch {
    return "free";
  }
}

export function isBillingTest() {
  if (process.env.SHOPIFY_BILLING_TEST) {
    return process.env.SHOPIFY_BILLING_TEST.toLowerCase() === "true";
  }

  return process.env.NODE_ENV !== "production";
}

function planFromSubscription(subscription?: ActiveSubscription): AppPlan {
  if (!subscription) {
    return "free";
  }

  const normalizedName = String(subscription.name || "").toLowerCase();
  if (normalizedName.includes("enterprise")) {
    return "enterprise";
  }

  if (normalizedName.includes("pro")) {
    return "pro";
  }

  const recurringAmount = subscription.lineItems
    ?.map((lineItem) =>
      Number(lineItem.plan?.pricingDetails?.price?.amount ?? Number.NaN),
    )
    .find((amount) => Number.isFinite(amount) && amount > 0);

  if (recurringAmount && recurringAmount >= 39.9) {
    return "enterprise";
  }

  if (recurringAmount && recurringAmount > 0) {
    return "pro";
  }

  return "free";
}

function planOverride(): AppPlan | null {
  if (process.env.NODE_ENV === "production") {
    return null;
  }

  const value = process.env.APP_PLAN_OVERRIDE?.toLowerCase();

  return value === "free" || value === "pro" || value === "enterprise"
    ? value
    : null;
}
