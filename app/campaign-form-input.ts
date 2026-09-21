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

