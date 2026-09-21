import type { CampaignFormInput } from "./campaign-storage.server";
import type { FieldErrorKey, FormError } from "./form-errors";
export { campaignInputFromForm } from "./campaign-form-input";
import { withLocale, type Locale, type TranslationKey } from "./i18n";

/**
 * Where to go after saving. Merchants who opened the editor from Shopify's
 * own Discounts page (via the function's `ui.paths`) are sent back there.
 */
export function afterSaveUrl(request: Request, saved: string, locale: Locale) {
  const returnTo = new URL(request.url).searchParams.get("returnTo");
  const params = new URLSearchParams({ saved });

  if (returnTo === "discounts") {
    params.set("returnTo", "discounts");
  }

  return withLocale(`/app/campaigns?${params.toString()}`, locale);
}

/** Field-level validation. Returns structured errors the editor translates. */
export function validateCampaignInput(input: CampaignFormInput): FormError[] {
  const errors: FormError[] = [];

  if (!input.name) {
    errors.push({ field: "name", key: "error.name.required" });
  }

  if (
    input.productDiscountType === "none" &&
    input.orderDiscountType === "none" &&
    input.shippingDiscountType === "none"
  ) {
    errors.push({ field: "discountType", key: "error.type.required" });
  }

  if (input.productDiscountType === "percentage") {
    validatePercentage(input.productDiscountPercentage, "productPercentage", "label.productPercentage", errors);
  }

  if (input.productDiscountType === "fixed_amount") {
    validateMoney(
      input.productDiscountFixedAmount,
      input.productDiscountFixedCurrencyCode,
      "productFixedAmount",
      "productFixedCurrency",
      "label.productFixed",
      errors,
    );
  }

  if (input.productDiscountType === "buy_one_get_one_free") {
    validateWholeNumber(input.productDiscountBuyQuantity, "productBuyQuantity", "label.buyQuantity", errors);
    validateWholeNumber(input.productDiscountFreeQuantity, "productFreeQuantity", "label.freeQuantity", errors);
  }

  if (input.productDiscountType === "volume_tier") {
    validateVolumeTiers(input.productDiscountVolumeTiers, errors);
  }

  if (input.orderDiscountType === "percentage") {
    validatePercentage(input.orderDiscountPercentage, "orderPercentage", "label.orderPercentage", errors);
    if (input.orderDiscountMaximumAmount) {
      validateMoney(
        input.orderDiscountMaximumAmount,
        input.orderDiscountMaximumCurrencyCode,
        "orderMaximumAmount",
        "orderMaximumCurrency",
        "label.orderMaximum",
        errors,
      );
    }
  }

  if (input.orderDiscountType === "fixed_amount") {
    validateMoney(
      input.orderDiscountFixedAmount,
      input.orderDiscountFixedCurrencyCode,
      "orderFixedAmount",
      "orderFixedCurrency",
      "label.orderFixed",
      errors,
    );
  }

  if (input.shippingDiscountType === "percentage") {
    validatePercentage(input.shippingDiscountPercentage, "shippingPercentage", "label.shippingPercentage", errors);
  }

  if (input.shippingDiscountType === "fixed_amount") {
    validateMoney(
      input.shippingDiscountFixedAmount,
      input.shippingDiscountFixedCurrencyCode,
      "shippingFixedAmount",
      "shippingFixedCurrency",
      "label.shippingFixed",
      errors,
    );
  }

  if (input.minimumCartSubtotalAmount) {
    validateMoney(
      input.minimumCartSubtotalAmount,
      input.minimumCartSubtotalCurrencyCode,
      "minimumSubtotalAmount",
      "minimumSubtotalCurrency",
      "label.minSubtotal",
      errors,
    );
  }

  if (
    input.minimumCartQuantity !== undefined &&
    (!Number.isInteger(input.minimumCartQuantity) || input.minimumCartQuantity <= 0)
  ) {
    errors.push({
      field: "minimumCartQuantity",
      key: "error.whole.range",
      paramKeys: { label: "label.minQuantity" },
    });
  }

  validateDateRange(input.startsAt, input.endsAt, errors);

  return errors;
}

function validateVolumeTiers(
  tiers: CampaignFormInput["productDiscountVolumeTiers"],
  errors: FormError[],
) {
  if (!tiers?.length) {
    errors.push({ field: "productVolumeTiers", key: "error.tiers.required" });
    return;
  }

  for (const tier of tiers) {
    validateWholeNumber(tier.minimumQuantity, "productVolumeTiers", "label.tierMin", errors);
    validatePercentage(tier.percentage, "productVolumeTiers", "label.tierPct", errors);
  }
}

function validatePercentage(
  value: number | undefined,
  field: FieldErrorKey,
  labelKey: TranslationKey,
  errors: FormError[],
) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    errors.push({ field, key: "error.percentage.required", paramKeys: { label: labelKey } });
    return;
  }

  if (value <= 0 || value > 100) {
    errors.push({ field, key: "error.percentage.range", paramKeys: { label: labelKey } });
  }
}

function validateMoney(
  amount: string | undefined,
  currencyCode: string | undefined,
  amountField: FieldErrorKey,
  currencyField: FieldErrorKey,
  labelKey: TranslationKey,
  errors: FormError[],
) {
  const numericAmount = Number(amount);

  if (!amount || !Number.isFinite(numericAmount) || numericAmount <= 0) {
    errors.push({ field: amountField, key: "error.amount.required", paramKeys: { label: labelKey } });
  }

  if (!currencyCode || !/^[A-Z]{3}$/.test(currencyCode)) {
    errors.push({ field: currencyField, key: "error.currency.invalid", paramKeys: { label: labelKey } });
  }
}

function validateWholeNumber(
  value: number | undefined,
  field: FieldErrorKey,
  labelKey: TranslationKey,
  errors: FormError[],
) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    errors.push({ field, key: "error.whole.required", paramKeys: { label: labelKey } });
    return;
  }

  if (!Number.isInteger(value) || value <= 0) {
    errors.push({ field, key: "error.whole.range", paramKeys: { label: labelKey } });
  }
}

function validateDateRange(
  startsAt: string | undefined,
  endsAt: string | undefined,
  errors: FormError[],
) {
  if (startsAt && !/^\d{4}-\d{2}-\d{2}$/.test(startsAt)) {
    errors.push({ field: "startsAt", key: "error.date.invalid", paramKeys: { label: "label.startDate" } });
  }

  if (endsAt && !/^\d{4}-\d{2}-\d{2}$/.test(endsAt)) {
    errors.push({ field: "endsAt", key: "error.date.invalid", paramKeys: { label: "label.endDate" } });
  }

  if (startsAt && endsAt && startsAt > endsAt) {
    errors.push({ field: "endsAt", key: "error.date.order" });
  }
}
