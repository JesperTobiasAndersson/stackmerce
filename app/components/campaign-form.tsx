import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Form, Link, useFetcher, useLocation } from "react-router";

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
import type {
  ShopifyCollectionSummary,
  ShopifyMarketSummary,
  ShopifyProductSummary,
  ShopifyShippingMethodSummary,
} from "../shopify-api.server";
import styles from "./campaign-form.module.css";

export type CampaignFormTab = "basic" | "discounts" | "conditions" | "schedule";

const TAB_LABELS: Record<CampaignFormTab, string> = {
  basic: "Basic",
  discounts: "Discounts",
  conditions: "Conditions",
  schedule: "Schedule",
};

const TABS = Object.keys(TAB_LABELS) as CampaignFormTab[];
const VOLUME_TIER_ROWS = 3;

/** Loader shape shared by the create and edit routes for `?resource=` searches. */
export interface ResourceSearchData {
  resource?: string | null;
  products?: ShopifyProductSummary[];
  collections?: ShopifyCollectionSummary[];
}

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
  /** Active campaigns on the store, excluding nothing; used for the plan limit hint. */
  activeCampaignCount: number;
  errors: string[];
  isSaving: boolean;
  submitLabel: string;
  /** Rendered next to the submit button (e.g. the delete button on edit). */
  secondaryActions?: ReactNode;
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
  submitLabel,
  secondaryActions,
}: CampaignFormProps) {
  const entitlements = entitlementForPlan(plan);
  const location = useLocation();
  const plansHref = { pathname: "/app/plans", search: location.search };
  const fieldErrors = fieldErrorsFromMessages(errors);
  const errorSummary = errorSummaryItems(errors);
  const errorSummaryKey = errors.join("\n");

  const [activeTab, setActiveTab] = useState<CampaignFormTab>("basic");
  const [dismissedErrorSummaryKey, setDismissedErrorSummaryKey] = useState("");
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
  const [selectedProducts, setSelectedProducts] = useState(initialSelectedProducts);
  const [excludedProducts, setExcludedProducts] = useState(initialExcludedProducts);
  const [selectedCollections, setSelectedCollections] = useState(
    initialSelectedCollections,
  );
  const [excludedCollections, setExcludedCollections] = useState(
    initialExcludedCollections,
  );

  // Jump to the first tab with a problem whenever a *new* set of errors comes
  // back. Keyed on the joined messages, not the array, so re-renders (like the
  // merchant clicking another tab) don't yank them back.
  useEffect(() => {
    if (errorSummaryKey) {
      setActiveTab(tabForError(errorSummaryKey.split("\n")[0]));
    }
  }, [errorSummaryKey]);

  const showErrorSummary =
    errorSummary.length > 0 && dismissedErrorSummaryKey !== errorSummaryKey;
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
  const campaignSummary = campaignSummaryItems({
    productDiscountType,
    orderDiscountType,
    shippingDiscountType,
    marketName: selectedMarketName,
    includedProductCount: selectedProducts.length,
    excludedProductCount: excludedProducts.length,
    includedCollectionCount: selectedCollections.length,
    excludedCollectionCount: excludedCollections.length,
  });
  const scheduleLocked = !entitlements.scheduling;
  const scheduleHasValues = Boolean(initialValues.startsAt || initialValues.endsAt);

  return (
    <>
      <ErrorSummary
        errors={showErrorSummary ? errorSummary : []}
        onDismiss={() => setDismissedErrorSummaryKey(errorSummaryKey)}
        onSelectTab={setActiveTab}
      />

      {mode === "edit" && initialLockedFeatures.length ? (
        <div className={styles.warningBanner} role="status">
          <p className={styles.warningBannerTitle}>
            This discount uses features not included in your {entitlements.name}{" "}
            plan
          </p>
          <p>
            {initialLockedFeatures.join(", ")}. Saving with these settings is
            blocked until you either remove them or{" "}
            <Link to={plansHref}>upgrade your plan</Link>. The discount keeps
            working as it is until you save.
          </p>
        </div>
      ) : null}

      <Form method="post" className={styles.formContainer} noValidate>
        <div className={styles.tabNav} role="tablist">
          {TABS.map((tab) => (
            <button
              aria-selected={activeTab === tab}
              className={
                activeTab === tab
                  ? `${styles.tabButton} ${styles.active}`
                  : styles.tabButton
              }
              key={tab}
              onClick={() => setActiveTab(tab)}
              role="tab"
              type="button"
            >
              {TAB_LABELS[tab]}
              {tab === "schedule" && scheduleLocked ? (
                <span className={styles.lockedBadge}>Pro</span>
              ) : null}
            </button>
          ))}
        </div>

        {/* Basic */}
        <div className={tabClassName(activeTab === "basic")}>
          <div className={styles.formSection}>
            <h3 className={styles.sectionHeading}>Discount Details</h3>
            <p className={styles.sectionDescription}>
              Give your discount a name and set its status.
            </p>

            <div className={styles.fieldWrapper}>
              <label className={styles.label}>
                <span className={styles.labelText}>
                  Discount Name <span className={styles.required}>*</span>
                </span>
                <input
                  aria-describedby={fieldErrors.name ? "name-error" : undefined}
                  aria-invalid={Boolean(fieldErrors.name)}
                  className={styles.input}
                  defaultValue={initialValues.name}
                  name="name"
                  placeholder="e.g., Summer Sale"
                  required
                  type="text"
                />
              </label>
              <p className={styles.helpText}>
                Shown to customers at checkout next to the discount amount.
              </p>
              <FieldError id="name-error" message={fieldErrors.name} />
            </div>

            <div className={styles.fieldWrapper}>
              <label className={styles.label}>
                <span className={styles.labelText}>Status</span>
                <select
                  className={styles.select}
                  defaultValue={initialValues.status}
                  name="status"
                >
                  <option value="inactive">Inactive (Draft)</option>
                  <option disabled={isNewlyActivating} value="active">
                    Active{isNewlyActivating ? " (plan limit reached)" : ""}
                  </option>
                </select>
              </label>
              <p className={styles.helpText}>
                {isNewlyActivating
                  ? `You are using ${activeCampaignCount} of ${formatCampaignLimit(
                      entitlements.maxActiveCampaigns,
                    )} active discount${
                      entitlements.maxActiveCampaigns === 1 ? "" : "s"
                    } on ${entitlements.name}. Save it as a draft, deactivate another discount, or upgrade to activate it.`
                  : "Inactive discounts are saved as drafts and never applied at checkout. You can activate them later."}
              </p>
              {isNewlyActivating ? (
                <LockedFeatureNotice plansHref={plansHref}>
                  Pro allows {formatCampaignLimit(PLAN_ENTITLEMENTS.pro.maxActiveCampaigns)}{" "}
                  active discounts; Enterprise has no limit.
                </LockedFeatureNotice>
              ) : null}
            </div>
          </div>
        </div>

        {/* Discounts */}
        <div className={tabClassName(activeTab === "discounts")}>
          <div className={styles.formSection}>
            <h3 className={styles.sectionHeading}>Product Discount</h3>
            <p className={styles.sectionDescription}>
              Offer a discount on products in the cart.
            </p>

            <div className={styles.fieldWrapper}>
              <label className={styles.label}>
                <span className={styles.labelText}>Discount Type</span>
                <select
                  className={styles.select}
                  defaultValue={initialValues.productDiscountType}
                  name="productDiscountType"
                  onChange={(event) =>
                    setProductDiscountType(event.target.value as ProductDiscountType)
                  }
                >
                  <option value="none">No product discount</option>
                  <option value="percentage">Percentage off eligible products</option>
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
                </select>
              </label>
              <FieldError
                id="product-discount-type-error"
                message={fieldErrors.discountType}
              />
              {!entitlements.fixedAmountDiscounts ? (
                <LockedFeatureNotice plansHref={plansHref}>
                  Fixed amount, Buy X get Y, and volume tier product discounts
                  are included in Pro.
                </LockedFeatureNotice>
              ) : null}
              <DiscountExplanation
                explanation={productDiscountExplanation(productDiscountType)}
              />
            </div>

            {productDiscountType === "percentage" ? (
              <PercentageField
                defaultValue={initialValues.productDiscountPercentage}
                error={fieldErrors.productPercentage}
                id="product-percentage"
                name="productDiscountPercentage"
              />
            ) : null}

            {productDiscountType === "fixed_amount" ? (
              <MoneyFields
                amountError={fieldErrors.productFixedAmount}
                amountName="productDiscountFixedAmount"
                availableCurrencies={availableCurrencies}
                currencyError={fieldErrors.productFixedCurrency}
                currencyName="productDiscountFixedCurrencyCode"
                defaultAmount={initialValues.productDiscountFixedAmount}
                defaultCurrency={
                  initialValues.productDiscountFixedCurrencyCode ?? defaultCurrency
                }
                id="product-fixed"
                label="Amount"
                required
              />
            ) : null}

            {productDiscountType === "buy_one_get_one_free" ? (
              <>
                <div className={styles.fieldWrapper}>
                  <label className={styles.label}>
                    <span className={styles.labelText}>
                      Buy quantity <span className={styles.required}>*</span>
                    </span>
                    <input
                      aria-invalid={Boolean(fieldErrors.productBuyQuantity)}
                      className={styles.input}
                      defaultValue={initialValues.productDiscountBuyQuantity ?? 1}
                      inputMode="numeric"
                      min="1"
                      name="productDiscountBuyQuantity"
                      step="1"
                      type="number"
                    />
                  </label>
                  <FieldError
                    id="product-buy-quantity-error"
                    message={fieldErrors.productBuyQuantity}
                  />
                </div>
                <div className={styles.fieldWrapper}>
                  <label className={styles.label}>
                    <span className={styles.labelText}>
                      Free quantity <span className={styles.required}>*</span>
                    </span>
                    <input
                      aria-invalid={Boolean(fieldErrors.productFreeQuantity)}
                      className={styles.input}
                      defaultValue={initialValues.productDiscountFreeQuantity ?? 1}
                      inputMode="numeric"
                      min="1"
                      name="productDiscountFreeQuantity"
                      step="1"
                      type="number"
                    />
                  </label>
                  <p className={styles.helpText}>
                    The cheapest eligible items are discounted first.
                  </p>
                  <FieldError
                    id="product-free-quantity-error"
                    message={fieldErrors.productFreeQuantity}
                  />
                </div>
              </>
            ) : null}

            {productDiscountType === "volume_tier" ? (
              <>
                {Array.from({ length: VOLUME_TIER_ROWS }, (_, index) => {
                  const tier = initialValues.productDiscountVolumeTiers?.[index];
                  const isFirst = index === 0;

                  return (
                    <div className={styles.fieldGroup} key={index}>
                      <label className={styles.label}>
                        <span className={styles.labelText}>
                          Tier {index + 1} minimum quantity
                          {isFirst ? <span className={styles.required}> *</span> : null}
                        </span>
                        <input
                          className={styles.input}
                          defaultValue={tier?.minimumQuantity ?? ""}
                          inputMode="numeric"
                          min="1"
                          name="productVolumeTierMinimumQuantity"
                          placeholder={isFirst ? "e.g., 3" : "Optional"}
                          step="1"
                          type="number"
                        />
                      </label>
                      <label className={styles.label}>
                        <span className={styles.labelText}>
                          Tier {index + 1} percentage
                          {isFirst ? <span className={styles.required}> *</span> : null}
                        </span>
                        <input
                          className={styles.input}
                          defaultValue={tier?.percentage ?? ""}
                          inputMode="decimal"
                          max="100"
                          min="0.01"
                          name="productVolumeTierPercentage"
                          placeholder={isFirst ? "e.g., 10" : "Optional"}
                          step="0.01"
                          type="number"
                        />
                      </label>
                    </div>
                  );
                })}
                <p className={styles.helpText}>
                  The highest matching tier is applied to all eligible products.
                </p>
                <FieldError
                  id="volume-tier-error"
                  message={fieldErrors.productVolumeTiers}
                />
              </>
            ) : null}
          </div>

          <div className={styles.formSection}>
            <h3 className={styles.sectionHeading}>Order Discount</h3>
            <p className={styles.sectionDescription}>
              Offer a discount on the order subtotal.
            </p>

            <div className={styles.fieldWrapper}>
              <label className={styles.label}>
                <span className={styles.labelText}>Discount Type</span>
                <select
                  className={styles.select}
                  defaultValue={initialValues.orderDiscountType}
                  name="orderDiscountType"
                  onChange={(event) =>
                    setOrderDiscountType(event.target.value as OrderDiscountType)
                  }
                >
                  <option value="none">No order discount</option>
                  <option value="percentage">Percentage off order subtotal</option>
                  <PlanOption
                    allowed={entitlements.fixedAmountDiscounts}
                    current={initialValues.orderDiscountType}
                    label="Fixed amount off order subtotal"
                    value="fixed_amount"
                  />
                </select>
              </label>
              <DiscountExplanation
                explanation={orderDiscountExplanation(orderDiscountType)}
              />
            </div>

            {orderDiscountType === "percentage" ? (
              <>
                <PercentageField
                  defaultValue={initialValues.orderDiscountPercentage}
                  error={fieldErrors.orderPercentage}
                  id="order-percentage"
                  name="orderDiscountPercentage"
                />
                <MoneyFields
                  amountError={fieldErrors.orderMaximumAmount}
                  amountName="orderDiscountMaximumAmount"
                  availableCurrencies={availableCurrencies}
                  currencyError={fieldErrors.orderMaximumCurrency}
                  currencyName="orderDiscountMaximumCurrencyCode"
                  defaultAmount={initialValues.orderDiscountMaximumAmount}
                  defaultCurrency={
                    initialValues.orderDiscountMaximumCurrencyCode ?? defaultCurrency
                  }
                  help="Leave empty for no maximum."
                  id="order-maximum"
                  label="Maximum discount amount"
                />
              </>
            ) : null}

            {orderDiscountType === "fixed_amount" ? (
              <MoneyFields
                amountError={fieldErrors.orderFixedAmount}
                amountName="orderDiscountFixedAmount"
                availableCurrencies={availableCurrencies}
                currencyError={fieldErrors.orderFixedCurrency}
                currencyName="orderDiscountFixedCurrencyCode"
                defaultAmount={initialValues.orderDiscountFixedAmount}
                defaultCurrency={
                  initialValues.orderDiscountFixedCurrencyCode ?? defaultCurrency
                }
                id="order-fixed"
                label="Amount"
                required
              />
            ) : null}
          </div>

          <div className={styles.formSection}>
            <h3 className={styles.sectionHeading}>
              Shipping Discount
              {!entitlements.shippingDiscounts ? (
                <span className={styles.lockedBadge}>Pro</span>
              ) : null}
            </h3>
            <p className={styles.sectionDescription}>
              Offer a discount or free shipping.
            </p>

            {!entitlements.shippingDiscounts &&
            initialValues.shippingDiscountType === "none" ? (
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
              <>
                <div className={styles.fieldWrapper}>
                  <label className={styles.label}>
                    <span className={styles.labelText}>Discount Type</span>
                    <select
                      className={styles.select}
                      defaultValue={initialValues.shippingDiscountType}
                      name="shippingDiscountType"
                      onChange={(event) => {
                        const value = event.target.value as ShippingDiscountType;
                        setShippingDiscountType(value);
                        if (value === "none") {
                          setShippingDeliveryOptionHandle("");
                        }
                      }}
                    >
                      <option value="none">No shipping discount</option>
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
                          entitlements.shippingDiscounts &&
                          entitlements.fixedAmountDiscounts
                        }
                        current={initialValues.shippingDiscountType}
                        label="Fixed amount off shipping"
                        value="fixed_amount"
                      />
                    </select>
                  </label>
                  {!entitlements.shippingDiscounts ? (
                    <LockedFeatureNotice plansHref={plansHref}>
                      Shipping discounts are a Pro feature. Set this to
                      &quot;No shipping discount&quot; or upgrade to keep it.
                    </LockedFeatureNotice>
                  ) : null}
                  <DiscountExplanation
                    explanation={shippingDiscountExplanation(shippingDiscountType)}
                  />
                </div>

                {shippingDiscountType !== "none" ? (
                  <div className={styles.fieldWrapper}>
                    <label className={styles.label}>
                      <span className={styles.labelText}>Shipping method</span>
                      <select
                        className={styles.select}
                        disabled={
                          !entitlements.shippingMethodTargeting &&
                          !initialValues.shippingDeliveryOptionHandle
                        }
                        name="shippingDeliveryOptionHandle"
                        onChange={(event) =>
                          setShippingDeliveryOptionHandle(event.target.value)
                        }
                        value={shippingDeliveryOptionHandle}
                      >
                        <option value="">All shipping methods</option>
                        {shippingMethods.map((method) => (
                          <option key={method.id} value={method.handle}>
                            {method.name} ({method.zoneName})
                          </option>
                        ))}
                        {shippingDeliveryOptionHandle &&
                        !shippingMethods.some(
                          (method) => method.handle === shippingDeliveryOptionHandle,
                        ) ? (
                          <option value={shippingDeliveryOptionHandle}>
                            {selectedShippingMethodName || shippingDeliveryOptionHandle}
                          </option>
                        ) : null}
                      </select>
                    </label>
                    <input
                      name="shippingDeliveryOptionTitle"
                      type="hidden"
                      value={selectedShippingMethodName}
                    />
                    <p className={styles.helpText}>
                      {shippingMethods.length
                        ? "Pick one method to discount only that rate. Leave it on all methods to discount every rate."
                        : "No shipping methods could be loaded. Reopen the app to approve the read_shipping permission."}
                    </p>
                    {!entitlements.shippingMethodTargeting ? (
                      <LockedFeatureNotice plansHref={plansHref}>
                        Targeting a specific shipping method is included in Pro.
                      </LockedFeatureNotice>
                    ) : null}
                  </div>
                ) : null}

                {shippingDiscountType === "percentage" ? (
                  <PercentageField
                    defaultValue={initialValues.shippingDiscountPercentage}
                    error={fieldErrors.shippingPercentage}
                    id="shipping-percentage"
                    name="shippingDiscountPercentage"
                  />
                ) : null}

                {shippingDiscountType === "fixed_amount" ? (
                  <MoneyFields
                    amountError={fieldErrors.shippingFixedAmount}
                    amountName="shippingDiscountFixedAmount"
                    availableCurrencies={availableCurrencies}
                    currencyError={fieldErrors.shippingFixedCurrency}
                    currencyName="shippingDiscountFixedCurrencyCode"
                    defaultAmount={initialValues.shippingDiscountFixedAmount}
                    defaultCurrency={
                      initialValues.shippingDiscountFixedCurrencyCode ??
                      defaultCurrency
                    }
                    id="shipping-fixed"
                    label="Amount"
                    required
                  />
                ) : null}
              </>
            )}
          </div>
        </div>

        {/* Conditions */}
        <div className={tabClassName(activeTab === "conditions")}>
          <div className={styles.formSection}>
            <h3 className={styles.sectionHeading}>Minimum Requirements</h3>
            <p className={styles.sectionDescription}>
              Only apply the discount when the cart reaches a minimum subtotal or
              quantity.
            </p>
            <DiscountExplanation explanation={conditionExplanation("minimums")} />

            <MoneyFields
              amountError={fieldErrors.minimumSubtotalAmount}
              amountName="minimumCartSubtotalAmount"
              availableCurrencies={availableCurrencies}
              currencyError={fieldErrors.minimumSubtotalCurrency}
              currencyName="minimumCartSubtotalCurrencyCode"
              defaultAmount={initialValues.minimumCartSubtotalAmount}
              defaultCurrency={
                initialValues.minimumCartSubtotalCurrencyCode ?? defaultCurrency
              }
              help="Leave empty for no minimum."
              id="minimum-subtotal"
              label="Minimum subtotal"
            />

            <div className={styles.fieldWrapper}>
              <label className={styles.label}>
                <span className={styles.labelText}>Minimum quantity</span>
                <input
                  aria-invalid={Boolean(fieldErrors.minimumCartQuantity)}
                  className={styles.input}
                  defaultValue={initialValues.minimumCartQuantity ?? ""}
                  inputMode="numeric"
                  min="1"
                  name="minimumCartQuantity"
                  placeholder="e.g., 3"
                  step="1"
                  type="number"
                />
              </label>
              <p className={styles.helpText}>Leave empty for no quantity minimum.</p>
              <FieldError
                id="minimum-cart-quantity-error"
                message={fieldErrors.minimumCartQuantity}
              />
            </div>
          </div>

          <div className={styles.formSection}>
            <h3 className={styles.sectionHeading}>
              Market
              {!entitlements.marketTargeting ? (
                <span className={styles.lockedBadge}>Pro</span>
              ) : null}
            </h3>
            <p className={styles.sectionDescription}>
              Limit the whole campaign to one market. Leave empty to apply to all
              markets.
            </p>

            {!entitlements.marketTargeting && !initialValues.marketHandle ? (
              <UpgradePanel
                plansHref={plansHref}
                points={[
                  "Run region-specific promotions from one campaign list",
                  "Applies to the product, order, and shipping discount in the campaign",
                ]}
                title="Market targeting is included in Pro"
              />
            ) : (
              <div className={styles.fieldWrapper}>
                <DiscountExplanation explanation={conditionExplanation("market")} />
                <label className={styles.label} style={{ marginTop: "1rem" }}>
                  <span className={styles.labelText}>Market</span>
                  <select
                    className={styles.select}
                    name="marketHandle"
                    onChange={(event) => setMarketHandle(event.target.value)}
                    value={marketHandle}
                  >
                    <option value="">All markets</option>
                    {markets.map((market) => (
                      <option key={market.id} value={market.handle}>
                        {market.name}
                      </option>
                    ))}
                    {marketHandle &&
                    !markets.some((market) => market.handle === marketHandle) ? (
                      <option value={marketHandle}>
                        {selectedMarketName || marketHandle}
                      </option>
                    ) : null}
                  </select>
                </label>
                <input name="marketName" type="hidden" value={selectedMarketName} />
                <p className={styles.helpText}>
                  {markets.length
                    ? "This market rule applies to every discount in this campaign."
                    : "No markets could be loaded. Reopen the app to approve the read_markets permission."}
                </p>
                {!entitlements.marketTargeting ? (
                  <LockedFeatureNotice plansHref={plansHref}>
                    Market targeting is a Pro feature. Switch to &quot;All
                    markets&quot; or upgrade to keep it.
                  </LockedFeatureNotice>
                ) : null}
              </div>
            )}
          </div>

          <div className={styles.formSection}>
            <h3 className={styles.sectionHeading}>Combines With</h3>
            <p className={styles.sectionDescription}>
              Choose which other Shopify discounts can be combined with this
              campaign.
            </p>
            <DiscountExplanation explanation={conditionExplanation("combinesWith")} />

            <div className={styles.checkboxGroup} style={{ marginTop: "1rem" }}>
              <label className={styles.checkboxLabel}>
                <input
                  className={styles.checkboxInput}
                  defaultChecked={initialValues.combinesWithProductDiscounts ?? true}
                  name="combinesWithProductDiscounts"
                  type="checkbox"
                  value="true"
                />
                Product discounts
              </label>
              <label className={styles.checkboxLabel}>
                <input
                  className={styles.checkboxInput}
                  defaultChecked={initialValues.combinesWithOrderDiscounts ?? false}
                  name="combinesWithOrderDiscounts"
                  type="checkbox"
                  value="true"
                />
                Order discounts
              </label>
              <label className={styles.checkboxLabel}>
                <input
                  className={styles.checkboxInput}
                  defaultChecked={initialValues.combinesWithShippingDiscounts ?? true}
                  name="combinesWithShippingDiscounts"
                  type="checkbox"
                  value="true"
                />
                Shipping discounts
              </label>
            </div>
          </div>

          <div className={styles.formSection}>
            <h3 className={styles.sectionHeading}>Product Restrictions</h3>
            <p className={styles.sectionDescription}>
              Search and select products. Leave empty to apply to all products.
            </p>
            <DiscountExplanation explanation={conditionExplanation("products")} />
            <ResourcePicker<ShopifyProductSummary>
              excluded={excludedProducts}
              excludedFieldName="excludedProductIds"
              includedFieldName="productIds"
              label="Search products"
              onExcludedChange={setExcludedProducts}
              onSelectedChange={setSelectedProducts}
              resource="products"
              selected={selectedProducts}
            />
          </div>

          <div className={styles.formSection}>
            <h3 className={styles.sectionHeading}>Collection Restrictions</h3>
            <p className={styles.sectionDescription}>
              Search and select collections. Leave empty to apply to all.
            </p>
            <DiscountExplanation explanation={conditionExplanation("collections")} />
            <ResourcePicker<ShopifyCollectionSummary>
              excluded={excludedCollections}
              excludedFieldName="excludedCollectionIds"
              includedFieldName="collectionIds"
              label="Search collections"
              onExcludedChange={setExcludedCollections}
              onSelectedChange={setSelectedCollections}
              resource="collections"
              selected={selectedCollections}
            />
          </div>
        </div>

        {/* Schedule */}
        <div className={tabClassName(activeTab === "schedule")}>
          <div className={styles.formSection}>
            <h3 className={styles.sectionHeading}>
              Discount Schedule
              {scheduleLocked ? <span className={styles.lockedBadge}>Pro</span> : null}
            </h3>
            <p className={styles.sectionDescription}>
              Set start and end dates for your discount. Leave empty to run
              indefinitely.
            </p>

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
              <>
                {scheduleLocked ? (
                  <LockedFeatureNotice plansHref={plansHref}>
                    Scheduling is a Pro feature. Clear both dates or upgrade to
                    keep this schedule.
                  </LockedFeatureNotice>
                ) : null}
                <div className={styles.fieldGroup} style={{ marginTop: "1rem" }}>
                  <div>
                    <label className={styles.label}>
                      <span className={styles.labelText}>Start date</span>
                      <input
                        aria-invalid={Boolean(fieldErrors.startsAt)}
                        className={styles.input}
                        defaultValue={initialValues.startsAt ?? ""}
                        name="startsAt"
                        type="date"
                      />
                    </label>
                    <p className={styles.helpText}>When should this discount go live?</p>
                    <FieldError id="starts-at-error" message={fieldErrors.startsAt} />
                  </div>
                  <div>
                    <label className={styles.label}>
                      <span className={styles.labelText}>End date</span>
                      <input
                        aria-invalid={Boolean(fieldErrors.endsAt)}
                        className={styles.input}
                        defaultValue={initialValues.endsAt ?? ""}
                        name="endsAt"
                        type="date"
                      />
                    </label>
                    <p className={styles.helpText}>
                      The discount stops at the end of this day.
                    </p>
                    <FieldError id="ends-at-error" message={fieldErrors.endsAt} />
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        <div className={styles.summaryBox}>
          <h3 className={styles.summaryHeading}>Campaign Summary</h3>
          <ul className={styles.summaryList}>
            {campaignSummary.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>

        <div className={styles.actions}>
          <button className={styles.submitButton} disabled={isSaving} type="submit">
            {isSaving ? "Saving..." : submitLabel}
          </button>
          {secondaryActions}
        </div>
      </Form>
    </>
  );
}

