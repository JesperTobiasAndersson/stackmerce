import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
  useRouteError,
  useSearchParams,
  useSubmit,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useEffect } from "react";

import { getBillingSummary, isBillingTest, planCacheKey } from "../billing.server";
import {
  entitlementForPlan,
  formatCampaignLimit,
  PAID_PLAN_TRIAL_DAYS,
  PLAN_ENTITLEMENTS,
  type AppPlan,
} from "../entitlements";
import { loadActiveCampaignCount } from "../campaign-storage.server";
import { flag, showToast } from "../lib/polaris";
import { invalidateRuntimeCache } from "../runtime-cache.server";
import { authenticate, ENTERPRISE_PLAN, PRO_PLAN } from "../shopify.server";

type BillingPlan = Exclude<AppPlan, "free">;

type PlansLoaderData = {
  currentPlan: AppPlan;
  billingTest: boolean;
  /** Pre-formatted on the server so SSR and the client agree on the day. */
  trialEndsLabel: string | null;
  nextChargeLabel: string | null;
  activeCampaignCount: number;
  approved: boolean;
};

const SHOPIFY_BILLING_PLANS: Record<
  BillingPlan,
  typeof PRO_PLAN | typeof ENTERPRISE_PLAN
> = {
  pro: PRO_PLAN,
  enterprise: ENTERPRISE_PLAN,
};

const DOWNGRADE_MODAL_ID = "downgrade-modal";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  // Shopify appends charge_id when it sends the merchant back from the
  // subscription approval page; that request must not be served from cache.
  const approved =
    url.searchParams.has("charge_id") ||
    url.searchParams.get("billing") === "approved";
  const [billing, activeCampaignCount] = await Promise.all([
    getBillingSummary(admin, session.shop, { fresh: approved }),
    loadActiveCampaignCount(admin),
  ]);

  return {
    currentPlan: billing.plan,
    billingTest: isBillingTest(),
    trialEndsLabel: billing.subscription?.trialEndsAt
      ? formatDate(billing.subscription.trialEndsAt)
      : null,
    nextChargeLabel:
      billing.subscription?.currentPeriodEnd && !billing.subscription.trialEndsAt
        ? formatDate(billing.subscription.currentPeriodEnd)
        : null,
    activeCampaignCount,
    approved,
  } satisfies PlansLoaderData;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, billing, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const requestedPlan = String(formData.get("plan") || "") as AppPlan;
  const { plan: currentPlan } = await getBillingSummary(admin, session.shop);
  const billingTest = isBillingTest();

  if (!isSelectablePlan(requestedPlan)) {
    return { error: "Choose a valid plan." };
  }

  if (requestedPlan === currentPlan) {
    return redirect("/app/plans");
  }

  if (requestedPlan === "free") {
    try {
      const billingCheck = await billing.check({
        plans: [PRO_PLAN, ENTERPRISE_PLAN],
        isTest: billingTest,
      });
      const subscription = subscriptionForPlan(
        billingCheck.appSubscriptions,
        currentPlan,
      );

      if (!subscription?.id) {
        return {
          error:
            "Could not find an active subscription to cancel for the current plan.",
        };
      }

      await billing.cancel({
        subscriptionId: subscription.id,
        isTest: billingTest,
        prorate: true,
      });

      invalidateRuntimeCache(planCacheKey(session.shop));
    } catch (error) {
      return { error: billingErrorMessage(error) };
    }

    return redirect("/app/plans?billing=cancelled");
  }

  try {
    invalidateRuntimeCache(planCacheKey(session.shop));
    await billing.request({
      plan: SHOPIFY_BILLING_PLANS[requestedPlan],
      isTest: billingTest,
      // Bring the merchant back to this page (inside Shopify Admin) instead of
      // the app root so they see the confirmation and their new plan.
      returnUrl: embeddedPlansUrl(session.shop),
    });
  } catch (error) {
    if (error instanceof Response) {
      throw error;
    }

    return { error: billingErrorMessage(error) };
  }
};

