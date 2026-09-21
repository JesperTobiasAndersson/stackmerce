import type { CampaignFormInput } from "./campaign-storage.server";
import { formatDate, formatMoney, type Locale, type Translate } from "./i18n";

/**
 * Short, merchant-readable description of what a discount does, e.g.
 * ["10% off products", "2 collections, excludes 1", "Min. 500 kr", "Until Oct 31"].
 * Works from the form input shape so the editor can show it live and the
 * list can show it from stored config (via `campaignInputFromConfig`).
 */
export function describeCampaign(
  input: CampaignFormInput,
  t: Translate,
  locale: Locale,
): string[] {
  const parts: string[] = [];
  const money = (amount: string | undefined, currency: string | undefined) =>
    formatMoney(locale, amount ?? "0", currency ?? "");

  switch (input.productDiscountType) {
    case "percentage":
      if (input.productDiscountPercentage != null) {
        parts.push(t("summary.percentageProducts", { value: input.productDiscountPercentage }));
      }
      break;
    case "fixed_amount":
      if (input.productDiscountFixedAmount) {
        parts.push(
          t("summary.fixedProducts", {
            amount: money(input.productDiscountFixedAmount, input.productDiscountFixedCurrencyCode),
          }),
        );
      }
      break;
    case "buy_one_get_one_free":
      parts.push(
        t("summary.bogo", {
          buy: input.productDiscountBuyQuantity ?? 1,
          free: input.productDiscountFreeQuantity ?? 1,
        }),
      );
      break;
    case "volume_tier": {
      const best = Math.max(
        0,
        ...(input.productDiscountVolumeTiers ?? []).map((tier) => Number(tier.percentage) || 0),
      );
      if (best > 0) {
        parts.push(t("summary.volume", { value: best }));
      }
      break;
    }
  }

  if (input.orderDiscountType === "percentage" && input.orderDiscountPercentage != null) {
    parts.push(
      input.orderDiscountMaximumAmount
        ? t("summary.percentageOrderCapped", {
            value: input.orderDiscountPercentage,
            amount: money(input.orderDiscountMaximumAmount, input.orderDiscountMaximumCurrencyCode),
          })
        : t("summary.percentageOrder", { value: input.orderDiscountPercentage }),
    );
  } else if (input.orderDiscountType === "fixed_amount" && input.orderDiscountFixedAmount) {
    parts.push(
      t("summary.fixedOrder", {
        amount: money(input.orderDiscountFixedAmount, input.orderDiscountFixedCurrencyCode),
      }),
    );
  }

  switch (input.shippingDiscountType) {
    case "free_shipping":
      parts.push(t("summary.freeShipping"));
      break;
    case "percentage":
      if (input.shippingDiscountPercentage != null) {
        parts.push(t("summary.percentageShipping", { value: input.shippingDiscountPercentage }));
      }
      break;
    case "fixed_amount":
      if (input.shippingDiscountFixedAmount) {
        parts.push(
          t("summary.fixedShipping", {
            amount: money(input.shippingDiscountFixedAmount, input.shippingDiscountFixedCurrencyCode),
          }),
        );
      }
      break;
  }

  if (input.shippingDiscountType !== "none" && input.shippingDeliveryOptionTitle) {
    parts.push(t("summary.shippingMethod", { method: input.shippingDeliveryOptionTitle }));
  }

  const products = input.productIds?.length ?? 0;
  const collections = input.collectionIds?.length ?? 0;
  const excluded = (input.excludedProductIds?.length ?? 0) + (input.excludedCollectionIds?.length ?? 0);
  const scope: string[] = [];
  if (products) {
    scope.push(products === 1 ? t("summary.product") : t("summary.products", { count: products }));
  }
  if (collections) {
    scope.push(
      collections === 1 ? t("summary.collection") : t("summary.collections", { count: collections }),
    );
  }
  if (!scope.length && (input.productDiscountType !== "none" || input.orderDiscountType !== "none")) {
    scope.push(t("summary.allProducts"));
  }
  if (scope.length) {
    parts.push(
      excluded ? `${scope.join(", ")}, ${t("summary.excludes", { count: excluded })}` : scope.join(", "),
    );
  }

  if (input.minimumCartSubtotalAmount) {
    parts.push(
      t("summary.minSubtotal", {
        amount: money(input.minimumCartSubtotalAmount, input.minimumCartSubtotalCurrencyCode),
      }),
    );
  }
  if (input.minimumCartQuantity) {
    parts.push(t("summary.minQuantity", { count: input.minimumCartQuantity }));
  }
  if (input.marketName) {
    parts.push(t("summary.market", { market: input.marketName }));
  }

  if (input.startsAt && input.endsAt) {
    parts.push(
      t("summary.range", {
        start: formatDate(locale, input.startsAt),
        end: formatDate(locale, input.endsAt),
      }),
    );
  } else if (input.startsAt) {
    parts.push(t("summary.from", { date: formatDate(locale, input.startsAt) }));
  } else if (input.endsAt) {
    parts.push(t("summary.until", { date: formatDate(locale, input.endsAt) }));
  }

  return parts;
}
