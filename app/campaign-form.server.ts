import type { CampaignFormInput } from "./campaign-storage.server";

/** Parses the campaign editor's POST body into the storage input shape. */
export function campaignInputFromForm(formData: FormData): CampaignFormInput {
  return {
    name: String(formData.get("name") || "").trim(),
    status: formValue(formData, "status", ["active", "inactive"], "inactive"),
    productDiscountType: formValue(
      formData,
      "productDiscountType",
      ["none", "percentage", "fixed_amount", "buy_one_get_one_free", "volume_tier"],
      "none",
    ),
    productDiscountPercentage: optionalNumber(
      formData.get("productDiscountPercentage"),
    ),
    productDiscountFixedAmount: optionalString(
      formData.get("productDiscountFixedAmount"),
    ),
    productDiscountFixedCurrencyCode: optionalCurrency(
      formData.get("productDiscountFixedCurrencyCode"),
    ),
    productDiscountBuyQuantity: optionalNumber(
      formData.get("productDiscountBuyQuantity"),
    ),
    productDiscountFreeQuantity: optionalNumber(
      formData.get("productDiscountFreeQuantity"),
    ),
    productDiscountVolumeTiers: volumeTiersFromForm(formData),
    orderDiscountType: formValue(
      formData,
      "orderDiscountType",
      ["none", "percentage", "fixed_amount"],
      "none",
    ),
    orderDiscountPercentage: optionalNumber(
      formData.get("orderDiscountPercentage"),
    ),
    orderDiscountMaximumAmount: optionalString(
      formData.get("orderDiscountMaximumAmount"),
    ),
    orderDiscountMaximumCurrencyCode: optionalCurrency(
      formData.get("orderDiscountMaximumCurrencyCode"),
    ),
    orderDiscountFixedAmount: optionalString(
      formData.get("orderDiscountFixedAmount"),
    ),
    orderDiscountFixedCurrencyCode: optionalCurrency(
      formData.get("orderDiscountFixedCurrencyCode"),
    ),
    productIds: selectedIds(formData, "productIds"),
    collectionIds: selectedIds(formData, "collectionIds"),
    excludedProductIds: selectedIds(formData, "excludedProductIds"),
    excludedCollectionIds: selectedIds(formData, "excludedCollectionIds"),
    shippingDiscountType: formValue(
      formData,
      "shippingDiscountType",
      ["none", "free_shipping", "percentage", "fixed_amount"],
      "none",
    ),
    shippingDiscountPercentage: optionalNumber(
      formData.get("shippingDiscountPercentage"),
    ),
    shippingDiscountFixedAmount: optionalString(
      formData.get("shippingDiscountFixedAmount"),
    ),
    shippingDiscountFixedCurrencyCode: optionalCurrency(
      formData.get("shippingDiscountFixedCurrencyCode"),
    ),
    shippingDeliveryOptionHandle: optionalString(
      formData.get("shippingDeliveryOptionHandle"),
    ),
    shippingDeliveryOptionTitle: optionalString(
      formData.get("shippingDeliveryOptionTitle"),
    ),
    marketHandle: optionalString(formData.get("marketHandle")),
    marketName: optionalString(formData.get("marketName")),
    combinesWithOrderDiscounts:
      formData.get("combinesWithOrderDiscounts") === "true",
    combinesWithProductDiscounts:
      formData.get("combinesWithProductDiscounts") === "true",
    combinesWithShippingDiscounts:
      formData.get("combinesWithShippingDiscounts") === "true",
    minimumCartSubtotalAmount: optionalString(
      formData.get("minimumCartSubtotalAmount"),
    ),
    minimumCartSubtotalCurrencyCode: optionalCurrency(
      formData.get("minimumCartSubtotalCurrencyCode"),
    ),
    minimumCartQuantity: optionalNumber(formData.get("minimumCartQuantity")),
    startsAt: optionalString(formData.get("startsAt")),
    endsAt: optionalString(formData.get("endsAt")),
  };
}

/**
 * Field-level validation. Messages are matched by keyword in the editor to
 * attach them to fields and tabs, so keep the labels stable.
 */
