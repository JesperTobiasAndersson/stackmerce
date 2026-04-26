import {
  CAMPAIGN_CONFIG_METAFIELD_KEY,
  CAMPAIGN_CONFIG_METAFIELD_NAMESPACE,
  CAMPAIGN_CONFIG_VERSION,
  INPUT_VARIABLES_METAFIELD_KEY,
  INPUT_VARIABLES_METAFIELD_NAMESPACE,
  type CampaignConfig,
} from "./campaign-config";
import { withRuntimeCache } from "./runtime-cache.server";

interface ShopifyAdminClient {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
}

interface PageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

interface GraphQLError {
  message: string;
}

interface GraphQLResponse<TData> {
  data?: TData;
  errors?: GraphQLError[];
}

interface DiscountMetafield {
  jsonValue: unknown;
}

interface DiscountAutomaticAppNode {
  title: string;
  status: string;
  appDiscountType: {
    functionId: string;
  };
  metafield: DiscountMetafield | null;
}

interface DiscountNode {
  id: string;
  metafield: DiscountMetafield | null;
  discount: {
    __typename: string;
  } & Partial<DiscountAutomaticAppNode>;
}

export interface ShopifyProductSummary {
  id: string;
  title: string;
  handle: string;
  status: string;
}

export interface ShopifyCollectionSummary {
  id: string;
  title: string;
  handle: string;
}

export interface ShopifyShippingMethodSummary {
  id: string;
  name: string;
  handle: string;
  zoneName: string;
  profileName: string;
  active: boolean;
}

export interface ShopifyMarketSummary {
  id: string;
  name: string;
  handle: string;
}

export interface ShopifyConnectionResult<TNode> {
  nodes: TNode[];
  pageInfo: PageInfo;
}

export interface ShopifyCampaignSummary {
  id: string;
  name: string;
  status: string;
  discountType: string;
  functionId: string;
}

export interface ShopifyCampaignDetail extends ShopifyCampaignSummary {
  config: CampaignConfig;
}

export interface CreateCampaignInput {
  name: string;
  status: "active" | "inactive";
  productDiscountType:
    | "none"
    | "percentage"
    | "fixed_amount"
    | "buy_one_get_one_free"
    | "volume_tier";
  productDiscountPercentage?: number;
  productDiscountFixedAmount?: string;
  productDiscountFixedCurrencyCode?: string;
  productDiscountBuyQuantity?: number;
  productDiscountFreeQuantity?: number;
  productDiscountVolumeTiers?: Array<{
    minimumQuantity: number;
    percentage: number;
  }>;
  orderDiscountType: "none" | "percentage" | "fixed_amount";
  orderDiscountPercentage?: number;
  orderDiscountMaximumAmount?: string;
  orderDiscountMaximumCurrencyCode?: string;
  orderDiscountFixedAmount?: string;
  orderDiscountFixedCurrencyCode?: string;
  productIds?: string[];
  collectionIds?: string[];
  excludedProductIds?: string[];
  excludedCollectionIds?: string[];
  shippingDiscountType: "none" | "free_shipping" | "percentage" | "fixed_amount";
  shippingDiscountPercentage?: number;
  shippingDiscountFixedAmount?: string;
  shippingDiscountFixedCurrencyCode?: string;
  shippingDeliveryOptionHandle?: string;
  shippingDeliveryOptionTitle?: string;
  marketHandle?: string;
  marketName?: string;
  combinesWithOrderDiscounts?: boolean;
  combinesWithProductDiscounts?: boolean;
  combinesWithShippingDiscounts?: boolean;
  minimumCartSubtotalAmount?: string;
  minimumCartSubtotalCurrencyCode?: string;
  minimumCartQuantity?: number;
  startsAt?: string;
  endsAt?: string;
}

export interface ShopifyCurrencyInfo {
  defaultCurrency: string;
  availableCurrencies: string[];
}

export interface ListShopifyResourcesOptions {
  first?: number;
  after?: string | null;
  query?: string;
}

const DEFAULT_PAGE_SIZE = 25;
const CURRENCY_CACHE_TTL_MS = 10 * 60_000;
const SHIPPING_METHODS_CACHE_TTL_MS = 10 * 60_000;
const MARKETS_CACHE_TTL_MS = 10 * 60_000;

