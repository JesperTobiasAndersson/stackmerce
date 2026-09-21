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
import { formatDate, resolveLocale } from "../i18n";
import { useTranslation } from "../i18n/react";
import { authenticate } from "../shopify.server";

type OverviewLoaderData = {
  plan: AppPlan;
  trialEndsLabel: string | null;
  totalCampaigns: number;
  activeCampaigns: number;
  overLimit: number;
  storefrontUrl: string;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const locale = resolveLocale(request);
  const [billing, campaigns] = await Promise.all([
    getBillingSummary(admin, session.shop),
    loadAllCampaigns(admin).catch(() => []),
  ]);
  const activeCampaigns = countActiveCampaigns(campaigns);

  return {
    plan: billing.plan,
    trialEndsLabel: billing.subscription?.trialEndsAt
      ? formatDate(locale, billing.subscription.trialEndsAt)
      : null,
    totalCampaigns: campaigns.length,
    activeCampaigns,
    overLimit: activeCampaignsOverLimit(billing.plan, activeCampaigns),
    storefrontUrl: `https://${session.shop}`,
  } satisfies OverviewLoaderData;
};

export default function AppIndex() {
  const { plan, trialEndsLabel, totalCampaigns, activeCampaigns, overLimit, storefrontUrl } =
    useLoaderData<typeof loader>() as OverviewLoaderData;
  const { t } = useTranslation();
  const entitlements = entitlementForPlan(plan);
  const { search } = useLocation();
  const link = (pathname: string) => `${pathname}${search}`;
  const hasCampaigns = totalCampaigns > 0;
  const hasActive = activeCampaigns > 0;
  const drafts = totalCampaigns - activeCampaigns;
  const setupComplete = hasCampaigns && hasActive;

  return (
    <s-page heading={t("overview.title")}>
      <s-button slot="primary-action" href={link("/app/campaigns/new")} variant="primary">
        {t("common.createDiscount")}
      </s-button>
      <s-button slot="secondary-actions" href={link("/app/campaigns")}>
        {t("common.viewDiscounts")}
      </s-button>

      {overLimit > 0 ? (
        <s-banner heading={t("overview.overLimit.heading")} tone="warning">
          <s-paragraph>
            {t("overview.overLimit.text", {
              plan: entitlements.name,
              limit: formatCampaignLimit(entitlements.maxActiveCampaigns),
              active: activeCampaigns,
              over: overLimit,
            })}{" "}
            <s-link href={link("/app/plans")}>{t("common.viewPlans")}</s-link>
          </s-paragraph>
        </s-banner>
      ) : null}

      {!setupComplete ? (
        <s-section heading={t("overview.setup.heading")}>
          <s-stack direction="block" gap="base">
            <s-text color="subdued">{t("overview.setup.intro")}</s-text>
            <SetupStep
              cta={t("common.createDiscount")}
              done={hasCampaigns}
              href={link("/app/campaigns/new")}
              step={1}
              t={t}
              text={t("overview.setup.step1.text")}
              title={t("overview.setup.step1.title")}
            />
            <SetupStep
              cta={t("overview.setup.step2.cta")}
              done={hasActive}
              href={link("/app/campaigns")}
              step={2}
              t={t}
              text={t("overview.setup.step2.text")}
              title={t("overview.setup.step2.title")}
            />
            <SetupStep
              cta={t("overview.setup.step3.cta")}
              done={false}
              external
              href={storefrontUrl}
              step={3}
              t={t}
              text={t("overview.setup.step3.text")}
              title={t("overview.setup.step3.title")}
            />
          </s-stack>
        </s-section>
      ) : null}

      <s-section heading={t("overview.atAGlance")}>
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))" gap="base">
          <MetricCard
            label={t("overview.metric.active")}
            value={`${activeCampaigns} / ${formatCampaignLimit(entitlements.maxActiveCampaigns)}`}
            detail={hasActive ? t("overview.metric.activeSome") : t("overview.metric.activeNone")}
          />
          <MetricCard
            label={t("overview.metric.drafts")}
            value={String(drafts)}
            detail={t("overview.metric.draftsDetail")}
          />
          <MetricCard
            label={t("overview.metric.plan")}
            value={entitlements.name}
            detail={
              trialEndsLabel
                ? t("overview.metric.trialEnds", { date: trialEndsLabel })
                : plan === "free"
                  ? t("overview.metric.trialAvailable", { days: PAID_PLAN_TRIAL_DAYS })
                  : entitlements.priceLabel
            }
          />
        </s-grid>
      </s-section>

      {setupComplete ? (
        <s-section heading={t("overview.next.heading")}>
          <s-stack direction="block" gap="base">
            <StepCard
              cta={t("common.createDiscount")}
              href={link("/app/campaigns/new")}
              text={t("overview.next.create.text")}
              title={t("overview.next.create.title")}
            />
            <StepCard
              cta={t("overview.next.manage.cta")}
              href={link("/app/campaigns")}
              text={t("overview.next.manage.text", {
                active: activeCampaigns,
                total: totalCampaigns,
              })}
              title={t("overview.next.manage.title")}
            />
            {plan === "free" ? (
              <StepCard
                cta={t("common.startTrial", { days: PAID_PLAN_TRIAL_DAYS })}
                href={link("/app/plans")}
                text={t("overview.next.pro.text", {
                  limit: formatCampaignLimit(PLAN_ENTITLEMENTS.pro.maxActiveCampaigns),
                  price: PLAN_ENTITLEMENTS.pro.priceLabel,
                })}
                title={t("overview.next.pro.title", { days: PAID_PLAN_TRIAL_DAYS })}
              />
            ) : plan === "pro" ? (
              <StepCard
                cta={t("common.viewPlans")}
                href={link("/app/plans")}
                text={t("overview.next.enterprise.text")}
                title={t("overview.next.enterprise.title", {
                  limit: formatCampaignLimit(PLAN_ENTITLEMENTS.pro.maxActiveCampaigns),
                })}
              />
            ) : null}
          </s-stack>
        </s-section>
      ) : null}
    </s-page>
  );
}

function SetupStep({
  cta,
  done,
  external = false,
  href,
  step,
  t,
  text,
  title,
}: {
  cta: string;
  done: boolean;
  external?: boolean;
  href: string;
  step: number;
  t: ReturnType<typeof useTranslation>["t"];
  text: string;
  title: string;
}) {
  return (
    <s-box border="base" borderRadius="base" padding="base">
      <s-grid alignItems="center" gap="base" gridTemplateColumns="auto 1fr auto">
        <s-badge icon={done ? "check-circle" : undefined} tone={done ? "success" : "neutral"}>
          {done ? t("overview.setup.done") : String(step)}
        </s-badge>
        <s-stack direction="block" gap="small-200">
          <s-text type="strong">{title}</s-text>
          <s-text color="subdued">{text}</s-text>
        </s-stack>
        {done ? null : (
          <s-button href={href} target={external ? "_blank" : undefined}>
            {cta}
          </s-button>
        )}
      </s-grid>
    </s-box>
  );
}

function MetricCard({ label, value, detail }: { label: string; value: string; detail: string }) {
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
  cta,
  href,
  text,
  title,
}: {
  cta: string;
  href: string;
  text: string;
  title: string;
}) {
  return (
    <s-box border="base" borderRadius="base" padding="base">
      <s-grid alignItems="center" gap="base" gridTemplateColumns="1fr auto">
        <s-stack direction="block" gap="small-200">
          <s-text type="strong">{title}</s-text>
          <s-text color="subdued">{text}</s-text>
        </s-stack>
        <s-button href={href}>{cta}</s-button>
      </s-grid>
    </s-box>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
