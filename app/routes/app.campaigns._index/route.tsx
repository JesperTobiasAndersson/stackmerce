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
  useLoaderData,
  useLocation,
  useNavigate,
  useNavigation,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useEffect, useState } from "react";

import styles from "./styles.module.css";
import { getCurrentPlan } from "../../billing.server";
import {
  entitlementForPlan,
  formatCampaignLimit,
  type AppPlan,
} from "../../entitlements";
import {
  loadCampaigns,
  saveCampaignStatus,
  deleteCampaignById,
} from "../../campaign-storage.server";
import { authenticate } from "../../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  try {
    const [campaigns, plan] = await Promise.all([
      loadCampaigns(admin),
      getCurrentPlan(admin, session.shop),
    ]);

    return { campaigns: campaigns.nodes, missingDiscountScope: false, plan };
  } catch (error) {
    if (isMissingDiscountScopeError(error)) {
      return { campaigns: [], missingDiscountScope: true, plan: "free" as AppPlan };
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
      return redirect("/app/campaigns");
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
      const [campaigns, plan] = await Promise.all([
        loadCampaigns(admin, { first: 250 }),
        getCurrentPlan(admin, session.shop),
      ]);
      const entitlements = entitlementForPlan(plan);
      const targetCampaign = campaigns.nodes.find(
        (campaign) => campaign.id === campaignId,
      );
      const activeCampaignCount = campaigns.nodes.filter(
        (campaign) => campaign.status.toLowerCase() === "active",
      ).length;

      if (
        targetCampaign?.status.toLowerCase() !== "active" &&
        activeCampaignCount + 1 > entitlements.maxActiveCampaigns
      ) {
        return {
          error: `${entitlements.name} includes ${formatCampaignLimit(
            entitlements.maxActiveCampaigns,
          )} active discount${
            entitlements.maxActiveCampaigns === 1 ? "" : "s"
          }. Upgrade to activate more discounts.`,
        };
      }
    }

    await saveCampaignStatus(admin, campaignId, status);
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Could not update status.",
    };
  }

  return { error: null };
};

