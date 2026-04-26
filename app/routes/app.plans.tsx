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

import { getCurrentPlan, isBillingTest } from "../billing.server";
import {
  entitlementForPlan,
  formatCampaignLimit,
  PLAN_ENTITLEMENTS,
  type AppPlan,
} from "../entitlements";
import { invalidateRuntimeCache } from "../runtime-cache.server";
import { authenticate, ENTERPRISE_PLAN, PRO_PLAN } from "../shopify.server";
import styles from "./app.plans/styles.module.css";

type BillingPlan = Exclude<AppPlan, "free">;

type PlansLoaderData = {
  currentPlan: AppPlan;
  billingTest: boolean;
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
  const currentPlan = await getCurrentPlan(admin, session.shop);

  return {
    currentPlan,
    billingTest: isBillingTest(),
  } satisfies PlansLoaderData;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, billing, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const requestedPlan = String(formData.get("plan") || "") as AppPlan;
  const currentPlan = await getCurrentPlan(admin, session.shop);
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

      invalidateRuntimeCache(`plan:${session.shop}`);
    } catch (error) {
      return { error: billingErrorMessage(error) };
    }

    return redirect("/app/plans?billing=cancelled");
  }

  try {
    invalidateRuntimeCache(`plan:${session.shop}`);
    await billing.request({
      plan: SHOPIFY_BILLING_PLANS[requestedPlan],
      isTest: billingTest,
    });
  } catch (error) {
    if (error instanceof Response) {
      throw error;
    }

    return { error: billingErrorMessage(error) };
  }
};

export default function Plans() {
  const { currentPlan, billingTest } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();
  const billingStatus = searchParams.get("billing");
  const submittingPlan =
    navigation.state === "submitting"
      ? String(navigation.formData?.get("plan") || "")
      : "";

  return (
    <s-page heading="Plans">
      <s-section>
        <div className={styles.header}>
          <div>
            <span className={styles.eyebrow}>Billing</span>
            <h1 className={styles.title}>Choose the right plan</h1>
            <p className={styles.description}>
              Free keeps the basics available. Pro and Enterprise unlock the
              advanced discount types and targeting controls.
            </p>
          </div>
          <div className={styles.currentPlan}>
            <span>Current plan</span>
            <strong>{entitlementForPlan(currentPlan).name}</strong>
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

      {billingStatus === "approved" ? (
        <s-section>
          <div className={styles.success}>Plan approval completed.</div>
        </s-section>
      ) : billingStatus === "cancelled" ? (
        <s-section>
          <div className={styles.success}>Subscription cancelled.</div>
        </s-section>
      ) : null}

      {actionData?.error ? (
        <s-section>
          <div className={styles.error}>{actionData.error}</div>
        </s-section>
      ) : null}

      <s-section>
        <div className={styles.planGrid}>
          {(Object.keys(PLAN_ENTITLEMENTS) as AppPlan[]).map((plan) => {
            const entitlements = PLAN_ENTITLEMENTS[plan];
            const isCurrentPlan = currentPlan === plan;
            const isSubmitting = submittingPlan === plan;

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

                <div className={styles.price}>
                  <strong>{entitlements.priceLabel.replace("/month", "")}</strong>
                  <span>/ month</span>
                </div>

                <ul className={styles.featureList}>
                  {planFeatures(plan).map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>

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
                        : plan === "free"
                          ? "Downgrade to Free"
                          : `Upgrade to ${entitlements.name}`}
                  </button>
                </Form>
              </article>
            );
          })}
        </div>
      </s-section>
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
  const targetName =
    currentPlan === "enterprise" ? ENTERPRISE_PLAN : PRO_PLAN;

  return subscriptions.find(
    (subscription) =>
      subscription.status === "ACTIVE" &&
      subscription.name.toLowerCase() === targetName.toLowerCase(),
  );
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
      "Basic product and collection restrictions",
      "Community support",
    ];
  }

  if (plan === "pro") {
    return [
      `${campaignLimit} active discounts`,
      "Fixed amount discounts",
      "BOGO and volume tier discounts",
      "Shipping discounts and market targeting",
      "Scheduling",
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
