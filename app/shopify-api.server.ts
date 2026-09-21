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
  imageUrl?: string | null;
}

export interface ShopifyCollectionSummary {
  id: string;
  title: string;
  handle: string;
  imageUrl?: string | null;
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
  /** App status: "active" only when the config is active and Shopify has the discount ACTIVE. */
  status: "active" | "inactive";
  /** Raw Shopify discount status: ACTIVE, EXPIRED, or SCHEDULED. */
  shopifyStatus: string;
  discountType: string;
  functionId: string;
  /** Stored campaign configuration (the metafield the function reads). */
  config: CampaignConfig;
}

export type ShopifyCampaignDetail = ShopifyCampaignSummary;

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
// discountNodes returns every discount on the store (codes, native automatic
// discounts, other apps). Restrict the query to our kind so a page is never
// filled with discounts we then throw away.
const APP_DISCOUNTS_QUERY_FILTER = "type:app method:automatic";
const CAMPAIGN_PAGE_SIZE = 100;
const MAX_CAMPAIGN_PAGES = 10;
const CURRENCY_CACHE_TTL_MS = 10 * 60_000;
const SHIPPING_METHODS_CACHE_TTL_MS = 10 * 60_000;
const MARKETS_CACHE_TTL_MS = 10 * 60_000;

