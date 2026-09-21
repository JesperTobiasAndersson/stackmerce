import type { Translate, TranslationKey } from "./i18n";

export type FieldErrorKey =
  | "name"
  | "discountType"
  | "productPercentage"
  | "productFixedAmount"
  | "productFixedCurrency"
  | "productBuyQuantity"
  | "productFreeQuantity"
  | "productVolumeTiers"
  | "orderPercentage"
  | "orderMaximumAmount"
  | "orderMaximumCurrency"
  | "orderFixedAmount"
  | "orderFixedCurrency"
  | "shippingPercentage"
  | "shippingFixedAmount"
  | "shippingFixedCurrency"
  | "minimumSubtotalAmount"
  | "minimumSubtotalCurrency"
  | "minimumCartQuantity"
  | "startsAt"
  | "endsAt";

/**
 * A validation problem the editor can both list in a banner and attach to a
 * field. Translated at render time so the merchant sees it in their language.
 * `paramKeys` are translation keys resolved into `params` before formatting;
 * `message` is a raw, untranslated string (e.g. from the Shopify API).
 */
export interface FormError {
  field: FieldErrorKey | null;
  key?: TranslationKey;
  params?: Record<string, string | number>;
  paramKeys?: Record<string, TranslationKey>;
  message?: string;
}

export function formErrorMessage(error: FormError, t: Translate): string {
  if (!error.key) {
    return error.message ?? "";
  }

  const params: Record<string, string | number> = { ...(error.params ?? {}) };
  for (const [name, key] of Object.entries(error.paramKeys ?? {})) {
    params[name] = t(key);
  }

  return t(error.key, params);
}

export function fieldErrorMessages(
  errors: FormError[],
  t: Translate,
): Partial<Record<FieldErrorKey, string>> {
  const messages: Partial<Record<FieldErrorKey, string>> = {};

  for (const error of errors) {
    if (error.field && !messages[error.field]) {
      messages[error.field] = formErrorMessage(error, t);
    }
  }

  return messages;
}

export function rawError(message: string): FormError {
  return { field: null, message };
}