export function validateCampaignInput(input: CampaignFormInput) {
  const errors: string[] = [];

  if (!input.name) {
    errors.push("Campaign name is required.");
  }

  if (
    input.productDiscountType === "none" &&
    input.orderDiscountType === "none" &&
    input.shippingDiscountType === "none"
  ) {
    errors.push("Choose at least one discount type (product, order, or shipping).");
  }

  if (input.productDiscountType === "percentage") {
    validatePercentage(
      input.productDiscountPercentage,
      "Product discount percentage",
      errors,
    );
  }

  if (input.productDiscountType === "fixed_amount") {
    validateFixedAmount(
      input.productDiscountFixedAmount,
      input.productDiscountFixedCurrencyCode,
      "Product fixed discount",
      errors,
    );
  }

  if (input.productDiscountType === "buy_one_get_one_free") {
    validateWholeNumber(input.productDiscountBuyQuantity, "Buy quantity", errors);
    validateWholeNumber(input.productDiscountFreeQuantity, "Free quantity", errors);
  }

  if (input.productDiscountType === "volume_tier") {
    validateVolumeTiers(input.productDiscountVolumeTiers, errors);
  }

  if (input.orderDiscountType === "percentage") {
    validatePercentage(
      input.orderDiscountPercentage,
      "Order discount percentage",
      errors,
    );
    validateOptionalMoney(
      input.orderDiscountMaximumAmount,
      input.orderDiscountMaximumCurrencyCode,
      "Order maximum discount",
      errors,
    );
  }

  if (input.orderDiscountType === "fixed_amount") {
    validateFixedAmount(
      input.orderDiscountFixedAmount,
      input.orderDiscountFixedCurrencyCode,
      "Order fixed discount",
      errors,
    );
  }

  if (input.shippingDiscountType === "percentage") {
    validatePercentage(
      input.shippingDiscountPercentage,
      "Shipping discount percentage",
      errors,
    );
  }

  if (input.shippingDiscountType === "fixed_amount") {
    validateFixedAmount(
      input.shippingDiscountFixedAmount,
      input.shippingDiscountFixedCurrencyCode,
      "Shipping fixed discount",
      errors,
    );
  }

  validateOptionalMoney(
    input.minimumCartSubtotalAmount,
    input.minimumCartSubtotalCurrencyCode,
    "Minimum cart subtotal",
    errors,
  );
  validateOptionalWholeNumber(
    input.minimumCartQuantity,
    "Minimum cart quantity",
    errors,
  );
  validateDateRange(input.startsAt, input.endsAt, errors);

  return errors;
}

function formValue<TValue extends string>(
  formData: FormData,
  key: string,
  allowedValues: TValue[],
  fallback: TValue,
) {
  const value = String(formData.get(key) || "");

  return allowedValues.includes(value as TValue) ? (value as TValue) : fallback;
}

function optionalNumber(value: FormDataEntryValue | null) {
  if (value === null || String(value).trim() === "") {
    return undefined;
  }

  return Number(value);
}

function optionalString(value: FormDataEntryValue | null) {
  const stringValue = String(value || "").trim();

  return stringValue || undefined;
}

function optionalCurrency(value: FormDataEntryValue | null) {
  return optionalString(value)?.toUpperCase();
}

function selectedIds(formData: FormData, key: string) {
  return formData
    .getAll(key)
    .map((value) => String(value).trim())
    .filter(Boolean);
}

function volumeTiersFromForm(formData: FormData) {
  const minimumQuantities = formData.getAll("productVolumeTierMinimumQuantity");
  const percentages = formData.getAll("productVolumeTierPercentage");

  return minimumQuantities.flatMap((minimumQuantity, index) => {
    const minimum = optionalNumber(minimumQuantity);
    const percentage = optionalNumber(percentages[index] ?? null);

    if (minimum === undefined && percentage === undefined) {
      return [];
    }

    return [
      {
        minimumQuantity: minimum ?? 0,
        percentage: percentage ?? 0,
      },
    ];
  });
}

function validateVolumeTiers(
  tiers: CampaignFormInput["productDiscountVolumeTiers"],
  errors: string[],
) {
  if (!tiers?.length) {
    errors.push("At least one volume discount tier is required.");
    return;
  }

  for (const tier of tiers) {
    validateWholeNumber(
      tier.minimumQuantity,
      "Volume tier minimum quantity",
      errors,
    );
    validatePercentage(tier.percentage, "Volume tier percentage", errors);
  }
}

function validatePercentage(
  value: number | undefined,
  label: string,
  errors: string[],
) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    errors.push(`${label} is required.`);
    return;
  }

  if (value <= 0 || value > 100) {
    errors.push(`${label} must be greater than 0 and at most 100.`);
  }
}

function validateFixedAmount(
  amount: string | undefined,
  currencyCode: string | undefined,
  label: string,
  errors: string[],
) {
  const numericAmount = Number(amount);

  if (!amount || !Number.isFinite(numericAmount) || numericAmount <= 0) {
    errors.push(`${label} amount must be greater than 0.`);
  }

  if (!currencyCode || !/^[A-Z]{3}$/.test(currencyCode)) {
    errors.push(`${label} currency must be a 3-letter code.`);
  }
}

function validateOptionalMoney(
  amount: string | undefined,
  currencyCode: string | undefined,
  label: string,
  errors: string[],
) {
  if (!amount) {
    return;
  }

  validateFixedAmount(amount, currencyCode, label, errors);
}

function validateOptionalWholeNumber(
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

function validateWholeNumber(
  value: number | undefined,
  label: string,
  errors: string[],
) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    errors.push(`${label} is required.`);
    return;
  }

  if (!Number.isInteger(value) || value <= 0) {
    errors.push(`${label} must be a whole number greater than 0.`);
  }
}

function validateDateRange(
  startsAt: string | undefined,
  endsAt: string | undefined,
  errors: string[],
) {
  if (startsAt && !/^\d{4}-\d{2}-\d{2}$/.test(startsAt)) {
    errors.push("Start date must be a valid date.");
  }

  if (endsAt && !/^\d{4}-\d{2}-\d{2}$/.test(endsAt)) {
    errors.push("End date must be a valid date.");
  }

  if (startsAt && endsAt && startsAt > endsAt) {
    errors.push("Start date must be before end date.");
  }
}
