import type { CampaignFormInput } from "./campaign-storage.server";

export type AppPlan = "free" | "pro" | "enterprise";

export const PAID_PLAN_TRIAL_DAYS = 7;

export interface PlanEntitlements {
  key: AppPlan;
  name: string;
  priceLabel: string;
  monthlyPrice: number;
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
    monthlyPrice: 0,
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
    monthlyPrice: 14.9,
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
    monthlyPrice: 39.9,
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

/** Client-safe: the list page and overview count from loader data. */
export function countActiveCampaigns(campaigns: Array<{ status: string }>) {
  return campaigns.filter((campaign) => campaign.status === "active").length;
}

export function formatCampaignLimit(limit: number) {
  return Number.isFinite(limit) ? String(limit) : "Unlimited";
}

export function activeCampaignLimitMessage(plan: AppPlan) {
  const entitlements = entitlementForPlan(plan);
  const limit = entitlements.maxActiveCampaigns;

  return `${entitlements.name} includes ${formatCampaignLimit(limit)} active discount${
    limit === 1 ? "" : "s"
  }. Upgrade to activate more discounts.`;
}

/** True when activating one more campaign would exceed the plan's limit. */
export function isAtActiveCampaignLimit(plan: AppPlan, activeCampaignCount: number) {
  return activeCampaignCount >= entitlementForPlan(plan).maxActiveCampaigns;
}

/** How many active campaigns exceed the plan (after a downgrade). */
export function activeCampaignsOverLimit(plan: AppPlan, activeCampaignCount: number) {
  return Math.max(
    0,
    activeCampaignCount - entitlementForPlan(plan).maxActiveCampaigns,
  );
}

/**
 * Names of Pro/Enterprise features a campaign uses that the plan does not
 * include. Empty when the campaign is fully allowed on the plan.
 */
export function lockedFeaturesForCampaign(
  input: CampaignFormInput,
  plan: AppPlan,
): string[] {
  const entitlements = entitlementForPlan(plan);
  const locked: string[] = [];

  if (
    !entitlements.fixedAmountDiscounts &&
    (input.productDiscountType === "fixed_amount" ||
      input.orderDiscountType === "fixed_amount" ||
      input.shippingDiscountType === "fixed_amount")
  ) {
    locked.push("Fixed amount discounts");
  }

  if (
    !entitlements.bogoDiscounts &&
    input.productDiscountType === "buy_one_get_one_free"
  ) {
    locked.push("Buy X Get Y discounts");
  }

  if (!entitlements.volumeTiers && input.productDiscountType === "volume_tier") {
    locked.push("Volume tier discounts");
  }

  if (!entitlements.shippingDiscounts && input.shippingDiscountType !== "none") {
    locked.push("Shipping discounts");
  }

  if (!entitlements.marketTargeting && input.marketHandle) {
    locked.push("Market targeting");
  }

  if (!entitlements.shippingMethodTargeting && input.shippingDeliveryOptionHandle) {
    locked.push("Shipping method targeting");
  }

  if (!entitlements.scheduling && (input.startsAt || input.endsAt)) {
    locked.push("Scheduling");
  }

  return locked;
}

export function lockedFeatureMessage(feature: string) {
  const verb = feature.endsWith("s") ? "are" : "is";

  return `${feature} ${verb} available on Pro and Enterprise.`;
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
  const errors: string[] = [];

  // Only *newly* activating a campaign counts against the limit. A merchant who
  // downgraded while over the limit can still edit campaigns that are already
  // active; the list page tells them to deactivate the extras.
  if (
    input.status === "active" &&
    !currentCampaignIsActive &&
    isAtActiveCampaignLimit(plan, activeCampaignCount)
  ) {
    errors.push(activeCampaignLimitMessage(plan));
  }

  for (const feature of lockedFeaturesForCampaign(input, plan)) {
    errors.push(lockedFeatureMessage(feature));
  }

  return errors;
}
