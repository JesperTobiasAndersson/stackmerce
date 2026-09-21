import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData, useLocation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";

import styles from "./app._index/styles.module.css";
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
  const location = useLocation();
  const link = (pathname: string) => ({ pathname, search: location.search });
  const hasCampaigns = totalCampaigns > 0;

  const summaryItems = [
    {
      label: "Active discounts",
      value: `${activeCampaigns} / ${formatCampaignLimit(entitlements.maxActiveCampaigns)}`,
      description:
        overLimit > 0
          ? `${overLimit} more than ${entitlements.name} includes. Deactivate or upgrade.`
          : activeCampaigns === 0
            ? "Nothing is discounting checkout right now."
            : "Applied automatically at checkout.",
    },
    {
      label: "Drafts",
      value: String(totalCampaigns - activeCampaigns),
      description: "Saved but not applied. Activate them when ready.",
    },
    {
      label: "Plan",
      value: entitlements.name,
      description: trialEndsLabel
        ? `Free trial ends ${trialEndsLabel}.`
        : plan === "free"
          ? `Pro adds fixed amounts, BOGO, volume tiers, shipping, markets, and scheduling. ${PAID_PLAN_TRIAL_DAYS}-day free trial.`
          : entitlements.priceLabel,
    },
  ];

  const launchItems = [
    {
      eyebrow: hasCampaigns ? "Create" : "Start here",
      title: hasCampaigns ? "Create another discount" : "Create your first discount",
      description:
        "Percentage off products or the whole order, limited to the products, collections, and cart minimums you choose.",
      href: "/app/campaigns/new",
      cta: "Create discount",
    },
    {
      eyebrow: "Manage",
      title: "Review what is live",
      description: hasCampaigns
        ? `${activeCampaigns} of ${totalCampaigns} discount${
            totalCampaigns === 1 ? "" : "s"
          } active. Activate, pause, edit, or delete from one list.`
        : "Your discounts will show up here with their status once you create one.",
      href: "/app/campaigns",
      cta: "Open discounts",
    },
    {
      eyebrow: plan === "free" ? "Upgrade" : "Plan",
      title:
        plan === "free"
          ? "Try Pro free for 7 days"
          : plan === "pro"
            ? "Need more than 25 active discounts?"
            : "Manage your subscription",
      description:
        plan === "free"
          ? `Fixed amounts, Buy X get Y, volume tiers, shipping discounts, market targeting, scheduling, and up to ${formatCampaignLimit(
              PLAN_ENTITLEMENTS.pro.maxActiveCampaigns,
            )} active discounts.`
          : plan === "pro"
            ? "Enterprise removes the active discount cap and adds priority support."
            : "You are on Enterprise with unlimited active discounts.",
      href: "/app/plans",
      cta: plan === "free" ? "Start free trial" : "View plans",
    },
  ];

  return (
    <s-page heading="Overview">
      <s-section>
        <div className={styles.header}>
          <div>
            <span className={styles.eyebrow}>Discount operations</span>
            <h1 className={styles.title}>
              {hasCampaigns
                ? "Your automatic discounts at a glance"
                : "Start building discounts inside Shopify Admin"}
            </h1>
            <p className={styles.description}>
              Discounts are applied automatically at checkout by a Shopify
              Function, so there are no codes for customers to enter.
            </p>
          </div>
          <div className={styles.headerActions}>
            <Link className={styles.primaryAction} to={link("/app/campaigns/new")}>
              Create discount
            </Link>
            <Link className={styles.secondaryAction} to={link("/app/campaigns")}>
              Browse discounts
            </Link>
          </div>
        </div>
      </s-section>

      <s-section>
        <div className={styles.summaryGrid} aria-label="Overview summary">
          {summaryItems.map((item) => (
            <div className={styles.summaryCard} key={item.label}>
              <span className={styles.summaryLabel}>{item.label}</span>
              <strong className={styles.summaryValue}>{item.value}</strong>
              <span className={styles.summaryText}>{item.description}</span>
            </div>
          ))}
        </div>
      </s-section>

      <s-section>
        <div className={styles.cardGrid}>
          {launchItems.map((item) => (
            <article className={styles.card} key={item.title}>
              <span className={styles.cardEyebrow}>{item.eyebrow}</span>
              <h2 className={styles.cardTitle}>{item.title}</h2>
              <p className={styles.cardDescription}>{item.description}</p>
              <Link className={styles.cardLink} to={link(item.href)}>
                {item.cta}
              </Link>
            </article>
          ))}
        </div>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
