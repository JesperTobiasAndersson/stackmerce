import type {
  CreateCampaignInput,
  ListShopifyResourcesOptions,
  ShopifyCampaignDetail,
  ShopifyCampaignSummary,
  ShopifyConnectionResult,
} from "./shopify-api.server";
import {
  createCampaign,
  getCampaign,
  listCampaigns,
  updateCampaign,
  updateCampaignStatus,
  deleteCampaign,
} from "./shopify-api.server";

interface ShopifyAdminClient {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
}

export type CampaignFormInput = CreateCampaignInput;
export type CampaignListResult = ShopifyConnectionResult<ShopifyCampaignSummary>;
export type CampaignDetail = ShopifyCampaignDetail;

export async function loadCampaigns(
  admin: ShopifyAdminClient,
  options: ListShopifyResourcesOptions = {},
): Promise<CampaignListResult> {
  return listCampaigns(admin, options);
}

export async function loadCampaign(
  admin: ShopifyAdminClient,
  id: string,
): Promise<CampaignDetail> {
  return getCampaign(admin, id);
}

export async function saveNewCampaign(
  admin: ShopifyAdminClient,
  input: CampaignFormInput,
) {
  return createCampaign(admin, input);
}

export async function saveCampaign(
  admin: ShopifyAdminClient,
  id: string,
  input: CampaignFormInput,
) {
  const existingCampaign = await loadCampaign(admin, id);

  return updateCampaign(admin, id, input, existingCampaign.config);
}

export async function saveCampaignStatus(
  admin: ShopifyAdminClient,
  id: string,
  status: CampaignFormInput["status"],
) {
  return updateCampaignStatus(admin, id, status);
}

export async function deleteCampaignById(
  admin: ShopifyAdminClient,
  id: string,
) {
  return deleteCampaign(admin, id);
}
