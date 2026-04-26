export const CAMPAIGN_CONFIG_VERSION = 1;
export const CAMPAIGN_CONFIG_METAFIELD_NAMESPACE = "$app:discount-campaign";
export const CAMPAIGN_CONFIG_METAFIELD_KEY = "campaign_config";
export const INPUT_VARIABLES_METAFIELD_NAMESPACE = "$app:discount-campaign";
export const INPUT_VARIABLES_METAFIELD_KEY = "input_variables";

export type CampaignStatus = "active" | "inactive";

export type ProductDiscountType =
  | "none"
  | "percentage"
  | "fixed_amount"
  | "buy_one_get_one_free"
  | "volume_tier";

export type OrderDiscountType = "none" | "percentage" | "fixed_amount";

export type ShippingDiscountType =
  | "none"
  | "free_shipping"
  | "percentage"
  | "fixed_amount";

export interface MoneyAmount {
  amount: string;
  currencyCode: string;
}

export interface ProductDiscountConfig {
  type: ProductDiscountType;
  percentage?: number;
  fixedAmount?: MoneyAmount;
  buyQuantity?: number;
  freeQuantity?: number;
  volumeTiers?: VolumeDiscountTier[];
}

export interface VolumeDiscountTier {
  minimumQuantity: number;
  percentage: number;
}

export interface OrderDiscountConfig {
  type: OrderDiscountType;
  percentage?: number;
  fixedAmount?: MoneyAmount;
  maximumDiscountAmount?: MoneyAmount;
}

export interface ShippingDiscountConfig {
  type: ShippingDiscountType;
  percentage?: number;
  fixedAmount?: MoneyAmount;
  deliveryOptionHandles?: string[];
  deliveryOptionTitles?: string[];
  marketHandles?: string[];
  marketNames?: string[];
}

export interface CampaignCombinesWithConfig {
  orderDiscounts: boolean;
  productDiscounts: boolean;
  shippingDiscounts: boolean;
}

export interface CampaignConditionsConfig {
  minimumCartSubtotal?: MoneyAmount;
  minimumCartQuantity?: number;
  productIds: string[];
  collectionIds: string[];
  excludedProductIds: string[];
  excludedCollectionIds: string[];
  marketHandles?: string[];
  marketNames?: string[];
  startsAt?: string;
  endsAt?: string;
}

export interface CampaignConfig {
  version: typeof CAMPAIGN_CONFIG_VERSION;
  id: string;
  name: string;
  status: CampaignStatus;
  productDiscount: ProductDiscountConfig;
  orderDiscount: OrderDiscountConfig;
  shippingDiscount: ShippingDiscountConfig;
  combinesWith: CampaignCombinesWithConfig;
  conditions: CampaignConditionsConfig;
}

export interface CampaignConfigValidationResult {
  valid: boolean;
  errors: string[];
}

export function createDefaultCampaignConfig(
  id: string,
  name = "",
): CampaignConfig {
  return {
    version: CAMPAIGN_CONFIG_VERSION,
    id,
    name,
    status: "inactive",
    productDiscount: {
      type: "none",
    },
    orderDiscount: {
      type: "none",
    },
    shippingDiscount: {
      type: "none",
    },
    combinesWith: {
      orderDiscounts: false,
      productDiscounts: true,
      shippingDiscounts: true,
    },
    conditions: {
      productIds: [],
      collectionIds: [],
      excludedProductIds: [],
      excludedCollectionIds: [],
    },
  };
}

export function validateCampaignConfig(
  config: CampaignConfig,
): CampaignConfigValidationResult {
  const errors: string[] = [];

  if (config.version !== CAMPAIGN_CONFIG_VERSION) {
    errors.push("Unsupported campaign config version.");
  }

  if (!config.id.trim()) {
    errors.push("Campaign id is required.");
  }

  if (!config.name.trim()) {
    errors.push("Campaign name is required.");
  }

  validateProductDiscount(config.productDiscount, errors);
  validateOrderDiscount(config.orderDiscount, errors);
  validateShippingDiscount(config.shippingDiscount, errors);
  validateConditions(config.conditions, errors);

  return {
    valid: errors.length === 0,
    errors,
  };
}