const PRODUCTS_BY_IDS_QUERY = `#graphql
  query ProductsByIds($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on Product {
        id
        title
        handle
        status
        featuredMedia {
          preview {
            image {
              url(transform: { maxWidth: 80, maxHeight: 80 })
            }
          }
        }
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
        image {
          url(transform: { maxWidth: 80, maxHeight: 80 })
        }
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

const ACTIVATE_AUTOMATIC_DISCOUNT_MUTATION = `#graphql
  mutation ActivateAutomaticDiscount($id: ID!) {
    discountAutomaticActivate(id: $id) {
      automaticDiscountNode {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const DEACTIVATE_AUTOMATIC_DISCOUNT_MUTATION = `#graphql
  mutation DeactivateAutomaticDiscount($id: ID!) {
    discountAutomaticDeactivate(id: $id) {
      automaticDiscountNode {
        id
      }
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

export async function getProductsByIds(
  admin: ShopifyAdminClient,
  ids: string[],
): Promise<ShopifyProductSummary[]> {
  if (!ids.length) {
    return [];
  }

  const data = await shopifyGraphql<{
    nodes: Array<
      | (ShopifyProductSummary & {
          featuredMedia?: { preview?: { image?: { url?: string } | null } | null } | null;
        })
      | null
    >;
  }>(admin, PRODUCTS_BY_IDS_QUERY, { ids });

  return data.nodes.flatMap((node) =>
    node
      ? [
          {
            id: node.id,
            title: node.title,
            handle: node.handle,
            status: node.status,
            imageUrl: node.featuredMedia?.preview?.image?.url ?? null,
          },
        ]
      : [],
  );
}

export async function getCollectionsByIds(
  admin: ShopifyAdminClient,
  ids: string[],
): Promise<ShopifyCollectionSummary[]> {
  if (!ids.length) {
    return [];
  }

  const data = await shopifyGraphql<{
    nodes: Array<(ShopifyCollectionSummary & { image?: { url?: string } | null }) | null>;
  }>(admin, COLLECTIONS_BY_IDS_QUERY, { ids });

  return data.nodes.flatMap((node) =>
    node
      ? [
          {
            id: node.id,
            title: node.title,
            handle: node.handle,
            imageUrl: node.image?.url ?? null,
          },
        ]
      : [],
  );
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
  }>(admin, DISCOUNT_CAMPAIGNS_QUERY, {
    ...connectionVariables(options),
    query: [APP_DISCOUNTS_QUERY_FILTER, options.query].filter(Boolean).join(" "),
  });

  return {
    nodes: data.discountNodes.nodes.flatMap(campaignFromDiscountNode),
    pageInfo: data.discountNodes.pageInfo,
  };
}

/**
 * Every campaign the app manages on this store. Walks the connection so the
 * list page and the active-campaign limit never miss campaigns past page one.
 */
export async function listAllCampaigns(
  admin: ShopifyAdminClient,
): Promise<ShopifyCampaignSummary[]> {
  const campaigns: ShopifyCampaignSummary[] = [];
  let after: string | null = null;

  for (let page = 0; page < MAX_CAMPAIGN_PAGES; page += 1) {
    const result: ShopifyConnectionResult<ShopifyCampaignSummary> =
      await listCampaigns(admin, { first: CAMPAIGN_PAGE_SIZE, after });
    campaigns.push(...result.nodes);

    if (!result.pageInfo.hasNextPage || !result.pageInfo.endCursor) {
      break;
    }

    after = result.pageInfo.endCursor;
  }

  return campaigns;
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

  // Shopify creates automatic discounts as ACTIVE. Keep its status in step with
  // ours so Shopify Admin > Discounts shows the same thing the app does and the
  // function is not invoked for drafts.
  if (input.status === "inactive") {
    await setShopifyDiscountActive(
      admin,
      result.automaticAppDiscount.discountId,
      false,
    );
  }

  return result.automaticAppDiscount;
}

export async function updateCampaign(
  admin: ShopifyAdminClient,
  id: string,
  input: CreateCampaignInput,
  existingCampaign: ShopifyCampaignDetail,
) {
  const existingConfig = existingCampaign.config;
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

  const shouldBeActive = input.status === "active";
  if (shouldBeActive !== (existingCampaign.shopifyStatus === "ACTIVE")) {
    await setShopifyDiscountActive(admin, id, shouldBeActive);
  }

  return result.automaticAppDiscount;
}

async function setShopifyDiscountActive(
  admin: ShopifyAdminClient,
  id: string,
  active: boolean,
) {
  type StatusPayload = {
    automaticDiscountNode: { id: string } | null;
    userErrors: Array<{ field: string[] | null; message: string }>;
  };
  const data = await shopifyGraphql<{
    discountAutomaticActivate?: StatusPayload;
    discountAutomaticDeactivate?: StatusPayload;
  }>(
    admin,
    active
      ? ACTIVATE_AUTOMATIC_DISCOUNT_MUTATION
      : DEACTIVATE_AUTOMATIC_DISCOUNT_MUTATION,
    { id },
  );
  const result = active
    ? data.discountAutomaticActivate
    : data.discountAutomaticDeactivate;

  if (result?.userErrors.length) {
    throw new Error(
      `Saved, but could not ${active ? "activate" : "deactivate"} the discount in Shopify: ${result.userErrors
        .map((error) => error.message)
        .join("; ")}`,
    );
  }
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
    campaignInputFromConfig(campaign.config, { name: campaign.name, status }),
    campaign,
  );
}

/**
 * Flattens a stored campaign config back into the form/input shape. Used to
 * pre-fill the edit form and to re-save a campaign with only its status changed.
 */
export function campaignInputFromConfig(
  config: CampaignConfig,
  overrides: Partial<Pick<CreateCampaignInput, "name" | "status">> = {},
): CreateCampaignInput {
  return {
    name: overrides.name ?? config.name,
    status: overrides.status ?? config.status,
    productDiscountType: config.productDiscount.type,
    productDiscountPercentage: config.productDiscount.percentage,
    productDiscountFixedAmount: config.productDiscount.fixedAmount?.amount,
    productDiscountFixedCurrencyCode:
      config.productDiscount.fixedAmount?.currencyCode,
    productDiscountBuyQuantity: config.productDiscount.buyQuantity,
    productDiscountFreeQuantity: config.productDiscount.freeQuantity,
    productDiscountVolumeTiers: config.productDiscount.volumeTiers,
    orderDiscountType: config.orderDiscount?.type ?? "none",
    orderDiscountPercentage: config.orderDiscount?.percentage,
    orderDiscountMaximumAmount:
      config.orderDiscount?.maximumDiscountAmount?.amount,
    orderDiscountMaximumCurrencyCode:
      config.orderDiscount?.maximumDiscountAmount?.currencyCode,
    orderDiscountFixedAmount: config.orderDiscount?.fixedAmount?.amount,
    orderDiscountFixedCurrencyCode:
      config.orderDiscount?.fixedAmount?.currencyCode,
    shippingDiscountType: config.shippingDiscount.type,
    shippingDiscountPercentage: config.shippingDiscount.percentage,
    shippingDiscountFixedAmount: config.shippingDiscount.fixedAmount?.amount,
    shippingDiscountFixedCurrencyCode:
      config.shippingDiscount.fixedAmount?.currencyCode,
    shippingDeliveryOptionHandle:
      config.shippingDiscount.deliveryOptionHandles?.[0],
    shippingDeliveryOptionTitle:
      config.shippingDiscount.deliveryOptionTitles?.[0],
    marketHandle:
      config.conditions.marketHandles?.[0] ??
      config.shippingDiscount.marketHandles?.[0],
    marketName:
      config.conditions.marketNames?.[0] ??
      config.shippingDiscount.marketNames?.[0],
    combinesWithOrderDiscounts: config.combinesWith?.orderDiscounts ?? false,
    combinesWithProductDiscounts: config.combinesWith?.productDiscounts ?? true,
    combinesWithShippingDiscounts:
      config.combinesWith?.shippingDiscounts ?? true,
    productIds: config.conditions.productIds ?? [],
    collectionIds: config.conditions.collectionIds ?? [],
    excludedProductIds: config.conditions.excludedProductIds ?? [],
    excludedCollectionIds: config.conditions.excludedCollectionIds ?? [],
    minimumCartSubtotalAmount: config.conditions.minimumCartSubtotal?.amount,
    minimumCartSubtotalCurrencyCode:
      config.conditions.minimumCartSubtotal?.currencyCode,
    minimumCartQuantity: config.conditions.minimumCartQuantity,
    startsAt: config.conditions.startsAt,
    endsAt: config.conditions.endsAt,
  };
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

  const shopifyStatus = discount.status ?? "ACTIVE";

  return [
    {
      id: node.id,
      name: discount.title ?? "Untitled campaign",
      // A campaign only discounts anything when both the config and Shopify
      // agree it is active (a merchant can deactivate it in Shopify Admin).
      status:
        config.status === "active" && shopifyStatus === "ACTIVE"
          ? "active"
          : "inactive",
      shopifyStatus,
      discountType: campaignDiscountType(config),
      functionId: discount.appDiscountType?.functionId ?? "",
      config: config as CampaignConfig,
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

  return summary;
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
