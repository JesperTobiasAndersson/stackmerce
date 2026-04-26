import type { CampaignFormInput } from "./campaign-storage.server";

export type AppPlan = "free" | "pro" | "enterprise";

export interface PlanEntitlements {
  key: AppPlan;
  name: string;
  priceLabel: string;
  maxActiveCampaigns: number;
  fixedAmountDiscounts: boolean;
  bogoDiscounts: boolean;
  volumeTiers: boolean;
  shippingDiscounts: boolean;
  marketTargeting: boolean;
  shippingMethodTargeting: boolean;
  scheduling: boolean;
  prioritySupport: boolean;
}

export const PLAN_ENTITLEMENTS: Record<AppPlan, PlanEntitlements> = {
  free: {
    key: "free",
    name: "Free",
    priceLabel: "$0/month",
    maxActiveCampaigns: 1,
    fixedAmountDiscounts: false,
    bogoDiscounts: false,
    volumeTiers: false,
    shippingDiscounts: false,
    marketTargeting: false,
    shippingMethodTargeting: false,
    scheduling: false,
    prioritySupport: false,
  },
  pro: {
    key: "pro",
    name: "Pro",
    priceLabel: "$14.90/month",
    maxActiveCampaigns: 25,
    fixedAmountDiscounts: true,
    bogoDiscounts: true,
    volumeTiers: true,
    shippingDiscounts: true,
    marketTargeting: true,
    shippingMethodTargeting: true,
    scheduling: true,
    prioritySupport: false,
  },
  enterprise: {
    key: "enterprise",
    name: "Enterprise",
    priceLabel: "$39.90/month",
    maxActiveCampaigns: Number.POSITIVE_INFINITY,
    fixedAmountDiscounts: true,
    bogoDiscounts: true,
    volumeTiers: true,
    shippingDiscounts: true,
    marketTargeting: true,
    shippingMethodTargeting: true,
    scheduling: true,
    prioritySupport: true,
  },
};

export function entitlementForPlan(plan: AppPlan) {
  return PLAN_ENTITLEMENTS[plan];
}

export function formatCampaignLimit(limit: number) {
  return Number.isFinite(limit) ? String(limit) : "Unlimited";
}

export function validateCampaignEntitlements({
  activeCampaignCount,
  currentCampaignIsActive = false,
  input,
  plan,
}: {
  activeCampaignCount: number;
  currentCampaignIsActive?: boolean;
  input: CampaignFormInput;
  plan: AppPlan;
}) {
  const entitlements = entitlementForPlan(plan);
  const errors: string[] = [];
  const projectedActiveCampaignCount =
    input.status === "active" && !currentCampaignIsActive
      ? activeCampaignCount + 1
      : activeCampaignCount;

  if (projectedActiveCampaignCount > entitlements.maxActiveCampaigns) {
    errors.push(
      `${entitlements.name} includes ${formatCampaignLimit(
        entitlements.maxActiveCampaigns,
      )} active discount${
        entitlements.maxActiveCampaigns === 1 ? "" : "s"
      }. Upgrade to activate more discounts.`,
    );
  }

  if (
    !entitlements.fixedAmountDiscounts &&
    (input.productDiscountType === "fixed_amount" ||
      input.orderDiscountType === "fixed_amount" ||
      input.shippingDiscountType === "fixed_amount")
  ) {
    errors.push("Fixed amount discounts are available on Pro and Enterprise.");
  }

  if (
    !entitlements.bogoDiscounts &&
    input.productDiscountType === "buy_one_get_one_free"
  ) {
    errors.push("Buy X Get Y discounts are available on Pro and Enterprise.");
  }

  if (!entitlements.volumeTiers && input.productDiscountType === "volume_tier") {
    errors.push("Volume tier discounts are available on Pro and Enterprise.");
  }

  if (!entitlements.shippingDiscounts && input.shippingDiscountType !== "none") {
    errors.push("Shipping discounts are available on Pro and Enterprise.");
  }

  if (!entitlements.marketTargeting && input.marketHandle) {
    errors.push("Market targeting is available on Pro and Enterprise.");
  }

  if (!entitlements.shippingMethodTargeting && input.shippingDeliveryOptionHandle) {
    errors.push("Shipping method targeting is available on Pro and Enterprise.");
  }

  if (!entitlements.scheduling && (input.startsAt || input.endsAt)) {
    errors.push("Scheduling discounts is available on Pro and Enterprise.");
  }

  return errors;
}
