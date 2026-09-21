import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import {
  redirect,
  useFetcher,
  useLoaderData,
  useLocation,
  useNavigation,
  useSearchParams,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useEffect, useState } from "react";

import { getBillingSummary } from "../../billing.server";
import {
  activeCampaignLimitMessage,
  activeCampaignsOverLimit,
  countActiveCampaigns,
  entitlementForPlan,
  formatCampaignLimit,
  isAtActiveCampaignLimit,
  PAID_PLAN_TRIAL_DAYS,
  PLAN_ENTITLEMENTS,
  type AppPlan,
} from "../../entitlements";
import {
  deleteCampaignById,
  loadAllCampaigns,
  saveCampaignStatus,
  type CampaignSummary,
} from "../../campaign-storage.server";
import { flag, showToast } from "../../lib/polaris";
import { authenticate } from "../../shopify.server";

type CampaignsLoaderData = {
  campaigns: CampaignSummary[];
  missingDiscountScope: boolean;
  plan: AppPlan;
  /** Pre-formatted on the server so SSR and the client agree on the day. */
  trialEndsLabel: string | null;
};

const SAVED_MESSAGES: Record<string, string> = {
  created: "Discount created",
  updated: "Discount updated",
  deleted: "Discount deleted",
};

const DELETE_MODAL_ID = "delete-discount-modal";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  try {
    const [campaigns, billing] = await Promise.all([
      loadAllCampaigns(admin),
      getBillingSummary(admin, session.shop),
    ]);

    return {
      campaigns,
      missingDiscountScope: false,
      plan: billing.plan,
      trialEndsLabel: billing.subscription?.trialEndsAt
        ? formatDate(billing.subscription.trialEndsAt)
        : null,
    } satisfies CampaignsLoaderData;
  } catch (error) {
    if (isMissingDiscountScopeError(error)) {
      return {
        campaigns: [],
        missingDiscountScope: true,
        plan: "free",
        trialEndsLabel: null,
      } satisfies CampaignsLoaderData;
    }

    throw error;
  }
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const campaignId = String(formData.get("campaignId") || "");
  const actionType = String(formData.get("_action") || "");

  if (!campaignId) {
    return { error: "Campaign id is required." };
  }

  if (actionType === "delete") {
    try {
      await deleteCampaignById(admin, campaignId);
      return redirect("/app/campaigns?saved=deleted");
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "Could not delete campaign.",
      };
    }
  }

  const status = String(formData.get("status") || "");

  if (status !== "active" && status !== "inactive") {
    return { error: "Campaign status is invalid." };
  }

  try {
    if (status === "active") {
      const [campaigns, billing] = await Promise.all([
        loadAllCampaigns(admin),
        getBillingSummary(admin, session.shop),
      ]);
      const targetCampaign = campaigns.find((campaign) => campaign.id === campaignId);

      if (
        targetCampaign?.status !== "active" &&
        isAtActiveCampaignLimit(billing.plan, countActiveCampaigns(campaigns))
      ) {
        return { error: activeCampaignLimitMessage(billing.plan) };
      }
    }

    await saveCampaignStatus(admin, campaignId, status);
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Could not update status.",
    };
  }

  return { error: null, status };
};

