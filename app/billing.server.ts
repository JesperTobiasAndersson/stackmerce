import type { AppPlan } from "./entitlements";
import { invalidateRuntimeCache, withRuntimeCache } from "./runtime-cache.server";

interface ShopifyAdminClient {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
}

interface ActiveSubscription {
  id?: string;
  name?: string;
  status?: string;
  test?: boolean;
  trialDays?: number;
  createdAt?: string;
  currentPeriodEnd?: string | null;
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

export interface BillingSummary {
  plan: AppPlan;
  subscription: {
    id: string;
    name: string;
    isTest: boolean;
    /** ISO date the free trial ends, or null when there is no trial running. */
    trialEndsAt: string | null;
    /** ISO date of the next charge (end of the current billing period). */
    currentPeriodEnd: string | null;
  } | null;
}

const ACTIVE_SUBSCRIPTIONS_QUERY = `#graphql
  query ActiveAppSubscriptions {
    currentAppInstallation {
      activeSubscriptions {
        id
        name
        status
        test
        trialDays
        createdAt
        currentPeriodEnd
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

const SHOP_PLAN_QUERY = `#graphql
  query ShopPlanType {
    shop {
      plan {
        partnerDevelopment
      }
    }
  }
`;

const PLAN_CACHE_TTL_MS = 60_000;
const SHOP_TYPE_CACHE_TTL_MS = 10 * 60_000;

const FREE_SUMMARY: BillingSummary = { plan: "free", subscription: null };

export interface BillingLookupOptions {
  /**
   * Skip the cached plan and ask Shopify again. Use on the request that
   * returns from Shopify's subscription approval page, otherwise the merchant
   * can land on a page that still shows the old plan for up to a minute.
   */
  fresh?: boolean;
}

export async function getBillingSummary(
  admin: ShopifyAdminClient,
  shop: string | null = null,
  { fresh = false }: BillingLookupOptions = {},
): Promise<BillingSummary> {
  const overridePlan = planOverride();
  if (overridePlan) {
    return { plan: overridePlan, subscription: null };
  }

  const cacheKey = shop ? planCacheKey(shop) : null;
  if (fresh && cacheKey) {
    invalidateRuntimeCache(cacheKey);
  }

  try {
    return await withRuntimeCache(cacheKey, PLAN_CACHE_TTL_MS, async () => {
      const response = await admin.graphql(ACTIVE_SUBSCRIPTIONS_QUERY);
      const json = (await response.json()) as BillingQueryResponse;
      const activeSubscription =
        json.data?.currentAppInstallation?.activeSubscriptions?.find(
          (subscription) =>
            !subscription.status || subscription.status === "ACTIVE",
        );

      return summaryFromSubscription(activeSubscription);
    });
  } catch {
    return FREE_SUMMARY;
  }
}

export async function getCurrentPlan(
  admin: ShopifyAdminClient,
  shop: string | null = null,
  options: BillingLookupOptions = {},
): Promise<AppPlan> {
  return (await getBillingSummary(admin, shop, options)).plan;
}

/**
 * Development stores cannot approve real app charges, and Shopify's reviewers
 * install from a development store in another Partner organization. Charges
 * on such stores must be test charges or the upgrade flow fails for them.
 */
export async function isDevelopmentStore(
  admin: ShopifyAdminClient,
  shop: string,
): Promise<boolean> {
  try {
    return await withRuntimeCache(`shop-type:${shop}`, SHOP_TYPE_CACHE_TTL_MS, async () => {
      const response = await admin.graphql(SHOP_PLAN_QUERY);
      const json = (await response.json()) as {
        data?: { shop?: { plan?: { partnerDevelopment?: boolean } } };
      };

      return Boolean(json.data?.shop?.plan?.partnerDevelopment);
    });
  } catch {
    return false;
  }
}

/** Test charges in non-production environments and on development stores. */
export async function shouldUseTestBilling(admin: ShopifyAdminClient, shop: string) {
  return isBillingTest() || (await isDevelopmentStore(admin, shop));
}

export function planCacheKey(shop: string) {
  return `plan:${shop}`;
}

export function isBillingTest() {
  if (process.env.SHOPIFY_BILLING_TEST) {
    return process.env.SHOPIFY_BILLING_TEST.toLowerCase() === "true";
  }

  return process.env.NODE_ENV !== "production";
}

function summaryFromSubscription(
  subscription?: ActiveSubscription,
): BillingSummary {
  const plan = planFromSubscription(subscription);

  if (!subscription || plan === "free") {
    return FREE_SUMMARY;
  }

  return {
    plan,
    subscription: {
      id: subscription.id ?? "",
      name: subscription.name ?? "",
      isTest: Boolean(subscription.test),
      trialEndsAt: trialEndsAt(subscription),
      currentPeriodEnd: subscription.currentPeriodEnd ?? null,
    },
  };
}

function trialEndsAt(subscription: ActiveSubscription) {
  const trialDays = Number(subscription.trialDays ?? 0);
  const createdAt = Date.parse(subscription.createdAt ?? "");

  if (!trialDays || Number.isNaN(createdAt)) {
    return null;
  }

  const endsAt = createdAt + trialDays * 24 * 60 * 60 * 1000;

  return endsAt > Date.now() ? new Date(endsAt).toISOString() : null;
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