const PRODUCTS_QUERY = `#graphql
  query Products($first: Int!, $after: String, $query: String) {
    products(first: $first, after: $after, query: $query) {
      nodes {
        id
        title
        handle
        status
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const COLLECTIONS_QUERY = `#graphql
  query Collections($first: Int!, $after: String, $query: String) {
    collections(first: $first, after: $after, query: $query) {
      nodes {
        id
        title
        handle
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const PRODUCTS_BY_IDS_QUERY = `#graphql
  query ProductsByIds($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        id
        title
        handle
        status
      }
    }
  }
`;

const COLLECTIONS_BY_IDS_QUERY = `#graphql
  query CollectionsByIds($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Collection {
        id
        title
        handle
      }
    }
  }
`;

const SHIPPING_METHODS_QUERY = `#graphql
  query ShippingMethods($first: Int!, $zonesFirst: Int!, $methodsFirst: Int!) {
    deliveryProfiles(first: $first, merchantOwnedOnly: true) {
      nodes {
        id
        name
        profileLocationGroups {
          locationGroupZones(first: $zonesFirst) {
            nodes {
              zone {
                name
              }
              methodDefinitions(first: $methodsFirst) {
                nodes {
                  id
                  active
                  name
                }
              }
            }
          }
        }
      }
    }
  }
`;

const MARKETS_QUERY = `#graphql
  query Markets($first: Int!) {
    markets(first: $first) {
      nodes {
        id
        name
        handle
      }
    }
  }
`;

const DISCOUNT_CAMPAIGNS_QUERY = `#graphql
  query DiscountCampaigns($first: Int!, $after: String, $query: String) {
    discountNodes(first: $first, after: $after, query: $query) {
      nodes {
        id
        metafield(
          namespace: "$app:discount-campaign"
          key: "campaign_config"
        ) {
          jsonValue
        }
        discount {
          __typename
          ... on DiscountAutomaticApp {
            title
            status
            appDiscountType {
              functionId
            }
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const DISCOUNT_CAMPAIGN_QUERY = `#graphql
  query DiscountCampaign($id: ID!) {
    discountNode(id: $id) {
      id
      metafield(
        namespace: "$app:discount-campaign"
        key: "campaign_config"
      ) {
        jsonValue
      }
      discount {
        __typename
        ... on DiscountAutomaticApp {
          title
          status
          appDiscountType {
            functionId
          }
        }
      }
    }
  }
`;

const CREATE_AUTOMATIC_APP_DISCOUNT_MUTATION = `#graphql
  mutation CreateAutomaticAppDiscount(
    $automaticAppDiscount: DiscountAutomaticAppInput!
  ) {
    discountAutomaticAppCreate(automaticAppDiscount: $automaticAppDiscount) {
      automaticAppDiscount {
        discountId
        title
        status
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const UPDATE_AUTOMATIC_APP_DISCOUNT_MUTATION = `#graphql
  mutation UpdateAutomaticAppDiscount(
    $id: ID!
    $automaticAppDiscount: DiscountAutomaticAppInput!
  ) {
    discountAutomaticAppUpdate(
      id: $id
      automaticAppDiscount: $automaticAppDiscount
    ) {
      automaticAppDiscount {
        title
        status
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const DELETE_AUTOMATIC_DISCOUNT_MUTATION = `#graphql
  mutation DeleteAutomaticDiscount($id: ID!) {
    discountAutomaticDelete(id: $id) {
      deletedAutomaticDiscountId
      userErrors {
        field
        message
      }
    }
  }
`;

const SHOP_CURRENCY_QUERY = `#graphql
  query ShopCurrency {
    shop {
      currencyCode
    }
  }
`;

const SHOP_CURRENCY_INFO_QUERY = `#graphql
  query ShopCurrencyInfo {
    shop {
      currencyCode
      enabledPresentmentCurrencies
    }
  }
`;

export async function listProducts(
  admin: ShopifyAdminClient,
  options: ListShopifyResourcesOptions = {},
): Promise<ShopifyConnectionResult<ShopifyProductSummary>> {
  const data = await shopifyGraphql<{
    products: ShopifyConnectionResult<ShopifyProductSummary>;
  }>(admin, PRODUCTS_QUERY, connectionVariables(options));

  return data.products;
}

export async function listCollections(
  admin: ShopifyAdminClient,
  options: ListShopifyResourcesOptions = {},
): Promise<ShopifyConnectionResult<ShopifyCollectionSummary>> {
  const data = await shopifyGraphql<{
    collections: ShopifyConnectionResult<ShopifyCollectionSummary>;
  }>(admin, COLLECTIONS_QUERY, connectionVariables(options));

  return data.collections;
}

export async function getProductsByIds(
  admin: ShopifyAdminClient,
  ids: string[],
): Promise<ShopifyProductSummary[]> {
  if (!ids.length) {
    return [];
  }

  const data = await shopifyGraphql<{
    nodes: Array<ShopifyProductSummary | null>;
  }>(admin, PRODUCTS_BY_IDS_QUERY, {ids});

  return data.nodes.filter(Boolean) as ShopifyProductSummary[];
}

export async function getCollectionsByIds(
  admin: ShopifyAdminClient,
  ids: string[],
): Promise<ShopifyCollectionSummary[]> {
  if (!ids.length) {
    return [];
  }

  const data = await shopifyGraphql<{
    nodes: Array<ShopifyCollectionSummary | null>;
  }>(admin, COLLECTIONS_BY_IDS_QUERY, {ids});

  return data.nodes.filter(Boolean) as ShopifyCollectionSummary[];
}

export async function listShippingMethods(
  admin: ShopifyAdminClient,
  shop: string | null = null,
): Promise<ShopifyShippingMethodSummary[]> {
  try {
    return await withRuntimeCache(
      shop ? `shipping-methods:${shop}` : null,
      SHIPPING_METHODS_CACHE_TTL_MS,
      async () => {
        const data = await shopifyGraphql<{
          deliveryProfiles: {
            nodes: Array<{
              id: string;
              name: string;
              profileLocationGroups: Array<{
                locationGroupZones: {
                  nodes: Array<{
                    zone: {name: string} | null;
                    methodDefinitions: {
                      nodes: Array<{
                        id: string;
                        active: boolean;
                        name: string;
                      }>;
                    };
                  }>;
                };
              }>;
            }>;
          };
        }>(admin, SHIPPING_METHODS_QUERY, {
          first: 20,
          zonesFirst: 50,
          methodsFirst: 50,
        });

        const methods = data.deliveryProfiles.nodes.flatMap((profile) =>
          profile.profileLocationGroups.flatMap((locationGroup) =>
            locationGroup.locationGroupZones.nodes.flatMap((zone) =>
              zone.methodDefinitions.nodes.map((method) => ({
                id: method.id,
                name: method.name,
                handle: deliveryOptionHandle(method.name),
                zoneName: zone.zone?.name ?? "Shipping zone",
                profileName: profile.name,
                active: method.active,
              })),
            ),
          ),
        );
        const uniqueMethods = new Map<string, ShopifyShippingMethodSummary>();

        for (const method of methods) {
          if (!method.active || uniqueMethods.has(method.handle)) {
            continue;
          }

          uniqueMethods.set(method.handle, method);
        }

        return Array.from(uniqueMethods.values()).sort((a, b) =>
          a.name.localeCompare(b.name),
        );
      },
    );
  } catch {
    return [];
  }
}

export async function listMarkets(
  admin: ShopifyAdminClient,
  shop: string | null = null,
): Promise<ShopifyMarketSummary[]> {
  try {
    return await withRuntimeCache(
      shop ? `markets:${shop}` : null,
      MARKETS_CACHE_TTL_MS,
      async () => {
        const data = await shopifyGraphql<{
          markets: {
            nodes: ShopifyMarketSummary[];
          };
        }>(admin, MARKETS_QUERY, {first: 50});

        return data.markets.nodes
          .filter((market) => market.handle)
          .sort((a, b) => a.name.localeCompare(b.name));
      },
    );
  } catch {
    return [];
  }
}

export async function getCurrencyInfo(
  admin: ShopifyAdminClient,
  shop: string | null = null,
): Promise<ShopifyCurrencyInfo> {
  try {
    return await withRuntimeCache(
      shop ? `currency-info:${shop}` : null,
      CURRENCY_CACHE_TTL_MS,
      async () => {
        const data = await shopifyGraphql<{
          shop: {
            currencyCode: string;
            enabledPresentmentCurrencies: string[];
          };
        }>(admin, SHOP_CURRENCY_INFO_QUERY, {});
        const defaultCurrency = data.shop.currencyCode;
        const presentmentCurrencies = data.shop.enabledPresentmentCurrencies ?? [];
        const availableCurrencies = fallbackCurrencies(
          Array.from(new Set([defaultCurrency, ...presentmentCurrencies])),
          defaultCurrency,
        );

        return {
          defaultCurrency,
          availableCurrencies,
        };
      },
    );
  } catch {
    try {
      const data = await shopifyGraphql<{ shop: { currencyCode: string } }>(
        admin,
        SHOP_CURRENCY_QUERY,
        {},
      );

      return {
        defaultCurrency: data.shop.currencyCode,
        availableCurrencies: fallbackCurrencies(
          [data.shop.currencyCode],
          data.shop.currencyCode,
        ),
      };
    } catch {
      return {
        defaultCurrency: 'USD',
        availableCurrencies: ['USD'],
      };
    }
  }
}

function fallbackCurrencies(
  availableCurrencies: string[],
  defaultCurrency: string,
) {
  return availableCurrencies.length ? availableCurrencies : [defaultCurrency];
}

export async function listCampaigns(
  admin: ShopifyAdminClient,
  options: ListShopifyResourcesOptions = {},
): Promise<ShopifyConnectionResult<ShopifyCampaignSummary>> {
  const data = await shopifyGraphql<{
    discountNodes: ShopifyConnectionResult<DiscountNode>;
  }>(admin, DISCOUNT_CAMPAIGNS_QUERY, connectionVariables(options));

  return {
    nodes: data.discountNodes.nodes.flatMap(campaignFromDiscountNode),
    pageInfo: data.discountNodes.pageInfo,
  };
}

export async function getCampaign(
  admin: ShopifyAdminClient,
  id: string,
): Promise<ShopifyCampaignDetail> {
  const data = await shopifyGraphql<{
    discountNode: DiscountNode | null;
  }>(admin, DISCOUNT_CAMPAIGN_QUERY, { id });

  if (!data.discountNode) {
    throw new Error("Campaign was not found.");
  }

  const campaign = campaignDetailFromDiscountNode(data.discountNode);
  if (!campaign) {
    throw new Error("Campaign is not managed by this app.");
  }

  return campaign;
}

export async function createCampaign(
  admin: ShopifyAdminClient,
  input: CreateCampaignInput,
) {
  const config = buildBasicCampaignConfig(input);
  const discountClasses = discountClassesForCampaign(input);

  if (!discountClasses.length) {
    throw new Error("Choose at least one product, order, or shipping discount type.");
  }

  const data = await shopifyGraphql<{
    discountAutomaticAppCreate: {
      automaticAppDiscount: {
        discountId: string;
        title: string;
        status: string;
      } | null;
      userErrors: { field: string[] | null; message: string }[];
    };
  }>(admin, CREATE_AUTOMATIC_APP_DISCOUNT_MUTATION, {
    automaticAppDiscount: {
      title: input.name,
      functionHandle: "discount-function-js",
      startsAt: new Date().toISOString(),
      combinesWith: combinesWithForCampaign(input),
      discountClasses,
      metafields: [
        {
          namespace: CAMPAIGN_CONFIG_METAFIELD_NAMESPACE,
          key: CAMPAIGN_CONFIG_METAFIELD_KEY,
          type: "json",
          value: JSON.stringify(config),
        },
        inputVariablesMetafield(input),
      ],
    },
  });

  const result = data.discountAutomaticAppCreate;
  if (result.userErrors.length) {
    throw new Error(
      result.userErrors.map((error) => error.message).join("; "),
    );
  }

  if (!result.automaticAppDiscount) {
    throw new Error("Shopify did not return the created campaign.");
  }

  return result.automaticAppDiscount;
}

export async function updateCampaign(
  admin: ShopifyAdminClient,
  id: string,
  input: CreateCampaignInput,
  existingConfig: CampaignConfig,
) {
  const config: CampaignConfig = {
    ...existingConfig,
    name: input.name,
    status: input.status,
    productDiscount: {
      ...existingConfig.productDiscount,
      type: input.productDiscountType,
      percentage:
        input.productDiscountType === "percentage"
          ? input.productDiscountPercentage
          : undefined,
      fixedAmount:
        input.productDiscountType === "fixed_amount"
          ? {
              amount: input.productDiscountFixedAmount ?? "",
              currencyCode: input.productDiscountFixedCurrencyCode ?? "USD",
            }
          : undefined,
      buyQuantity:
        input.productDiscountType === "buy_one_get_one_free"
          ? input.productDiscountBuyQuantity ?? 1
          : undefined,
      freeQuantity:
        input.productDiscountType === "buy_one_get_one_free"
          ? input.productDiscountFreeQuantity ?? 1
          : undefined,
      volumeTiers:
        input.productDiscountType === "volume_tier"
          ? input.productDiscountVolumeTiers ?? []
          : undefined,
    },
    orderDiscount: {
      ...(existingConfig.orderDiscount ?? {type: "none"}),
      type: input.orderDiscountType,
      percentage:
        input.orderDiscountType === "percentage"
          ? input.orderDiscountPercentage
          : undefined,
      maximumDiscountAmount:
        input.orderDiscountType === "percentage" &&
        input.orderDiscountMaximumAmount
          ? {
              amount: input.orderDiscountMaximumAmount,
              currencyCode: input.orderDiscountMaximumCurrencyCode ?? "USD",
            }
          : undefined,
      fixedAmount:
        input.orderDiscountType === "fixed_amount"
          ? {
              amount: input.orderDiscountFixedAmount ?? "",
              currencyCode: input.orderDiscountFixedCurrencyCode ?? "USD",
            }
          : undefined,
    },
    shippingDiscount: {
      ...existingConfig.shippingDiscount,
      type: input.shippingDiscountType,
      percentage:
        input.shippingDiscountType === "percentage"
          ? input.shippingDiscountPercentage
          : undefined,
      fixedAmount:
        input.shippingDiscountType === "fixed_amount"
          ? {
              amount: input.shippingDiscountFixedAmount ?? "",
              currencyCode: input.shippingDiscountFixedCurrencyCode ?? "USD",
            }
          : undefined,
      deliveryOptionHandles: shippingDeliveryOptionHandles(input),
      deliveryOptionTitles: shippingDeliveryOptionTitles(input),
      marketHandles: [],
      marketNames: [],
    },
    combinesWith: combinesWithForCampaign(input),
    conditions: {
      ...existingConfig.conditions,
      productIds: input.productIds ?? [],
      collectionIds: input.collectionIds ?? [],
      excludedProductIds: input.excludedProductIds ?? [],
      excludedCollectionIds: input.excludedCollectionIds ?? [],
      marketHandles: marketHandles(input),
      marketNames: marketNames(input),
      minimumCartSubtotal: minimumCartSubtotal(input),
      minimumCartQuantity: input.minimumCartQuantity,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
    },
  };
  const discountClasses = discountClassesForCampaign(input);

  if (!discountClasses.length) {
    throw new Error("Choose at least one product, order, or shipping discount type.");
  }

  const data = await shopifyGraphql<{
    discountAutomaticAppUpdate: {
      automaticAppDiscount: {
        title: string;
        status: string;
      } | null;
      userErrors: { field: string[] | null; message: string }[];
    };
  }>(admin, UPDATE_AUTOMATIC_APP_DISCOUNT_MUTATION, {
    id,
    automaticAppDiscount: {
      title: input.name,
      combinesWith: combinesWithForCampaign(input),
      discountClasses,
      metafields: [
        {
          namespace: CAMPAIGN_CONFIG_METAFIELD_NAMESPACE,
          key: CAMPAIGN_CONFIG_METAFIELD_KEY,
          type: "json",
          value: JSON.stringify(config),
        },
        inputVariablesMetafield(input),
      ],
    },
  });

  const result = data.discountAutomaticAppUpdate;
  if (result.userErrors.length) {
    throw new Error(
      result.userErrors.map((error) => error.message).join("; "),
    );
  }

  if (!result.automaticAppDiscount) {
    throw new Error("Shopify did not return the updated campaign.");
  }

  return result.automaticAppDiscount;
}

export async function updateCampaignStatus(
  admin: ShopifyAdminClient,
  id: string,
  status: CreateCampaignInput["status"],
) {
  const campaign = await getCampaign(admin, id);

  return updateCampaign(
    admin,
    id,
    {
      name: campaign.name,
      status,
      productDiscountType: campaign.config.productDiscount.type,
      productDiscountPercentage: campaign.config.productDiscount.percentage,
      productDiscountFixedAmount:
        campaign.config.productDiscount.fixedAmount?.amount,
      productDiscountFixedCurrencyCode:
        campaign.config.productDiscount.fixedAmount?.currencyCode,
      productDiscountBuyQuantity: campaign.config.productDiscount.buyQuantity,
      productDiscountFreeQuantity: campaign.config.productDiscount.freeQuantity,
      productDiscountVolumeTiers: campaign.config.productDiscount.volumeTiers,
      orderDiscountType: campaign.config.orderDiscount?.type ?? "none",
      orderDiscountPercentage: campaign.config.orderDiscount?.percentage,
      orderDiscountMaximumAmount:
        campaign.config.orderDiscount?.maximumDiscountAmount?.amount,
      orderDiscountMaximumCurrencyCode:
        campaign.config.orderDiscount?.maximumDiscountAmount?.currencyCode,
      orderDiscountFixedAmount:
        campaign.config.orderDiscount?.fixedAmount?.amount,
      orderDiscountFixedCurrencyCode:
        campaign.config.orderDiscount?.fixedAmount?.currencyCode,
      shippingDiscountType: campaign.config.shippingDiscount.type,
      shippingDiscountPercentage: campaign.config.shippingDiscount.percentage,
      shippingDiscountFixedAmount:
        campaign.config.shippingDiscount.fixedAmount?.amount,
      shippingDiscountFixedCurrencyCode:
        campaign.config.shippingDiscount.fixedAmount?.currencyCode,
      shippingDeliveryOptionHandle:
        campaign.config.shippingDiscount.deliveryOptionHandles?.[0],
      shippingDeliveryOptionTitle:
        campaign.config.shippingDiscount.deliveryOptionTitles?.[0],
      marketHandle:
        campaign.config.conditions.marketHandles?.[0] ??
        campaign.config.shippingDiscount.marketHandles?.[0],
      marketName:
        campaign.config.conditions.marketNames?.[0] ??
        campaign.config.shippingDiscount.marketNames?.[0],
      combinesWithOrderDiscounts:
        campaign.config.combinesWith?.orderDiscounts ?? false,
      combinesWithProductDiscounts:
        campaign.config.combinesWith?.productDiscounts ?? true,
      combinesWithShippingDiscounts:
        campaign.config.combinesWith?.shippingDiscounts ?? true,
      productIds: campaign.config.conditions.productIds,
      collectionIds: campaign.config.conditions.collectionIds,
      excludedProductIds: campaign.config.conditions.excludedProductIds ?? [],
      excludedCollectionIds:
        campaign.config.conditions.excludedCollectionIds ?? [],
      minimumCartSubtotalAmount:
        campaign.config.conditions.minimumCartSubtotal?.amount,
      minimumCartSubtotalCurrencyCode:
        campaign.config.conditions.minimumCartSubtotal?.currencyCode,
      minimumCartQuantity: campaign.config.conditions.minimumCartQuantity,
      startsAt: campaign.config.conditions.startsAt,
      endsAt: campaign.config.conditions.endsAt,
    },
    campaign.config,
  );
}

async function shopifyGraphql<TData>(
  admin: ShopifyAdminClient,
  query: string,
  variables: Record<string, unknown>,
): Promise<TData> {
  const response = await admin.graphql(query, { variables });
  const json = (await response.json()) as GraphQLResponse<TData>;

  if (json.errors?.length) {
    throw new Error(json.errors.map((error) => error.message).join("; "));
  }

  if (!json.data) {
    throw new Error("Shopify Admin API response did not include data.");
  }

  return json.data;
}

function connectionVariables(options: ListShopifyResourcesOptions) {
  return {
    first: options.first ?? DEFAULT_PAGE_SIZE,
    after: options.after ?? null,
    query: options.query || null,
  };
}

function campaignFromDiscountNode(
  node: DiscountNode,
): ShopifyCampaignSummary[] {
  const discount = node.discount;

  if (discount.__typename !== "DiscountAutomaticApp") {
    return [];
  }

  const config = node.metafield?.jsonValue as
    | {
        status?: string;
        productDiscount?: { type?: string };
        orderDiscount?: { type?: string };
        shippingDiscount?: { type?: string };
      }
    | undefined;

  if (!config) {
    return [];
  }

  return [
    {
      id: node.id,
      name: discount.title ?? "Untitled campaign",
      status: config.status ?? "inactive",
      discountType: campaignDiscountType(config),
      functionId: discount.appDiscountType?.functionId ?? "",
    },
  ];
}

function campaignDetailFromDiscountNode(
  node: DiscountNode,
): ShopifyCampaignDetail | null {
  const summary = campaignFromDiscountNode(node)[0];
  if (!summary) {
    return null;
  }

  return {
    ...summary,
    config: node.metafield?.jsonValue as CampaignConfig,
  };
}

function buildBasicCampaignConfig(input: CreateCampaignInput): CampaignConfig {
  return {
    version: CAMPAIGN_CONFIG_VERSION,
    id: crypto.randomUUID(),
    name: input.name,
    status: input.status,
    productDiscount: {
      type: input.productDiscountType,
      percentage:
        input.productDiscountType === "percentage"
          ? input.productDiscountPercentage
          : undefined,
      fixedAmount:
        input.productDiscountType === "fixed_amount"
          ? {
              amount: input.productDiscountFixedAmount ?? "",
              currencyCode: input.productDiscountFixedCurrencyCode ?? "USD",
            }
          : undefined,
      buyQuantity:
        input.productDiscountType === "buy_one_get_one_free"
          ? input.productDiscountBuyQuantity ?? 1
          : undefined,
      freeQuantity:
        input.productDiscountType === "buy_one_get_one_free"
          ? input.productDiscountFreeQuantity ?? 1
          : undefined,
      volumeTiers:
        input.productDiscountType === "volume_tier"
          ? input.productDiscountVolumeTiers ?? []
          : undefined,
    },
    orderDiscount: {
      type: input.orderDiscountType,
      percentage:
        input.orderDiscountType === "percentage"
          ? input.orderDiscountPercentage
          : undefined,
      maximumDiscountAmount:
        input.orderDiscountType === "percentage" &&
        input.orderDiscountMaximumAmount
          ? {
              amount: input.orderDiscountMaximumAmount,
              currencyCode: input.orderDiscountMaximumCurrencyCode ?? "USD",
            }
          : undefined,
      fixedAmount:
        input.orderDiscountType === "fixed_amount"
          ? {
              amount: input.orderDiscountFixedAmount ?? "",
              currencyCode: input.orderDiscountFixedCurrencyCode ?? "USD",
            }
          : undefined,
    },
    shippingDiscount: {
      type: input.shippingDiscountType,
      percentage:
        input.shippingDiscountType === "percentage"
          ? input.shippingDiscountPercentage
          : undefined,
      fixedAmount:
        input.shippingDiscountType === "fixed_amount"
          ? {
              amount: input.shippingDiscountFixedAmount ?? "",
              currencyCode: input.shippingDiscountFixedCurrencyCode ?? "USD",
            }
          : undefined,
      deliveryOptionHandles: shippingDeliveryOptionHandles(input),
      deliveryOptionTitles: shippingDeliveryOptionTitles(input),
      marketHandles: [],
      marketNames: [],
    },
    combinesWith: combinesWithForCampaign(input),
    conditions: {
      productIds: input.productIds ?? [],
      collectionIds: input.collectionIds ?? [],
      excludedProductIds: input.excludedProductIds ?? [],
      excludedCollectionIds: input.excludedCollectionIds ?? [],
      marketHandles: marketHandles(input),
      marketNames: marketNames(input),
      minimumCartSubtotal: minimumCartSubtotal(input),
      minimumCartQuantity: input.minimumCartQuantity,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
    },
  };
}

function inputVariablesMetafield(input: CreateCampaignInput) {
  return {
    namespace: INPUT_VARIABLES_METAFIELD_NAMESPACE,
    key: INPUT_VARIABLES_METAFIELD_KEY,
    type: "json",
    value: JSON.stringify({
      selectedCollectionIds: input.collectionIds ?? [],
      excludedCollectionIds: input.excludedCollectionIds ?? [],
    }),
  };
}

function minimumCartSubtotal(input: CreateCampaignInput) {
  if (!input.minimumCartSubtotalAmount) {
    return undefined;
  }

  return {
    amount: input.minimumCartSubtotalAmount,
    currencyCode: input.minimumCartSubtotalCurrencyCode ?? "USD",
  };
}

function shippingDeliveryOptionHandles(input: CreateCampaignInput) {
  if (
    input.shippingDiscountType === "none" ||
    !input.shippingDeliveryOptionHandle
  ) {
    return [];
  }

  return [input.shippingDeliveryOptionHandle];
}

function shippingDeliveryOptionTitles(input: CreateCampaignInput) {
  if (
    input.shippingDiscountType === "none" ||
    !input.shippingDeliveryOptionTitle
  ) {
    return [];
  }

  return [input.shippingDeliveryOptionTitle];
}

function marketHandles(input: CreateCampaignInput) {
  if (!input.marketHandle) {
    return [];
  }

  return [input.marketHandle];
}

function marketNames(input: CreateCampaignInput) {
  if (!input.marketName) {
    return [];
  }

  return [input.marketName];
}

function deliveryOptionHandle(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function discountClassesForCampaign(input: CreateCampaignInput) {
  const discountClasses: string[] = [];

  if (input.productDiscountType !== "none") {
    discountClasses.push("PRODUCT");
  }

  if (input.orderDiscountType !== "none") {
    discountClasses.push("ORDER");
  }

  if (input.shippingDiscountType !== "none") {
    discountClasses.push("SHIPPING");
  }

  return discountClasses;
}

function combinesWithForCampaign(input: CreateCampaignInput) {
  return {
    orderDiscounts: input.combinesWithOrderDiscounts ?? false,
    productDiscounts: input.combinesWithProductDiscounts ?? true,
    shippingDiscounts: input.combinesWithShippingDiscounts ?? true,
  };
}

function campaignDiscountType(config: {
  productDiscount?: { type?: string };
  orderDiscount?: { type?: string };
  shippingDiscount?: { type?: string };
}) {
  const productType = readableDiscountType(config.productDiscount?.type);
  const orderType = readableDiscountType(config.orderDiscount?.type);
  const shippingType = readableDiscountType(config.shippingDiscount?.type);
  const types = [productType, orderType, shippingType].filter(Boolean);

  if (types.length) {
    return types.join(" + ");
  }

  return "Not configured";
}

function readableDiscountType(type: string | undefined) {
  if (!type || type === "none") {
    return "";
  }

  return type
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export async function deleteCampaign(
  admin: ShopifyAdminClient,
  id: string,
) {
  const data = await shopifyGraphql<{
    discountAutomaticDelete: {
      deletedAutomaticDiscountId: string | null;
      userErrors: Array<{ field: string[] | null; message: string }>;
    };
  }>(admin, DELETE_AUTOMATIC_DISCOUNT_MUTATION, {
    id,
  });

  const result = data.discountAutomaticDelete;
  if (result.userErrors.length) {
    throw new Error(
      result.userErrors.map((error) => error.message).join("; "),
    );
  }

  if (!result.deletedAutomaticDiscountId) {
    throw new Error("Shopify did not return the deleted campaign id.");
  }

  return result.deletedAutomaticDiscountId;
}
