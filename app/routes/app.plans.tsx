import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  Form,
  redirect,
  useActionData,
  useLoaderData,
  useNavigation,
  useRouteError,
  useSearchParams,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useState } from "react";

import {
  getBillingSummary,
  isBillingTest,
  planCacheKey,
} from "../billing.server";
import {
  entitlementForPlan,
  formatCampaignLimit,
  PAID_PLAN_TRIAL_DAYS,
  PLAN_ENTITLEMENTS,
  type AppPlan,
} from "../entitlements";
import { loadActiveCampaignCount } from "../campaign-storage.server";
import { invalidateRuntimeCache } from "../runtime-cache.server";
import { authenticate, ENTERPRISE_PLAN, PRO_PLAN } from "../shopify.server";
import styles from "./app.plans/styles.module.css";

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
  const [searchParams] = useSearchParams();
  const [confirmDowngrade, setConfirmDowngrade] = useState(false);
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

  return (
    <s-page heading="Plans">
      <s-section>
        <div className={styles.header}>
          <div>
            <span className={styles.eyebrow}>Billing</span>
            <h1 className={styles.title}>Choose the right plan</h1>
            <p className={styles.description}>
              Free keeps the basics available. Pro and Enterprise unlock the
              advanced discount types and targeting controls, and both start
              with a {PAID_PLAN_TRIAL_DAYS}-day free trial.
            </p>
          </div>
          <div className={styles.currentPlan}>
            <span>Current plan</span>
            <strong>{current.name}</strong>
            {trialEndsLabel ? (
              <span className={styles.currentPlanMeta}>
                Free trial ends {trialEndsLabel}
              </span>
            ) : nextChargeLabel ? (
              <span className={styles.currentPlanMeta}>
                Next charge {nextChargeLabel}
              </span>
            ) : null}
          </div>
        </div>
      </s-section>

      {billingTest ? (
        <s-section>
          <div className={styles.notice}>
            Billing is running in test mode. Set{" "}
            <code>SHOPIFY_BILLING_TEST=false</code> in production when the app
            is ready for real charges.
          </div>
        </s-section>
      ) : null}

      {approved ? (
        <s-section>
          <div className={styles.success} role="status">
            You are now on {current.name}.{" "}
            {trialEndsLabel
              ? `Your free trial runs until ${trialEndsLabel}; you will not be charged before then.`
              : "All plan features are unlocked."}
          </div>
        </s-section>
      ) : billingStatus === "cancelled" ? (
        <s-section>
          <div className={styles.success} role="status">
            Subscription cancelled. You are back on the Free plan.
          </div>
        </s-section>
      ) : null}

      {actionData?.error ? (
        <s-section>
          <div className={styles.error} role="alert">
            {actionData.error}
          </div>
        </s-section>
      ) : null}

      <s-section>
        <div className={styles.planGrid}>
          {(Object.keys(PLAN_ENTITLEMENTS) as AppPlan[]).map((plan) => {
            const entitlements = PLAN_ENTITLEMENTS[plan];
            const isCurrentPlan = currentPlan === plan;
            const isSubmitting = submittingPlan === plan;
            const isPaid = plan !== "free";
            const isDowngrade = plan === "free";

            return (
              <article
                className={
                  isCurrentPlan
                    ? `${styles.planCard} ${styles.planCardCurrent}`
                    : styles.planCard
                }
                key={plan}
              >
                <div className={styles.planCardHeader}>
                  <div>
                    <h2>{entitlements.name}</h2>
                    <p>{planDescriptions[plan]}</p>
                  </div>
                  {isCurrentPlan ? (
                    <span className={styles.currentBadge}>Active</span>
                  ) : null}
                </div>

                {isPaid && !isCurrentPlan && currentPlan === "free" ? (
                  <span className={styles.trialBadge}>
                    {PAID_PLAN_TRIAL_DAYS}-day free trial
                  </span>
                ) : null}

                <div className={styles.price}>
                  <strong>{entitlements.priceLabel.replace("/month", "")}</strong>
                  <span>/ month</span>
                </div>
                {isPaid ? (
                  <p className={styles.priceNote}>
                    Billed every 30 days through Shopify. Cancel any time.
                  </p>
                ) : null}

                <ul className={styles.featureList}>
                  {planFeatures(plan).map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>

                {isDowngrade && !isCurrentPlan ? (
                  <button
                    className={styles.secondaryButton}
                    disabled={Boolean(submittingPlan)}
                    onClick={() => setConfirmDowngrade(true)}
                    type="button"
                  >
                    {isSubmitting ? "Cancelling..." : "Downgrade to Free"}
                  </button>
                ) : (
                  <Form method="post">
                    <input name="plan" type="hidden" value={plan} />
                    <button
                      className={
                        isCurrentPlan
                          ? styles.secondaryButton
                          : styles.primaryButton
                      }
                      disabled={isCurrentPlan || Boolean(submittingPlan)}
                      type="submit"
                    >
                      {isCurrentPlan
                        ? "Current plan"
                        : isSubmitting
                          ? "Opening Shopify..."
                          : currentPlan === "free"
                            ? `Start ${PAID_PLAN_TRIAL_DAYS}-day free trial`
                            : plan === "enterprise"
                              ? "Upgrade to Enterprise"
                              : "Switch to Pro"}
                    </button>
                  </Form>
                )}
              </article>
            );
          })}
        </div>
      </s-section>

      {confirmDowngrade ? (
        <div
          aria-labelledby="downgrade-title"
          aria-modal="true"
          className={styles.modalBackdrop}
          role="dialog"
        >
          <div className={styles.modal}>
            <h2 id="downgrade-title">Downgrade to Free?</h2>
            <p>
              Your {current.name} subscription is cancelled immediately and any
              unused time is credited by Shopify. On Free:
            </p>
            <ul>
              <li>
                Only {PLAN_ENTITLEMENTS.free.maxActiveCampaigns} discount can be
                active
                {campaignsToDeactivate > 0
                  ? ` (you currently have ${activeCampaignCount} active; you will need to deactivate ${campaignsToDeactivate})`
                  : ""}
                .
              </li>
              <li>
                Discounts using fixed amounts, BOGO, volume tiers, shipping
                discounts, market targeting, or scheduling keep running but
                cannot be edited until those settings are removed.
              </li>
            </ul>
            <div className={styles.modalActions}>
              <button
                className={styles.secondaryButton}
                disabled={Boolean(submittingPlan)}
                onClick={() => setConfirmDowngrade(false)}
                type="button"
              >
                Keep {current.name}
              </button>
              <Form method="post">
                <input name="plan" type="hidden" value="free" />
                <button
                  className={styles.dangerButton}
                  disabled={Boolean(submittingPlan)}
                  type="submit"
                >
                  {submittingPlan === "free" ? "Cancelling..." : "Downgrade to Free"}
                </button>
              </Form>
            </div>
          </div>
        </div>
      ) : null}
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
