export const CAMPAIGN_CONFIG_VERSION = 1;

export function getCampaignConfig(input) {
  const config = input.discount.metafield?.jsonValue;

  if (
    !isValidCampaignConfig(config) ||
    config.status !== "active" ||
    !cartMeetsMinimumSubtotal(input.cart, config.conditions) ||
    !cartMeetsMinimumQuantity(input.cart, config.conditions) ||
    !campaignIsInDateRange(input.shop, config.conditions)
  ) {
    return null;
  }

  return config;
}

function isValidCampaignConfig(config) {
  return (
    config &&
    config.version === CAMPAIGN_CONFIG_VERSION &&
    typeof config.id === "string" &&
    typeof config.name === "string" &&
    (config.status === "active" || config.status === "inactive") &&
    typeof config.productDiscount === "object" &&
    (!config.orderDiscount || typeof config.orderDiscount === "object") &&
    typeof config.shippingDiscount === "object" &&
    typeof config.conditions === "object"
  );
}

export function percentageValue(value) {
  if (typeof value !== "number" || value <= 0 || value > 100) {
    return null;
  }

  return {percentage: {value}};
}

export function fixedAmountValue(
  value,
  cartCurrencyCode,
  options = {},
) {
  const amount = fixedAmountAmount(value, cartCurrencyCode);

  if (!amount) {
    return null;
  }

  return {
    fixedAmount: {
      amount,
      ...options,
    },
  };
}

export function fixedAmountAmount(value, cartCurrencyCode) {
  if (
    value?.currencyCode &&
    cartCurrencyCode &&
    value.currencyCode !== cartCurrencyCode
  ) {
    return null;
  }

  const amount = Number(value?.amount);

  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  return amount.toFixed(2);
}

export function fixedAmountPercentageValue(
  value,
  cartCurrencyCode,
  subtotalAmount,
) {
  const amount = Number(fixedAmountAmount(value, cartCurrencyCode));
  const subtotal = Number(subtotalAmount);

  if (
    !Number.isFinite(amount) ||
    !Number.isFinite(subtotal) ||
    amount <= 0 ||
    subtotal <= 0
  ) {
    return null;
  }

  return percentageValue(Math.min((amount / subtotal) * 100, 100));
}

export function marketMatches(
  conditions,
  checkoutMarketHandle,
  fallbackDiscount = {},
) {
  const selectedMarketHandles = [
    ...(conditions.marketHandles ?? []),
    ...(fallbackDiscount.marketHandles ?? []),
  ]
    .map(normalizeMarketHandle)
    .filter(Boolean);

  if (!selectedMarketHandles.length) {
    return true;
  }

  const marketHandle = normalizeMarketHandle(checkoutMarketHandle);
  return Boolean(marketHandle && selectedMarketHandles.includes(marketHandle));
}

function normalizeMarketHandle(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function cartMeetsMinimumSubtotal(cart, conditions) {
  const minimum = Number(conditions.minimumCartSubtotal?.amount);

  if (!Number.isFinite(minimum) || minimum <= 0) {
    return true;
  }

  const subtotal = Number(cart.cost?.subtotalAmount?.amount);

  return Number.isFinite(subtotal) && subtotal >= minimum;
}

function cartMeetsMinimumQuantity(cart, conditions) {
  const minimumQuantity = Number(conditions.minimumCartQuantity);

  if (
    !Number.isInteger(minimumQuantity) ||
    minimumQuantity <= 0
  ) {
    return true;
  }

  const cartQuantity = (cart.lines ?? []).reduce((sum, line) => {
    const quantity = Number(line.quantity);

    return Number.isInteger(quantity) && quantity > 0
      ? sum + quantity
      : sum;
  }, 0);

  return cartQuantity >= minimumQuantity;
}

function campaignIsInDateRange(shop, conditions) {
  const currentDate = String(shop?.localTime?.date || "");

  if (!/^\d{4}-\d{2}-\d{2}$/.test(currentDate)) {
    return true;
  }

  if (conditions.startsAt && currentDate < conditions.startsAt) {
    return false;
  }

  if (conditions.endsAt && currentDate > conditions.endsAt) {
    return false;
  }

  return true;
}
