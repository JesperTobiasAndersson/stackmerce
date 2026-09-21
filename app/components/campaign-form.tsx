import { useEffect, useRef, useState } from "react";
import { Form, useLocation } from "react-router";

import type {
  OrderDiscountType,
  ProductDiscountType,
  ShippingDiscountType,
} from "../campaign-config";
import { campaignInputFromForm } from "../campaign-form-input";
import type { CampaignFormInput } from "../campaign-storage.server";
import { describeCampaign } from "../campaign-summary";
import {
  entitlementForPlan,
  formatCampaignLimit,
  isAtActiveCampaignLimit,
  lockedFeaturesForCampaign,
  PAID_PLAN_TRIAL_DAYS,
  PLAN_ENTITLEMENTS,
  type AppPlan,
} from "../entitlements";
import { fieldErrorMessages, formErrorMessage, type FormError } from "../form-errors";
import type { Translate, TranslationKey } from "../i18n";
import { useTranslation } from "../i18n/react";
import { fieldValue, flag } from "../lib/polaris";
import type { CurrencyCode } from "../lib/polaris";
import type {
  ShopifyCollectionSummary,
  ShopifyMarketSummary,
  ShopifyProductSummary,
  ShopifyShippingMethodSummary,
} from "../shopify-api.server";

const VOLUME_TIER_ROWS = 3;

export interface CampaignFormProps {
  mode: "create" | "edit";
  plan: AppPlan;
  initialValues: CampaignFormInput;
  initialSelectedProducts?: ShopifyProductSummary[];
  initialSelectedCollections?: ShopifyCollectionSummary[];
  initialExcludedProducts?: ShopifyProductSummary[];
  initialExcludedCollections?: ShopifyCollectionSummary[];
  defaultCurrency: string;
  availableCurrencies: string[];
  shippingMethods: ShopifyShippingMethodSummary[];
  markets: ShopifyMarketSummary[];
  /** Active campaigns on the store; used for the plan limit hint. */
  activeCampaignCount: number;
  errors: FormError[];
  isSaving: boolean;
}

export function emptyCampaignFormInput(): CampaignFormInput {
  return {
    name: "",
    status: "inactive",
    productDiscountType: "none",
    orderDiscountType: "none",
    shippingDiscountType: "none",
    combinesWithOrderDiscounts: false,
    combinesWithProductDiscounts: true,
    combinesWithShippingDiscounts: true,
    productIds: [],
    collectionIds: [],
    excludedProductIds: [],
    excludedCollectionIds: [],
  };
}

/**
 * The campaign editor. Renders the form plus a live summary for the page's
 * `aside` slot, so it must be a direct child of `<s-page>`. Saving goes
 * through the App Bridge contextual save bar (`data-save-bar`), which submits
 * the React Router form.
 */