export default function CampaignsIndex() {
  const { campaigns, missingDiscountScope, plan } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const entitlements = entitlementForPlan(plan);
  const location = useLocation();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const [campaignPendingDelete, setCampaignPendingDelete] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const submittingCampaignId =
    navigation.state === "submitting"
      ? String(navigation.formData?.get("campaignId") || "")
      : "";
  const isDeletingCampaign =
    navigation.state === "submitting" &&
    String(navigation.formData?.get("_action") || "") === "delete";
  const isOpeningNewCampaign =
    navigation.state === "loading" &&
    navigation.location?.pathname === "/app/campaigns/new";
  const activeCampaigns = campaigns.filter(
    (campaign) => campaign.status.toLowerCase() === "active",
  );
  const inactiveCampaigns = campaigns.length - activeCampaigns.length;
  const productCampaigns = campaigns.filter((campaign) =>
    campaign.discountType.toLowerCase().includes("product"),
  ).length;
  const orderCampaigns = campaigns.filter((campaign) =>
    campaign.discountType.toLowerCase().includes("order"),
  ).length;
  const shippingCampaigns = campaigns.filter((campaign) =>
    campaign.discountType.toLowerCase().includes("shipping"),
  ).length;

  useEffect(() => {
    if (isDeletingCampaign) {
      setCampaignPendingDelete(null);
    }
  }, [isDeletingCampaign]);

  const goToNewCampaign = () => {
    navigate({
      pathname: "/app/campaigns/new",
      search: location.search,
    });
  };

  return (
    <s-page heading="Discounts">
      <s-section>
        <div className={styles.header}>
          <div>
            <span className={styles.headerEyebrow}>Automatic discounts</span>
            <h1 className={styles.headerTitle}>Your Discounts</h1>
            <p className={styles.headerDescription}>
              Create and manage automatic product, order, and shipping discounts
              for your store.
            </p>
          </div>
          <div className={styles.headerActions}>
            <span className={styles.planPill}>
              {entitlements.name} · {entitlements.priceLabel}
            </span>
            <button
              className={styles.headerButton}
              disabled={isOpeningNewCampaign}
              onClick={goToNewCampaign}
              type="button"
            >
              {isOpeningNewCampaign ? "Opening..." : "Create discount"}
            </button>
          </div>
        </div>
      </s-section>

      <s-section>
        <div className={styles.summaryGrid} aria-label="Discount summary">
          <div className={`${styles.summaryCard} ${styles.summaryCardActive}`}>
            <span className={styles.summaryLabel}>Active</span>
            <strong className={styles.summaryValue}>
              {activeCampaigns.length} / {formatCampaignLimit(entitlements.maxActiveCampaigns)}
            </strong>
            <span className={styles.summaryText}>
              {activeCampaigns.length === 1 ? "Discount is running" : "Discounts are running"}
            </span>
          </div>
          <div className={`${styles.summaryCard} ${styles.summaryCardDraft}`}>
            <span className={styles.summaryLabel}>Inactive</span>
            <strong className={styles.summaryValue}>{inactiveCampaigns}</strong>
            <span className={styles.summaryText}>
              {inactiveCampaigns === 1 ? "Draft discount" : "Draft discounts"}
            </span>
          </div>
          <div className={`${styles.summaryCard} ${styles.summaryCardCoverage}`}>
            <span className={styles.summaryLabel}>Coverage</span>
            <strong className={styles.summaryValue}>
              {productCampaigns + orderCampaigns + shippingCampaigns}
            </strong>
            <span className={styles.summaryText}>
              Product, order, or shipping rules configured
            </span>
          </div>
        </div>
      </s-section>

      {plan !== "enterprise" ? (
        <s-section>
          <div className={styles.upgradePanel}>
            <div>
              <span className={styles.upgradeEyebrow}>
                {plan === "free" ? "Free plan" : "Enterprise plan"}
              </span>
              <h2 className={styles.upgradeTitle}>
                {plan === "free"
                  ? "Unlock advanced discount campaigns"
                  : "Need unlimited campaigns and priority support?"}
              </h2>
              <p className={styles.upgradeText}>
                {plan === "free"
                  ? "Pro includes fixed amount discounts, BOGO, volume tiers, shipping discounts, market targeting, scheduling, and up to 25 active discounts."
                  : "Enterprise includes unlimited active discounts, all advanced features, and priority support."}
              </p>
            </div>
            <div className={styles.upgradePrice}>
              <strong>{plan === "free" ? "$14.90" : "$39.90"}</strong>
              <span>/ month</span>
              <Link className={styles.upgradeLink} to="/app/plans">
                View plans
              </Link>
            </div>
          </div>
        </s-section>
      ) : null}

      {missingDiscountScope ? (
        <s-section>
          <div className={styles.criticalSection}>
            <h3 className={styles.criticalHeading}>Discount access required</h3>
            <p>
              This app needs permission to read discounts. Reopen or reinstall the app in your dev store to approve the updated permissions.
            </p>
          </div>
        </s-section>
      ) : actionData?.error ? (
        <s-section>
          <div className={styles.criticalSection}>
            <h3 className={styles.criticalHeading}>Action needed</h3>
            <p>{actionData.error}</p>
          </div>
        </s-section>
      ) : campaigns.length === 0 ? (
        <s-section>
          <div className={styles.emptyState}>
            <h3 className={styles.emptyStateHeading}>No discounts yet</h3>
            <p className={styles.emptyStateText}>
              Create your first discount to get started. You can set up product and shipping discounts, configure conditions, and schedule discounts.
            </p>
            <button
              className={styles.emptyStateButton}
              disabled={isOpeningNewCampaign}
              onClick={goToNewCampaign}
              type="button"
            >
              {isOpeningNewCampaign ? "Opening..." : "Create your first discount"}
            </button>
          </div>
        </s-section>
      ) : (
        <s-section>
          <div className={styles.campaignsContainer}>
            {campaigns.map((campaign) => (
              <div key={campaign.id} className={styles.campaignCard}>
                <div className={styles.campaignCardHeader}>
                  <div className={styles.campaignCardTitle}>
                    <h3>{campaign.name}</h3>
                    <p>{campaign.discountType}</p>
                  </div>
                  <div className={
                    campaign.status === "active"
                      ? `${styles.statusBadge} ${styles.activeBadge}`
                      : `${styles.statusBadge} ${styles.inactiveBadge}`
                  }>
                    {formatStatus(campaign.status)}
                  </div>
                </div>
                <div className={styles.campaignMeta}>
                  <span>Automatic app discount</span>
                  <span>Shopify Function</span>
                </div>
                <div className={styles.campaignCardActions}>
                  <Link 
                    to={{
                      pathname: `/app/campaigns/${encodeURIComponent(campaign.id)}`,
                      search: location.search,
                    }}
                    className={styles.editButton}
                  >
                    Edit
                  </Link>
                  <Form method="post" style={{ flex: 1 }}>
                    <input
                      name="campaignId"
                      type="hidden"
                      value={campaign.id}
                    />
                    <input
                      name="status"
                      type="hidden"
                      value={nextStatus(campaign.status)}
                    />
                    <button
                      disabled={submittingCampaignId === campaign.id}
                      className={styles.toggleButton}
                      type="submit"
                    >
                      {submittingCampaignId === campaign.id
                        ? "Saving..."
                        : statusActionLabel(campaign.status)}
                    </button>
                  </Form>
                  <div style={{ flex: 1 }}>
                    <button
                      className={styles.deleteButton}
                      type="button"
                      onClick={() => {
                        setCampaignPendingDelete({
                          id: campaign.id,
                          name: campaign.name,
                        });
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </s-section>
      )}

      {campaignPendingDelete ? (
        <div
          aria-labelledby="delete-campaign-title"
          aria-modal="true"
          className={styles.modalBackdrop}
          role="dialog"
        >
          <div className={styles.deleteModal}>
            <div className={styles.deleteModalHeader}>
              <h2 id="delete-campaign-title">Delete discount?</h2>
              <button
                aria-label="Close delete confirmation"
                className={styles.modalCloseButton}
                disabled={isDeletingCampaign}
                onClick={() => setCampaignPendingDelete(null)}
                type="button"
              >
                x
              </button>
            </div>
            <p className={styles.deleteModalText}>
              This will permanently delete &quot;{campaignPendingDelete.name}&quot;. This
              action cannot be undone.
            </p>
            <div className={styles.deleteModalActions}>
              <button
                className={styles.cancelButton}
                disabled={isDeletingCampaign}
                onClick={() => setCampaignPendingDelete(null)}
                type="button"
              >
                Cancel
              </button>
              <Form method="post">
                <input
                  name="campaignId"
                  type="hidden"
                  value={campaignPendingDelete.id}
                />
                <input name="_action" type="hidden" value="delete" />
                <button
                  className={styles.deleteButton}
                  disabled={isDeletingCampaign}
                  type="submit"
                >
                  {isDeletingCampaign ? "Deleting..." : "Delete discount"}
                </button>
              </Form>
            </div>
          </div>
        </div>
      ) : null}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

function formatStatus(status: string) {
  return status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
}

function nextStatus(status: string) {
  return status.toLowerCase() === "active" ? "inactive" : "active";
}

function statusActionLabel(status: string) {
  return status.toLowerCase() === "active" ? "Deactivate" : "Activate";
}

function isMissingDiscountScopeError(error: unknown) {
  return (
    error instanceof Error &&
    error.message.includes("read_discounts") &&
    error.message.includes("discountNodes")
  );
}