export default function Plans() {
  const {
    currentPlan,
    billingTest,
    trialEndsLabel,
    nextChargeLabel,
    activeCampaignCount,
    approved,
  } = useLoaderData<typeof loader>() as PlansLoaderData;
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submit = useSubmit();
  const [searchParams] = useSearchParams();
  const billingStatus = searchParams.get("billing");
  const submittingPlan =
    navigation.state === "submitting"
      ? String(navigation.formData?.get("plan") || "")
      : "";
  const current = entitlementForPlan(currentPlan);
  const campaignsToDeactivate = Math.max(
    0,
    activeCampaignCount - PLAN_ENTITLEMENTS.free.maxActiveCampaigns,
  );

  useEffect(() => {
    if (approved) {
      showToast(`You are now on ${current.name}`);
    } else if (billingStatus === "cancelled") {
      showToast("Subscription cancelled");
    }
  }, [approved, billingStatus, current.name]);

  const choosePlan = (plan: AppPlan) => {
    submit({ plan }, { method: "post" });
  };

  return (
    <s-page heading="Plans">
      {billingTest ? (
        <s-banner heading="Billing is in test mode" tone="info">
          <s-paragraph>
            No real charges are made. Set SHOPIFY_BILLING_TEST=false in
            production when the app is ready for real charges.
          </s-paragraph>
        </s-banner>
      ) : null}

      {approved ? (
        <s-banner heading={`You are now on ${current.name}`} tone="success">
          <s-paragraph>
            {trialEndsLabel
              ? `Your free trial runs until ${trialEndsLabel}; you will not be charged before then.`
              : "All plan features are unlocked."}
          </s-paragraph>
        </s-banner>
      ) : billingStatus === "cancelled" ? (
        <s-banner heading="Subscription cancelled" tone="success">
          <s-paragraph>You are back on the Free plan.</s-paragraph>
        </s-banner>
      ) : null}

      {actionData?.error ? (
        <s-banner heading="Could not change plan" tone="critical">
          <s-paragraph>{actionData.error}</s-paragraph>
        </s-banner>
      ) : null}

      <s-section heading="Choose the right plan">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            Free keeps the basics available. Pro and Enterprise unlock the
            advanced discount types and targeting controls, and both start with
            a {PAID_PLAN_TRIAL_DAYS}-day free trial.
            {nextChargeLabel ? ` Your next charge is on ${nextChargeLabel}.` : ""}
          </s-paragraph>

          <s-grid gap="base" gridTemplateColumns="repeat(auto-fit, minmax(240px, 1fr))">
            {(Object.keys(PLAN_ENTITLEMENTS) as AppPlan[]).map((plan) => {
              const entitlements = PLAN_ENTITLEMENTS[plan];
              const isCurrentPlan = currentPlan === plan;
              const isSubmitting = submittingPlan === plan;
              const isPaid = plan !== "free";

              return (
                <s-box
                  background={isCurrentPlan ? "subdued" : "base"}
                  border="base"
                  borderRadius="base"
                  key={plan}
                  padding="base"
                >
                  <s-stack direction="block" gap="base">
                    <s-stack alignItems="center" direction="inline" gap="small" justifyContent="space-between">
                      <s-heading>{entitlements.name}</s-heading>
                      {isCurrentPlan ? (
                        <s-badge tone="success">Current plan</s-badge>
                      ) : isPaid && currentPlan === "free" ? (
                        <s-badge tone="info">{PAID_PLAN_TRIAL_DAYS}-day free trial</s-badge>
                      ) : null}
                    </s-stack>
                    <s-text color="subdued">{planDescriptions[plan]}</s-text>
                    <s-stack alignItems="baseline" direction="inline" gap="small-300">
                      <s-heading>{entitlements.priceLabel.replace("/month", "")}</s-heading>
                      <s-text color="subdued">/ month</s-text>
                    </s-stack>
                    {isPaid ? (
                      <s-text color="subdued">
                        Billed every 30 days through Shopify. Cancel any time.
                      </s-text>
                    ) : null}
                    <s-unordered-list>
                      {planFeatures(plan).map((feature) => (
                        <s-list-item key={feature}>{feature}</s-list-item>
                      ))}
                    </s-unordered-list>
                    {isCurrentPlan ? (
                      <s-button disabled>Current plan</s-button>
                    ) : plan === "free" ? (
                      <s-button
                        command="--show"
                        commandFor={DOWNGRADE_MODAL_ID}
                        disabled={flag(Boolean(submittingPlan))}
                      >
                        Downgrade to Free
                      </s-button>
                    ) : (
                      <s-button
                        disabled={flag(Boolean(submittingPlan))}
                        loading={flag(isSubmitting)}
                        onClick={() => choosePlan(plan)}
                        variant="primary"
                      >
                        {currentPlan === "free"
                          ? `Start ${PAID_PLAN_TRIAL_DAYS}-day free trial`
                          : plan === "enterprise"
                            ? "Upgrade to Enterprise"
                            : "Switch to Pro"}
                      </s-button>
                    )}
                  </s-stack>
                </s-box>
              );
            })}
          </s-grid>
        </s-stack>
      </s-section>

      <s-modal heading="Downgrade to Free?" id={DOWNGRADE_MODAL_ID}>
        <s-stack direction="block" gap="base">
          <s-paragraph>
            Your {current.name} subscription is cancelled immediately and any
            unused time is credited by Shopify. On Free:
          </s-paragraph>
          <s-unordered-list>
            <s-list-item>
              Only {PLAN_ENTITLEMENTS.free.maxActiveCampaigns} discount can be active
              {campaignsToDeactivate > 0
                ? ` (you currently have ${activeCampaignCount} active; you will need to deactivate ${campaignsToDeactivate})`
                : ""}
              .
            </s-list-item>
            <s-list-item>
              Discounts using fixed amounts, BOGO, volume tiers, shipping
              discounts, market targeting, or scheduling keep running but cannot
              be edited until those settings are removed.
            </s-list-item>
          </s-unordered-list>
        </s-stack>
        <s-button
          command="--hide"
          commandFor={DOWNGRADE_MODAL_ID}
          loading={flag(submittingPlan === "free")}
          onClick={() => choosePlan("free")}
          slot="primary-action"
          tone="critical"
          variant="primary"
        >
          Downgrade to Free
        </s-button>
        <s-button command="--hide" commandFor={DOWNGRADE_MODAL_ID} slot="secondary-actions">
          Keep {current.name}
        </s-button>
      </s-modal>
    </s-page>
  );
}