function validateProductDiscount(
  discount: ProductDiscountConfig,
  errors: string[],
) {
  if (discount.type === "percentage") {
    validatePercentage(discount.percentage, "Product discount percentage", errors);
  }

  if (discount.type === "fixed_amount") {
    validateMoney(discount.fixedAmount, "Product fixed discount amount", errors);
  }

  if (discount.type === "buy_one_get_one_free") {
    validateWholeNumber(discount.buyQuantity, "Buy quantity", errors);
    validateWholeNumber(discount.freeQuantity, "Free quantity", errors);
  }

  if (discount.type === "volume_tier") {
    if (!discount.volumeTiers?.length) {
      errors.push("At least one volume discount tier is required.");
    }

    for (const tier of discount.volumeTiers ?? []) {
      validateWholeNumber(tier.minimumQuantity, "Volume tier minimum quantity", errors);
      validatePercentage(tier.percentage, "Volume tier percentage", errors);
    }
  }
}

function validateOrderDiscount(
  discount: OrderDiscountConfig,
  errors: string[],
) {
  if (discount.type === "percentage") {
    validatePercentage(discount.percentage, "Order discount percentage", errors);

    if (discount.maximumDiscountAmount) {
      validateMoney(
        discount.maximumDiscountAmount,
        "Order maximum discount amount",
        errors,
      );
    }
  }

  if (discount.type === "fixed_amount") {
    validateMoney(discount.fixedAmount, "Order fixed discount amount", errors);
  }
}

function validateShippingDiscount(
  discount: ShippingDiscountConfig,
  errors: string[],
) {
  if (discount.type === "percentage") {
    validatePercentage(discount.percentage, "Shipping discount percentage", errors);
  }

  if (discount.type === "fixed_amount") {
    validateMoney(discount.fixedAmount, "Shipping fixed discount amount", errors);
  }
}

function validateConditions(
  conditions: CampaignConditionsConfig,
  errors: string[],
) {
  if (conditions.minimumCartSubtotal) {
    validateMoney(conditions.minimumCartSubtotal, "Minimum cart subtotal", errors);
  }

  if (
    conditions.minimumCartQuantity !== undefined &&
    (!Number.isInteger(conditions.minimumCartQuantity) ||
      conditions.minimumCartQuantity <= 0)
  ) {
    errors.push("Minimum cart quantity must be a whole number greater than 0.");
  }

  if (conditions.startsAt && Number.isNaN(Date.parse(conditions.startsAt))) {
    errors.push("Start date must be an ISO date string.");
  }

  if (conditions.endsAt && Number.isNaN(Date.parse(conditions.endsAt))) {
    errors.push("End date must be an ISO date string.");
  }

  if (
    conditions.startsAt &&
    conditions.endsAt &&
    Date.parse(conditions.startsAt) > Date.parse(conditions.endsAt)
  ) {
    errors.push("Start date must be before end date.");
  }
}

function validatePercentage(
  value: number | undefined,
  label: string,
  errors: string[],
) {
  if (typeof value !== "number" || value <= 0 || value > 100) {
    errors.push(`${label} must be greater than 0 and at most 100.`);
  }
}

function validateWholeNumber(
  value: number | undefined,
  label: string,
  errors: string[],
) {
  if (value === undefined) {
    return;
  }

  if (!Number.isInteger(value) || value <= 0) {
    errors.push(`${label} must be a whole number greater than 0.`);
  }
}

function validateMoney(
  value: MoneyAmount | undefined,
  label: string,
  errors: string[],
) {
  if (!value) {
    errors.push(`${label} is required.`);
    return;
  }

  if (!value.currencyCode.trim()) {
    errors.push(`${label} currency is required.`);
  }

  const amount = Number(value.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    errors.push(`${label} must be greater than 0.`);
  }
}
