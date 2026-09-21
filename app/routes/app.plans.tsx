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

import { getBillingSummary, planCacheKey, shouldUseTestBilling } from "../billing.server";
import {
  entitlementForPlan,
  PAID_PLAN_TRIAL_DAYS,
  PLAN_ENTITLEMENTS,
  type AppPlan,
} from "../entitlements";
import { formatDate, resolveLocale, withLocale } from "../i18n";
import { useTranslation } from "../i18n/react";
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
const PLANS: AppPlan[] = ["free", "pro", "enterprise"];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const locale = resolveLocale(request);
  const url = new URL(request.url);
  // Shopify appends charge_id when it sends the merchant back from the
  // subscription approval page; that request must not be served from cache.
  const approved =
    url.searchParams.has("charge_id") ||
    url.searchParams.get("billing") === "approved";
  const [billing, activeCampaignCount, billingTest] = await Promise.all([
    getBillingSummary(admin, session.shop, { fresh: approved }),
    loadActiveCampaignCount(admin),
    shouldUseTestBilling(admin, session.shop),
  ]);

  return {
    currentPlan: billing.plan,
    billingTest,
    trialEndsLabel: billing.subscription?.trialEndsAt
      ? formatDate(locale, billing.subscription.trialEndsAt, true)
      : null,
    nextChargeLabel:
      billing.subscription?.currentPeriodEnd && !billing.subscription.trialEndsAt
        ? formatDate(locale, billing.subscription.currentPeriodEnd, true)
        : null,
    activeCampaignCount,
    approved,
  } satisfies PlansLoaderData;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, billing, session } = await authenticate.admin(request);
  const locale = resolveLocale(request);
  const formData = await request.formData();
  const requestedPlan = String(formData.get("plan") || "") as AppPlan;
  const [{ plan: currentPlan }, billingTest] = await Promise.all([
    getBillingSummary(admin, session.shop),
    shouldUseTestBilling(admin, session.shop),
  ]);

  if (!isSelectablePlan(requestedPlan)) {
    return { error: "Choose a valid plan." };
  }

  if (requestedPlan === currentPlan) {
    return redirect(withLocale("/app/plans", locale));
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

    return redirect(withLocale("/app/plans?billing=cancelled", locale));
  }

  try {
    invalidateRuntimeCache(planCacheKey(session.shop));
    await billing.request({
      plan: SHOPIFY_BILLING_PLANS[requestedPlan],
      isTest: billingTest,
      // Bring the merchant back to this page (inside Shopify Admin) instead of
      // the app root so they see the confirmation and their new plan.
      returnUrl: embeddedPlansUrl(session.shop, locale),
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
  const { t } = useTranslation();
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
      showToast(t("toast.planChanged", { plan: current.name }));
    } else if (billingStatus === "cancelled") {
      showToast(t("toast.cancelled"));
    }
  }, [approved, billingStatus, current.name, t]);

  const choosePlan = (plan: AppPlan) => {
    submit({ plan }, { method: "post" });
  };

  return (
    <s-page heading={t("plans.title")}>
      {billingTest ? (
        <s-banner heading={t("plans.testMode.heading")} tone="info">
          <s-paragraph>{t("plans.testMode.text")}</s-paragraph>
        </s-banner>
      ) : null}

      {approved ? (
        <s-banner heading={t("plans.approved.heading", { plan: current.name })} tone="success">
          <s-paragraph>
            {trialEndsLabel
              ? t("plans.approved.trial", { date: trialEndsLabel })
              : t("plans.approved.text")}
          </s-paragraph>
        </s-banner>
      ) : billingStatus === "cancelled" ? (
        <s-banner heading={t("plans.cancelled.heading")} tone="success">
          <s-paragraph>{t("plans.cancelled.text")}</s-paragraph>
        </s-banner>
      ) : null}

      {actionData?.error ? (
        <s-banner heading={t("plans.error.heading")} tone="critical">
          <s-paragraph>{actionData.error}</s-paragraph>
        </s-banner>
      ) : null}

      <s-section heading={t("plans.heading")}>
        <s-stack direction="block" gap="base">
          <s-paragraph>
            {t("plans.intro", { days: PAID_PLAN_TRIAL_DAYS })}
            {nextChargeLabel ? ` ${t("plans.nextCharge", { date: nextChargeLabel })}` : ""}
          </s-paragraph>

          <s-grid gap="base" gridTemplateColumns="repeat(auto-fit, minmax(240px, 1fr))">
            {PLANS.map((plan) => {
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
                    <s-stack
                      alignItems="center"
                      direction="inline"
                      gap="small"
                      justifyContent="space-between"
                    >
                      <s-heading>{entitlements.name}</s-heading>
                      {isCurrentPlan ? (
                        <s-badge tone="success">{t("plans.current")}</s-badge>
                      ) : isPaid && currentPlan === "free" ? (
                        <s-badge tone="info">
                          {t("plans.trialBadge", { days: PAID_PLAN_TRIAL_DAYS })}
                        </s-badge>
                      ) : null}
                    </s-stack>
                    <s-text color="subdued">{t(`plans.desc.${plan}`)}</s-text>
                    <s-stack alignItems="baseline" direction="inline" gap="small-300">
                      <s-heading>{entitlements.priceLabel.replace("/month", "")}</s-heading>
                      <s-text color="subdued">{t("plans.perMonth")}</s-text>
                    </s-stack>
                    {isPaid ? <s-text color="subdued">{t("plans.billedNote")}</s-text> : null}
                    {isCurrentPlan ? (
                      <s-button disabled>{t("plans.current")}</s-button>
                    ) : plan === "free" ? (
                      <s-button
                        command="--show"
                        commandFor={DOWNGRADE_MODAL_ID}
                        disabled={flag(Boolean(submittingPlan))}
                      >
                        {t("plans.downgrade")}
                      </s-button>
                    ) : (
                      <s-button
                        disabled={flag(Boolean(submittingPlan))}
                        loading={flag(isSubmitting)}
                        onClick={() => choosePlan(plan)}
                        variant="primary"
                      >
                        {currentPlan === "free"
                          ? t("common.startTrial", { days: PAID_PLAN_TRIAL_DAYS })
                          : plan === "enterprise"
                            ? t("plans.upgradeEnterprise")
                            : t("plans.switchPro")}
                      </s-button>
                    )}
                  </s-stack>
                </s-box>
              );
            })}
          </s-grid>
        </s-stack>
      </s-section>

      <s-section heading={t("plans.compare.heading")}>
        <s-table variant="auto">
          <s-table-header-row>
            <s-table-header listSlot="primary">{t("plans.compare.feature")}</s-table-header>
            {PLANS.map((plan) => (
              <s-table-header key={plan} listSlot="labeled">
                {PLAN_ENTITLEMENTS[plan].name}
              </s-table-header>
            ))}
          </s-table-header-row>
          <s-table-body>
            <s-table-row>
              <s-table-cell>{t("plans.compare.activeDiscounts")}</s-table-cell>
              {PLANS.map((plan) => (
                <s-table-cell key={plan}>
                  {Number.isFinite(PLAN_ENTITLEMENTS[plan].maxActiveCampaigns)
                    ? String(PLAN_ENTITLEMENTS[plan].maxActiveCampaigns)
                    : t("common.unlimited")}
                </s-table-cell>
              ))}
            </s-table-row>
            <FeatureRow label={t("plans.compare.percentage")} values={[true, true, true]} />
            <FeatureRow label={t("plans.compare.targeting")} values={[true, true, true]} />
            <FeatureRow label={t("plans.compare.minimums")} values={[true, true, true]} />
            <FeatureRow
              label={t("plans.compare.fixed")}
              values={PLANS.map((plan) => PLAN_ENTITLEMENTS[plan].fixedAmountDiscounts)}
            />
            <FeatureRow
              label={t("plans.compare.bogo")}
              values={PLANS.map((plan) => PLAN_ENTITLEMENTS[plan].bogoDiscounts)}
            />
            <FeatureRow
              label={t("plans.compare.shipping")}
              values={PLANS.map((plan) => PLAN_ENTITLEMENTS[plan].shippingDiscounts)}
            />
            <FeatureRow
              label={t("plans.compare.market")}
              values={PLANS.map((plan) => PLAN_ENTITLEMENTS[plan].marketTargeting)}
            />
            <FeatureRow
              label={t("plans.compare.scheduling")}
              values={PLANS.map((plan) => PLAN_ENTITLEMENTS[plan].scheduling)}
            />
            <FeatureRow
              label={t("plans.compare.support")}
              values={PLANS.map((plan) => PLAN_ENTITLEMENTS[plan].prioritySupport)}
            />
          </s-table-body>
        </s-table>
      </s-section>

      <s-modal heading={t("plans.downgradeModal.heading")} id={DOWNGRADE_MODAL_ID}>
        <s-stack direction="block" gap="base">
          <s-paragraph>{t("plans.downgradeModal.text", { plan: current.name })}</s-paragraph>
          <s-unordered-list>
            <s-list-item>
              {campaignsToDeactivate > 0
                ? t("plans.downgradeModal.limitOver", {
                    limit: PLAN_ENTITLEMENTS.free.maxActiveCampaigns,
                    active: activeCampaignCount,
                    over: campaignsToDeactivate,
                  })
                : t("plans.downgradeModal.limit", {
                    limit: PLAN_ENTITLEMENTS.free.maxActiveCampaigns,
                  })}
            </s-list-item>
            <s-list-item>{t("plans.downgradeModal.features")}</s-list-item>
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
          {t("plans.downgrade")}
        </s-button>
        <s-button command="--hide" commandFor={DOWNGRADE_MODAL_ID} slot="secondary-actions">
          {t("plans.keep", { plan: current.name })}
        </s-button>
      </s-modal>
    </s-page>
  );
}

function FeatureRow({ label, values }: { label: string; values: boolean[] }) {
  return (
    <s-table-row>
      <s-table-cell>{label}</s-table-cell>
      {values.map((included, index) => (
        <s-table-cell key={index}>
          {included ? <s-icon tone="success" type="check" /> : <s-icon tone="neutral" type="minus" />}
        </s-table-cell>
      ))}
    </s-table-row>
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
function embeddedPlansUrl(shop: string, locale: string) {
  const store = shop.replace(".myshopify.com", "");
  const apiKey = process.env.SHOPIFY_API_KEY || "";

  return `https://admin.shopify.com/store/${store}/apps/${apiKey}/app/plans?billing=approved&locale=${locale}`;
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

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