function isSelectablePlan(plan: string): plan is AppPlan {
  return plan === "free" || plan === "pro" || plan === "enterprise";
}

type BillingSubscription = {
  id: string;
  name: string;
  status: string;
};

function subscriptionForPlan(
  subscriptions: BillingSubscription[],
  currentPlan: AppPlan,
) {
  const targetName = currentPlan === "enterprise" ? ENTERPRISE_PLAN : PRO_PLAN;

  return subscriptions.find(
    (subscription) =>
      subscription.status === "ACTIVE" &&
      subscription.name.toLowerCase() === targetName.toLowerCase(),
  );
}

/**
 * The Plans page as seen inside Shopify Admin. Shopify appends `charge_id`
 * when it redirects back after the merchant approves the subscription.
 */
function embeddedPlansUrl(shop: string) {
  const store = shop.replace(".myshopify.com", "");
  const apiKey = process.env.SHOPIFY_API_KEY || "";

  return `https://admin.shopify.com/store/${store}/apps/${apiKey}/app/plans?billing=approved`;
}

function billingErrorMessage(error: unknown) {
  const fallback =
    error instanceof Error ? error.message : "Could not start billing.";
  const errorData = hasErrorData(error) ? error.errorData : undefined;
  const details = Array.isArray(errorData)
    ? errorData
        .map((item) => {
          if (typeof item === "string") return item;
          if (item && typeof item === "object" && "message" in item) {
            return String(item.message);
          }
          return "";
        })
        .filter(Boolean)
        .join("; ")
    : "";

  return details ? `${fallback}: ${details}` : fallback;
}

function hasErrorData(error: unknown): error is { errorData: unknown } {
  return Boolean(error && typeof error === "object" && "errorData" in error);
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

const planDescriptions: Record<AppPlan, string> = {
  free: "For one simple automatic discount.",
  pro: "For stores that need advanced discount campaigns.",
  enterprise: "For high-volume stores that need no campaign cap.",
};

function planFeatures(plan: AppPlan) {
  const entitlements = PLAN_ENTITLEMENTS[plan];
  const campaignLimit = formatCampaignLimit(entitlements.maxActiveCampaigns);

  if (plan === "free") {
    return [
      `${campaignLimit} active discount`,
      "Percentage product and order discounts",
      "Product and collection include/exclude rules",
      "Minimum subtotal and quantity conditions",
    ];
  }

  if (plan === "pro") {
    return [
      `${campaignLimit} active discounts`,
      "Fixed amount discounts",
      "BOGO and volume tier discounts",
      "Shipping discounts and shipping method targeting",
      "Market targeting and scheduling",
    ];
  }

  return [
    `${campaignLimit} active discounts`,
    "All Pro features",
    "Priority support",
    "Best for larger catalogs and multiple campaigns",
  ];
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
