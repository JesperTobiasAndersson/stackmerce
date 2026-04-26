import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  Form,
  Link,
  redirect,
  useActionData,
  useFetcher,
  useLoaderData,
  useLocation,
  useNavigation,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useEffect, useState } from "react";

import styles from "./app.campaigns.new/styles.module.css";
import { getCurrentPlan } from "../billing.server";
import {
  entitlementForPlan,
  validateCampaignEntitlements,
  type AppPlan,
} from "../entitlements";
import type {
  OrderDiscountType,
  ProductDiscountType,
  ShippingDiscountType,
} from "../campaign-config";
import type { CampaignFormInput } from "../campaign-storage.server";
import { loadCampaigns, saveNewCampaign } from "../campaign-storage.server";
import type {
  ShopifyCollectionSummary,
  ShopifyMarketSummary,
  ShopifyProductSummary,
  ShopifyShippingMethodSummary,
} from "../shopify-api.server";
import {
  getCurrencyInfo,
  listMarkets,
  listShippingMethods,
  listCollections,
  listProducts,
} from "../shopify-api.server";
import { authenticate } from "../shopify.server";

type NewCampaignLoaderData = {
  plan: AppPlan;
  defaultCurrency: string;
  availableCurrencies: string[];
  shippingMethods: ShopifyShippingMethodSummary[];
  markets: ShopifyMarketSummary[];
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const resource = url.searchParams.get("resource");
  const query = String(url.searchParams.get("query") || "").trim();

  if (resource === "products") {
    if (query.length < 2) {
      return { resource, products: [] };
    }

    const products = await listProducts(admin, {
      first: 20,
      query,
    });

    return { resource, products: products.nodes };
  }

  if (resource === "collections") {
    if (query.length < 2) {
      return { resource, collections: [] };
    }

    const collections = await listCollections(admin, {
      first: 20,
      query,
    });

    return { resource, collections: collections.nodes };
  }

  const [currencyInfo, shippingMethods, markets, plan] = await Promise.all([
    getCurrencyInfo(admin, session.shop),
    listShippingMethods(admin, session.shop),
    listMarkets(admin, session.shop),
    getCurrentPlan(admin, session.shop),
  ]);

  return {
    plan,
    defaultCurrency: currencyInfo.defaultCurrency,
    availableCurrencies: currencyInfo.availableCurrencies,
    shippingMethods,
    markets,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const campaign = campaignInputFromForm(formData);
  const [plan, campaigns] = await Promise.all([
    getCurrentPlan(admin, session.shop),
    loadCampaigns(admin, { first: 250 }),
  ]);
  const activeCampaignCount = campaigns.nodes.filter(
    (existingCampaign) => existingCampaign.status.toLowerCase() === "active",
  ).length;
  const errors = [
    ...validateCampaignInput(campaign),
    ...validateCampaignEntitlements({
      activeCampaignCount,
      input: campaign,
      plan,
    }),
  ];

  if (errors.length) {
    return { errors };
  }

  try {
    await saveNewCampaign(admin, campaign);
  } catch (error) {
    return {
      errors: [error instanceof Error ? error.message : "Could not save campaign."],
    };
  }

  return redirect("/app/campaigns");
};

export default function NewCampaign() {
  const { plan, defaultCurrency, availableCurrencies, shippingMethods, markets } =
    useLoaderData<typeof loader>() as NewCampaignLoaderData;
  const entitlements = entitlementForPlan(plan);
  const actionData = useActionData<typeof action>();
  const errors = actionData?.errors ?? [];
  const fieldErrors = fieldErrorsFromMessages(errors);
  const location = useLocation();
  const navigation = useNavigation();
  const productFetcher = useFetcher<typeof loader>();
  const collectionFetcher = useFetcher<typeof loader>();
  const isSaving = navigation.state === "submitting";
  const [activeTab, setActiveTab] = useState<"basic" | "discounts" | "conditions" | "schedule">("basic");
  const [dismissedErrorSummaryKey, setDismissedErrorSummaryKey] = useState("");
  const [productQuery, setProductQuery] = useState("");
  const [collectionQuery, setCollectionQuery] = useState("");
  const [selectedProducts, setSelectedProducts] = useState<ShopifyProductSummary[]>([]);
  const [selectedCollections, setSelectedCollections] = useState<ShopifyCollectionSummary[]>([]);
  const [excludedProducts, setExcludedProducts] = useState<ShopifyProductSummary[]>([]);
  const [excludedCollections, setExcludedCollections] = useState<ShopifyCollectionSummary[]>([]);
  const [formState, setFormState] = useState({
    productDiscountType: "none",
    orderDiscountType: "none",
    shippingDiscountType: "none",
    shippingDeliveryOptionHandle: "",
    marketHandle: "",
    selectedProductIds: new Set<string>(),
    selectedCollectionIds: new Set<string>(),
    excludedProductIds: new Set<string>(),
    excludedCollectionIds: new Set<string>(),
  });

  const searchProducts = (query: string) => {
    const searchParams = new URLSearchParams(location.search);
    searchParams.set("resource", "products");
    searchParams.set("query", query);
    productFetcher.load(`/app/campaigns/new?${searchParams.toString()}`);
  };

  const searchCollections = (query: string) => {
    const searchParams = new URLSearchParams(location.search);
    searchParams.set("resource", "collections");
    searchParams.set("query", query);
    collectionFetcher.load(`/app/campaigns/new?${searchParams.toString()}`);
  };

  useEffect(() => {
    const query = productQuery.trim();
    if (query.length < 2) {
      return;
    }

    const timeout = window.setTimeout(() => searchProducts(query), 250);

    return () => window.clearTimeout(timeout);
  }, [productQuery]);

  useEffect(() => {
    const query = collectionQuery.trim();
    if (query.length < 2) {
      return;
    }

    const timeout = window.setTimeout(() => searchCollections(query), 250);

    return () => window.clearTimeout(timeout);
  }, [collectionQuery]);

  const handleProductSelect = (product: ShopifyProductSummary) => {
    const newSet = new Set(formState.selectedProductIds);
    const excludedProductIds = new Set(formState.excludedProductIds);
    if (!newSet.has(product.id)) {
      newSet.add(product.id);
      setSelectedProducts([...selectedProducts, product]);
    }
    excludedProductIds.delete(product.id);
    setExcludedProducts(excludedProducts.filter((item) => item.id !== product.id));
    setFormState({ ...formState, selectedProductIds: newSet, excludedProductIds });
  };

  const handleProductRemove = (id: string) => {
    const newSet = new Set(formState.selectedProductIds);
    newSet.delete(id);
    setSelectedProducts(
      selectedProducts.filter((product) => product.id !== id),
    );
    setFormState({ ...formState, selectedProductIds: newSet });
  };

  const handleProductExclude = (product: ShopifyProductSummary) => {
    const selectedProductIds = new Set(formState.selectedProductIds);
    const excludedProductIds = new Set(formState.excludedProductIds);
    if (!excludedProductIds.has(product.id)) {
      excludedProductIds.add(product.id);
      setExcludedProducts([...excludedProducts, product]);
    }
    selectedProductIds.delete(product.id);
    setSelectedProducts(selectedProducts.filter((item) => item.id !== product.id));
    setFormState({ ...formState, selectedProductIds, excludedProductIds });
  };

  const handleProductUnexclude = (id: string) => {
    const excludedProductIds = new Set(formState.excludedProductIds);
    excludedProductIds.delete(id);
    setExcludedProducts(excludedProducts.filter((product) => product.id !== id));
    setFormState({ ...formState, excludedProductIds });
  };

  const handleCollectionSelect = (collection: ShopifyCollectionSummary) => {
    const newSet = new Set(formState.selectedCollectionIds);
    const excludedCollectionIds = new Set(formState.excludedCollectionIds);
    if (!newSet.has(collection.id)) {
      newSet.add(collection.id);
      setSelectedCollections([...selectedCollections, collection]);
    }
    excludedCollectionIds.delete(collection.id);
    setExcludedCollections(
      excludedCollections.filter((item) => item.id !== collection.id),
    );
    setFormState({ ...formState, selectedCollectionIds: newSet, excludedCollectionIds });
  };

  const handleCollectionRemove = (id: string) => {
    const newSet = new Set(formState.selectedCollectionIds);
    newSet.delete(id);
    setSelectedCollections(
      selectedCollections.filter((collection) => collection.id !== id),
    );
    setFormState({ ...formState, selectedCollectionIds: newSet });
  };

  const handleCollectionExclude = (collection: ShopifyCollectionSummary) => {
    const selectedCollectionIds = new Set(formState.selectedCollectionIds);
    const excludedCollectionIds = new Set(formState.excludedCollectionIds);
    if (!excludedCollectionIds.has(collection.id)) {
      excludedCollectionIds.add(collection.id);
      setExcludedCollections([...excludedCollections, collection]);
    }
    selectedCollectionIds.delete(collection.id);
    setSelectedCollections(
      selectedCollections.filter((item) => item.id !== collection.id),
    );
    setFormState({ ...formState, selectedCollectionIds, excludedCollectionIds });
  };

  const handleCollectionUnexclude = (id: string) => {
    const excludedCollectionIds = new Set(formState.excludedCollectionIds);
    excludedCollectionIds.delete(id);
    setExcludedCollections(
      excludedCollections.filter((collection) => collection.id !== id),
    );
    setFormState({ ...formState, excludedCollectionIds });
  };

  const productResults =
    productFetcher.data && "products" in productFetcher.data
      ? productFetcher.data.products ?? []
      : [];
  const collectionResults =
    collectionFetcher.data && "collections" in collectionFetcher.data
      ? collectionFetcher.data.collections ?? []
      : [];
  const isSearchingProducts = productFetcher.state !== "idle";
  const isSearchingCollections = collectionFetcher.state !== "idle";
  const campaignSummary = campaignSummaryItems({
    productDiscountType: formState.productDiscountType,
    orderDiscountType: formState.orderDiscountType,
    shippingDiscountType: formState.shippingDiscountType,
    marketName:
      markets.find((market) => market.handle === formState.marketHandle)?.name ??
      "",
    includedProductCount: selectedProducts.length,
    excludedProductCount: excludedProducts.length,
    includedCollectionCount: selectedCollections.length,
    excludedCollectionCount: excludedCollections.length,
  });
  const errorSummary = errorSummaryItems(errors);
  const errorSummaryKey = errors.join("\n");
  const showErrorSummary =
    errorSummary.length > 0 && dismissedErrorSummaryKey !== errorSummaryKey;

  useEffect(() => {
    if (errorSummary.length) {
      setActiveTab(errorSummary[0].tab);
    }
  }, [errorSummaryKey]);

  return (
    <s-page heading="Create discount">
      <s-section>
        <Link
          className={styles.backButton}
          to={{ pathname: "/app/campaigns", search: location.search }}
        >
          &lt; Back to discounts
        </Link>

        <ErrorSummary
          errors={showErrorSummary ? errorSummary : []}
          onDismiss={() => setDismissedErrorSummaryKey(errorSummaryKey)}
          onSelectTab={setActiveTab}
        />

        <div className={styles.pageHeader}>
          <h1 className={styles.pageTitle}>Create a new discount</h1>
          <p className={styles.sectionDescription}>
            Build product and shipping discounts with optional conditions and schedules.
          </p>
          <p className={styles.planNotice}>
            Current plan: {entitlements.name} ({entitlements.priceLabel})
          </p>
        </div>

        <Form method="post" className={styles.formContainer} noValidate>
          {/* Tab Navigation */}
          <div className={styles.tabNav}>
            {(["basic", "discounts", "conditions", "schedule"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                className={
                  activeTab === tab
                    ? `${styles.tabButton} ${styles.active}`
                    : styles.tabButton
                }
                onClick={() => setActiveTab(tab)}
              >
                {tabLabels[tab]}
              </button>
            ))}
          </div>

          {/* Basic Tab */}
          <div className={`${styles.tabContent} ${activeTab === "basic" ? styles.active : ""}`}>
              <div className={styles.formSection}>
                <h3 className={styles.sectionHeading}>Discount Details</h3>
                <p className={styles.sectionDescription}>
                  Give your discount a name and set its initial status.
                </p>

                <div style={fieldWrapperStyle}>
                  <label style={labelStyle}>
                    <span style={labelTextStyle}>Discount Name *</span>
                    <input
                      aria-invalid={Boolean(fieldErrors.name)}
                      aria-describedby={
                        fieldErrors.name ? "name-error" : undefined
                      }
                      name="name"
                      placeholder="e.g., Summer Sale 2024"
                      required
                      style={inputStyle}
                      type="text"
                    />
                  </label>
                  <p style={helpTextStyle}>
                    A memorable name helps you identify this discount in your list.
                  </p>
                  <FieldError id="name-error" message={fieldErrors.name} />
                </div>

                <div style={fieldWrapperStyle}>
                  <label style={labelStyle}>
                    <span style={labelTextStyle}>Status</span>
                    <select name="status" defaultValue="inactive" style={selectStyle}>
                      <option value="inactive">Inactive (Draft)</option>
                      <option value="active">Active</option>
                    </select>
                  </label>
                  <p style={helpTextStyle}>
                    Inactive discounts are saved but not active. You can activate them later.
                  </p>
                </div>
              </div>
            </div>


          {/* Discounts Tab */}
          <div className={`${styles.tabContent} ${activeTab === "discounts" ? styles.active : ""}`}>
              {/* Product Discount Section */}
              <div className={styles.formSection}>
                <h3 className={styles.sectionHeading}>Product Discount</h3>
                <p className={styles.sectionDescription}>
                  Offer a discount on products in the cart.
                </p>

                <div style={fieldWrapperStyle}>
                  <label style={labelStyle}>
                    <span style={labelTextStyle}>Discount Type</span>
                    <select
                      name="productDiscountType"
                      defaultValue="none"
                      onChange={(e) =>
                        setFormState({
                          ...formState,
                          productDiscountType:
                            e.target.value as ProductDiscountType,
                        })
                      }
                      style={selectStyle}
                    >
                      <option value="none">No product discount</option>
                      <option value="percentage">Percentage off eligible products</option>
                      <option
                        disabled={!entitlements.fixedAmountDiscounts}
                        value="fixed_amount"
                      >
                        Fixed amount off eligible products
                        {lockedFeatureLabel(entitlements.fixedAmountDiscounts)}
                      </option>
                      <option
                        disabled={!entitlements.bogoDiscounts}
                        value="buy_one_get_one_free"
                      >
                        Buy X, get Y cheapest free
                        {lockedFeatureLabel(entitlements.bogoDiscounts)}
                      </option>
                      <option
                        disabled={!entitlements.volumeTiers}
                        value="volume_tier"
                      >
                        Volume tiers by quantity
                        {lockedFeatureLabel(entitlements.volumeTiers)}
                      </option>
                    </select>
                  </label>
                  <FieldError
                    id="product-discount-type-error"
                    message={fieldErrors.discountType}
                  />
                  <DiscountExplanation
                    explanation={productDiscountExplanation(
                      formState.productDiscountType,
                    )}
                  />
                </div>

                {formState.productDiscountType === "percentage" && (
                  <div style={fieldWrapperStyle}>
                    <label style={labelStyle}>
                      <span style={labelTextStyle}>Percentage *</span>
                      <input
                        aria-invalid={Boolean(fieldErrors.productPercentage)}
                        aria-describedby={
                          fieldErrors.productPercentage
                            ? "product-percentage-error"
                            : undefined
                        }
                        inputMode="decimal"
                        max="100"
                        min="0.01"
                        name="productDiscountPercentage"
                        placeholder="e.g., 10"
                        step="0.01"
                        style={inputStyle}
                        type="number"
                      />
                    </label>
                    <p style={helpTextStyle}>Enter a value between 0 and 100</p>
                    <FieldError
                      id="product-percentage-error"
                      message={fieldErrors.productPercentage}
                    />
                  </div>
                )}

                {formState.productDiscountType === "fixed_amount" && (
                  <>
                    <div style={fieldWrapperStyle}>
                      <label style={labelStyle}>
                        <span style={labelTextStyle}>Amount *</span>
                        <input
                          aria-invalid={Boolean(fieldErrors.productFixedAmount)}
                          aria-describedby={
                            fieldErrors.productFixedAmount
                              ? "product-fixed-amount-error"
                              : undefined
                          }
                          inputMode="decimal"
                          min="0.01"
                          name="productDiscountFixedAmount"
                          placeholder="e.g., 5.00"
                          step="0.01"
                          style={inputStyle}
                          type="number"
                        />
                      </label>
                      <FieldError
                        id="product-fixed-amount-error"
                        message={fieldErrors.productFixedAmount}
                      />
                    </div>
                    <div style={fieldWrapperStyle}>
                      <label style={labelStyle}>
                        <span style={labelTextStyle}>Currency Code</span>
                        <select
                          defaultValue={defaultCurrency}
                          name="productDiscountFixedCurrencyCode"
                          style={selectStyle}
                        >
                          {availableCurrencies.map((code) => (
                            <option key={code} value={code}>
                              {code}
                            </option>
                          ))}
                        </select>
                      </label>
                      <p style={helpTextStyle}>Select the currency for this discount</p>
                      <FieldError
                        id="product-fixed-currency-error"
                        message={fieldErrors.productFixedCurrency}
                      />
                    </div>
                  </>
                )}

                {formState.productDiscountType === "buy_one_get_one_free" && (
                  <>
                    <div style={fieldWrapperStyle}>
                      <label style={labelStyle}>
                        <span style={labelTextStyle}>Buy quantity *</span>
                        <input
                          aria-invalid={Boolean(fieldErrors.productBuyQuantity)}
                          aria-describedby={
                            fieldErrors.productBuyQuantity
                              ? "product-buy-quantity-error"
                              : undefined
                          }
                          defaultValue="1"
                          inputMode="numeric"
                          min="1"
                          name="productDiscountBuyQuantity"
                          step="1"
                          style={inputStyle}
                          type="number"
                        />
                      </label>
                      <FieldError
                        id="product-buy-quantity-error"
                        message={fieldErrors.productBuyQuantity}
                      />
                    </div>
                    <div style={fieldWrapperStyle}>
                      <label style={labelStyle}>
                        <span style={labelTextStyle}>Free quantity *</span>
                        <input
                          aria-invalid={Boolean(fieldErrors.productFreeQuantity)}
                          aria-describedby={
                            fieldErrors.productFreeQuantity
                              ? "product-free-quantity-error"
                              : undefined
                          }
                          defaultValue="1"
                          inputMode="numeric"
                          min="1"
                          name="productDiscountFreeQuantity"
                          step="1"
                          style={inputStyle}
                          type="number"
                        />
                      </label>
                      <p style={helpTextStyle}>
                        The cheapest eligible items are discounted first.
                      </p>
                      <FieldError
                        id="product-free-quantity-error"
                        message={fieldErrors.productFreeQuantity}
                      />
                    </div>
                  </>
                )}

                {formState.productDiscountType === "volume_tier" && (
                  <>
                    {[1, 2, 3].map((tierNumber) => (
                      <div key={tierNumber} style={fieldGroupStyle}>
                        <label style={labelStyle}>
                          <span style={labelTextStyle}>
                            Tier {tierNumber} minimum quantity
                            {tierNumber === 1 ? " *" : ""}
                          </span>
                          <input
                            inputMode="numeric"
                            min="1"
                            name="productVolumeTierMinimumQuantity"
                            placeholder={tierNumber === 1 ? "e.g., 3" : ""}
                            step="1"
                            style={inputStyle}
                            type="number"
                          />
                        </label>
                        <label style={labelStyle}>
                          <span style={labelTextStyle}>
                            Tier {tierNumber} percentage
                            {tierNumber === 1 ? " *" : ""}
                          </span>
                          <input
                            inputMode="decimal"
                            max="100"
                            min="0.01"
                            name="productVolumeTierPercentage"
                            placeholder={tierNumber === 1 ? "e.g., 10" : ""}
                            step="0.01"
                            style={inputStyle}
                            type="number"
                          />
                        </label>
                      </div>
                    ))}
                    <p style={helpTextStyle}>
                      The highest matching tier is applied to all eligible products.
                    </p>
                    <FieldError
                      id="volume-tier-error"
                      message={fieldErrors.productVolumeTiers}
                    />
                  </>
                )}
              </div>

              {/* Order Discount Section */}
              <div style={formSectionStyle}>
                <h3 style={sectionHeadingStyle}>Order Discount</h3>
                <p style={sectionDescriptionStyle}>
                  Offer a discount on the order subtotal.
                </p>

                <div style={fieldWrapperStyle}>
                  <label style={labelStyle}>
                    <span style={labelTextStyle}>Discount Type</span>
                    <select
                      name="orderDiscountType"
                      defaultValue="none"
                      onChange={(e) =>
                        setFormState({
                          ...formState,
                          orderDiscountType:
                            e.target.value as OrderDiscountType,
                        })
                      }
                      style={selectStyle}
                    >
                      <option value="none">No order discount</option>
                      <option value="percentage">Percentage off order subtotal</option>
                      <option
                        disabled={!entitlements.fixedAmountDiscounts}
                        value="fixed_amount"
                      >
                        Fixed amount off order subtotal
                        {lockedFeatureLabel(entitlements.fixedAmountDiscounts)}
                      </option>
                    </select>
                  </label>
                  <DiscountExplanation
                    explanation={orderDiscountExplanation(
                      formState.orderDiscountType,
                    )}
                  />
                </div>

                {formState.orderDiscountType === "percentage" && (
                  <>
                    <div style={fieldWrapperStyle}>
                      <label style={labelStyle}>
                        <span style={labelTextStyle}>Percentage *</span>
                        <input
                          aria-invalid={Boolean(fieldErrors.orderPercentage)}
                          aria-describedby={
                            fieldErrors.orderPercentage
                              ? "order-percentage-error"
                              : undefined
                          }
                          inputMode="decimal"
                          max="100"
                          min="0.01"
                          name="orderDiscountPercentage"
                          placeholder="e.g., 10"
                          step="0.01"
                          style={inputStyle}
                          type="number"
                        />
                      </label>
                      <p style={helpTextStyle}>Enter a value between 0 and 100</p>
                      <FieldError
                        id="order-percentage-error"
                        message={fieldErrors.orderPercentage}
                      />
                    </div>
                    <div style={fieldGroupStyle}>
                      <label style={labelStyle}>
                        <span style={labelTextStyle}>Maximum discount amount</span>
                        <input
                          aria-invalid={Boolean(fieldErrors.orderMaximumAmount)}
                          aria-describedby={
                            fieldErrors.orderMaximumAmount
                              ? "order-maximum-amount-error"
                              : undefined
                          }
                          inputMode="decimal"
                          min="0.01"
                          name="orderDiscountMaximumAmount"
                          placeholder="e.g., 200.00"
                          step="0.01"
                          style={inputStyle}
                          type="number"
                        />
                      </label>
                      <label style={labelStyle}>
                        <span style={labelTextStyle}>Currency Code</span>
                        <select
                          defaultValue={defaultCurrency}
                          name="orderDiscountMaximumCurrencyCode"
                          style={selectStyle}
                        >
                          {availableCurrencies.map((code) => (
                            <option key={code} value={code}>
                              {code}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <p style={helpTextStyle}>Leave empty for no maximum.</p>
                    <FieldError
                      id="order-maximum-amount-error"
                      message={fieldErrors.orderMaximumAmount}
                    />
                    <FieldError
                      id="order-maximum-currency-error"
                      message={fieldErrors.orderMaximumCurrency}
                    />
                  </>
                )}

                {formState.orderDiscountType === "fixed_amount" && (
                  <>
                    <div style={fieldWrapperStyle}>
                      <label style={labelStyle}>
                        <span style={labelTextStyle}>Amount *</span>
                        <input
                          aria-invalid={Boolean(fieldErrors.orderFixedAmount)}
                          aria-describedby={
                            fieldErrors.orderFixedAmount
                              ? "order-fixed-amount-error"
                              : undefined
                          }
                          inputMode="decimal"
                          min="0.01"
                          name="orderDiscountFixedAmount"
                          placeholder="e.g., 5.00"
                          step="0.01"
                          style={inputStyle}
                          type="number"
                        />
                      </label>
                      <FieldError
                        id="order-fixed-amount-error"
                        message={fieldErrors.orderFixedAmount}
                      />
                    </div>
                    <div style={fieldWrapperStyle}>
                      <label style={labelStyle}>
                        <span style={labelTextStyle}>Currency Code</span>
                        <select
                          defaultValue={defaultCurrency}
                          name="orderDiscountFixedCurrencyCode"
                          style={selectStyle}
                        >
                          {availableCurrencies.map((code) => (
                            <option key={code} value={code}>
                              {code}
                            </option>
                          ))}
                        </select>
                      </label>
                      <p style={helpTextStyle}>Select the currency for this discount</p>
                      <FieldError
                        id="order-fixed-currency-error"
                        message={fieldErrors.orderFixedCurrency}
                      />
                    </div>
                  </>
                )}
              </div>

              {/* Shipping Discount Section */}
              <div style={formSectionStyle}>
                <h3 style={sectionHeadingStyle}>Shipping Discount</h3>
                <p style={sectionDescriptionStyle}>
                  Offer a discount or free shipping.
                </p>

                <div style={fieldWrapperStyle}>
                  <label style={labelStyle}>
                    <span style={labelTextStyle}>Discount Type</span>
                    <select
                      name="shippingDiscountType"
                      defaultValue="none"
                      onChange={(e) =>
                        setFormState({
                          ...formState,
                          shippingDiscountType:
                            e.target.value as ShippingDiscountType,
                          shippingDeliveryOptionHandle:
                            e.target.value === "none"
                              ? ""
                              : formState.shippingDeliveryOptionHandle,
                        })
                      }
                      style={selectStyle}
                    >
                      <option value="none">No shipping discount</option>
                      <option
                        disabled={!entitlements.shippingDiscounts}
                        value="free_shipping"
                      >
                        Free shipping
                        {lockedFeatureLabel(entitlements.shippingDiscounts)}
                      </option>
                      <option
                        disabled={!entitlements.shippingDiscounts}
                        value="percentage"
                      >
                        Percentage off shipping
                        {lockedFeatureLabel(entitlements.shippingDiscounts)}
                      </option>
                      <option
                        disabled={
                          !entitlements.shippingDiscounts ||
                          !entitlements.fixedAmountDiscounts
                        }
                        value="fixed_amount"
                      >
                        Fixed amount off shipping
                        {lockedFeatureLabel(
                          entitlements.shippingDiscounts &&
                            entitlements.fixedAmountDiscounts,
                        )}
                      </option>
                    </select>
                  </label>
                  <DiscountExplanation
                    explanation={shippingDiscountExplanation(
                      formState.shippingDiscountType,
                    )}
                  />
                </div>

                {formState.shippingDiscountType !== "none" && (
                  <div style={fieldWrapperStyle}>
                    <label style={labelStyle}>
                      <span style={labelTextStyle}>Shipping method</span>
                      <select
                        disabled={!entitlements.shippingMethodTargeting}
                        name="shippingDeliveryOptionHandle"
                        onChange={(event) =>
                          setFormState({
                            ...formState,
                            shippingDeliveryOptionHandle: event.target.value,
                          })
                        }
                        style={selectStyle}
                        value={formState.shippingDeliveryOptionHandle}
                      >
                        <option value="">All shipping methods</option>
                        {shippingMethods.map((method) => (
                          <option key={method.id} value={method.handle}>
                            {method.name} ({method.zoneName})
                          </option>
                        ))}
                      </select>
                    </label>
                    <input
                      name="shippingDeliveryOptionTitle"
                      type="hidden"
                      value={
                        shippingMethods.find(
                          (method) =>
                            method.handle ===
                            formState.shippingDeliveryOptionHandle,
                        )?.name ?? ""
                      }
                    />
                    <p style={helpTextStyle}>
                      {!entitlements.shippingMethodTargeting
                        ? "Specific shipping method targeting is available on Pro and Enterprise."
                        : shippingMethods.length
                        ? "Select one method to apply the shipping discount only to that method. Leave empty to apply to all methods."
                        : "No shipping methods could be loaded. The app needs the read_shipping scope and the shop must approve the updated permissions."}
                    </p>
                  </div>
                )}

                {formState.shippingDiscountType === "percentage" && (
                  <div style={fieldWrapperStyle}>
                    <label style={labelStyle}>
                      <span style={labelTextStyle}>Percentage *</span>
                      <input
                        aria-invalid={Boolean(fieldErrors.shippingPercentage)}
                        aria-describedby={
                          fieldErrors.shippingPercentage
                            ? "shipping-percentage-error"
                            : undefined
                        }
                        inputMode="decimal"
                        max="100"
                        min="0.01"
                        name="shippingDiscountPercentage"
                        placeholder="e.g., 10"
                        step="0.01"
                        style={inputStyle}
                        type="number"
                      />
                    </label>
                    <p style={helpTextStyle}>Enter a value between 0 and 100</p>
                    <FieldError
                      id="shipping-percentage-error"
                      message={fieldErrors.shippingPercentage}
                    />
                  </div>
                )}

                {formState.shippingDiscountType === "fixed_amount" && (
                  <>
                    <div style={fieldWrapperStyle}>
                      <label style={labelStyle}>
                        <span style={labelTextStyle}>Amount *</span>
                        <input
                          aria-invalid={Boolean(fieldErrors.shippingFixedAmount)}
                          aria-describedby={
                            fieldErrors.shippingFixedAmount
                              ? "shipping-fixed-amount-error"
                              : undefined
                          }
                          inputMode="decimal"
                          min="0.01"
                          name="shippingDiscountFixedAmount"
                          placeholder="e.g., 5.00"
                          step="0.01"
                          style={inputStyle}
                          type="number"
                        />
                      </label>
                      <FieldError
                        id="shipping-fixed-amount-error"
                        message={fieldErrors.shippingFixedAmount}
                      />
                    </div>
                    <div style={fieldWrapperStyle}>
                      <label style={labelStyle}>
                        <span style={labelTextStyle}>Currency Code</span>
                        <select
                          defaultValue={defaultCurrency}
                          name="shippingDiscountFixedCurrencyCode"
                          style={selectStyle}
                        >
                          {availableCurrencies.map((code) => (
                            <option key={code} value={code}>
                              {code}
                            </option>
                          ))}
                        </select>
                      </label>
                      <p style={helpTextStyle}>Select the currency for this discount</p>
                      <FieldError
                        id="shipping-fixed-currency-error"
                        message={fieldErrors.shippingFixedCurrency}
                      />
                    </div>
                  </>
                )}
              </div>
            </div>


          {/* Conditions Tab */}
          <div className={`${styles.tabContent} ${activeTab === "conditions" ? styles.active : ""}`}>
              <div className={styles.formSection}>
                <h3 className={styles.sectionHeading}>Minimum Cart Subtotal</h3>
                <p className={styles.sectionDescription}>
                  Only apply discount when cart reaches a minimum subtotal or quantity.
                </p>
                <DiscountExplanation
                  explanation={conditionExplanation("minimums")}
                />

                <div style={fieldWrapperStyle}>
                  <label style={labelStyle}>
                    <span style={labelTextStyle}>Minimum Amount</span>
                    <input
                      aria-invalid={Boolean(fieldErrors.minimumSubtotalAmount)}
                      aria-describedby={
                        fieldErrors.minimumSubtotalAmount
                          ? "minimum-subtotal-amount-error"
                          : undefined
                      }
                      inputMode="decimal"
                      min="0.01"
                      name="minimumCartSubtotalAmount"
                      placeholder="e.g., 50.00"
                      step="0.01"
                      style={inputStyle}
                      type="number"
                    />
                  </label>
                  <p style={helpTextStyle}>Leave empty for no minimum</p>
                  <FieldError
                    id="minimum-subtotal-amount-error"
                    message={fieldErrors.minimumSubtotalAmount}
                  />
                </div>

                <div style={fieldWrapperStyle}>
                  <label style={labelStyle}>
                    <span style={labelTextStyle}>Minimum Quantity</span>
                    <input
                      aria-invalid={Boolean(fieldErrors.minimumCartQuantity)}
                      aria-describedby={
                        fieldErrors.minimumCartQuantity
                          ? "minimum-cart-quantity-error"
                          : undefined
                      }
                      inputMode="numeric"
                      min="1"
                      name="minimumCartQuantity"
                      placeholder="e.g., 3"
                      step="1"
                      style={inputStyle}
                      type="number"
                    />
                  </label>
                  <p style={helpTextStyle}>Leave empty for no quantity minimum</p>
                  <FieldError
                    id="minimum-cart-quantity-error"
                    message={fieldErrors.minimumCartQuantity}
                  />
                </div>

                <div style={fieldWrapperStyle}>
                  <label style={labelStyle}>
                    <span style={labelTextStyle}>Currency Code</span>
                    <select
                      defaultValue={defaultCurrency}
                      name="minimumCartSubtotalCurrencyCode"
                      style={selectStyle}
                    >
                      {availableCurrencies.map((code) => (
                        <option key={code} value={code}>
                          {code}
                        </option>
                      ))}
                    </select>
                  </label>
                  <FieldError
                    id="minimum-subtotal-currency-error"
                    message={fieldErrors.minimumSubtotalCurrency}
                  />
                </div>
              </div>

              <div style={formSectionStyle}>
                <h3 style={sectionHeadingStyle}>Market</h3>
                <p style={sectionDescriptionStyle}>
                  Limit the entire campaign to one market. Leave empty to apply to all markets.
                </p>
                <DiscountExplanation explanation={conditionExplanation("market")} />

                <div style={fieldWrapperStyle}>
                  <label style={labelStyle}>
                    <span style={labelTextStyle}>Market</span>
                    <select
                      disabled={!entitlements.marketTargeting}
                      name="marketHandle"
                      onChange={(event) =>
                        setFormState({
                          ...formState,
                          marketHandle: event.target.value,
                        })
                      }
                      style={selectStyle}
                      value={formState.marketHandle}
                    >
                      <option value="">All markets</option>
                      {markets.map((market) => (
                        <option key={market.id} value={market.handle}>
                          {market.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <input
                    name="marketName"
                    type="hidden"
                    value={
                      markets.find(
                        (market) => market.handle === formState.marketHandle,
                      )?.name ?? ""
                    }
                  />
                  <p style={helpTextStyle}>
                    {!entitlements.marketTargeting
                      ? "Market targeting is available on Pro and Enterprise."
                      : markets.length
                      ? "This market rule applies to product, order, and shipping discounts in this campaign."
                      : "No markets could be loaded. The app needs the read_markets scope and the shop must approve the updated permissions."}
                  </p>
                </div>
              </div>

              <div style={formSectionStyle}>
                <h3 style={sectionHeadingStyle}>Combines With</h3>
                <p style={sectionDescriptionStyle}>
                  Choose which other Shopify discounts can be combined with this campaign.
                </p>
                <DiscountExplanation
                  explanation={conditionExplanation("combinesWith")}
                />

                <div style={checkboxGroupStyle}>
                  <label style={checkboxLabelStyle}>
                    <input
                      name="combinesWithProductDiscounts"
                      defaultChecked
                      style={checkboxInputStyle}
                      type="checkbox"
                      value="true"
                    />
                    Product discounts
                  </label>
                  <label style={checkboxLabelStyle}>
                    <input
                      name="combinesWithOrderDiscounts"
                      style={checkboxInputStyle}
                      type="checkbox"
                      value="true"
                    />
                    Order discounts
                  </label>
                  <label style={checkboxLabelStyle}>
                    <input
                      name="combinesWithShippingDiscounts"
                      defaultChecked
                      style={checkboxInputStyle}
                      type="checkbox"
                      value="true"
                    />
                    Shipping discounts
                  </label>
                </div>
              </div>

              {/* Product Restrictions */}
              <div style={formSectionStyle}>
                <h3 style={sectionHeadingStyle}>Product Restrictions</h3>
                <p style={sectionDescriptionStyle}>
                  Search and select products. Leave empty to apply to all products.
                </p>
                <DiscountExplanation
                  explanation={conditionExplanation("products")}
                />

                {selectedProducts.map((product) => (
                  <input
                    key={product.id}
                    name="productIds"
                    type="hidden"
                    value={product.id}
                  />
                ))}
                {excludedProducts.map((product) => (
                  <input
                    key={product.id}
                    name="excludedProductIds"
                    type="hidden"
                    value={product.id}
                  />
                ))}

                <div style={fieldWrapperStyle}>
                  <label style={labelStyle}>
                    <span style={labelTextStyle}>Search products</span>
                    <input
                      onChange={(event) => setProductQuery(event.target.value)}
                      placeholder="Type at least 2 characters"
                      style={inputStyle}
                      type="search"
                      value={productQuery}
                    />
                  </label>
                  <p style={helpTextStyle}>
                    Results are limited to 20 products. Search by product name
                    instead of loading the full catalog.
                  </p>
                </div>

                {selectedProducts.length ? (
                  <div style={selectedItemsStyle}>
                    {selectedProducts.map((product) => (
                      <span key={product.id} style={selectedItemStyle}>
                        {product.title}
                        <button
                          aria-label={`Remove ${product.title}`}
                          onClick={() => handleProductRemove(product.id)}
                          style={selectedItemRemoveStyle}
                          type="button"
                        >
                          x
                        </button>
                      </span>
                    ))}
                  </div>
                ) : null}

                {excludedProducts.length ? (
                  <div style={selectedItemsStyle}>
                    {excludedProducts.map((product) => (
                      <span key={product.id} style={excludedItemStyle}>
                        {product.title}
                        <button
                          aria-label={`Remove ${product.title} from exclusions`}
                          onClick={() => handleProductUnexclude(product.id)}
                          style={excludedItemRemoveStyle}
                          type="button"
                        >
                          x
                        </button>
                      </span>
                    ))}
                  </div>
                ) : null}

                <div style={searchResultsStyle}>
                  {productQuery.trim().length < 2 ? (
                    <p style={helpTextStyle}>Enter a product search term.</p>
                  ) : isSearchingProducts ? (
                    <p style={helpTextStyle}>Searching products...</p>
                  ) : productResults.length ? (
                    productResults.map((product) => (
                      <button
                        disabled={formState.selectedProductIds.has(product.id)}
                        key={product.id}
                        onClick={() => handleProductSelect(product)}
                        style={searchResultButtonStyle}
                        type="button"
                      >
                        <span>{product.title}</span>
                        <span style={searchResultMetaStyle}>
                          {formState.selectedProductIds.has(product.id)
                            ? "Selected"
                            : "Add"}
                        </span>
                      </button>
                    ))
                  ) : (
                    <p style={helpTextStyle}>No products found.</p>
                  )}
                </div>

                {productResults.length ? (
                  <div style={searchResultsStyle}>
                    {productResults.map((product) => (
                      <button
                        disabled={formState.excludedProductIds.has(product.id)}
                        key={product.id}
                        onClick={() => handleProductExclude(product)}
                        style={searchResultButtonStyle}
                        type="button"
                      >
                        <span>{product.title}</span>
                        <span style={searchResultMetaStyle}>
                          {formState.excludedProductIds.has(product.id)
                            ? "Excluded"
                            : "Exclude"}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              {/* Collection Restrictions */}
              <div style={formSectionStyle}>
                <h3 style={sectionHeadingStyle}>Collection Restrictions</h3>
                <p style={sectionDescriptionStyle}>
                  Search and select collections. Leave empty to apply to all.
                </p>
                <DiscountExplanation
                  explanation={conditionExplanation("collections")}
                />

                {selectedCollections.map((collection) => (
                  <input
                    key={collection.id}
                    name="collectionIds"
                    type="hidden"
                    value={collection.id}
                  />
                ))}
                {excludedCollections.map((collection) => (
                  <input
                    key={collection.id}
                    name="excludedCollectionIds"
                    type="hidden"
                    value={collection.id}
                  />
                ))}

                <div style={fieldWrapperStyle}>
                  <label style={labelStyle}>
                    <span style={labelTextStyle}>Search collections</span>
                    <input
                      onChange={(event) =>
                        setCollectionQuery(event.target.value)
                      }
                      placeholder="Type at least 2 characters"
                      style={inputStyle}
                      type="search"
                      value={collectionQuery}
                    />
                  </label>
                  <p style={helpTextStyle}>
                    Results are limited to 20 collections.
                  </p>
                </div>

                {selectedCollections.length ? (
                  <div style={selectedItemsStyle}>
                    {selectedCollections.map((collection) => (
                      <span key={collection.id} style={selectedItemStyle}>
                        {collection.title}
                        <button
                          aria-label={`Remove ${collection.title}`}
                          onClick={() => handleCollectionRemove(collection.id)}
                          style={selectedItemRemoveStyle}
                          type="button"
                        >
                          x
                        </button>
                      </span>
                    ))}
                  </div>
                ) : null}

                {excludedCollections.length ? (
                  <div style={selectedItemsStyle}>
                    {excludedCollections.map((collection) => (
                      <span key={collection.id} style={excludedItemStyle}>
                        {collection.title}
                        <button
                          aria-label={`Remove ${collection.title} from exclusions`}
                          onClick={() => handleCollectionUnexclude(collection.id)}
                          style={excludedItemRemoveStyle}
                          type="button"
                        >
                          x
                        </button>
                      </span>
                    ))}
                  </div>
                ) : null}

                <div style={searchResultsStyle}>
                  {collectionQuery.trim().length < 2 ? (
                    <p style={helpTextStyle}>Enter a collection search term.</p>
                  ) : isSearchingCollections ? (
                    <p style={helpTextStyle}>Searching collections...</p>
                  ) : collectionResults.length ? (
                    collectionResults.map((collection) => (
                      <button
                        disabled={formState.selectedCollectionIds.has(
                          collection.id,
                        )}
                        key={collection.id}
                        onClick={() => handleCollectionSelect(collection)}
                        style={searchResultButtonStyle}
                        type="button"
                      >
                        <span>{collection.title}</span>
                        <span style={searchResultMetaStyle}>
                          {formState.selectedCollectionIds.has(collection.id)
                            ? "Selected"
                            : "Add"}
                        </span>
                      </button>
                    ))
                  ) : (
                    <p style={helpTextStyle}>No collections found.</p>
                  )}
                </div>

                {collectionResults.length ? (
                  <div style={searchResultsStyle}>
                    {collectionResults.map((collection) => (
                      <button
                        disabled={formState.excludedCollectionIds.has(
                          collection.id,
                        )}
                        key={collection.id}
                        onClick={() => handleCollectionExclude(collection)}
                        style={searchResultButtonStyle}
                        type="button"
                      >
                        <span>{collection.title}</span>
                        <span style={searchResultMetaStyle}>
                          {formState.excludedCollectionIds.has(collection.id)
                            ? "Excluded"
                            : "Exclude"}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>


          {/* Schedule Tab */}
          <div className={`${styles.tabContent} ${activeTab === "schedule" ? styles.active : ""}`}>
              <div className={styles.formSection}>
                <h3 className={styles.sectionHeading}>Discount Schedule</h3>
                <p className={styles.sectionDescription}>
                  Set start and end dates for your discount. Leave empty to run indefinitely.
                </p>

                <div style={fieldWrapperStyle}>
                  <label style={labelStyle}>
                    <span style={labelTextStyle}>Start Date</span>
                    <input
                      aria-invalid={Boolean(fieldErrors.startsAt)}
                      aria-describedby={
                        fieldErrors.startsAt ? "starts-at-error" : undefined
                      }
                      name="startsAt"
                      disabled={!entitlements.scheduling}
                      style={inputStyle}
                      type="date"
                    />
                  </label>
                  <p style={helpTextStyle}>
                    {entitlements.scheduling
                      ? "When should this discount go live?"
                      : "Scheduling is available on Pro and Enterprise."}
                  </p>
                  <FieldError
                    id="starts-at-error"
                    message={fieldErrors.startsAt}
                  />
                </div>

                <div style={fieldWrapperStyle}>
                  <label style={labelStyle}>
                    <span style={labelTextStyle}>End Date</span>
                    <input
                      aria-invalid={Boolean(fieldErrors.endsAt)}
                      aria-describedby={
                        fieldErrors.endsAt ? "ends-at-error" : undefined
                      }
                      name="endsAt"
                      disabled={!entitlements.scheduling}
                      style={inputStyle}
                      type="date"
                    />
                  </label>
                  <p style={helpTextStyle}>
                    {entitlements.scheduling
                      ? "When should this discount end?"
                      : "Scheduling is available on Pro and Enterprise."}
                  </p>
                  <FieldError id="ends-at-error" message={fieldErrors.endsAt} />
                </div>
              </div>
            </div>


          {/* Action Buttons */}
          <div style={summaryBoxStyle}>
            <h3 style={summaryHeadingStyle}>Campaign Summary</h3>
            <ul style={summaryListStyle}>
              {campaignSummary.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>

          <div className={styles.actions}>
            <button
              disabled={isSaving}
              className={styles.submitButton}
              type="submit"
            >
              {isSaving ? "Saving..." : "Save discount"}
            </button>
          </div>
        </Form>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

const tabLabels: Record<"basic" | "discounts" | "conditions" | "schedule", string> = {
  basic: "Basic",
  discounts: "Discounts",
  conditions: "Conditions",
  schedule: "Schedule",
};

function campaignInputFromForm(formData: FormData): CampaignFormInput {
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
    productDiscountFixedCurrencyCode:
      optionalString(formData.get("productDiscountFixedCurrencyCode"))?.toUpperCase(),
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
    orderDiscountMaximumCurrencyCode:
      optionalString(formData.get("orderDiscountMaximumCurrencyCode"))?.toUpperCase(),
    orderDiscountFixedAmount: optionalString(
      formData.get("orderDiscountFixedAmount"),
    ),
    orderDiscountFixedCurrencyCode:
      optionalString(formData.get("orderDiscountFixedCurrencyCode"))?.toUpperCase(),
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
    shippingDiscountFixedCurrencyCode:
      optionalString(formData.get("shippingDiscountFixedCurrencyCode"))?.toUpperCase(),
    shippingDeliveryOptionHandle: optionalString(
      formData.get("shippingDeliveryOptionHandle"),
    ),
    shippingDeliveryOptionTitle: optionalString(
      formData.get("shippingDeliveryOptionTitle"),
    ),
    marketHandle: optionalString(formData.get("marketHandle")),
    marketName: optionalString(formData.get("marketName")),
    combinesWithOrderDiscounts: formData.get("combinesWithOrderDiscounts") === "true",
    combinesWithProductDiscounts:
      formData.get("combinesWithProductDiscounts") === "true",
    combinesWithShippingDiscounts:
      formData.get("combinesWithShippingDiscounts") === "true",
    minimumCartSubtotalAmount: optionalString(
      formData.get("minimumCartSubtotalAmount"),
    ),
    minimumCartSubtotalCurrencyCode:
      optionalString(formData.get("minimumCartSubtotalCurrencyCode"))?.toUpperCase(),
    minimumCartQuantity: optionalNumber(formData.get("minimumCartQuantity")),
    startsAt: optionalString(formData.get("startsAt")),
    endsAt: optionalString(formData.get("endsAt")),
  };
}

function validateCampaignInput(input: CampaignFormInput) {
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
    validateWholeNumber(
      input.productDiscountBuyQuantity,
      "Buy quantity",
      errors,
    );
    validateWholeNumber(
      input.productDiscountFreeQuantity,
      "Free quantity",
      errors,
    );
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
  tiers:
    | Array<{
        minimumQuantity: number;
        percentage: number;
      }>
    | undefined,
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

type CampaignFormTab = "basic" | "discounts" | "conditions" | "schedule";

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

  const groupedErrors = (Object.keys(tabLabels) as CampaignFormTab[])
    .map((tab) => ({
      tab,
      errors: errors.filter((error) => error.tab === tab),
    }))
    .filter((group) => group.errors.length);

  return (
    <div className={styles.errorSummary} role="alert" aria-live="polite">
      <div className={styles.errorSummaryHeader}>
        <span className={styles.errorIcon}>!</span>
        <div>
          <h2 className={styles.errorSummaryTitle}>
            {errors.length === 1
              ? "One issue needs attention"
              : `${errors.length} issues need attention`}
          </h2>
          <p className={styles.errorSummaryText}>
            Review the tabs below. Selecting an issue opens the tab where it can
            be fixed.
          </p>
        </div>
        <button
          aria-label="Close error summary"
          className={styles.errorSummaryClose}
          onClick={onDismiss}
          type="button"
        >
          x
        </button>
      </div>
      <div className={styles.errorSummaryGroups}>
        {groupedErrors.map((group) => (
          <div key={group.tab} className={styles.errorSummaryGroup}>
            <button
              className={styles.errorSummaryTabButton}
              onClick={() => onSelectTab(group.tab)}
              type="button"
            >
              {tabLabels[group.tab]}
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

function lockedFeatureLabel(isAvailable: boolean) {
  return isAvailable ? "" : " (Pro)";
}

function FieldError({
  id,
  message,
}: {
  id: string;
  message: string | undefined;
}) {
  if (!message) {
    return null;
  }

  return (
    <p id={id} style={fieldErrorStyle}>
      {message}
    </p>
  );
}

type DiscountExplanationContent = {
  title: string;
  points: string[];
};

function DiscountExplanation({
  explanation,
}: {
  explanation: DiscountExplanationContent | null;
}) {
  if (!explanation) {
    return null;
  }

  return (
    <div style={explanationBoxStyle}>
      <strong style={explanationTitleStyle}>{explanation.title}</strong>
      <ul style={explanationListStyle}>
        {explanation.points.map((point) => (
          <li key={point}>{point}</li>
        ))}
      </ul>
    </div>
  );
}

function productDiscountExplanation(
  type: ProductDiscountType | string,
): DiscountExplanationContent | null {
  if (type === "percentage") {
    return {
      title: "Percentage off eligible products",
      points: [
        "Applies the same percentage to every eligible cart line.",
        "Product, collection, market, schedule, minimum subtotal, and minimum quantity conditions can limit when it applies.",
      ],
    };
  }

  if (type === "fixed_amount") {
    return {
      title: "Fixed amount off eligible products",
      points: [
        "Splits the fixed discount amount across eligible products.",
        "The discount will not exceed the eligible product subtotal.",
      ],
    };
  }

  if (type === "buy_one_get_one_free") {
    return {
      title: "Buy X, get Y cheapest free",
      points: [
        "Counts all eligible product units in the cart.",
        "For each complete buy/free set, the cheapest eligible units receive 100% off.",
      ],
    };
  }

  if (type === "volume_tier") {
    return {
      title: "Volume tiers by quantity",
      points: [
        "Counts total eligible product quantity.",
        "Applies the highest tier whose minimum quantity is reached to all eligible products.",
      ],
    };
  }

  return null;
}

function orderDiscountExplanation(
  type: OrderDiscountType | string,
): DiscountExplanationContent | null {
  if (type === "percentage") {
    return {
      title: "Percentage off order subtotal",
      points: [
        "Applies to the eligible order subtotal after product/collection exclusions.",
        "The optional maximum amount caps the discount by converting it to a lower effective percentage when needed.",
      ],
    };
  }

  if (type === "fixed_amount") {
    return {
      title: "Fixed amount off order subtotal",
      points: [
        "Applies one fixed amount to the eligible order subtotal.",
        "Products excluded by conditions are excluded from the order subtotal target.",
      ],
    };
  }

  return null;
}

function shippingDiscountExplanation(
  type: ShippingDiscountType | string,
): DiscountExplanationContent | null {
  if (type === "free_shipping") {
    return {
      title: "Free shipping",
      points: [
        "Applies a 100% discount to matching shipping rates.",
        "Can be limited by shipping method, market, schedule, minimum subtotal, and minimum quantity.",
      ],
    };
  }

  if (type === "percentage") {
    return {
      title: "Percentage off shipping",
      points: [
        "Applies the percentage to matching shipping rates.",
        "Shipping method and campaign conditions decide which rates are eligible.",
      ],
    };
  }

  if (type === "fixed_amount") {
    return {
      title: "Fixed amount off shipping",
      points: [
        "Applies one fixed amount to matching shipping rates.",
        "The discount follows the configured currency and matching shipping method.",
      ],
    };
  }

  return null;
}

function conditionExplanation(
  type:
    | "minimums"
    | "market"
    | "combinesWith"
    | "products"
    | "collections",
): DiscountExplanationContent {
  if (type === "minimums") {
    return {
      title: "Minimum requirements",
      points: [
        "Minimum subtotal checks the full cart subtotal before this campaign can apply.",
        "Minimum quantity checks the total item quantity in the cart.",
        "Leave a field empty when that requirement should not be used.",
      ],
    };
  }

  if (type === "market") {
    return {
      title: "Market targeting",
      points: [
        "Limits the whole campaign to one Shopify market.",
        "Applies to product, order, and shipping discounts in this campaign.",
        "Leave empty to allow all markets.",
      ],
    };
  }

  if (type === "combinesWith") {
    return {
      title: "Discount stacking",
      points: [
        "Controls whether Shopify may combine this campaign with other discounts.",
        "These settings affect compatibility with other product, order, and shipping discounts.",
      ],
    };
  }

  if (type === "products") {
    return {
      title: "Product include and exclude rules",
      points: [
        "Included products limit the campaign to only those products.",
        "Excluded products are never discounted, even if they are also included by another rule.",
        "Leave included products empty to allow all products except excluded ones.",
      ],
    };
  }

  return {
    title: "Collection include and exclude rules",
    points: [
      "Included collections limit the campaign to products in those collections.",
      "Excluded collections are never discounted and override included collections.",
      "Collection rules work together with product rules.",
    ],
  };
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
  productDiscountType: string;
  orderDiscountType: string;
  shippingDiscountType: string;
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

  items.push(
    marketName
      ? `Only applies in ${marketName}.`
      : "Applies in all markets.",
  );

  if (includedProductCount || includedCollectionCount) {
    items.push(
      `Limited to ${restrictionCountLabel(
        includedProductCount,
        "product",
      )}${includedProductCount && includedCollectionCount ? " and " : ""}${restrictionCountLabel(
        includedCollectionCount,
        "collection",
      )}.`,
    );
  } else {
    items.push("Eligible for all products unless exclusions are selected.");
  }

  if (excludedProductCount || excludedCollectionCount) {
    items.push(
      `Excludes ${restrictionCountLabel(
        excludedProductCount,
        "product",
      )}${excludedProductCount && excludedCollectionCount ? " and " : ""}${restrictionCountLabel(
        excludedCollectionCount,
        "collection",
      )}.`,
    );
  }

  return items;
}

function productDiscountSummary(type: string) {
  if (type === "percentage") return "Product discount: percentage off eligible products.";
  if (type === "fixed_amount") return "Product discount: fixed amount off eligible products.";
  if (type === "buy_one_get_one_free") return "Product discount: Buy X, get Y cheapest free.";
  if (type === "volume_tier") return "Product discount: volume tiers by eligible quantity.";
  return "";
}

function orderDiscountSummary(type: string) {
  if (type === "percentage") return "Order discount: percentage off eligible order subtotal.";
  if (type === "fixed_amount") return "Order discount: fixed amount off eligible order subtotal.";
  return "";
}

function shippingDiscountSummary(type: string) {
  if (type === "free_shipping") return "Shipping discount: free shipping.";
  if (type === "percentage") return "Shipping discount: percentage off matching shipping rates.";
  if (type === "fixed_amount") return "Shipping discount: fixed amount off matching shipping rates.";
  return "";
}

function restrictionCountLabel(count: number, label: string) {
  if (!count) return "";
  return `${count} ${label}${count === 1 ? "" : "s"}`;
}

function fieldErrorsFromMessages(errors: string[]) {
  const fieldErrors: Partial<Record<FieldErrorKey, string>> = {};

  for (const error of errors) {
    const lowerError = error.toLowerCase();

    if (lowerError.includes("campaign name")) {
      fieldErrors.name = error;
    } else if (lowerError.includes("choose at least one")) {
      fieldErrors.discountType = error;
    } else if (lowerError.includes("product discount percentage")) {
      fieldErrors.productPercentage = error;
    } else if (lowerError.includes("product fixed discount amount")) {
      fieldErrors.productFixedAmount = error;
    } else if (lowerError.includes("product fixed discount currency")) {
      fieldErrors.productFixedCurrency = error;
    } else if (lowerError.includes("buy quantity")) {
      fieldErrors.productBuyQuantity = error;
    } else if (lowerError.includes("free quantity")) {
      fieldErrors.productFreeQuantity = error;
    } else if (lowerError.includes("volume")) {
      fieldErrors.productVolumeTiers = error;
    } else if (lowerError.includes("order discount percentage")) {
      fieldErrors.orderPercentage = error;
    } else if (lowerError.includes("order maximum discount amount")) {
      fieldErrors.orderMaximumAmount = error;
    } else if (lowerError.includes("order maximum discount currency")) {
      fieldErrors.orderMaximumCurrency = error;
    } else if (lowerError.includes("order fixed discount amount")) {
      fieldErrors.orderFixedAmount = error;
    } else if (lowerError.includes("order fixed discount currency")) {
      fieldErrors.orderFixedCurrency = error;
    } else if (lowerError.includes("shipping discount percentage")) {
      fieldErrors.shippingPercentage = error;
    } else if (lowerError.includes("shipping fixed discount amount")) {
      fieldErrors.shippingFixedAmount = error;
    } else if (lowerError.includes("shipping fixed discount currency")) {
      fieldErrors.shippingFixedCurrency = error;
    } else if (lowerError.includes("minimum cart subtotal amount")) {
      fieldErrors.minimumSubtotalAmount = error;
    } else if (lowerError.includes("minimum cart subtotal currency")) {
      fieldErrors.minimumSubtotalCurrency = error;
    } else if (lowerError.includes("minimum cart quantity")) {
      fieldErrors.minimumCartQuantity = error;
    } else if (lowerError.includes("start date")) {
      fieldErrors.startsAt = error;
    } else if (lowerError.includes("end date")) {
      fieldErrors.endsAt = error;
    }
  }

  return fieldErrors;
}

function errorSummaryItems(errors: string[]): ErrorSummaryItem[] {
  return errors.map((message) => ({
    message,
    tab: tabForError(message),
  }));
}

function tabForError(error: string): CampaignFormTab {
  const lowerError = error.toLowerCase();

  if (lowerError.includes("campaign name")) {
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

// Styles
const tabNavStyle = {
  display: "flex",
  borderBottom: "2px solid #eef0f2",
  gap: "0",
  marginBottom: "2rem",
  alignItems: "stretch",
} as const;

const tabButtonStyle = {
  background: "transparent",
  border: "none",
  borderBottomWidth: "2px",
  borderBottomStyle: "solid",
  borderBottomColor: "transparent",
  cursor: "pointer",
  font: "inherit",
  fontWeight: 500,
  fontSize: "0.875rem",
  padding: "0.75rem 1rem",
  marginBottom: "-2px",
  transition: "all 0.2s ease",
  color: "#5f6368",
} as const;

const activeTabStyle = {
  ...tabButtonStyle,
  borderBottomColor: "#303030",
  color: "#303030",
} as const;

const inactiveTabStyle = {
  ...tabButtonStyle,
} as const;

const tabContentStyle = {
  paddingBottom: "2rem",
} as const;

const formSectionStyle = {
  marginBottom: "2rem",
  padding: "0.15rem 0 2rem 1.1rem",
  borderBottom: "1px solid #e3e3e3",
  borderLeft: "3px solid #e3e3e3",
} as const;

const sectionHeadingStyle = {
  fontSize: "1.05rem",
  fontWeight: 600,
  color: "#303030",
  margin: "0 0 0.5rem 0",
} as const;

const sectionDescriptionStyle = {
  fontSize: "0.875rem",
  color: "#616161",
  margin: "0 0 1.5rem 0",
  maxWidth: "48rem",
} as const;

const fieldWrapperStyle = {
  marginBottom: "1.5rem",
} as const;

const fieldGroupStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
  gap: "1.1rem",
  marginBottom: "1.25rem",
} as const;

const labelStyle = {
  display: "grid",
  gap: "0.5rem",
} as const;

const labelTextStyle = {
  fontWeight: 600,
  fontSize: "0.875rem",
  color: "#303030",
} as const;

const inputStyle = {
  background: "#fff",
  border: "1px solid #a8b4ad",
  borderRadius: "0.375rem",
  boxSizing: "border-box",
  font: "inherit",
  padding: "0.75rem",
  fontSize: "0.875rem",
  transition: "border-color 0.2s ease, box-shadow 0.2s ease, background-color 0.2s ease",
  width: "100%",
} as const;

const selectStyle = {
  ...inputStyle,
  appearance: "none",
  backgroundColor: "#fff",
  backgroundImage:
    "linear-gradient(45deg, transparent 50%, #303030 50%), linear-gradient(135deg, #303030 50%, transparent 50%), linear-gradient(180deg, #f7f7f7 0%, #eeeeee 100%)",
  backgroundPosition:
    "calc(100% - 1.05rem) 50%, calc(100% - 0.75rem) 50%, 100% 0",
  backgroundRepeat: "no-repeat",
  backgroundSize: "0.32rem 0.32rem, 0.32rem 0.32rem, 2.5rem 100%",
  borderColor: "#93a49b",
  color: "#303030",
  cursor: "pointer",
  fontWeight: 500,
  paddingRight: "3rem",
} as const;

const helpTextStyle = {
  fontSize: "0.75rem",
  color: "#616161",
  margin: "0.25rem 0 0 0",
} as const;

const fieldErrorStyle = {
  color: "#d72c0d",
  fontSize: "0.75rem",
  fontWeight: 600,
  margin: "0.35rem 0 0 0",
} as const;

const explanationBoxStyle = {
  background: "#f7f7f7",
  border: "1px solid #e3e3e3",
  borderLeft: "3px solid #c9c9c9",
  borderRadius: "0.375rem",
  color: "#303030",
  marginTop: "0.75rem",
  padding: "0.85rem 0.9rem",
} as const;

const explanationTitleStyle = {
  display: "block",
  fontSize: "0.85rem",
  marginBottom: "0.35rem",
} as const;

const explanationListStyle = {
  display: "grid",
  gap: "0.25rem",
  fontSize: "0.8rem",
  lineHeight: 1.4,
  margin: 0,
  paddingLeft: "1rem",
} as const;

const summaryBoxStyle = {
  background: "#f7f7f7",
  border: "1px solid #e3e3e3",
  borderLeft: "3px solid #c9c9c9",
  borderRadius: "0.5rem",
  marginTop: "2rem",
  padding: "1rem 1.1rem",
} as const;

const summaryHeadingStyle = {
  color: "#303030",
  fontSize: "1rem",
  fontWeight: 700,
  margin: "0 0 0.75rem 0",
} as const;

const summaryListStyle = {
  color: "#334155",
  display: "grid",
  fontSize: "0.875rem",
  gap: "0.4rem",
  lineHeight: 1.45,
  margin: 0,
  paddingLeft: "1.25rem",
} as const;

const checkboxGroupStyle = {
  display: "grid",
  gap: "0.6rem",
  background: "#ffffff",
  border: "1px solid #e3e3e3",
  borderRadius: "0.375rem",
  padding: "0.75rem",
} as const;

const checkboxLabelStyle = {
  display: "flex",
  alignItems: "center",
  gap: "0.75rem",
  padding: "0.65rem 0.75rem",
  borderRadius: "0.375rem",
  cursor: "pointer",
  transition: "background-color 0.2s ease",
  fontSize: "0.875rem",
  color: "#303030",
} as const;

const checkboxInputStyle = {
  cursor: "pointer",
  width: "1rem",
  height: "1rem",
} as const;

const selectedItemsStyle = {
  display: "flex",
  flexWrap: "wrap",
  gap: "0.5rem",
  margin: "0 0 1rem 0",
} as const;

const selectedItemStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: "0.5rem",
  background: "#f7f7f7",
  color: "#303030",
  border: "1px solid #c9c9c9",
  borderRadius: "0.375rem",
  padding: "0.45rem 0.55rem",
  fontSize: "0.875rem",
  fontWeight: 700,
} as const;

const selectedItemRemoveStyle = {
  alignItems: "center",
  background: "#ffffff",
  border: "1px solid #c9c9c9",
  borderRadius: "999px",
  color: "#303030",
  cursor: "pointer",
  display: "inline-flex",
  font: "inherit",
  fontWeight: 700,
  height: "1.25rem",
  justifyContent: "center",
  lineHeight: 1,
  padding: 0,
  width: "1.25rem",
} as const;

const excludedItemStyle = {
  ...selectedItemStyle,
  background: "linear-gradient(180deg, #fff4e5 0%, #ffe9bd 100%)",
  border: "1px solid #e6ad3b",
  borderLeft: "4px solid #b7791f",
  boxShadow: "0 2px 6px rgba(183, 121, 31, 0.1)",
  color: "#663c00",
} as const;

const excludedItemRemoveStyle = {
  ...selectedItemRemoveStyle,
  background: "rgba(183, 121, 31, 0.12)",
  border: "1px solid rgba(183, 121, 31, 0.22)",
  color: "#663c00",
} as const;

const searchResultsStyle = {
  display: "grid",
  gap: "0.5rem",
  background: "#ffffff",
  border: "1px solid #e3e3e3",
  borderRadius: "0.375rem",
  padding: "0.75rem",
  minHeight: "3rem",
} as const;

const searchResultButtonStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "1rem",
  width: "100%",
  border: "1px solid #e3e3e3",
  borderRadius: "0.375rem",
  background: "#fff",
  cursor: "pointer",
  font: "inherit",
  padding: "0.625rem 0.75rem",
  textAlign: "left",
  transition: "border-color 0.2s ease, box-shadow 0.2s ease, transform 0.2s ease",
} as const;

const searchResultMetaStyle = {
  background: "#f7f7f7",
  border: "1px solid #e3e3e3",
  borderRadius: "999px",
  color: "#303030",
  fontSize: "0.8125rem",
  fontWeight: 600,
  padding: "0.15rem 0.45rem",
  whiteSpace: "nowrap",
} as const;

const actionsStyle = {
  display: "flex",
  gap: "0.75rem",
  marginTop: "2rem",
  borderTop: "1px solid #e3e3e3",
  paddingTop: "1.5rem",
  flexWrap: "wrap",
} as const;

const primaryActionStyle = {
  background: "#303030",
  border: "1px solid #303030",
  borderRadius: "0.5rem",
  boxShadow: "0 10px 20px rgba(26, 26, 26, 0.14)",
  color: "#fff",
  cursor: "pointer",
  font: "inherit",
  fontWeight: 600,
  padding: "0.625rem 0.875rem",
  fontSize: "0.875rem",
} as const;

const errorBoxStyle = {
  background: "#fff4f4",
  border: "1px solid #fed3d1",
  borderRadius: "0.375rem",
  marginBottom: "1rem",
  padding: "1rem",
  display: "flex",
  gap: "0.75rem",
} as const;

const errorIconStyle = {
  fontSize: "1.25rem",
  flexShrink: 0,
} as const;

const errorTextStyle = {
  color: "#d72c0d",
  margin: "0.25rem 0",
  fontSize: "0.875rem",
} as const;
