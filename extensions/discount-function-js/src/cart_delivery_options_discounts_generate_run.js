import {
  DeliveryDiscountSelectionStrategy,
  DiscountClass,
} from "../generated/api";

import {
  fixedAmountValue,
  getCampaignConfig,
  marketMatches,
  percentageValue,
} from "./campaign_config";

/**
  * @typedef {import("../generated/api").DeliveryInput} RunInput
  * @typedef {import("../generated/api").CartDeliveryOptionsDiscountsGenerateRunResult} CartDeliveryOptionsDiscountsGenerateRunResult
  */

/**
  * @param {RunInput} input
  * @returns {CartDeliveryOptionsDiscountsGenerateRunResult}
 */

export function cartDeliveryOptionsDiscountsGenerateRun(input) {
  const config = getCampaignConfig(input);
  if (!config) {
    return {operations: []};
  }

  if (!input.cart.deliveryGroups.length) {
    return {operations: []};
  }

  const hasShippingDiscountClass = input.discount.discountClasses.includes(
    DiscountClass.Shipping,
  );

  if (!hasShippingDiscountClass) {
    return {operations: []};
  }

  if (
    !marketMatches(
      config.conditions,
      input.localization?.market?.handle,
      config.shippingDiscount,
    )
  ) {
    return {operations: []};
  }

  const value = shippingDiscountValue(
    config.shippingDiscount,
    input.cart.cost?.subtotalAmount?.currencyCode,
  );
  if (!value) {
    return {operations: []};
  }

  const candidates = deliveryDiscountCandidates(
    config,
    input.cart.deliveryGroups,
    value,
  );

  if (!candidates.length) {
    return {operations: []};
  }

  return {
    operations: [
      {
        deliveryDiscountsAdd: {
          candidates,
          selectionStrategy: DeliveryDiscountSelectionStrategy.All,
        },
      },
    ],
  };
}

function deliveryDiscountCandidates(config, deliveryGroups, value) {
  const selectedHandles = normalizedSelectedDeliveryOptionHandles(
    config.shippingDiscount,
  );

  if (!selectedHandles.length) {
    return deliveryGroups.map((deliveryGroup) => ({
      message: config.name,
      targets: [
        {
          deliveryGroup: {
            id: deliveryGroup.id,
          },
        },
      ],
      value,
    }));
  }

  return deliveryGroups.flatMap((deliveryGroup) =>
    deliveryGroup.deliveryOptions
      .filter((deliveryOption) =>
        deliveryOptionMatches(deliveryOption, selectedHandles),
      )
      .map((deliveryOption) => ({
        message: config.name,
        targets: [
          {
            deliveryOption: {
              handle: deliveryOption.handle,
            },
          },
        ],
        value,
      })),
  );
}

function normalizedSelectedDeliveryOptionHandles(discount) {
  return [
    ...(discount.deliveryOptionHandles ?? []),
    ...(discount.deliveryOptionTitles ?? []),
  ]
    .map(normalizeDeliveryOptionHandle)
    .filter(Boolean);
}

function deliveryOptionMatches(deliveryOption, selectedHandles) {
  return [deliveryOption.handle, deliveryOption.title, deliveryOption.code]
    .map(normalizeDeliveryOptionHandle)
    .some((handle) => selectedHandles.includes(handle));
}

function normalizeDeliveryOptionHandle(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function shippingDiscountValue(discount, cartCurrencyCode) {
  if (discount.type === "free_shipping") {
    return {percentage: {value: 100}};
  }

  if (discount.type === "percentage") {
    return percentageValue(discount.percentage);
  }

  if (discount.type === "fixed_amount") {
    return fixedAmountValue(
      discount.fixedAmount,
      cartCurrencyCode,
    );
  }

  return null;
}
