import {
  DiscountClass,
  OrderDiscountSelectionStrategy,
  ProductDiscountSelectionStrategy,
} from '../generated/api';

import {
  fixedAmountAmount,
  fixedAmountPercentageValue,
  getCampaignConfig,
  marketMatches,
  percentageValue,
} from "./campaign_config";

/**
  * @typedef {import("../generated/api").CartInput} RunInput
  * @typedef {import("../generated/api").CartLinesDiscountsGenerateRunResult} CartLinesDiscountsGenerateRunResult
  */

/**
  * @param {RunInput} input
  * @returns {CartLinesDiscountsGenerateRunResult}
  */

export function cartLinesDiscountsGenerateRun(input) {
  const config = getCampaignConfig(input);
  if (!config) {
    return {operations: []};
  }

  if (!input.cart.lines.length) {
    return {operations: []};
  }

  if (!marketMatches(config.conditions, input.localization?.market?.handle)) {
    return {operations: []};
  }

  const eligibleLines = input.cart.lines.filter((line) =>
    lineMatchesProductRestrictions(line, config.conditions),
  );

  if (!eligibleLines.length) {
    return {operations: []};
  }

  const operations = [];
  const productOperation = productDiscountOperation(
    config,
    input.discount.discountClasses,
    input.cart.cost?.subtotalAmount?.currencyCode,
    eligibleLines,
  );
  const orderOperation = orderDiscountOperation(
    config,
    input.discount.discountClasses,
    input.cart.cost?.subtotalAmount?.currencyCode,
    input.cart.lines,
    eligibleLines,
  );

  if (productOperation) {
    operations.push(productOperation);
  }

  if (orderOperation) {
    operations.push(orderOperation);
  }

  return {operations};
}

function productDiscountOperation(
  config,
  discountClasses,
  cartCurrencyCode,
  eligibleLines,
) {
  if (!discountClasses.includes(DiscountClass.Product)) {
    return null;
  }

  if (config.productDiscount.type === "fixed_amount") {
    return fixedProductDiscountOperation(
      config,
      cartCurrencyCode,
      eligibleLines,
    );
  }

  if (config.productDiscount.type === "buy_one_get_one_free") {
    return buyOneGetOneFreeProductDiscountOperation(config, eligibleLines);
  }

  if (config.productDiscount.type === "volume_tier") {
    return volumeTierProductDiscountOperation(config, eligibleLines);
  }

  const value = productDiscountValue(
    config.productDiscount,
    cartCurrencyCode,
    cartLinesSubtotal(eligibleLines),
  );
  if (!value) {
    return null;
  }

  const targets = eligibleLines.map((line) => ({
    cartLine: {
      id: line.id,
    },
  }));

  const candidates = [
    {
      message: config.name,
      targets,
      value,
    },
  ];

  return {
    productDiscountsAdd: {
      candidates,
      selectionStrategy: ProductDiscountSelectionStrategy.All,
    },
  };
}

function volumeTierProductDiscountOperation(config, eligibleLines) {
  const tier = matchingVolumeTier(
    config.productDiscount.volumeTiers,
    cartLinesQuantity(eligibleLines),
  );

  if (!tier) {
    return null;
  }

  const value = percentageValue(tier.percentage);
  if (!value) {
    return null;
  }

  return {
    productDiscountsAdd: {
      candidates: [
        {
          message: config.name,
          targets: eligibleLines.map((line) => ({
            cartLine: {
              id: line.id,
            },
          })),
          value,
        },
      ],
      selectionStrategy: ProductDiscountSelectionStrategy.All,
    },
  };
}

function matchingVolumeTier(tiers, quantity) {
  if (!Array.isArray(tiers) || quantity <= 0) {
    return null;
  }

  return tiers
    .filter(
      (tier) =>
        Number.isInteger(Number(tier.minimumQuantity)) &&
        Number(tier.minimumQuantity) > 0 &&
        typeof tier.percentage === "number" &&
        quantity >= Number(tier.minimumQuantity),
    )
    .sort((a, b) => Number(b.minimumQuantity) - Number(a.minimumQuantity))[0] ?? null;
}

