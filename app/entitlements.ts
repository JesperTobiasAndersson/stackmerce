import type { CampaignFormInput } from "./campaign-storage.server";
import type { FormError } from "./form-errors";

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

export type LockedFeatureKey =
  | "feature.fixedAmount"
  | "feature.bogo"
  | "feature.volume"
  | "feature.shipping"
  | "feature.market"
  | "feature.shippingMethod"
  | "feature.scheduling";

/**
 * Translation keys of the Pro/Enterprise features a campaign uses that the
 * plan does not include. Empty when the campaign is fully allowed on the plan.
 */
export function lockedFeaturesForCampaign(
  input: CampaignFormInput,
  plan: AppPlan,
): LockedFeatureKey[] {
  const entitlements = entitlementForPlan(plan);
  const locked: LockedFeatureKey[] = [];

  if (
    !entitlements.fixedAmountDiscounts &&
    (input.productDiscountType === "fixed_amount" ||
      input.orderDiscountType === "fixed_amount" ||
      input.shippingDiscountType === "fixed_amount")
  ) {
    locked.push("feature.fixedAmount");
  }

  if (!entitlements.bogoDiscounts && input.productDiscountType === "buy_one_get_one_free") {
    locked.push("feature.bogo");
  }

  if (!entitlements.volumeTiers && input.productDiscountType === "volume_tier") {
    locked.push("feature.volume");
  }

  if (!entitlements.shippingDiscounts && input.shippingDiscountType !== "none") {
    locked.push("feature.shipping");
  }

  if (!entitlements.marketTargeting && input.marketHandle) {
    locked.push("feature.market");
  }

  if (!entitlements.shippingMethodTargeting && input.shippingDeliveryOptionHandle) {
    locked.push("feature.shippingMethod");
  }

  if (!entitlements.scheduling && (input.startsAt || input.endsAt)) {
    locked.push("feature.scheduling");
  }

  return locked;
}

export function activeCampaignLimitError(plan: AppPlan): FormError {
  const entitlements = entitlementForPlan(plan);

  return {
    field: null,
    key: "error.plan.limit",
    params: {
      plan: entitlements.name,
      limit: formatCampaignLimit(entitlements.maxActiveCampaigns),
    },
  };
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
}): FormError[] {
  const errors: FormError[] = [];

  // Only *newly* activating a campaign counts against the limit. A merchant who
  // downgraded while over the limit can still edit campaigns that are already
  // active; the list page tells them to deactivate the extras.
  if (
    input.status === "active" &&
    !currentCampaignIsActive &&
    isAtActiveCampaignLimit(plan, activeCampaignCount)
  ) {
    errors.push(activeCampaignLimitError(plan));
  }

  for (const feature of lockedFeaturesForCampaign(input, plan)) {
    errors.push({ field: null, key: "error.plan.locked", paramKeys: { feature } });
  }

  return errors;
}
