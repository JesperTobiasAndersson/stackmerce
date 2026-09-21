import { useEffect, useRef, useState } from "react";
import { Form, useLocation } from "react-router";

import type {
  OrderDiscountType,
  ProductDiscountType,
  ShippingDiscountType,
} from "../campaign-config";
import type { CampaignFormInput } from "../campaign-storage.server";
import {
  entitlementForPlan,
  formatCampaignLimit,
  isAtActiveCampaignLimit,
  lockedFeaturesForCampaign,
  PAID_PLAN_TRIAL_DAYS,
  PLAN_ENTITLEMENTS,
  type AppPlan,
} from "../entitlements";
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
  errors: string[];
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
 * The campaign editor. Rendered inside an `<s-page>`; the page's title bar
 * actions live in the route. Saving goes through the App Bridge contextual
 * save bar (`data-save-bar`), which submits the React Router form.
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
  const entitlements = entitlementForPlan(plan);
  const { search } = useLocation();
  const plansHref = `/app/plans${search}`;
  const fieldErrors = fieldErrorsFromMessages(errors);
  const formRef = useRef<HTMLFormElement>(null);

  const [productDiscountType, setProductDiscountType] = useState<ProductDiscountType>(
    initialValues.productDiscountType,
  );
  const [orderDiscountType, setOrderDiscountType] = useState<OrderDiscountType>(
    initialValues.orderDiscountType,
  );
  const [shippingDiscountType, setShippingDiscountType] =
    useState<ShippingDiscountType>(initialValues.shippingDiscountType);
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
  const [currencies, setCurrencies] = useState({
    productFixed: initialValues.productDiscountFixedCurrencyCode ?? defaultCurrency,
    orderMaximum: initialValues.orderDiscountMaximumCurrencyCode ?? defaultCurrency,
    orderFixed: initialValues.orderDiscountFixedCurrencyCode ?? defaultCurrency,
    shippingFixed: initialValues.shippingDiscountFixedCurrencyCode ?? defaultCurrency,
    minimumSubtotal: initialValues.minimumCartSubtotalCurrencyCode ?? defaultCurrency,
  });

  // Scroll the error summary into view when a new set of errors comes back.
  const errorKey = errors.join("\n");
  useEffect(() => {
    if (errorKey) {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [errorKey]);

  /**
   * The save bar watches input/change events. Product and collection choices
   * come back from the resource picker and land in hidden inputs, so nudge it.
   */
  const markDirty = () => {
    formRef.current?.dispatchEvent(new Event("change", { bubbles: true }));
  };

  // Discard from the save bar resets native fields; mirror that for the
  // React-held state so the controlled selects and pickers follow.
  const resetState = () => {
    setProductDiscountType(initialValues.productDiscountType);
    setOrderDiscountType(initialValues.orderDiscountType);
    setShippingDiscountType(initialValues.shippingDiscountType);
    setShippingDeliveryOptionHandle(initialValues.shippingDeliveryOptionHandle ?? "");
    setMarketHandle(initialValues.marketHandle ?? "");
    setStatus(initialValues.status);
    setSelectedProducts(initialSelectedProducts);
    setExcludedProducts(initialExcludedProducts);
    setSelectedCollections(initialSelectedCollections);
    setExcludedCollections(initialExcludedCollections);
    setCurrencies({
      productFixed: initialValues.productDiscountFixedCurrencyCode ?? defaultCurrency,
      orderMaximum: initialValues.orderDiscountMaximumCurrencyCode ?? defaultCurrency,
      orderFixed: initialValues.orderDiscountFixedCurrencyCode ?? defaultCurrency,
      shippingFixed: initialValues.shippingDiscountFixedCurrencyCode ?? defaultCurrency,
      minimumSubtotal: initialValues.minimumCartSubtotalCurrencyCode ?? defaultCurrency,
    });
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
  const currencyOptions = (current: string) =>
    availableCurrencies.includes(current)
      ? availableCurrencies
      : [current, ...availableCurrencies];

  return (
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
                ? "One issue needs attention"
                : `${errors.length} issues need attention`
            }
            tone="critical"
          >
            <s-unordered-list>
              {errors.map((error) => (
                <s-list-item key={error}>{error}</s-list-item>
              ))}
            </s-unordered-list>
          </s-banner>
        ) : null}

        {mode === "edit" && initialLockedFeatures.length ? (
          <s-banner
            heading={`This discount uses features not included in ${entitlements.name}`}
            tone="warning"
          >
            <s-paragraph>
              {initialLockedFeatures.join(", ")}. Saving is blocked until you
              remove them or <s-link href={plansHref}>upgrade your plan</s-link>.
              The discount keeps working as it is until you save.
            </s-paragraph>
          </s-banner>
        ) : null}

        {/* Details */}
        <s-section heading="Discount details">
          <s-stack direction="block" gap="base">
            <s-text-field
              defaultValue={initialValues.name}
              details="Shown to customers at checkout next to the discount amount."
              error={fieldErrors.name}
              label="Name"
              name="name"
              placeholder="e.g. Summer sale"
              required
            />
            <s-select
              onChange={(event) =>
                setStatus(fieldValue(event) === "active" ? "active" : "inactive")
              }
              value={status}
              details={
                isNewlyActivating
                  ? `You are using ${activeCampaignCount} of ${formatCampaignLimit(
                      entitlements.maxActiveCampaigns,
                    )} active discount${
                      entitlements.maxActiveCampaigns === 1 ? "" : "s"
                    } on ${entitlements.name}. Save as a draft, deactivate another discount, or upgrade to activate it.`
                  : "Drafts are saved but never applied at checkout. You can activate them later."
              }
              label="Status"
              name="status"
            >
              <s-option value="inactive">Draft</s-option>
              <s-option disabled={flag(isNewlyActivating)} value="active">
                Active{isNewlyActivating ? " (plan limit reached)" : ""}
              </s-option>
            </s-select>
            {isNewlyActivating ? (
              <UpgradeNote
                plansHref={plansHref}
                text={`Pro allows ${formatCampaignLimit(
                  PLAN_ENTITLEMENTS.pro.maxActiveCampaigns,
                )} active discounts; Enterprise has no limit.`}
              />
            ) : null}
          </s-stack>
        </s-section>

        {/* Product discount */}
        <s-section heading="Product discount">
          <s-stack direction="block" gap="base">
            <s-select
              error={fieldErrors.discountType}
              label="Type"
              name="productDiscountType"
              onChange={(event) =>
                setProductDiscountType(fieldValue(event) as ProductDiscountType)
              }
              value={productDiscountType}
            >
              <s-option value="none">No product discount</s-option>
              <s-option value="percentage">Percentage off eligible products</s-option>
              <PlanOption
                allowed={entitlements.fixedAmountDiscounts}
                current={initialValues.productDiscountType}
                label="Fixed amount off eligible products"
                value="fixed_amount"
              />
              <PlanOption
                allowed={entitlements.bogoDiscounts}
                current={initialValues.productDiscountType}
                label="Buy X, get Y cheapest free"
                value="buy_one_get_one_free"
              />
              <PlanOption
                allowed={entitlements.volumeTiers}
                current={initialValues.productDiscountType}
                label="Volume tiers by quantity"
                value="volume_tier"
              />
            </s-select>
            {!entitlements.fixedAmountDiscounts ? (
              <UpgradeNote
                plansHref={plansHref}
                text="Fixed amount, Buy X get Y, and volume tier product discounts are included in Pro."
              />
            ) : null}
            <Explanation text={productDiscountExplanation(productDiscountType)} />

            {productDiscountType === "percentage" ? (
              <PercentageField
                defaultValue={initialValues.productDiscountPercentage}
                error={fieldErrors.productPercentage}
                name="productDiscountPercentage"
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
                label="Amount off"
                onCurrencyChange={(code) =>
                  setCurrencies((current) => ({ ...current, productFixed: code }))
                }
                required
              />
            ) : null}

            {productDiscountType === "buy_one_get_one_free" ? (
              <s-grid gap="base" gridTemplateColumns="1fr 1fr">
                <s-number-field
                  defaultValue={String(initialValues.productDiscountBuyQuantity ?? 1)}
                  error={fieldErrors.productBuyQuantity}
                  inputMode="numeric"
                  label="Buy quantity"
                  min={1}
                  name="productDiscountBuyQuantity"
                  required
                  step={1}
                />
                <s-number-field
                  defaultValue={String(initialValues.productDiscountFreeQuantity ?? 1)}
                  details="The cheapest eligible items are discounted first."
                  error={fieldErrors.productFreeQuantity}
                  inputMode="numeric"
                  label="Free quantity"
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
                        label={`Tier ${index + 1} minimum quantity`}
                        min={1}
                        name="productVolumeTierMinimumQuantity"
                        placeholder={isFirst ? "e.g. 3" : "Optional"}
                        required={flag(isFirst)}
                        step={1}
                      />
                      <s-number-field
                        defaultValue={tier?.percentage != null ? String(tier.percentage) : ""}
                        inputMode="decimal"
                        label={`Tier ${index + 1} percentage`}
                        max={100}
                        min={0.01}
                        name="productVolumeTierPercentage"
                        placeholder={isFirst ? "e.g. 10" : "Optional"}
                        required={flag(isFirst)}
                        step={0.01}
                        suffix="%"
                      />
                    </s-grid>
                  );
                })}
                <s-text color="subdued">
                  The highest matching tier is applied to all eligible products.
                </s-text>
                {fieldErrors.productVolumeTiers ? (
                  <s-text tone="critical">{fieldErrors.productVolumeTiers}</s-text>
                ) : null}
              </s-stack>
            ) : null}
          </s-stack>
        </s-section>

        {/* Order discount */}
        <s-section heading="Order discount">
          <s-stack direction="block" gap="base">
            <s-select
              label="Type"
              name="orderDiscountType"
              onChange={(event) =>
                setOrderDiscountType(fieldValue(event) as OrderDiscountType)
              }
              value={orderDiscountType}
            >
              <s-option value="none">No order discount</s-option>
              <s-option value="percentage">Percentage off order subtotal</s-option>
              <PlanOption
                allowed={entitlements.fixedAmountDiscounts}
                current={initialValues.orderDiscountType}
                label="Fixed amount off order subtotal"
                value="fixed_amount"
              />
            </s-select>
            <Explanation text={orderDiscountExplanation(orderDiscountType)} />

            {orderDiscountType === "percentage" ? (
              <>
                <PercentageField
                  defaultValue={initialValues.orderDiscountPercentage}
                  error={fieldErrors.orderPercentage}
                  name="orderDiscountPercentage"
                />
                <MoneyFields
                  amountError={fieldErrors.orderMaximumAmount}
                  amountName="orderDiscountMaximumAmount"
                  currency={currencies.orderMaximum}
                  currencyError={fieldErrors.orderMaximumCurrency}
                  currencyName="orderDiscountMaximumCurrencyCode"
                  currencyOptions={currencyOptions(currencies.orderMaximum)}
                  defaultAmount={initialValues.orderDiscountMaximumAmount}
                  details="Leave empty for no maximum."
                  label="Maximum discount amount"
                  onCurrencyChange={(code) =>
                    setCurrencies((current) => ({ ...current, orderMaximum: code }))
                  }
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
                label="Amount off"
                onCurrencyChange={(code) =>
                  setCurrencies((current) => ({ ...current, orderFixed: code }))
                }
                required
              />
            ) : null}
          </s-stack>
        </s-section>

        {/* Shipping discount */}
        <s-section heading="Shipping discount">
          {shippingLocked && initialValues.shippingDiscountType === "none" ? (
            <UpgradePanel
              plansHref={plansHref}
              points={[
                "Free shipping, percentage, or fixed amount off shipping rates",
                "Limit the discount to a specific shipping method",
                "Combine it with the product or order discount in this campaign",
              ]}
              title="Shipping discounts are included in Pro"
            />
          ) : (
            <s-stack direction="block" gap="base">
              <s-select
                label="Type"
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
                <s-option value="none">No shipping discount</s-option>
                <PlanOption
                  allowed={entitlements.shippingDiscounts}
                  current={initialValues.shippingDiscountType}
                  label="Free shipping"
                  value="free_shipping"
                />
                <PlanOption
                  allowed={entitlements.shippingDiscounts}
                  current={initialValues.shippingDiscountType}
                  label="Percentage off shipping"
                  value="percentage"
                />
                <PlanOption
                  allowed={
                    entitlements.shippingDiscounts && entitlements.fixedAmountDiscounts
                  }
                  current={initialValues.shippingDiscountType}
                  label="Fixed amount off shipping"
                  value="fixed_amount"
                />
              </s-select>
              {shippingLocked ? (
                <UpgradeNote
                  plansHref={plansHref}
                  text='Shipping discounts are a Pro feature. Set this to "No shipping discount" or upgrade to keep it.'
                />
              ) : null}
              <Explanation text={shippingDiscountExplanation(shippingDiscountType)} />

              {shippingDiscountType !== "none" ? (
                <>
                  <s-select
                    details={
                      shippingMethods.length
                        ? "Pick one method to discount only that rate, or leave it on all methods."
                        : "No shipping methods could be loaded. Reopen the app to approve the read_shipping permission."
                    }
                    disabled={flag(
                      !entitlements.shippingMethodTargeting &&
                        !initialValues.shippingDeliveryOptionHandle,
                    )}
                    label="Shipping method"
                    name="shippingDeliveryOptionHandle"
                    onChange={(event) => setShippingDeliveryOptionHandle(fieldValue(event))}
                    value={shippingDeliveryOptionHandle}
                  >
                    <s-option value="">All shipping methods</s-option>
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
                      text="Targeting a specific shipping method is included in Pro."
                    />
                  ) : null}
                </>
              ) : null}

              {shippingDiscountType === "percentage" ? (
                <PercentageField
                  defaultValue={initialValues.shippingDiscountPercentage}
                  error={fieldErrors.shippingPercentage}
                  name="shippingDiscountPercentage"
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
                  label="Amount off"
                  onCurrencyChange={(code) =>
                    setCurrencies((current) => ({ ...current, shippingFixed: code }))
                  }
                  required
                />
              ) : null}
            </s-stack>
          )}
        </s-section>

        {/* Minimum requirements */}
        <s-section heading="Minimum requirements">
          <s-stack direction="block" gap="base">
            <Explanation text={conditionExplanation("minimums")} />
            <MoneyFields
              amountError={fieldErrors.minimumSubtotalAmount}
              amountName="minimumCartSubtotalAmount"
              currency={currencies.minimumSubtotal}
              currencyError={fieldErrors.minimumSubtotalCurrency}
              currencyName="minimumCartSubtotalCurrencyCode"
              currencyOptions={currencyOptions(currencies.minimumSubtotal)}
              defaultAmount={initialValues.minimumCartSubtotalAmount}
              details="Leave empty for no minimum."
              label="Minimum subtotal"
              onCurrencyChange={(code) =>
                setCurrencies((current) => ({ ...current, minimumSubtotal: code }))
              }
            />
            <s-number-field
              defaultValue={
                initialValues.minimumCartQuantity != null
                  ? String(initialValues.minimumCartQuantity)
                  : ""
              }
              details="Leave empty for no quantity minimum."
              error={fieldErrors.minimumCartQuantity}
              inputMode="numeric"
              label="Minimum quantity"
              min={1}
              name="minimumCartQuantity"
              placeholder="e.g. 3"
              step={1}
            />
          </s-stack>
        </s-section>

        {/* Market */}
        <s-section heading="Market">
          {marketLocked && !initialValues.marketHandle ? (
            <UpgradePanel
              plansHref={plansHref}
              points={[
                "Run region-specific promotions from one campaign list",
                "Applies to the product, order, and shipping discount in the campaign",
              ]}
              title="Market targeting is included in Pro"
            />
          ) : (
            <s-stack direction="block" gap="base">
              <s-select
                details={
                  markets.length
                    ? "Limit the whole campaign to one market. Leave on all markets to apply everywhere."
                    : "No markets could be loaded. Reopen the app to approve the read_markets permission."
                }
                label="Market"
                name="marketHandle"
                onChange={(event) => setMarketHandle(fieldValue(event))}
                value={marketHandle}
              >
                <s-option value="">All markets</s-option>
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
                  text='Market targeting is a Pro feature. Switch to "All markets" or upgrade to keep it.'
                />
              ) : null}
            </s-stack>
          )}
        </s-section>

        {/* Combinations */}
        <s-section heading="Combinations">
          <s-stack direction="block" gap="base">
            <s-paragraph>
              Choose which other Shopify discounts can be combined with this one.
            </s-paragraph>
            <s-checkbox
              defaultChecked={flag(initialValues.combinesWithProductDiscounts ?? true)}
              label="Product discounts"
              name="combinesWithProductDiscounts"
              value="true"
            />
            <s-checkbox
              defaultChecked={flag(initialValues.combinesWithOrderDiscounts ?? false)}
              label="Order discounts"
              name="combinesWithOrderDiscounts"
              value="true"
            />
            <s-checkbox
              defaultChecked={flag(initialValues.combinesWithShippingDiscounts ?? true)}
              label="Shipping discounts"
              name="combinesWithShippingDiscounts"
              value="true"
            />
          </s-stack>
        </s-section>

        {/* Products */}
        <s-section heading="Products">
          <s-stack direction="block" gap="base">
            <Explanation text={conditionExplanation("products")} />
            <ResourceSelection<ShopifyProductSummary>
              excluded={excludedProducts}
              excludedFieldName="excludedProductIds"
              included={selectedProducts}
              includedFieldName="productIds"
              onChange={markDirty}
              onExcludedChange={setExcludedProducts}
              onIncludedChange={setSelectedProducts}
              type="product"
            />
          </s-stack>
        </s-section>

        {/* Collections */}
        <s-section heading="Collections">
          <s-stack direction="block" gap="base">
            <Explanation text={conditionExplanation("collections")} />
            <ResourceSelection<ShopifyCollectionSummary>
              excluded={excludedCollections}
              excludedFieldName="excludedCollectionIds"
              included={selectedCollections}
              includedFieldName="collectionIds"
              onChange={markDirty}
              onExcludedChange={setExcludedCollections}
              onIncludedChange={setSelectedCollections}
              type="collection"
            />
          </s-stack>
        </s-section>

        {/* Schedule */}
        <s-section heading="Schedule">
          {scheduleLocked && !scheduleHasValues ? (
            <UpgradePanel
              plansHref={plansHref}
              points={[
                "Prepare sales in advance and let them start on their own",
                "End flash sales automatically so nothing runs longer than planned",
                "Dates follow your store's local time",
              ]}
              title="Scheduling is included in Pro"
            />
          ) : (
            <s-stack direction="block" gap="base">
              <s-paragraph>
                Leave both dates empty to run the discount until you deactivate it.
                Dates follow your store&apos;s local time.
              </s-paragraph>
              {scheduleLocked ? (
                <UpgradeNote
                  plansHref={plansHref}
                  text="Scheduling is a Pro feature. Clear both dates or upgrade to keep this schedule."
                />
              ) : null}
              <s-grid gap="base" gridTemplateColumns="1fr 1fr">
                <s-date-field
                  defaultValue={initialValues.startsAt ?? ""}
                  error={fieldErrors.startsAt}
                  label="Start date"
                  name="startsAt"
                />
                <s-date-field
                  defaultValue={initialValues.endsAt ?? ""}
                  details="The discount stops at the end of this day."
                  error={fieldErrors.endsAt}
                  label="End date"
                  name="endsAt"
                />
              </s-grid>
            </s-stack>
          )}
        </s-section>

        {mode === "create" && !isSaving ? (
          <s-box padding="base">
            <s-text color="subdued">
              Changes are saved with the save bar at the top of the page.
            </s-text>
          </s-box>
        ) : null}
      </s-stack>
    </Form>
  );
}

