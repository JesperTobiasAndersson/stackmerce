import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useLocation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import { getBillingSummary } from "../billing.server";
import { loadAllCampaigns } from "../campaign-storage.server";
import {
  activeCampaignsOverLimit,
  countActiveCampaigns,
  entitlementForPlan,
  formatCampaignLimit,
  PAID_PLAN_TRIAL_DAYS,
  PLAN_ENTITLEMENTS,
  type AppPlan,
} from "../entitlements";
import { authenticate } from "../shopify.server";

type OverviewLoaderData = {
  plan: AppPlan;
  trialEndsLabel: string | null;
  totalCampaigns: number;
  activeCampaigns: number;
  overLimit: number;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const [billing, campaigns] = await Promise.all([
    getBillingSummary(admin, session.shop),
    loadAllCampaigns(admin).catch(() => []),
  ]);
  const activeCampaigns = countActiveCampaigns(campaigns);

  return {
    plan: billing.plan,
    trialEndsLabel: billing.subscription?.trialEndsAt
      ? new Date(billing.subscription.trialEndsAt).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          timeZone: "UTC",
        })
      : null,
    totalCampaigns: campaigns.length,
    activeCampaigns,
    overLimit: activeCampaignsOverLimit(billing.plan, activeCampaigns),
  } satisfies OverviewLoaderData;
};

export default function AppIndex() {
  const { plan, trialEndsLabel, totalCampaigns, activeCampaigns, overLimit } =
    useLoaderData<typeof loader>() as OverviewLoaderData;
  const entitlements = entitlementForPlan(plan);
  const { search } = useLocation();
  const link = (pathname: string) => `${pathname}${search}`;
  const hasCampaigns = totalCampaigns > 0;
  const drafts = totalCampaigns - activeCampaigns;

  return (
    <s-page heading="Overview">
      <s-button slot="primary-action" href={link("/app/campaigns/new")} variant="primary">
        Create discount
      </s-button>
      <s-button slot="secondary-actions" href={link("/app/campaigns")}>
        View discounts
      </s-button>

      {overLimit > 0 ? (
        <s-banner heading="More discounts are active than your plan includes" tone="warning">
          <s-paragraph>
            {entitlements.name} includes{" "}
            {formatCampaignLimit(entitlements.maxActiveCampaigns)} active discount
            {entitlements.maxActiveCampaigns === 1 ? "" : "s"}; {activeCampaigns} are
            active. Deactivate {overLimit} in{" "}
            <s-link href={link("/app/campaigns")}>Discounts</s-link> or{" "}
            <s-link href={link("/app/plans")}>upgrade your plan</s-link>.
          </s-paragraph>
        </s-banner>
      ) : null}

      <s-section heading="At a glance">
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))" gap="base">
          <MetricCard
            label="Active discounts"
            value={`${activeCampaigns} / ${formatCampaignLimit(entitlements.maxActiveCampaigns)}`}
            detail={
              activeCampaigns === 0
                ? "Nothing is discounting checkout right now."
                : "Applied automatically at checkout."
            }
          />
          <MetricCard
            label="Drafts"
            value={String(drafts)}
            detail="Saved but not applied. Activate them when ready."
          />
          <MetricCard
            label="Plan"
            value={entitlements.name}
            detail={
              trialEndsLabel
                ? `Free trial ends ${trialEndsLabel}.`
                : plan === "free"
                  ? `${PAID_PLAN_TRIAL_DAYS}-day free trial of Pro available.`
                  : entitlements.priceLabel
            }
          />
        </s-grid>
      </s-section>

      <s-section heading={hasCampaigns ? "Next steps" : "Get started"}>
        <s-stack direction="block" gap="base">
          <StepCard
            title={hasCampaigns ? "Create another discount" : "Create your first discount"}
            description="Percentage off products or the whole order, limited to the products, collections, and cart minimums you choose. Discounts apply automatically at checkout; customers never enter a code."
            href={link("/app/campaigns/new")}
            cta="Create discount"
          />
          <StepCard
            title="Review what is live"
            description={
              hasCampaigns
                ? `${activeCampaigns} of ${totalCampaigns} discount${
                    totalCampaigns === 1 ? "" : "s"
                  } active. Activate, pause, edit, or delete from one list.`
                : "Your discounts will show up in the Discounts list with their status once you create one."
            }
            href={link("/app/campaigns")}
            cta="Open discounts"
          />
          {plan === "free" ? (
            <StepCard
              title={`Try Pro free for ${PAID_PLAN_TRIAL_DAYS} days`}
              description={`Fixed amounts, Buy X get Y, volume tiers, shipping discounts, market targeting, scheduling, and up to ${formatCampaignLimit(
                PLAN_ENTITLEMENTS.pro.maxActiveCampaigns,
              )} active discounts. ${PLAN_ENTITLEMENTS.pro.priceLabel} after the trial, cancel any time.`}
              href={link("/app/plans")}
              cta="Start free trial"
            />
          ) : plan === "pro" ? (
            <StepCard
              title="Need more than 25 active discounts?"
              description="Enterprise removes the active discount cap and adds priority support."
              href={link("/app/plans")}
              cta="View plans"
            />
          ) : null}
        </s-stack>
      </s-section>
    </s-page>
  );
}

function MetricCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <s-box border="base" borderRadius="base" padding="base">
      <s-stack direction="block" gap="small-200">
        <s-text color="subdued">{label}</s-text>
        <s-heading>{value}</s-heading>
        <s-text color="subdued">{detail}</s-text>
      </s-stack>
    </s-box>
  );
}

function StepCard({
  title,
  description,
  href,
  cta,
}: {
  title: string;
  description: string;
  href: string;
  cta: string;
}) {
  return (
    <s-box border="base" borderRadius="base" padding="base">
      <s-grid gridTemplateColumns="1fr auto" gap="base" alignItems="center">
        <s-stack direction="block" gap="small-200">
          <s-text type="strong">{title}</s-text>
          <s-text color="subdued">{description}</s-text>
        </s-stack>
        <s-button href={href}>{cta}</s-button>
      </s-grid>
    </s-box>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