function buyOneGetOneFreeProductDiscountOperation(config, eligibleLines) {
  const buyQuantity = positiveIntegerOrDefault(
    config.productDiscount.buyQuantity,
    1,
  );
  const freeQuantityPerSet = positiveIntegerOrDefault(
    config.productDiscount.freeQuantity,
    1,
  );
  const setQuantity = buyQuantity + freeQuantityPerSet;
  const eligibleLinePrices = eligibleLines
    .map((line) => {
      const quantity = Number(line.quantity);
      const subtotalCents = moneyCents(line.cost?.subtotalAmount?.amount);

      if (!Number.isInteger(quantity) || quantity <= 0 || subtotalCents <= 0) {
        return null;
      }

      return {
        line,
        quantity,
        unitPriceCents: Math.round(subtotalCents / quantity),
      };
    })
    .filter(Boolean);
  const totalQuantity = eligibleLinePrices.reduce(
    (sum, {quantity}) => sum + quantity,
    0,
  );
  let remainingFreeQuantity =
    Math.floor(totalQuantity / setQuantity) * freeQuantityPerSet;

  if (remainingFreeQuantity <= 0) {
    return null;
  }

  const candidates = eligibleLinePrices
    .sort((a, b) => a.unitPriceCents - b.unitPriceCents)
    .map(({line, quantity}) => {
      const freeQuantity = Math.min(quantity, remainingFreeQuantity);
      remainingFreeQuantity -= freeQuantity;

      if (freeQuantity <= 0) {
        return null;
      }

      return {
        message: config.name,
        targets: [
          {
            cartLine: {
              id: line.id,
              quantity: freeQuantity,
            },
          },
        ],
        value: {
          percentage: {
            value: 100,
          },
        },
      };
    })
    .filter(Boolean);

  if (!candidates.length) {
    return null;
  }

  return {
    productDiscountsAdd: {
      candidates,
      selectionStrategy: ProductDiscountSelectionStrategy.All,
    },
  };
}

function positiveIntegerOrDefault(value, defaultValue) {
  const number = Number(value);

  return Number.isInteger(number) && number > 0 ? number : defaultValue;
}

function fixedProductDiscountOperation(config, cartCurrencyCode, eligibleLines) {
  const candidates = fixedProductDiscountCandidates(
    config.productDiscount.fixedAmount,
    cartCurrencyCode,
    eligibleLines,
    config.name,
  );

  if (!candidates.length) {
    return null;
  }

  return {
    productDiscountsAdd: {
      candidates,
      selectionStrategy: ProductDiscountSelectionStrategy.All,
    },
  };
}

function orderDiscountOperation(
  config,
  discountClasses,
  cartCurrencyCode,
  cartLines,
  eligibleLines,
) {
  if (!discountClasses.includes(DiscountClass.Order)) {
    return null;
  }

  const value = orderDiscountValue(
    config.orderDiscount ?? {type: "none"},
    cartCurrencyCode,
    cartLinesSubtotal(eligibleLines),
  );
  if (!value) {
    return null;
  }

  const eligibleLineIds = new Set(eligibleLines.map((line) => line.id));
  const excludedCartLineIds = cartLines
    .filter((line) => !eligibleLineIds.has(line.id))
    .map((line) => line.id);

  return {
    orderDiscountsAdd: {
      candidates: [
        {
          message: config.name,
          targets: [
            {
              orderSubtotal: {
                excludedCartLineIds,
              },
            },
          ],
          value,
        },
      ],
      selectionStrategy: OrderDiscountSelectionStrategy.First,
    },
  };
}

function lineMatchesProductRestrictions(line, conditions = {}) {
  const productIds = conditions.productIds;
  const collectionIds = conditions.collectionIds;
  const excludedProductIds = conditions.excludedProductIds;
  const excludedCollectionIds = conditions.excludedCollectionIds;
  const productId = line.merchandise?.product?.id;
  const productExcluded =
    Array.isArray(excludedProductIds) &&
    excludedProductIds.length > 0 &&
    excludedProductIds.includes(productId);
  const collectionExcluded =
    Array.isArray(excludedCollectionIds) &&
    excludedCollectionIds.length > 0 &&
    line.merchandise?.product?.inAnyExcludedCollection === true;

  if (productExcluded || collectionExcluded) {
    return false;
  }

  const productMatches =
    !Array.isArray(productIds) ||
    !productIds.length ||
    productIds.includes(productId);
  const collectionMatches =
    !Array.isArray(collectionIds) ||
    !collectionIds.length ||
    line.merchandise?.product?.inAnySelectedCollection === true;

  return productMatches && collectionMatches;
}