export function CampaignForm({
  mode,
  plan,
  initialValues,
  initialSelectedProducts = [],
  initialSelectedCollections = [],
  initialExcludedProducts = [],
  initialExcludedCollections = [],
  defaultCurrency,
  availableCurrencies,
  shippingMethods,
  markets,
  activeCampaignCount,
  errors,
  isSaving,
}: CampaignFormProps) {
  const { t, locale } = useTranslation();
  const entitlements = entitlementForPlan(plan);
  const { search } = useLocation();
  const plansHref = `/app/plans${search}`;
  const fieldErrors = fieldErrorMessages(errors, t);
  const formRef = useRef<HTMLFormElement>(null);

  const [productDiscountType, setProductDiscountType] = useState<ProductDiscountType>(
    initialValues.productDiscountType,
  );
  const [orderDiscountType, setOrderDiscountType] = useState<OrderDiscountType>(
    initialValues.orderDiscountType,
  );
  const [shippingDiscountType, setShippingDiscountType] =
    useState<ShippingDiscountType>(initialValues.shippingDiscountType);
  const [showOrder, setShowOrder] = useState(initialValues.orderDiscountType !== "none");
  const [showShipping, setShowShipping] = useState(
    initialValues.shippingDiscountType !== "none",
  );
  const [shippingDeliveryOptionHandle, setShippingDeliveryOptionHandle] =
    useState(initialValues.shippingDeliveryOptionHandle ?? "");
  const [marketHandle, setMarketHandle] = useState(initialValues.marketHandle ?? "");
  const [status, setStatus] = useState(initialValues.status);
  const [selectedProducts, setSelectedProducts] = useState(initialSelectedProducts);
  const [excludedProducts, setExcludedProducts] = useState(initialExcludedProducts);
  const [selectedCollections, setSelectedCollections] = useState(
    initialSelectedCollections,
  );
  const [excludedCollections, setExcludedCollections] = useState(
    initialExcludedCollections,
  );
  const initialCurrencies = () => ({
    productFixed: initialValues.productDiscountFixedCurrencyCode ?? defaultCurrency,
    orderMaximum: initialValues.orderDiscountMaximumCurrencyCode ?? defaultCurrency,
    orderFixed: initialValues.orderDiscountFixedCurrencyCode ?? defaultCurrency,
    shippingFixed: initialValues.shippingDiscountFixedCurrencyCode ?? defaultCurrency,
    minimumSubtotal: initialValues.minimumCartSubtotalCurrencyCode ?? defaultCurrency,
  });
  const [currencies, setCurrencies] = useState(initialCurrencies);
  const [summaryInput, setSummaryInput] = useState<CampaignFormInput>(initialValues);

  // Scroll the error summary into view when a new set of errors comes back.
  const errorKey = errors.map((error) => formErrorMessage(error, t)).join("\n");
  useEffect(() => {
    if (errorKey) {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [errorKey]);

  /** Re-read the form so the summary aside reflects what is typed. */
  const refreshSummary = () => {
    const form = formRef.current;
    if (form) {
      setSummaryInput(campaignInputFromForm(new FormData(form)));
    }
  };

  // Polaris fields dispatch native input/change events that React's synthetic
  // onChange does not recognise for custom elements, so listen natively.
  useEffect(() => {
    const form = formRef.current;
    if (!form) {
      return;
    }

    form.addEventListener("input", refreshSummary);
    form.addEventListener("change", refreshSummary);

    return () => {
      form.removeEventListener("input", refreshSummary);
      form.removeEventListener("change", refreshSummary);
    };
    // refreshSummary only reads refs and calls a setter; stable for the mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * The save bar watches input/change events. Product and collection choices
   * come back from the resource picker and land in hidden inputs, so nudge it.
   */
  const markDirty = () => {
    // Let React commit the hidden inputs before the form is re-read.
    window.setTimeout(() => {
      formRef.current?.dispatchEvent(new Event("change", { bubbles: true }));
      refreshSummary();
    }, 0);
  };

  // Discard from the save bar resets native fields; mirror that for the
  // React-held state so the controlled selects and pickers follow.
  const resetState = () => {
    setProductDiscountType(initialValues.productDiscountType);
    setOrderDiscountType(initialValues.orderDiscountType);
    setShippingDiscountType(initialValues.shippingDiscountType);
    setShowOrder(initialValues.orderDiscountType !== "none");
    setShowShipping(initialValues.shippingDiscountType !== "none");
    setShippingDeliveryOptionHandle(initialValues.shippingDeliveryOptionHandle ?? "");
    setMarketHandle(initialValues.marketHandle ?? "");
    setStatus(initialValues.status);
    setSelectedProducts(initialSelectedProducts);
    setExcludedProducts(initialExcludedProducts);
    setSelectedCollections(initialSelectedCollections);
    setExcludedCollections(initialExcludedCollections);
    setCurrencies(initialCurrencies());
    setSummaryInput(initialValues);
  };

  const isNewlyActivating =
    initialValues.status !== "active" &&
    isAtActiveCampaignLimit(plan, activeCampaignCount);
  const initialLockedFeatures = lockedFeaturesForCampaign(initialValues, plan);
  const selectedMarketName =
    markets.find((market) => market.handle === marketHandle)?.name ??
    (marketHandle ? initialValues.marketName ?? "" : "");
  const selectedShippingMethodName =
    shippingMethods.find((method) => method.handle === shippingDeliveryOptionHandle)
      ?.name ??
    (shippingDeliveryOptionHandle
      ? initialValues.shippingDeliveryOptionTitle ?? ""
      : "");
  const scheduleLocked = !entitlements.scheduling;
  const scheduleHasValues = Boolean(initialValues.startsAt || initialValues.endsAt);
  const shippingLocked = !entitlements.shippingDiscounts;
  const marketLocked = !entitlements.marketTargeting;
  const multiCurrency = availableCurrencies.length > 1;
  const usesFixedAmount =
    productDiscountType === "fixed_amount" ||
    orderDiscountType === "fixed_amount" ||
    shippingDiscountType === "fixed_amount";
  const currencyOptions = (current: string) =>
    availableCurrencies.includes(current)
      ? availableCurrencies
      : [current, ...availableCurrencies];
  const summary = describeCampaign(summaryInput, t, locale);
  const proNote = t("common.upgradeNote", {
    price: PLAN_ENTITLEMENTS.pro.priceLabel,
    days: PAID_PLAN_TRIAL_DAYS,
  });

  return (
    <>
      <Form
        data-discard-confirmation
        data-save-bar
        method="post"
        noValidate
        onReset={resetState}
        ref={formRef}
      >
        <s-stack direction="block" gap="base">
          {errors.length ? (
            <s-banner
              heading={
                errors.length === 1
                  ? t("editor.errors.one")
                  : t("editor.errors.many", { count: errors.length })
              }
              tone="critical"
            >
              <s-unordered-list>
                {errors.map((error, index) => (
                  <s-list-item key={index}>{formErrorMessage(error, t)}</s-list-item>
                ))}
              </s-unordered-list>
            </s-banner>
          ) : null}

          {mode === "edit" && initialLockedFeatures.length ? (
            <s-banner
              heading={t("editor.locked.heading", { plan: entitlements.name })}
              tone="warning"
            >
              <s-paragraph>
                {t("editor.locked.text", {
                  features: initialLockedFeatures.map((key) => t(key)).join(", "),
                })}{" "}
                <s-link href={plansHref}>{t("common.viewPlans")}</s-link>
              </s-paragraph>
            </s-banner>
          ) : null}

          {multiCurrency && usesFixedAmount ? (
            <s-banner heading={t("editor.currencyWarning.heading")} tone="warning">
              <s-paragraph>
                {t("editor.currencyWarning.text", {
                  count: availableCurrencies.length,
                  currency: defaultCurrency,
                })}
              </s-paragraph>
            </s-banner>
          ) : null}

          {/* 1. Details */}
          <s-section heading={t("editor.details.heading")}>
            <s-stack direction="block" gap="base">
              <s-text-field
                defaultValue={initialValues.name}
                details={t("editor.details.nameHelp")}
                error={fieldErrors.name}
                label={t("editor.details.name")}
                name="name"
                placeholder={t("editor.details.namePlaceholder")}
                required
              />
              <s-select
                details={
                  isNewlyActivating
                    ? t("editor.details.statusLimit", {
                        active: activeCampaignCount,
                        limit: formatCampaignLimit(entitlements.maxActiveCampaigns),
                        plan: entitlements.name,
                      })
                    : t("editor.details.statusHelp")
                }
                label={t("editor.details.status")}
                name="status"
                onChange={(event) =>
                  setStatus(fieldValue(event) === "active" ? "active" : "inactive")
                }
                value={status}
              >
                <s-option value="inactive">{t("common.draft")}</s-option>
                <s-option disabled={flag(isNewlyActivating)} value="active">
                  {isNewlyActivating ? t("editor.details.activeLimited") : t("common.active")}
                </s-option>
              </s-select>
              {isNewlyActivating ? (
                <UpgradeNote
                  plansHref={plansHref}
                  t={t}
                  text={`${t("editor.details.limitNote", {
                    limit: formatCampaignLimit(PLAN_ENTITLEMENTS.pro.maxActiveCampaigns),
                  })} ${proNote}`}
                />
              ) : null}
            </s-stack>
          </s-section>

          {/* 2. Product discount */}
          <s-section heading={t("editor.product.heading")}>
            <s-stack direction="block" gap="base">
              <s-select
                error={fieldErrors.discountType}
                label={t("editor.type")}
                name="productDiscountType"
                onChange={(event) =>
                  setProductDiscountType(fieldValue(event) as ProductDiscountType)
                }
                value={productDiscountType}
              >
                <s-option value="none">{t("editor.type.none.product")}</s-option>
                <s-option value="percentage">{t("editor.type.percentageProducts")}</s-option>
                <PlanOption
                  allowed={entitlements.fixedAmountDiscounts}
                  current={initialValues.productDiscountType}
                  label={t("editor.type.fixedProducts")}
                  t={t}
                  value="fixed_amount"
                />
                <PlanOption
                  allowed={entitlements.bogoDiscounts}
                  current={initialValues.productDiscountType}
                  label={t("editor.type.bogo")}
                  t={t}
                  value="buy_one_get_one_free"
                />
                <PlanOption
                  allowed={entitlements.volumeTiers}
                  current={initialValues.productDiscountType}
                  label={t("editor.type.volume")}
                  t={t}
                  value="volume_tier"
                />
              </s-select>
              {!entitlements.fixedAmountDiscounts ? (
                <UpgradeNote
                  plansHref={plansHref}
                  t={t}
                  text={`${t("editor.product.proNote")} ${proNote}`}
                />
              ) : null}
              <Explanation text={productDiscountExplanation(productDiscountType, t)} />

              {productDiscountType === "percentage" ? (
                <PercentageField
                  defaultValue={initialValues.productDiscountPercentage}
                  error={fieldErrors.productPercentage}
                  name="productDiscountPercentage"
                  t={t}
                />
              ) : null}

              {productDiscountType === "fixed_amount" ? (
                <MoneyFields
                  amountError={fieldErrors.productFixedAmount}
                  amountName="productDiscountFixedAmount"
                  currency={currencies.productFixed}
                  currencyError={fieldErrors.productFixedCurrency}
                  currencyName="productDiscountFixedCurrencyCode"
                  currencyOptions={currencyOptions(currencies.productFixed)}
                  defaultAmount={initialValues.productDiscountFixedAmount}
                  label={t("editor.amountOff")}
                  multiCurrency={multiCurrency}
                  onCurrencyChange={(code) =>
                    setCurrencies((current) => ({ ...current, productFixed: code }))
                  }
                  required
                  t={t}
                />
              ) : null}

              {productDiscountType === "buy_one_get_one_free" ? (
                <s-grid gap="base" gridTemplateColumns="1fr 1fr">
                  <s-number-field
                    defaultValue={String(initialValues.productDiscountBuyQuantity ?? 1)}
                    error={fieldErrors.productBuyQuantity}
                    inputMode="numeric"
                    label={t("editor.buyQuantity")}
                    min={1}
                    name="productDiscountBuyQuantity"
                    required
                    step={1}
                  />
                  <s-number-field
                    defaultValue={String(initialValues.productDiscountFreeQuantity ?? 1)}
                    details={t("editor.freeQuantityHelp")}
                    error={fieldErrors.productFreeQuantity}
                    inputMode="numeric"
                    label={t("editor.freeQuantity")}
                    min={1}
                    name="productDiscountFreeQuantity"
                    required
                    step={1}
                  />
                </s-grid>
              ) : null}

              {productDiscountType === "volume_tier" ? (
                <s-stack direction="block" gap="base">
                  {Array.from({ length: VOLUME_TIER_ROWS }, (_, index) => {
                    const tier = initialValues.productDiscountVolumeTiers?.[index];
                    const isFirst = index === 0;

                    return (
                      <s-grid gap="base" gridTemplateColumns="1fr 1fr" key={index}>
                        <s-number-field
                          defaultValue={
                            tier?.minimumQuantity != null ? String(tier.minimumQuantity) : ""
                          }
                          inputMode="numeric"
                          label={t("editor.tierMin", { n: index + 1 })}
                          min={1}
                          name="productVolumeTierMinimumQuantity"
                          placeholder={isFirst ? "3" : t("editor.tierOptional")}
                          required={flag(isFirst)}
                          step={1}
                        />
                        <s-number-field
                          defaultValue={tier?.percentage != null ? String(tier.percentage) : ""}
                          inputMode="decimal"
                          label={t("editor.tierPct", { n: index + 1 })}
                          max={100}
                          min={0.01}
                          name="productVolumeTierPercentage"
                          placeholder={isFirst ? "10" : t("editor.tierOptional")}
                          required={flag(isFirst)}
                          step={0.01}
                          suffix="%"
                        />
                      </s-grid>
                    );
                  })}
                  <s-text color="subdued">{t("editor.tierHelp")}</s-text>
                  {fieldErrors.productVolumeTiers ? (
                    <s-text tone="critical">{fieldErrors.productVolumeTiers}</s-text>
                  ) : null}
                </s-stack>
              ) : null}
            </s-stack>
          </s-section>

          {/* 3. Order discount (collapsed until wanted) */}
          {showOrder ? (
            <s-section heading={t("editor.order.heading")}>
              <s-stack direction="block" gap="base">
                <s-select
                  label={t("editor.type")}
                  name="orderDiscountType"
                  onChange={(event) =>
                    setOrderDiscountType(fieldValue(event) as OrderDiscountType)
                  }
                  value={orderDiscountType}
                >
                  <s-option value="none">{t("editor.type.none.order")}</s-option>
                  <s-option value="percentage">{t("editor.type.percentageOrder")}</s-option>
                  <PlanOption
                    allowed={entitlements.fixedAmountDiscounts}
                    current={initialValues.orderDiscountType}
                    label={t("editor.type.fixedOrder")}
                    t={t}
                    value="fixed_amount"
                  />
                </s-select>
                <Explanation text={orderDiscountExplanation(orderDiscountType, t)} />

                {orderDiscountType === "percentage" ? (
                  <>
                    <PercentageField
                      defaultValue={initialValues.orderDiscountPercentage}
                      error={fieldErrors.orderPercentage}
                      name="orderDiscountPercentage"
                      t={t}
                    />
                    <MoneyFields
                      amountError={fieldErrors.orderMaximumAmount}
                      amountName="orderDiscountMaximumAmount"
                      currency={currencies.orderMaximum}
                      currencyError={fieldErrors.orderMaximumCurrency}
                      currencyName="orderDiscountMaximumCurrencyCode"
                      currencyOptions={currencyOptions(currencies.orderMaximum)}
                      defaultAmount={initialValues.orderDiscountMaximumAmount}
                      details={t("editor.maximumHelp")}
                      label={t("editor.maximumAmount")}
                      multiCurrency={multiCurrency}
                      onCurrencyChange={(code) =>
                        setCurrencies((current) => ({ ...current, orderMaximum: code }))
                      }
                      t={t}
                    />
                  </>
                ) : null}

                {orderDiscountType === "fixed_amount" ? (
                  <MoneyFields
                    amountError={fieldErrors.orderFixedAmount}
                    amountName="orderDiscountFixedAmount"
                    currency={currencies.orderFixed}
                    currencyError={fieldErrors.orderFixedCurrency}
                    currencyName="orderDiscountFixedCurrencyCode"
                    currencyOptions={currencyOptions(currencies.orderFixed)}
                    defaultAmount={initialValues.orderDiscountFixedAmount}
                    label={t("editor.amountOff")}
                    multiCurrency={multiCurrency}
                    onCurrencyChange={(code) =>
                      setCurrencies((current) => ({ ...current, orderFixed: code }))
                    }
                    required
                    t={t}
                  />
                ) : null}
              </s-stack>
            </s-section>
          ) : (
            <AddSection
              help={t("editor.order.addHelp")}
              heading={t("editor.order.heading")}
              label={t("editor.order.add")}
              onAdd={() => setShowOrder(true)}
            >
              <input name="orderDiscountType" type="hidden" value="none" />
            </AddSection>
          )}

          {/* 4. Shipping discount (collapsed until wanted; upgrade panel on Free) */}
          {shippingLocked && initialValues.shippingDiscountType === "none" ? (
            <s-section heading={t("editor.shipping.heading")}>
              <input name="shippingDiscountType" type="hidden" value="none" />
              <UpgradePanel
                plansHref={plansHref}
                points={[
                  t("editor.shipping.upgrade1"),
                  t("editor.shipping.upgrade2"),
                  t("editor.shipping.upgrade3"),
                ]}
                t={t}
                title={t("editor.shipping.upgradeTitle")}
              />
            </s-section>
          ) : showShipping ? (
            <s-section heading={t("editor.shipping.heading")}>
              <s-stack direction="block" gap="base">
                <s-select
                  label={t("editor.type")}
                  name="shippingDiscountType"
                  onChange={(event) => {
                    const value = fieldValue(event) as ShippingDiscountType;
                    setShippingDiscountType(value);
                    if (value === "none") {
                      setShippingDeliveryOptionHandle("");
                    }
                  }}
                  value={shippingDiscountType}
                >
                  <s-option value="none">{t("editor.type.none.shipping")}</s-option>
                  <PlanOption
                    allowed={entitlements.shippingDiscounts}
                    current={initialValues.shippingDiscountType}
                    label={t("editor.type.freeShipping")}
                    t={t}
                    value="free_shipping"
                  />
                  <PlanOption
                    allowed={entitlements.shippingDiscounts}
                    current={initialValues.shippingDiscountType}
                    label={t("editor.type.percentageShipping")}
                    t={t}
                    value="percentage"
                  />
                  <PlanOption
                    allowed={
                      entitlements.shippingDiscounts && entitlements.fixedAmountDiscounts
                    }
                    current={initialValues.shippingDiscountType}
                    label={t("editor.type.fixedShipping")}
                    t={t}
                    value="fixed_amount"
                  />
                </s-select>
                {shippingLocked ? (
                  <UpgradeNote
                    plansHref={plansHref}
                    t={t}
                    text={`${t("editor.shipping.proNote")} ${proNote}`}
                  />
                ) : null}
                <Explanation text={shippingDiscountExplanation(shippingDiscountType, t)} />

                {shippingDiscountType !== "none" ? (
                  <>
                    <s-select
                      details={
                        shippingMethods.length
                          ? t("editor.shipping.methodHelp")
                          : t("editor.shipping.methodMissing")
                      }
                      disabled={flag(
                        !entitlements.shippingMethodTargeting &&
                          !initialValues.shippingDeliveryOptionHandle,
                      )}
                      label={t("editor.shipping.method")}
                      name="shippingDeliveryOptionHandle"
                      onChange={(event) => setShippingDeliveryOptionHandle(fieldValue(event))}
                      value={shippingDeliveryOptionHandle}
                    >
                      <s-option value="">{t("editor.shipping.allMethods")}</s-option>
                      {shippingMethods.map((method) => (
                        <s-option key={method.id} value={method.handle}>
                          {method.name} ({method.zoneName})
                        </s-option>
                      ))}
                      {shippingDeliveryOptionHandle &&
                      !shippingMethods.some(
                        (method) => method.handle === shippingDeliveryOptionHandle,
                      ) ? (
                        <s-option value={shippingDeliveryOptionHandle}>
                          {selectedShippingMethodName || shippingDeliveryOptionHandle}
                        </s-option>
                      ) : null}
                    </s-select>
                    <input
                      name="shippingDeliveryOptionTitle"
                      type="hidden"
                      value={selectedShippingMethodName}
                    />
                    {!entitlements.shippingMethodTargeting ? (
                      <UpgradeNote
                        plansHref={plansHref}
                        t={t}
                        text={`${t("editor.shipping.methodProNote")} ${proNote}`}
                      />
                    ) : null}
                  </>
                ) : null}

                {shippingDiscountType === "percentage" ? (
                  <PercentageField
                    defaultValue={initialValues.shippingDiscountPercentage}
                    error={fieldErrors.shippingPercentage}
                    name="shippingDiscountPercentage"
                    t={t}
                  />
                ) : null}

                {shippingDiscountType === "fixed_amount" ? (
                  <MoneyFields
                    amountError={fieldErrors.shippingFixedAmount}
                    amountName="shippingDiscountFixedAmount"
                    currency={currencies.shippingFixed}
                    currencyError={fieldErrors.shippingFixedCurrency}
                    currencyName="shippingDiscountFixedCurrencyCode"
                    currencyOptions={currencyOptions(currencies.shippingFixed)}
                    defaultAmount={initialValues.shippingDiscountFixedAmount}
                    label={t("editor.amountOff")}
                    multiCurrency={multiCurrency}
                    onCurrencyChange={(code) =>
                      setCurrencies((current) => ({ ...current, shippingFixed: code }))
                    }
                    required
                    t={t}
                  />
                ) : null}
              </s-stack>
            </s-section>
          ) : (
            <AddSection
              help={t("editor.shipping.addHelp")}
              heading={t("editor.shipping.heading")}
              label={t("editor.shipping.add")}
              onAdd={() => setShowShipping(true)}
            >
              <input name="shippingDiscountType" type="hidden" value="none" />
            </AddSection>
          )}

          {/* 5. Applies to */}
          <s-section heading={t("editor.applies.heading")}>
            <s-stack direction="block" gap="large">
              <s-text color="subdued">{t("editor.applies.intro")}</s-text>
              <ResourceSelection<ShopifyProductSummary>
                excluded={excludedProducts}
                excludedFieldName="excludedProductIds"
                heading={t("editor.applies.products")}
                included={selectedProducts}
                includedFieldName="productIds"
                onChange={markDirty}
                onExcludedChange={setExcludedProducts}
                onIncludedChange={setSelectedProducts}
                t={t}
                type="product"
              />
              <ResourceSelection<ShopifyCollectionSummary>
                excluded={excludedCollections}
                excludedFieldName="excludedCollectionIds"
                heading={t("editor.applies.collections")}
                included={selectedCollections}
                includedFieldName="collectionIds"
                onChange={markDirty}
                onExcludedChange={setExcludedCollections}
                onIncludedChange={setSelectedCollections}
                t={t}
                type="collection"
              />
            </s-stack>
          </s-section>

          {/* 6. Minimum requirements */}
          <s-section heading={t("editor.minimums.heading")}>
            <s-stack direction="block" gap="base">
              <s-text color="subdued">{t("editor.minimums.intro")}</s-text>
              <MoneyFields
                amountError={fieldErrors.minimumSubtotalAmount}
                amountName="minimumCartSubtotalAmount"
                currency={currencies.minimumSubtotal}
                currencyError={fieldErrors.minimumSubtotalCurrency}
                currencyName="minimumCartSubtotalCurrencyCode"
                currencyOptions={currencyOptions(currencies.minimumSubtotal)}
                defaultAmount={initialValues.minimumCartSubtotalAmount}
                details={t("editor.minimums.subtotalHelp")}
                label={t("editor.minimums.subtotal")}
                multiCurrency={multiCurrency}
                onCurrencyChange={(code) =>
                  setCurrencies((current) => ({ ...current, minimumSubtotal: code }))
                }
                t={t}
              />
              <s-number-field
                defaultValue={
                  initialValues.minimumCartQuantity != null
                    ? String(initialValues.minimumCartQuantity)
                    : ""
                }
                details={t("editor.minimums.quantityHelp")}
                error={fieldErrors.minimumCartQuantity}
                inputMode="numeric"
                label={t("editor.minimums.quantity")}
                min={1}
                name="minimumCartQuantity"
                placeholder="3"
                step={1}
              />
            </s-stack>
          </s-section>

          {/* 7. Combinations */}
          <s-section heading={t("editor.combinations.heading")}>
            <s-stack direction="block" gap="base">
              <s-text color="subdued">{t("editor.combinations.intro")}</s-text>
              <s-checkbox
                defaultChecked={flag(initialValues.combinesWithProductDiscounts ?? true)}
                label={t("editor.combinations.product")}
                name="combinesWithProductDiscounts"
                value="true"
              />
              <s-checkbox
                defaultChecked={flag(initialValues.combinesWithOrderDiscounts ?? false)}
                label={t("editor.combinations.order")}
                name="combinesWithOrderDiscounts"
                value="true"
              />
              <s-checkbox
                defaultChecked={flag(initialValues.combinesWithShippingDiscounts ?? true)}
                label={t("editor.combinations.shipping")}
                name="combinesWithShippingDiscounts"
                value="true"
              />
            </s-stack>
          </s-section>

          {/* 8. Market */}
          <s-section heading={t("editor.market.heading")}>
            {marketLocked && !initialValues.marketHandle ? (
              <UpgradePanel
                plansHref={plansHref}
                points={[t("editor.market.upgrade1"), t("editor.market.upgrade2")]}
                t={t}
                title={t("editor.market.upgradeTitle")}
              />
            ) : (
              <s-stack direction="block" gap="base">
                <s-select
                  details={markets.length ? t("editor.market.help") : t("editor.market.missing")}
                  label={t("editor.market.label")}
                  name="marketHandle"
                  onChange={(event) => setMarketHandle(fieldValue(event))}
                  value={marketHandle}
                >
                  <s-option value="">{t("editor.market.all")}</s-option>
                  {markets.map((market) => (
                    <s-option key={market.id} value={market.handle}>
                      {market.name}
                    </s-option>
                  ))}
                  {marketHandle && !markets.some((market) => market.handle === marketHandle) ? (
                    <s-option value={marketHandle}>{selectedMarketName || marketHandle}</s-option>
                  ) : null}
                </s-select>
                <input name="marketName" type="hidden" value={selectedMarketName} />
                {marketLocked ? (
                  <UpgradeNote
                    plansHref={plansHref}
                    t={t}
                    text={`${t("editor.market.proNote")} ${proNote}`}
                  />
                ) : null}
              </s-stack>
            )}
          </s-section>

          {/* 9. Schedule */}
          <s-section heading={t("editor.schedule.heading")}>
            {scheduleLocked && !scheduleHasValues ? (
              <UpgradePanel
                plansHref={plansHref}
                points={[
                  t("editor.schedule.upgrade1"),
                  t("editor.schedule.upgrade2"),
                  t("editor.schedule.upgrade3"),
                ]}
                t={t}
                title={t("editor.schedule.upgradeTitle")}
              />
            ) : (
              <s-stack direction="block" gap="base">
                <s-text color="subdued">{t("editor.schedule.intro")}</s-text>
                {scheduleLocked ? (
                  <UpgradeNote
                    plansHref={plansHref}
                    t={t}
                    text={`${t("editor.schedule.proNote")} ${proNote}`}
                  />
                ) : null}
                <s-grid gap="base" gridTemplateColumns="1fr 1fr">
                  <s-date-field
                    defaultValue={initialValues.startsAt ?? ""}
                    error={fieldErrors.startsAt}
                    label={t("editor.schedule.start")}
                    name="startsAt"
                  />
                  <s-date-field
                    defaultValue={initialValues.endsAt ?? ""}
                    details={t("editor.schedule.endHelp")}
                    error={fieldErrors.endsAt}
                    label={t("editor.schedule.end")}
                    name="endsAt"
                  />
                </s-grid>
              </s-stack>
            )}
          </s-section>

          {!isSaving ? (
            <s-box padding="base">
              <s-text color="subdued">{t("editor.saveHint")}</s-text>
            </s-box>
          ) : null}
        </s-stack>
      </Form>

      {/* Live summary beside the form */}
      <s-section heading={t("editor.summary.heading")} slot="aside">
        <s-stack direction="block" gap="base">
          <s-badge tone={status === "active" ? "success" : "neutral"}>
            {status === "active" ? t("common.active") : t("common.draft")}
          </s-badge>
          {summary.length ? (
            <s-unordered-list>
              {summary.map((line) => (
                <s-list-item key={line}>{line}</s-list-item>
              ))}
            </s-unordered-list>
          ) : (
            <s-text color="subdued">{t("editor.summary.empty")}</s-text>
          )}
          <s-text color="subdued">{t("common.planLabel", { plan: entitlements.name })}</s-text>
        </s-stack>
      </s-section>
    </>
  );
}

/* ----------------------------------------------------------------------------
 * Field helpers
 * ------------------------------------------------------------------------- */

/** A collapsed section with a single "Add ..." action. */
function AddSection({
  children,
  heading,
  help,
  label,
  onAdd,
}: {
  children?: React.ReactNode;
  heading: string;
  help: string;
  label: string;
  onAdd: () => void;
}) {
  return (
    <s-section heading={heading}>
      {children}
      <s-stack direction="block" gap="base">
        <s-text color="subdued">{help}</s-text>
        <s-stack direction="inline" gap="base">
          <s-button icon="plus" onClick={onAdd}>
            {label}
          </s-button>
        </s-stack>
      </s-stack>
    </s-section>
  );
}

/**
 * A select option gated by plan. Locked options stay disabled unless they are
 * the campaign's current value, so a downgraded merchant can still see (and
 * switch away from) what the campaign uses.
 */
function PlanOption({
  allowed,
  current,
  label,
  t,
  value,
}: {
  allowed: boolean;
  current: string;
  label: string;
  t: Translate;
  value: string;
}) {
  return (
    <s-option disabled={flag(!allowed && current !== value)} value={value}>
      {label}
      {allowed ? "" : t("editor.type.proSuffix")}
    </s-option>
  );
}

function UpgradeNote({
  plansHref,
  t,
  text,
}: {
  plansHref: string;
  t: Translate;
  text: string;
}) {
  return (
    <s-text color="subdued">
      {text} <s-link href={plansHref}>{t("common.viewPlans")}</s-link>
    </s-text>
  );
}

function UpgradePanel({
  plansHref,
  points,
  t,
  title,
}: {
  plansHref: string;
  points: string[];
  t: Translate;
  title: string;
}) {
  return (
    <s-box background="subdued" border="base" borderRadius="base" padding="base">
      <s-stack direction="block" gap="base">
        <s-text type="strong">{title}</s-text>
        <s-unordered-list>
          {points.map((point) => (
            <s-list-item key={point}>{point}</s-list-item>
          ))}
        </s-unordered-list>
        <s-stack alignItems="center" direction="inline" gap="base">
          <s-button href={plansHref} variant="primary">
            {t("common.startTrial", { days: PAID_PLAN_TRIAL_DAYS })}
          </s-button>
          <s-text color="subdued">
            {t("common.trialNote", { price: PLAN_ENTITLEMENTS.pro.priceLabel })}
          </s-text>
        </s-stack>
      </s-stack>
    </s-box>
  );
}

function Explanation({ text }: { text: string | null }) {
  if (!text) {
    return null;
  }

  return <s-text color="subdued">{text}</s-text>;
}

function PercentageField({
  defaultValue,
  error,
  name,
  t,
}: {
  defaultValue: number | undefined;
  error: string | undefined;
  name: string;
  t: Translate;
}) {
  return (
    <s-number-field
      defaultValue={defaultValue != null ? String(defaultValue) : ""}
      details={t("editor.percentageHelp")}
      error={error}
      inputMode="decimal"
      label={t("editor.percentage")}
      max={100}
      min={0.01}
      name={name}
      placeholder="10"
      required
      step={0.01}
      suffix="%"
    />
  );
}

function MoneyFields({
  amountError,
  amountName,
  currency,
  currencyError,
  currencyName,
  currencyOptions,
  defaultAmount,
  details,
  label,
  multiCurrency,
  onCurrencyChange,
  required = false,
  t,
}: {
  amountError: string | undefined;
  amountName: string;
  currency: string;
  currencyError: string | undefined;
  currencyName: string;
  currencyOptions: string[];
  defaultAmount: string | undefined;
  details?: string;
  label: string;
  multiCurrency: boolean;
  onCurrencyChange: (code: string) => void;
  required?: boolean;
  t: Translate;
}) {
  const help = [details, multiCurrency ? t("editor.currencyHelp", { currency }) : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <s-grid alignItems="start" gap="base" gridTemplateColumns="2fr 1fr">
      <s-money-field
        currencyCode={currency as CurrencyCode}
        defaultValue={defaultAmount ?? ""}
        details={help || undefined}
        error={amountError}
        label={label}
        min={0}
        name={amountName}
        placeholder="0.00"
        required={flag(required)}
      />
      <s-select
        error={currencyError}
        label={t("editor.currency")}
        name={currencyName}
        onChange={(event) => onCurrencyChange(fieldValue(event))}
        value={currency}
      >
        {currencyOptions.map((code) => (
          <s-option key={code} value={code}>
            {code}
          </s-option>
        ))}
      </s-select>
    </s-grid>
  );
}

/* ----------------------------------------------------------------------------
 * Product / collection selection via the App Bridge resource picker
 * ------------------------------------------------------------------------- */

interface PickableResource {
  id: string;
  title: string;
  imageUrl?: string | null;
}

interface PickerImage {
  originalSrc?: string;
  url?: string;
}

function ResourceSelection<TResource extends PickableResource>({
  excluded,
  excludedFieldName,
  heading,
  included,
  includedFieldName,
  onChange,
  onExcludedChange,
  onIncludedChange,
  t,
  type,
}: {
  excluded: TResource[];
  excludedFieldName: string;
  heading: string;
  included: TResource[];
  includedFieldName: string;
  onChange: () => void;
  onExcludedChange: (items: TResource[]) => void;
  onIncludedChange: (items: TResource[]) => void;
  t: Translate;
  type: "product" | "collection";
}) {
  const resources = t(type === "product" ? "resources.products" : "resources.collections");

  const pick = async (
    current: TResource[],
    other: TResource[],
    apply: (items: TResource[]) => void,
    applyOther: (items: TResource[]) => void,
  ) => {
    const selection = await shopify.resourcePicker({
      type,
      multiple: true,
      action: "select",
      selectionIds: current.map((item) => ({ id: item.id })),
    });

    if (!selection) {
      return;
    }

    const items = selection.map((resource) => {
      const raw = resource as unknown as {
        id: string;
        title: string;
        handle?: string;
        images?: PickerImage[];
        image?: PickerImage | null;
      };

      return {
        ...(raw as unknown as TResource),
        imageUrl: raw.images?.[0]?.originalSrc ?? raw.images?.[0]?.url ?? raw.image?.originalSrc ?? raw.image?.url ?? null,
      } as TResource;
    });
    const ids = new Set(items.map((item) => item.id));
    apply(items);
    // An item cannot be both included and excluded.
    applyOther(other.filter((item) => !ids.has(item.id)));
    onChange();
  };

  return (
    <s-stack direction="block" gap="base">
      <s-text type="strong">{heading}</s-text>
      {included.map((item) => (
        <input key={item.id} name={includedFieldName} type="hidden" value={item.id} />
      ))}
      {excluded.map((item) => (
        <input key={item.id} name={excludedFieldName} type="hidden" value={item.id} />
      ))}

      <s-grid gap="base" gridTemplateColumns="repeat(auto-fit, minmax(240px, 1fr))">
        <ResourceList
          emptyText={t("editor.applies.allEligible", { resources })}
          heading={t("editor.applies.only", { resources })}
          items={included}
          onPick={() => pick(included, excluded, onIncludedChange, onExcludedChange)}
          onRemove={(id) => {
            onIncludedChange(included.filter((item) => item.id !== id));
            onChange();
          }}
          pickLabel={t("editor.applies.select", { resources })}
          t={t}
        />
        <ResourceList
          emptyText={t("editor.applies.noneExcluded", { resources })}
          heading={t("editor.applies.never")}
          items={excluded}
          onPick={() => pick(excluded, included, onExcludedChange, onIncludedChange)}
          onRemove={(id) => {
            onExcludedChange(excluded.filter((item) => item.id !== id));
            onChange();
          }}
          pickLabel={t("editor.applies.exclude", { resources })}
          t={t}
        />
      </s-grid>
    </s-stack>
  );
}

function ResourceList<TResource extends PickableResource>({
  emptyText,
  heading,
  items,
  onPick,
  onRemove,
  pickLabel,
  t,
}: {
  emptyText: string;
  heading: string;
  items: TResource[];
  onPick: () => void;
  onRemove: (id: string) => void;
  pickLabel: string;
  t: Translate;
}) {
  return (
    <s-box border="base" borderRadius="base" padding="base">
      <s-stack direction="block" gap="small">
        <s-text type="strong">{heading}</s-text>
        {items.length ? (
          items.map((item) => (
            <s-grid
              alignItems="center"
              gap="small"
              gridTemplateColumns="auto 1fr auto"
              key={item.id}
            >
              {item.imageUrl ? (
                <s-thumbnail alt="" size="small" src={item.imageUrl} />
              ) : (
                <s-box background="subdued" borderRadius="base" inlineSize="40px" blockSize="40px" />
              )}
              <s-text>{item.title}</s-text>
              <s-button
                accessibilityLabel={t("editor.applies.remove", { title: item.title })}
                icon="x"
                onClick={() => onRemove(item.id)}
                variant="tertiary"
              />
            </s-grid>
          ))
        ) : (
          <s-text color="subdued">{emptyText}</s-text>
        )}
        <s-stack direction="inline" gap="base">
          <s-button onClick={onPick}>{pickLabel}</s-button>
        </s-stack>
      </s-stack>
    </s-box>
  );
}

/* ----------------------------------------------------------------------------
 * Copy
 * ------------------------------------------------------------------------- */

function productDiscountExplanation(type: ProductDiscountType, t: Translate) {
  const keys: Partial<Record<ProductDiscountType, TranslationKey>> = {
    percentage: "editor.explain.percentageProducts",
    fixed_amount: "editor.explain.fixedProducts",
    buy_one_get_one_free: "editor.explain.bogo",
    volume_tier: "editor.explain.volume",
  };
  const key = keys[type];

  return key ? t(key) : null;
}

function orderDiscountExplanation(type: OrderDiscountType, t: Translate) {
  const keys: Partial<Record<OrderDiscountType, TranslationKey>> = {
    percentage: "editor.explain.percentageOrder",
    fixed_amount: "editor.explain.fixedOrder",
  };
  const key = keys[type];

  return key ? t(key) : null;
}

function shippingDiscountExplanation(type: ShippingDiscountType, t: Translate) {
  const keys: Partial<Record<ShippingDiscountType, TranslationKey>> = {
    free_shipping: "editor.explain.freeShipping",
    percentage: "editor.explain.percentageShipping",
    fixed_amount: "editor.explain.fixedShipping",
  };
  const key = keys[type];

  return key ? t(key) : null;
}