/* ----------------------------------------------------------------------------
 * Field helpers
 * ------------------------------------------------------------------------- */

function tabClassName(isActive: boolean) {
  return isActive ? `${styles.tabContent} ${styles.active}` : styles.tabContent;
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
  value,
}: {
  allowed: boolean;
  current: string;
  label: string;
  value: string;
}) {
  const locked = !allowed && current !== value;

  return (
    <option disabled={locked} value={value}>
      {label}
      {allowed ? "" : " (Pro)"}
    </option>
  );
}

function LockedFeatureNotice({
  children,
  plansHref,
}: {
  children: ReactNode;
  plansHref: { pathname: string; search: string };
}) {
  return (
    <div className={styles.lockedNotice}>
      <p className={styles.lockedNoticeText}>
        {children} From {PLAN_ENTITLEMENTS.pro.priceLabel}, {PAID_PLAN_TRIAL_DAYS}-day
        free trial.
      </p>
      <Link className={styles.lockedNoticeLink} to={plansHref}>
        View plans
      </Link>
    </div>
  );
}

function UpgradePanel({
  plansHref,
  points,
  title,
}: {
  plansHref: { pathname: string; search: string };
  points: string[];
  title: string;
}) {
  return (
    <div className={styles.upgradePanel}>
      <h4 className={styles.upgradePanelTitle}>{title}</h4>
      <ul className={styles.upgradePanelList}>
        {points.map((point) => (
          <li key={point}>{point}</li>
        ))}
      </ul>
      <div className={styles.upgradePanelActions}>
        <Link className={styles.upgradeButton} to={plansHref}>
          Start {PAID_PLAN_TRIAL_DAYS}-day free trial
        </Link>
        <span className={styles.upgradeHint}>
          Pro is {PLAN_ENTITLEMENTS.pro.priceLabel} after the trial. Cancel any
          time.
        </span>
      </div>
    </div>
  );
}