/* ----------------------------------------------------------------------------
 * Field helpers
 * ------------------------------------------------------------------------- */

/**
 * A select option gated by plan. Locked options stay disabled unless they are
 * the campaign's current value, so a downgraded merchant can still see (and
 * switch away from) what the campaign uses.
 */
function PlanOption({
  allowed,
  current,
  label,
  value,
}: {
  allowed: boolean;
  current: string;
  label: string;
  value: string;
}) {
  return (
    <s-option disabled={flag(!allowed && current !== value)} value={value}>
      {label}
      {allowed ? "" : " (Pro)"}
    </s-option>
  );
}

function UpgradeNote({ plansHref, text }: { plansHref: string; text: string }) {
  return (
    <s-text color="subdued">
      {text} From {PLAN_ENTITLEMENTS.pro.priceLabel}, {PAID_PLAN_TRIAL_DAYS}-day
      free trial. <s-link href={plansHref}>View plans</s-link>
    </s-text>
  );
}

function UpgradePanel({
  plansHref,
  points,
  title,
}: {
  plansHref: string;
  points: string[];
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
            Start {PAID_PLAN_TRIAL_DAYS}-day free trial
          </s-button>
          <s-text color="subdued">
            Pro is {PLAN_ENTITLEMENTS.pro.priceLabel} after the trial. Cancel any time.
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
}: {
  defaultValue: number | undefined;
  error: string | undefined;
  name: string;
}) {
  return (
    <s-number-field
      defaultValue={defaultValue != null ? String(defaultValue) : ""}
      details="Enter a value between 0 and 100."
      error={error}
      inputMode="decimal"
      label="Percentage"
      max={100}
      min={0.01}
      name={name}
      placeholder="e.g. 10"
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
  onCurrencyChange,
  required = false,
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
  onCurrencyChange: (code: string) => void;
  required?: boolean;
}) {
  return (
    <s-grid alignItems="start" gap="base" gridTemplateColumns="2fr 1fr">
      <s-money-field
        currencyCode={currency as CurrencyCode}
        defaultValue={defaultAmount ?? ""}
        details={details}
        error={amountError}
        label={label}
        min={0}
        name={amountName}
        placeholder="0.00"
        required={flag(required)}
      />
      <s-select
        error={currencyError}
        label="Currency"
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
}

function ResourceSelection<TResource extends PickableResource>({
  excluded,
  excludedFieldName,
  included,
  includedFieldName,
  onChange,
  onExcludedChange,
  onIncludedChange,
  type,
}: {
  excluded: TResource[];
  excludedFieldName: string;
  included: TResource[];
  includedFieldName: string;
  onChange: () => void;
  onExcludedChange: (items: TResource[]) => void;
  onIncludedChange: (items: TResource[]) => void;
  type: "product" | "collection";
}) {
  const plural = type === "product" ? "products" : "collections";

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

    const items = selection.map((resource) => resource as unknown as TResource);
    const ids = new Set(items.map((item) => item.id));
    apply(items);
    // An item cannot be both included and excluded.
    applyOther(other.filter((item) => !ids.has(item.id)));
    onChange();
  };

  return (
    <s-stack direction="block" gap="base">
      {included.map((item) => (
        <input key={item.id} name={includedFieldName} type="hidden" value={item.id} />
      ))}
      {excluded.map((item) => (
        <input key={item.id} name={excludedFieldName} type="hidden" value={item.id} />
      ))}

      <s-grid gap="base" gridTemplateColumns="1fr 1fr">
        <ResourceList
          emptyText={`All ${plural} are eligible.`}
          heading={`Only these ${plural}`}
          items={included}
          onPick={() => pick(included, excluded, onIncludedChange, onExcludedChange)}
          onRemove={(id) => {
            onIncludedChange(included.filter((item) => item.id !== id));
            onChange();
          }}
          pickLabel={`Select ${plural}`}
        />
        <ResourceList
          emptyText={`No ${plural} are excluded.`}
          heading={`Never discounted`}
          items={excluded}
          onPick={() => pick(excluded, included, onExcludedChange, onIncludedChange)}
          onRemove={(id) => {
            onExcludedChange(excluded.filter((item) => item.id !== id));
            onChange();
          }}
          pickLabel={`Exclude ${plural}`}
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
}: {
  emptyText: string;
  heading: string;
  items: TResource[];
  onPick: () => void;
  onRemove: (id: string) => void;
  pickLabel: string;
}) {
  return (
    <s-box border="base" borderRadius="base" padding="base">
      <s-stack direction="block" gap="small">
        <s-text type="strong">{heading}</s-text>
        {items.length ? (
          items.map((item) => (
            <s-grid alignItems="center" gap="small" gridTemplateColumns="1fr auto" key={item.id}>
              <s-text>{item.title}</s-text>
              <s-button
                accessibilityLabel={`Remove ${item.title}`}
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
 * Error mapping and copy
 * ------------------------------------------------------------------------- */

type FieldErrorKey =
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

const FIELD_ERROR_MATCHERS: Array<[string, FieldErrorKey]> = [
  ["campaign name", "name"],
  ["choose at least one", "discountType"],
  ["product discount percentage", "productPercentage"],
  ["product fixed discount amount", "productFixedAmount"],
  ["product fixed discount currency", "productFixedCurrency"],
  ["buy quantity", "productBuyQuantity"],
  ["free quantity", "productFreeQuantity"],
  ["volume", "productVolumeTiers"],
  ["order discount percentage", "orderPercentage"],
  ["order maximum discount amount", "orderMaximumAmount"],
  ["order maximum discount currency", "orderMaximumCurrency"],
  ["order fixed discount amount", "orderFixedAmount"],
  ["order fixed discount currency", "orderFixedCurrency"],
  ["shipping discount percentage", "shippingPercentage"],
  ["shipping fixed discount amount", "shippingFixedAmount"],
  ["shipping fixed discount currency", "shippingFixedCurrency"],
  ["minimum cart subtotal amount", "minimumSubtotalAmount"],
  ["minimum cart subtotal currency", "minimumSubtotalCurrency"],
  ["minimum cart quantity", "minimumCartQuantity"],
  ["start date", "startsAt"],
  ["end date", "endsAt"],
];

function fieldErrorsFromMessages(errors: string[]) {
  const fieldErrors: Partial<Record<FieldErrorKey, string>> = {};

  for (const error of errors) {
    const lowerError = error.toLowerCase();
    const match = FIELD_ERROR_MATCHERS.find(([needle]) => lowerError.includes(needle));

    if (match && !fieldErrors[match[1]]) {
      fieldErrors[match[1]] = error;
    }
  }

  return fieldErrors;
}

function productDiscountExplanation(type: ProductDiscountType) {
  switch (type) {
    case "percentage":
      return "Applies the same percentage to every eligible cart line.";
    case "fixed_amount":
      return "Splits the fixed amount across eligible products; never exceeds their subtotal.";
    case "buy_one_get_one_free":
      return "Counts all eligible units in the cart. For each complete buy/free set, the cheapest eligible units are free.";
    case "volume_tier":
      return "Counts the total eligible quantity and applies the highest tier reached to all eligible products.";
    default:
      return null;
  }
}

function orderDiscountExplanation(type: OrderDiscountType) {
  switch (type) {
    case "percentage":
      return "Applies to the order subtotal after product and collection exclusions. The optional maximum caps the discount.";
    case "fixed_amount":
      return "Takes one fixed amount off the eligible order subtotal.";
    default:
      return null;
  }
}

function shippingDiscountExplanation(type: ShippingDiscountType) {
  switch (type) {
    case "free_shipping":
      return "Applies a 100% discount to matching shipping rates.";
    case "percentage":
      return "Applies the percentage to matching shipping rates.";
    case "fixed_amount":
      return "Takes one fixed amount off matching shipping rates, in the configured currency.";
    default:
      return null;
  }
}

function conditionExplanation(type: "minimums" | "products" | "collections") {
  switch (type) {
    case "minimums":
      return "Minimum subtotal checks the full cart subtotal; minimum quantity checks the total item count. Leave a field empty to skip that requirement.";
    case "products":
      return "Selected products limit the discount to only those products. Excluded products are never discounted, even if a collection rule includes them.";
    default:
      return "Selected collections limit the discount to products in them. Excluded collections are never discounted and override included ones.";
  }
}
