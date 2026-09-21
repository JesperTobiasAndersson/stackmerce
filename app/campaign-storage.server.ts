import type {
  CreateCampaignInput,
  ListShopifyResourcesOptions,
  ShopifyCampaignDetail,
  ShopifyCampaignSummary,
  ShopifyConnectionResult,
} from "./shopify-api.server";
import { countActiveCampaigns } from "./entitlements";
import {
  createCampaign,
  getCampaign,
  listAllCampaigns,
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
export type CampaignSummary = ShopifyCampaignSummary;
export type CampaignDetail = ShopifyCampaignDetail;

export async function loadCampaigns(
  admin: ShopifyAdminClient,
  options: ListShopifyResourcesOptions = {},
): Promise<CampaignListResult> {
  return listCampaigns(admin, options);
}

/** All app campaigns on the store, for the list page and plan-limit checks. */
export async function loadAllCampaigns(
  admin: ShopifyAdminClient,
): Promise<CampaignSummary[]> {
  return listAllCampaigns(admin);
}

export async function loadActiveCampaignCount(admin: ShopifyAdminClient) {
  return countActiveCampaigns(await loadAllCampaigns(admin));
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
  existingCampaign?: CampaignDetail,
) {
  const campaign = existingCampaign ?? (await loadCampaign(admin, id));

  return updateCampaign(admin, id, input, campaign);
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