export default function CampaignsIndex() {
  const { campaigns, missingDiscountScope, plan, trialEndsLabel } =
    useLoaderData<typeof loader>() as CampaignsLoaderData;
  const entitlements = entitlementForPlan(plan);
  const { search } = useLocation();
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();
  const statusFetcher = useFetcher<typeof action>();
  const deleteFetcher = useFetcher<typeof action>();
  const [campaignPendingDelete, setCampaignPendingDelete] =
    useState<CampaignSummary | null>(null);
  const link = (pathname: string) => `${pathname}${search}`;

  const savedMessage = SAVED_MESSAGES[searchParams.get("saved") ?? ""];
  const returnToShopify = searchParams.get("returnTo") === "discounts";
  const activeCampaignCount = countActiveCampaigns(campaigns);
  const draftCount = campaigns.length - activeCampaignCount;
  const overLimit = activeCampaignsOverLimit(plan, activeCampaignCount);
  const atLimit = isAtActiveCampaignLimit(plan, activeCampaignCount);
  const submittingCampaignId =
    statusFetcher.state !== "idle"
      ? String(statusFetcher.formData?.get("campaignId") || "")
      : "";
  const isDeleting = deleteFetcher.state !== "idle";
  const isOpeningNewCampaign =
    navigation.state === "loading" &&
    navigation.location?.pathname === "/app/campaigns/new";
  const actionError = statusFetcher.data?.error ?? deleteFetcher.data?.error ?? null;

  // Confirmations arrive as ?saved= from the editor redirects. Show them as a
  // toast (the Shopify admin pattern) and drop the param so a reload doesn't
  // repeat it. When the merchant came from Shopify's own Discounts page, send
  // them back there.
  useEffect(() => {
    if (savedMessage) {
      showToast(savedMessage);
      const url = new URL(window.location.href);
      url.searchParams.delete("saved");
      url.searchParams.delete("returnTo");
      window.history.replaceState(window.history.state, "", url);
    }

    if (returnToShopify) {
      open("shopify://admin/discounts", "_top");
    }
  }, [savedMessage, returnToShopify]);

  useEffect(() => {
    if (statusFetcher.state === "idle" && statusFetcher.data && !statusFetcher.data.error) {
      showToast(
        statusFetcher.data.status === "active"
          ? "Discount activated"
          : "Discount deactivated",
      );
    }
  }, [statusFetcher.state, statusFetcher.data]);

  const toggleStatus = (campaign: CampaignSummary) => {
    statusFetcher.submit(
      {
        campaignId: campaign.id,
        status: campaign.status === "active" ? "inactive" : "active",
      },
      { method: "post" },
    );
  };

  const confirmDelete = () => {
    if (!campaignPendingDelete) {
      return;
    }

    deleteFetcher.submit(
      { campaignId: campaignPendingDelete.id, _action: "delete" },
      { method: "post" },
    );
    setCampaignPendingDelete(null);
  };

  return (
    <s-page heading="Discounts">
      <s-button
        href={link("/app/campaigns/new")}
        loading={flag(isOpeningNewCampaign)}
        slot="primary-action"
        variant="primary"
      >
        Create discount
      </s-button>
      <s-button href={link("/app/plans")} slot="secondary-actions">
        Plans
      </s-button>

      {missingDiscountScope ? (
        <s-banner heading="Discount access required" tone="critical">
          <s-paragraph>
            This app needs permission to read discounts. Reopen or reinstall the
            app to approve the updated permissions.
          </s-paragraph>
        </s-banner>
      ) : null}

      {actionError ? (
        <s-banner heading="Action needed" tone="critical">
          <s-paragraph>{actionError}</s-paragraph>
        </s-banner>
      ) : null}

      {overLimit > 0 ? (
        <s-banner
          heading={
            overLimit === 1
              ? "1 more discount is active than your plan includes"
              : `${overLimit} more discounts are active than your plan includes`
          }
          tone="warning"
        >
          <s-paragraph>
            {entitlements.name} includes{" "}
            {formatCampaignLimit(entitlements.maxActiveCampaigns)} active discount
            {entitlements.maxActiveCampaigns === 1 ? "" : "s"}. Your existing
            discounts keep running, but you cannot activate more until you
            deactivate {overLimit === 1 ? "one" : String(overLimit)} or{" "}
            <s-link href={link("/app/plans")}>upgrade your plan</s-link>.
          </s-paragraph>
        </s-banner>
      ) : null}

      {plan === "free" && campaigns.length > 0 ? (
        <s-banner
          dismissible
          heading={`Try Pro free for ${PAID_PLAN_TRIAL_DAYS} days`}
          tone="info"
        >
          <s-paragraph>
            Fixed amount discounts, Buy X get Y, volume tiers, shipping
            discounts, market targeting, scheduling, and up to{" "}
            {formatCampaignLimit(PLAN_ENTITLEMENTS.pro.maxActiveCampaigns)} active
            discounts. <s-link href={link("/app/plans")}>View plans</s-link>
          </s-paragraph>
        </s-banner>
      ) : null}

      {campaigns.length === 0 && !missingDiscountScope ? (
        <s-section heading="No discounts yet">
          <s-stack direction="block" gap="base">
            <s-paragraph>
              Create your first discount to get started. Set up product, order,
              or shipping discounts, add conditions, and activate it when ready.
              Discounts apply automatically at checkout.
            </s-paragraph>
            <s-stack direction="inline" gap="base">
              <s-button href={link("/app/campaigns/new")} variant="primary">
                Create your first discount
              </s-button>
            </s-stack>
          </s-stack>
        </s-section>
      ) : null}

      {campaigns.length > 0 ? (
        <s-section heading="All discounts">
          <s-stack direction="block" gap="base">
          <s-stack alignItems="center" direction="inline" gap="small">
            <s-badge tone={overLimit > 0 ? "warning" : "neutral"}>
              {activeCampaignCount} of {formatCampaignLimit(entitlements.maxActiveCampaigns)} active
            </s-badge>
            <s-badge tone="neutral">
              {draftCount} draft{draftCount === 1 ? "" : "s"}
            </s-badge>
            <s-badge tone={trialEndsLabel ? "info" : "neutral"}>
              {trialEndsLabel
                ? `${entitlements.name} trial ends ${trialEndsLabel}`
                : `${entitlements.name} plan`}
            </s-badge>
          </s-stack>
          <s-table variant="auto">
            <s-table-header-row>
              <s-table-header listSlot="primary">Discount</s-table-header>
              <s-table-header listSlot="labeled">Status</s-table-header>
              <s-table-header listSlot="labeled">Type</s-table-header>
              <s-table-header listSlot="inline">Actions</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {campaigns.map((campaign) => {
                const isActive = campaign.status === "active";
                const blockedByLimit = !isActive && atLimit;
                const isSubmitting = submittingCampaignId === campaign.id;

                return (
                  <s-table-row key={campaign.id}>
                    <s-table-cell>
                      <s-stack direction="block" gap="small-300">
                        <s-link
                          href={link(`/app/campaigns/${encodeURIComponent(campaign.id)}`)}
                        >
                          {campaign.name}
                        </s-link>
                        <s-text color="subdued">{campaignStatusDetail(campaign)}</s-text>
                      </s-stack>
                    </s-table-cell>
                    <s-table-cell>
                      <s-badge tone={isActive ? "success" : "neutral"}>
                        {isActive ? "Active" : "Inactive"}
                      </s-badge>
                    </s-table-cell>
                    <s-table-cell>{campaign.discountType}</s-table-cell>
                    <s-table-cell>
                      <s-button-group>
                        <s-button
                          href={link(`/app/campaigns/${encodeURIComponent(campaign.id)}`)}
                          variant="secondary"
                        >
                          Edit
                        </s-button>
                        {blockedByLimit ? (
                          <s-button
                            accessibilityLabel={activeCampaignLimitMessage(plan)}
                            href={link("/app/plans")}
                            variant="secondary"
                          >
                            Upgrade to activate
                          </s-button>
                        ) : (
                          <s-button
                            disabled={flag(Boolean(submittingCampaignId))}
                            loading={flag(isSubmitting)}
                            onClick={() => toggleStatus(campaign)}
                            variant="secondary"
                          >
                            {isActive ? "Deactivate" : "Activate"}
                          </s-button>
                        )}
                        <s-button
                          command="--show"
                          commandFor={DELETE_MODAL_ID}
                          disabled={flag(isDeleting)}
                          onClick={() => setCampaignPendingDelete(campaign)}
                          tone="critical"
                          variant="tertiary"
                        >
                          Delete
                        </s-button>
                      </s-button-group>
                    </s-table-cell>
                  </s-table-row>
                );
              })}
            </s-table-body>
          </s-table>
          </s-stack>
        </s-section>
      ) : null}

      <s-modal heading="Delete discount?" id={DELETE_MODAL_ID}>
        <s-paragraph>
          This will permanently delete &quot;{campaignPendingDelete?.name ?? ""}
          &quot;. Customers will stop receiving it immediately. This action cannot
          be undone.
        </s-paragraph>
        <s-button
          command="--hide"
          commandFor={DELETE_MODAL_ID}
          onClick={confirmDelete}
          slot="primary-action"
          tone="critical"
          variant="primary"
        >
          Delete discount
        </s-button>
        <s-button command="--hide" commandFor={DELETE_MODAL_ID} slot="secondary-actions">
          Cancel
        </s-button>
      </s-modal>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

function campaignStatusDetail(campaign: CampaignSummary) {
  if (campaign.status === "active") {
    return "Live at checkout";
  }

  // Older campaigns were left ACTIVE in Shopify while inactive here; the
  // function still skips them, and the next status change re-syncs Shopify.
  if (campaign.shopifyStatus === "ACTIVE") {
    return "Draft, not applied at checkout";
  }

  return `${formatStatus(campaign.shopifyStatus)} in Shopify`;
}

function formatStatus(status: string) {
  return status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function isMissingDiscountScopeError(error: unknown) {
  return (
    error instanceof Error &&
    error.message.includes("read_discounts") &&
    error.message.includes("discountNodes")
  );
}