function PercentageField({
  defaultValue,
  error,
  id,
  name,
}: {
  defaultValue: number | undefined;
  error: string | undefined;
  id: string;
  name: string;
}) {
  return (
    <div className={styles.fieldWrapper}>
      <label className={styles.label}>
        <span className={styles.labelText}>
          Percentage <span className={styles.required}>*</span>
        </span>
        <input
          aria-describedby={error ? `${id}-error` : undefined}
          aria-invalid={Boolean(error)}
          className={styles.input}
          defaultValue={defaultValue ?? ""}
          inputMode="decimal"
          max="100"
          min="0.01"
          name={name}
          placeholder="e.g., 10"
          step="0.01"
          type="number"
        />
      </label>
      <p className={styles.helpText}>Enter a value between 0 and 100.</p>
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}

function MoneyFields({
  amountError,
  amountName,
  availableCurrencies,
  currencyError,
  currencyName,
  defaultAmount,
  defaultCurrency,
  help,
  id,
  label,
  required = false,
}: {
  amountError: string | undefined;
  amountName: string;
  availableCurrencies: string[];
  currencyError: string | undefined;
  currencyName: string;
  defaultAmount: string | undefined;
  defaultCurrency: string;
  help?: string;
  id: string;
  label: string;
  required?: boolean;
}) {
  const currencies = availableCurrencies.includes(defaultCurrency)
    ? availableCurrencies
    : [defaultCurrency, ...availableCurrencies];

  return (
    <div className={styles.fieldWrapper}>
      <div className={styles.fieldGroup} style={{ marginBottom: 0 }}>
        <label className={styles.label}>
          <span className={styles.labelText}>
            {label}
            {required ? <span className={styles.required}> *</span> : null}
          </span>
          <input
            aria-describedby={amountError ? `${id}-amount-error` : undefined}
            aria-invalid={Boolean(amountError)}
            className={styles.input}
            defaultValue={defaultAmount ?? ""}
            inputMode="decimal"
            min="0.01"
            name={amountName}
            placeholder="e.g., 5.00"
            step="0.01"
            type="number"
          />
        </label>
        <label className={styles.label}>
          <span className={styles.labelText}>Currency</span>
          <select className={styles.select} defaultValue={defaultCurrency} name={currencyName}>
            {currencies.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </label>
      </div>
      {help ? <p className={styles.helpText}>{help}</p> : null}
      <FieldError id={`${id}-amount-error`} message={amountError} />
      <FieldError id={`${id}-currency-error`} message={currencyError} />
    </div>
  );
}

function FieldError({ id, message }: { id: string; message: string | undefined }) {
  if (!message) {
    return null;
  }

  return (
    <p className={styles.errorText} id={id}>
      {message}
    </p>
  );
}

/* ----------------------------------------------------------------------------
 * Product / collection picker
 * ------------------------------------------------------------------------- */

interface PickableResource {
  id: string;
  title: string;
}

function ResourcePicker<TResource extends PickableResource>({
  excluded,
  excludedFieldName,
  includedFieldName,
  label,
  onExcludedChange,
  onSelectedChange,
  resource,
  selected,
}: {
  excluded: TResource[];
  excludedFieldName: string;
  includedFieldName: string;
  label: string;
  onExcludedChange: (items: TResource[]) => void;
  onSelectedChange: (items: TResource[]) => void;
  resource: "products" | "collections";
  selected: TResource[];
}) {
  const location = useLocation();
  const fetcher = useFetcher<ResourceSearchData>();
  const [query, setQuery] = useState("");
  const trimmedQuery = query.trim();

  useEffect(() => {
    if (trimmedQuery.length < 2) {
      return;
    }

    const timeout = window.setTimeout(() => {
      const searchParams = new URLSearchParams(location.search);
      searchParams.set("resource", resource);
      searchParams.set("query", trimmedQuery);
      fetcher.load(`${location.pathname}?${searchParams.toString()}`);
    }, 250);

    return () => window.clearTimeout(timeout);
    // `fetcher` is stable for the life of the component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, location.search, resource, trimmedQuery]);

  // The loader returns products or collections depending on `resource`; the
  // caller picks the matching TResource.
  const results = ((resource === "products"
    ? fetcher.data?.products
    : fetcher.data?.collections) ?? []) as unknown as TResource[];
  const isSearching = fetcher.state !== "idle";
  const selectedIds = new Set(selected.map((item) => item.id));
  const excludedIds = new Set(excluded.map((item) => item.id));
  const singular = resource === "products" ? "product" : "collection";

  const include = (item: TResource) => {
    if (!selectedIds.has(item.id)) {
      onSelectedChange([...selected, item]);
    }
    onExcludedChange(excluded.filter((existing) => existing.id !== item.id));
  };

  const exclude = (item: TResource) => {
    if (!excludedIds.has(item.id)) {
      onExcludedChange([...excluded, item]);
    }
    onSelectedChange(selected.filter((existing) => existing.id !== item.id));
  };

  return (
    <>
      {selected.map((item) => (
        <input key={item.id} name={includedFieldName} type="hidden" value={item.id} />
      ))}
      {excluded.map((item) => (
        <input key={item.id} name={excludedFieldName} type="hidden" value={item.id} />
      ))}

      <div className={styles.fieldWrapper}>
        <label className={styles.label}>
          <span className={styles.labelText}>{label}</span>
          <input
            className={styles.input}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Type at least 2 characters"
            type="search"
            value={query}
          />
        </label>
        <p className={styles.helpText}>
          Search by name; the 20 best matches are shown. Add a {singular} to
          limit the discount to it, or exclude it to never discount it.
        </p>
      </div>

      {selected.length ? (
        <div className={styles.chipList}>
          <span className={styles.chipListLabel}>Only these {resource}</span>
          {selected.map((item) => (
            <span className={styles.chip} key={item.id}>
              {item.title}
              <button
                aria-label={`Remove ${item.title}`}
                className={styles.chipRemove}
                onClick={() =>
                  onSelectedChange(selected.filter((existing) => existing.id !== item.id))
                }
                type="button"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}

      {excluded.length ? (
        <div className={styles.chipList}>
          <span className={styles.chipListLabel}>Never discounted</span>
          {excluded.map((item) => (
            <span className={`${styles.chip} ${styles.chipExcluded}`} key={item.id}>
              {item.title}
              <button
                aria-label={`Remove ${item.title} from exclusions`}
                className={styles.chipRemove}
                onClick={() =>
                  onExcludedChange(excluded.filter((existing) => existing.id !== item.id))
                }
                type="button"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <div aria-live="polite" className={styles.searchResults}>
        {trimmedQuery.length < 2 ? (
          <p className={styles.helpText}>Enter a search term to find {resource}.</p>
        ) : isSearching ? (
          <p className={styles.helpText}>Searching {resource}...</p>
        ) : results.length ? (
          results.map((item) => {
            const isSelected = selectedIds.has(item.id);
            const isExcluded = excludedIds.has(item.id);

            return (
              <div className={styles.searchResultRow} key={item.id}>
                <span className={styles.searchResultTitle}>{item.title}</span>
                <span className={styles.searchResultActions}>
                  <button
                    className={styles.searchResultButton}
                    disabled={isSelected}
                    onClick={() => include(item)}
                    type="button"
                  >
                    {isSelected ? "Added" : "Add"}
                  </button>
                  <button
                    className={`${styles.searchResultButton} ${styles.searchResultButtonExclude}`}
                    disabled={isExcluded}
                    onClick={() => exclude(item)}
                    type="button"
                  >
                    {isExcluded ? "Excluded" : "Exclude"}
                  </button>
                </span>
              </div>
            );
          })
        ) : (
          <p className={styles.helpText}>No {resource} found.</p>
        )}
      </div>
    </>
  );
}

/* ----------------------------------------------------------------------------
 * Error summary
 * ------------------------------------------------------------------------- */

interface ErrorSummaryItem {
  message: string;
  tab: CampaignFormTab;
}

function ErrorSummary({
  errors,
  onDismiss,
  onSelectTab,
}: {
  errors: ErrorSummaryItem[];
  onDismiss: () => void;
  onSelectTab: (tab: CampaignFormTab) => void;
}) {
  if (!errors.length) {
    return null;
  }

  const groupedErrors = TABS.map((tab) => ({
    tab,
    errors: errors.filter((error) => error.tab === tab),
  })).filter((group) => group.errors.length);

  return (
    <div aria-live="polite" className={styles.errorSummary} role="alert">
      <div className={styles.errorSummaryHeader}>
        <span className={styles.errorIcon}>!</span>
        <div>
          <h2 className={styles.errorSummaryTitle}>
            {errors.length === 1
              ? "One issue needs attention"
              : `${errors.length} issues need attention`}
          </h2>
          <p className={styles.errorSummaryText}>
            Selecting an issue opens the tab where it can be fixed.
          </p>
        </div>
        <button
          aria-label="Close error summary"
          className={styles.errorSummaryClose}
          onClick={onDismiss}
          type="button"
        >
          ×
        </button>
      </div>
      <div className={styles.errorSummaryGroups}>
        {groupedErrors.map((group) => (
          <div className={styles.errorSummaryGroup} key={group.tab}>
            <button
              className={styles.errorSummaryTabButton}
              onClick={() => onSelectTab(group.tab)}
              type="button"
            >
              {TAB_LABELS[group.tab]}
            </button>
            <ul className={styles.errorSummaryList}>
              {group.errors.map((error) => (
                <li key={`${group.tab}-${error.message}`}>
                  <button
                    className={styles.errorSummaryIssue}
                    onClick={() => onSelectTab(group.tab)}
                    type="button"
                  >
                    {error.message}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

function errorSummaryItems(errors: string[]): ErrorSummaryItem[] {
  return errors.map((message) => ({ message, tab: tabForError(message) }));
}

function tabForError(error: string): CampaignFormTab {
  const lowerError = error.toLowerCase();

  if (
    lowerError.includes("campaign name") ||
    lowerError.includes("active discount")
  ) {
    return "basic";
  }

  if (
    lowerError.includes("start date") ||
    lowerError.includes("end date") ||
    lowerError.includes("scheduling")
  ) {
    return "schedule";
  }

  if (
    lowerError.includes("minimum") ||
    lowerError.includes("market") ||
    lowerError.includes("shipping method")
  ) {
    return "conditions";
  }

  return "discounts";
}

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
    const match = FIELD_ERROR_MATCHERS.find(([needle]) =>
      lowerError.includes(needle),
    );

    if (match && !fieldErrors[match[1]]) {
      fieldErrors[match[1]] = error;
    }
  }

  return fieldErrors;
}

/* ----------------------------------------------------------------------------
 * Explanations and summary copy
 * ------------------------------------------------------------------------- */

interface DiscountExplanationContent {
  title: string;
  points: string[];
}

function DiscountExplanation({
  explanation,
}: {
  explanation: DiscountExplanationContent | null;
}) {
  if (!explanation) {
    return null;
  }

  return (
    <div className={styles.explanationBox}>
      <strong className={styles.explanationTitle}>{explanation.title}</strong>
      <ul className={styles.explanationList}>
        {explanation.points.map((point) => (
          <li key={point}>{point}</li>
        ))}
      </ul>
    </div>
  );
}

function productDiscountExplanation(
  type: ProductDiscountType,
): DiscountExplanationContent | null {
  switch (type) {
    case "percentage":
      return {
        title: "Percentage off eligible products",
        points: [
          "Applies the same percentage to every eligible cart line.",
          "Product, collection, market, schedule, minimum subtotal, and minimum quantity conditions can limit when it applies.",
        ],
      };
    case "fixed_amount":
      return {
        title: "Fixed amount off eligible products",
        points: [
          "Splits the fixed discount amount across eligible products.",
          "The discount will not exceed the eligible product subtotal.",
        ],
      };
    case "buy_one_get_one_free":
      return {
        title: "Buy X, get Y cheapest free",
        points: [
          "Counts all eligible product units in the cart.",
          "For each complete buy/free set, the cheapest eligible units receive 100% off.",
        ],
      };
    case "volume_tier":
      return {
        title: "Volume tiers by quantity",
        points: [
          "Counts total eligible product quantity.",
          "Applies the highest tier whose minimum quantity is reached to all eligible products.",
        ],
      };
    default:
      return null;
  }
}

function orderDiscountExplanation(
  type: OrderDiscountType,
): DiscountExplanationContent | null {
  switch (type) {
    case "percentage":
      return {
        title: "Percentage off order subtotal",
        points: [
          "Applies to the eligible order subtotal after product/collection exclusions.",
          "The optional maximum amount caps the discount by converting it to a lower effective percentage when needed.",
        ],
      };
    case "fixed_amount":
      return {
        title: "Fixed amount off order subtotal",
        points: [
          "Applies one fixed amount to the eligible order subtotal.",
          "Products excluded by conditions are excluded from the order subtotal target.",
        ],
      };
    default:
      return null;
  }
}

function shippingDiscountExplanation(
  type: ShippingDiscountType,
): DiscountExplanationContent | null {
  switch (type) {
    case "free_shipping":
      return {
        title: "Free shipping",
        points: [
          "Applies a 100% discount to matching shipping rates.",
          "Can be limited by shipping method, market, schedule, minimum subtotal, and minimum quantity.",
        ],
      };
    case "percentage":
      return {
        title: "Percentage off shipping",
        points: [
          "Applies the percentage to matching shipping rates.",
          "Shipping method and campaign conditions decide which rates are eligible.",
        ],
      };
    case "fixed_amount":
      return {
        title: "Fixed amount off shipping",
        points: [
          "Applies one fixed amount to matching shipping rates.",
          "The discount follows the configured currency and matching shipping method.",
        ],
      };
    default:
      return null;
  }
}

function conditionExplanation(
  type: "minimums" | "market" | "combinesWith" | "products" | "collections",
): DiscountExplanationContent {
  switch (type) {
    case "minimums":
      return {
        title: "Minimum requirements",
        points: [
          "Minimum subtotal checks the full cart subtotal before this campaign can apply.",
          "Minimum quantity checks the total item quantity in the cart.",
          "Leave a field empty when that requirement should not be used.",
        ],
      };
    case "market":
      return {
        title: "Market targeting",
        points: [
          "Limits the whole campaign to one Shopify market.",
          "Applies to product, order, and shipping discounts in this campaign.",
          "Leave empty to allow all markets.",
        ],
      };
    case "combinesWith":
      return {
        title: "Discount stacking",
        points: [
          "Controls whether Shopify may combine this campaign with other discounts.",
          "These settings affect compatibility with other product, order, and shipping discounts.",
        ],
      };
    case "products":
      return {
        title: "Product include and exclude rules",
        points: [
          "Included products limit the campaign to only those products.",
          "Excluded products are never discounted, even if they are also included by another rule.",
          "Leave included products empty to allow all products except excluded ones.",
        ],
      };
    default:
      return {
        title: "Collection include and exclude rules",
        points: [
          "Included collections limit the campaign to products in those collections.",
          "Excluded collections are never discounted and override included collections.",
          "Collection rules work together with product rules.",
        ],
      };
  }
}

function campaignSummaryItems({
  productDiscountType,
  orderDiscountType,
  shippingDiscountType,
  marketName,
  includedProductCount,
  excludedProductCount,
  includedCollectionCount,
  excludedCollectionCount,
}: {
  productDiscountType: ProductDiscountType;
  orderDiscountType: OrderDiscountType;
  shippingDiscountType: ShippingDiscountType;
  marketName: string;
  includedProductCount: number;
  excludedProductCount: number;
  includedCollectionCount: number;
  excludedCollectionCount: number;
}) {
  const items = [
    productDiscountSummary(productDiscountType),
    orderDiscountSummary(orderDiscountType),
    shippingDiscountSummary(shippingDiscountType),
  ].filter(Boolean) as string[];

  if (!items.length) {
    items.push("No discount type selected yet.");
  }

  items.push(marketName ? `Only applies in ${marketName}.` : "Applies in all markets.");

  if (includedProductCount || includedCollectionCount) {
    items.push(
      `Limited to ${joinCounts([
        restrictionCountLabel(includedProductCount, "product"),
        restrictionCountLabel(includedCollectionCount, "collection"),
      ])}.`,
    );
  } else {
    items.push("Eligible for all products unless exclusions are selected.");
  }

  if (excludedProductCount || excludedCollectionCount) {
    items.push(
      `Excludes ${joinCounts([
        restrictionCountLabel(excludedProductCount, "product"),
        restrictionCountLabel(excludedCollectionCount, "collection"),
      ])}.`,
    );
  }

  return items;
}

function joinCounts(parts: string[]) {
  return parts.filter(Boolean).join(" and ");
}

function productDiscountSummary(type: ProductDiscountType) {
  switch (type) {
    case "percentage":
      return "Product discount: percentage off eligible products.";
    case "fixed_amount":
      return "Product discount: fixed amount off eligible products.";
    case "buy_one_get_one_free":
      return "Product discount: Buy X, get Y cheapest free.";
    case "volume_tier":
      return "Product discount: volume tiers by eligible quantity.";
    default:
      return "";
  }
}

function orderDiscountSummary(type: OrderDiscountType) {
  switch (type) {
    case "percentage":
      return "Order discount: percentage off eligible order subtotal.";
    case "fixed_amount":
      return "Order discount: fixed amount off eligible order subtotal.";
    default:
      return "";
  }
}

function shippingDiscountSummary(type: ShippingDiscountType) {
  switch (type) {
    case "free_shipping":
      return "Shipping discount: free shipping.";
    case "percentage":
      return "Shipping discount: percentage off matching shipping rates.";
    case "fixed_amount":
      return "Shipping discount: fixed amount off matching shipping rates.";
    default:
      return "";
  }
}

function restrictionCountLabel(count: number, label: string) {
  if (!count) return "";
  return `${count} ${label}${count === 1 ? "" : "s"}`;
}