function cartLinesSubtotal(lines) {
  return lines.reduce((sum, line) => {
    const amount = Number(line.cost?.subtotalAmount?.amount);

    return Number.isFinite(amount) ? sum + amount : sum;
  }, 0);
}

function cartLinesQuantity(lines) {
  return lines.reduce((sum, line) => {
    const quantity = Number(line.quantity);

    return Number.isInteger(quantity) && quantity > 0 ? sum + quantity : sum;
  }, 0);
}

function fixedProductDiscountCandidates(
  fixedAmount,
  cartCurrencyCode,
  eligibleLines,
  message,
) {
  const discountCents = moneyCents(fixedAmountAmount(
    fixedAmount,
    cartCurrencyCode,
  ));
  const lineAmounts = eligibleLines
    .map((line) => ({
      line,
      subtotalCents: moneyCents(line.cost?.subtotalAmount?.amount),
    }))
    .filter(({subtotalCents}) => subtotalCents > 0);
  const totalSubtotalCents = lineAmounts.reduce(
    (sum, {subtotalCents}) => sum + subtotalCents,
    0,
  );
  const targetDiscountCents = Math.min(discountCents, totalSubtotalCents);

  if (targetDiscountCents <= 0 || totalSubtotalCents <= 0) {
    return [];
  }

  let allocatedCents = 0;

  return lineAmounts
    .map(({line, subtotalCents}, index) => {
      const isLastLine = index === lineAmounts.length - 1;
      const lineDiscountCents = isLastLine
        ? targetDiscountCents - allocatedCents
        : Math.min(
            subtotalCents,
            Math.round(
              (targetDiscountCents * subtotalCents) / totalSubtotalCents,
            ),
          );

      allocatedCents += lineDiscountCents;

      if (lineDiscountCents <= 0) {
        return null;
      }

      return {
        message,
        targets: [
          {
            cartLine: {
              id: line.id,
            },
          },
        ],
        value: {
          percentage: {
            value: (lineDiscountCents / subtotalCents) * 100,
          },
        },
      };
    })
    .filter(Boolean);
}

function moneyCents(value) {
  const amount = Number(value);

  if (!Number.isFinite(amount) || amount <= 0) {
    return 0;
  }

  return Math.round(amount * 100);
}

function productDiscountValue(discount, cartCurrencyCode, subtotalAmount) {
  if (discount.type === "percentage") {
    return percentageValue(discount.percentage);
  }

  if (discount.type === "fixed_amount") {
    return fixedAmountPercentageValue(
      discount.fixedAmount,
      cartCurrencyCode,
      subtotalAmount,
    );
  }

  return null;
}

function orderDiscountValue(discount, cartCurrencyCode, subtotalAmount) {
  if (discount.type === "percentage") {
    const cappedValue = cappedPercentageValue(
      discount.percentage,
      discount.maximumDiscountAmount,
      cartCurrencyCode,
      subtotalAmount,
    );

    if (cappedValue) {
      return cappedValue;
    }

    return percentageValue(discount.percentage);
  }

  if (discount.type === "fixed_amount") {
    return fixedAmountPercentageValue(
      discount.fixedAmount,
      cartCurrencyCode,
      subtotalAmount,
    );
  }

  return null;
}

function cappedPercentageValue(
  percentage,
  maximumDiscountAmount,
  cartCurrencyCode,
  subtotalAmount,
) {
  const percentageNumber = Number(percentage);
  const maximumAmount = Number(
    fixedAmountAmount(maximumDiscountAmount, cartCurrencyCode),
  );
  const subtotal = Number(subtotalAmount);

  if (
    !Number.isFinite(percentageNumber) ||
    !Number.isFinite(maximumAmount) ||
    !Number.isFinite(subtotal) ||
    percentageNumber <= 0 ||
    maximumAmount <= 0 ||
    subtotal <= 0
  ) {
    return null;
  }

  const uncappedDiscountAmount = subtotal * (percentageNumber / 100);

  if (uncappedDiscountAmount <= maximumAmount) {
    return null;
  }

  return percentageValue(Math.min((maximumAmount / subtotal) * 100, 100));
}
