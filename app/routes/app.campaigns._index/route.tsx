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
  useSearchParams,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useEffect, useState } from "react";

import styles from "./styles.module.css";
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
import { authenticate } from "../../shopify.server";

type CampaignsLoaderData = {
  campaigns: CampaignSummary[];
  missingDiscountScope: boolean;
  plan: AppPlan;
  /** Pre-formatted on the server so SSR and the client agree on the day. */
  trialEndsLabel: string | null;
};

const SAVED_MESSAGES: Record<string, string> = {
  created: "Discount created.",
  updated: "Discount updated.",
  deleted: "Discount deleted.",
};

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

  return { error: null };
};

export default function CampaignsIndex() {
  const { campaigns, missingDiscountScope, plan, trialEndsLabel } =
    useLoaderData<typeof loader>() as CampaignsLoaderData;
  const actionData = useActionData<typeof action>();
  const entitlements = entitlementForPlan(plan);
  const location = useLocation();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();
  const savedMessage = SAVED_MESSAGES[searchParams.get("saved") ?? ""];
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
  const activeCampaignCount = countActiveCampaigns(campaigns);
  const inactiveCampaigns = campaigns.length - activeCampaignCount;
  const overLimit = activeCampaignsOverLimit(plan, activeCampaignCount);
  const atLimit = isAtActiveCampaignLimit(plan, activeCampaignCount);
  const coverage = campaigns.filter((campaign) =>
    /product|order|shipping/i.test(campaign.discountType),
  ).length;

  useEffect(() => {
    if (isDeletingCampaign) {
      setCampaignPendingDelete(null);
    }
  }, [isDeletingCampaign]);

  const goToNewCampaign = () => {
    navigate({ pathname: "/app/campaigns/new", search: location.search });
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
            {trialEndsLabel ? (
              <span className={styles.trialPill}>
                {entitlements.name} trial · ends {trialEndsLabel}
              </span>
            ) : (
              <span className={styles.planPill}>
                {entitlements.name} · {entitlements.priceLabel}
              </span>
            )}
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

      {savedMessage ? (
        <s-section>
          <div className={styles.successSection} role="status">
            {savedMessage}
          </div>
        </s-section>
      ) : null}

      <s-section>
        <div className={styles.summaryGrid} aria-label="Discount summary">
          <div className={`${styles.summaryCard} ${styles.summaryCardActive}`}>
            <span className={styles.summaryLabel}>Active</span>
            <strong className={styles.summaryValue}>
              {activeCampaignCount} / {formatCampaignLimit(entitlements.maxActiveCampaigns)}
            </strong>
            <span className={styles.summaryText}>
              {activeCampaignCount === 1
                ? "Discount is running"
                : "Discounts are running"}
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
            <span className={styles.summaryLabel}>Configured</span>
            <strong className={styles.summaryValue}>{coverage}</strong>
            <span className={styles.summaryText}>
              Discounts with product, order, or shipping rules
            </span>
          </div>
        </div>
      </s-section>

      {overLimit > 0 ? (
        <s-section>
          <div className={styles.warningSection} role="alert">
            <h2 className={styles.warningHeading}>
              {overLimit === 1
                ? "1 more discount is active than your plan includes"
                : `${overLimit} more discounts are active than your plan includes`}
            </h2>
            <p>
              {entitlements.name} includes{" "}
              {formatCampaignLimit(entitlements.maxActiveCampaigns)} active
              discount{entitlements.maxActiveCampaigns === 1 ? "" : "s"}. Your
              existing discounts keep running, but you cannot activate more
              until you deactivate {overLimit === 1 ? "one" : `${overLimit}`} or{" "}
              <Link to={{ pathname: "/app/plans", search: location.search }}>
                upgrade your plan
              </Link>
              .
            </p>
          </div>
        </s-section>
      ) : null}

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
                  ? `Pro includes fixed amount discounts, BOGO, volume tiers, shipping discounts, market targeting, scheduling, and up to ${formatCampaignLimit(
                      PLAN_ENTITLEMENTS.pro.maxActiveCampaigns,
                    )} active discounts. Try it free for ${PAID_PLAN_TRIAL_DAYS} days.`
                  : "Enterprise includes unlimited active discounts, all advanced features, and priority support."}
              </p>
            </div>
            <div className={styles.upgradePrice}>
              <strong>
                {plan === "free"
                  ? PLAN_ENTITLEMENTS.pro.priceLabel.replace("/month", "")
                  : PLAN_ENTITLEMENTS.enterprise.priceLabel.replace("/month", "")}
              </strong>
              <span>/ month</span>
              <Link
                className={styles.upgradeLink}
                to={{ pathname: "/app/plans", search: location.search }}
              >
                {plan === "free" ? "Start free trial" : "View plans"}
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
              This app needs permission to read discounts. Reopen or reinstall
              the app to approve the updated permissions.
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
              Create your first discount to get started. Set up product, order,
              or shipping discounts, add conditions, and activate it when ready.
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
            {campaigns.map((campaign) => {
              const isActive = campaign.status === "active";
              const blockedByLimit = !isActive && atLimit;

              return (
                <div key={campaign.id} className={styles.campaignCard}>
                  <div className={styles.campaignCardHeader}>
                    <div className={styles.campaignCardTitle}>
                      <h3>{campaign.name}</h3>
                      <p>{campaign.discountType}</p>
                    </div>
                    <div
                      className={
                        isActive
                          ? `${styles.statusBadge} ${styles.activeBadge}`
                          : `${styles.statusBadge} ${styles.inactiveBadge}`
                      }
                    >
                      {isActive ? "Active" : "Inactive"}
                    </div>
                  </div>
                  <div className={styles.campaignMeta}>
                    <span>Automatic app discount</span>
                    <span>{campaignStatusDetail(campaign)}</span>
                  </div>
                  <div className={styles.campaignCardActions}>
                    <Link
                      className={styles.editButton}
                      to={{
                        pathname: `/app/campaigns/${encodeURIComponent(campaign.id)}`,
                        search: location.search,
                      }}
                    >
                      Edit
                    </Link>
                    {blockedByLimit ? (
                      <Link
                        className={styles.limitButton}
                        title={activeCampaignLimitMessage(plan)}
                        to={{ pathname: "/app/plans", search: location.search }}
                      >
                        Upgrade to activate
                      </Link>
                    ) : (
                      <Form method="post" style={{ flex: 1 }}>
                        <input name="campaignId" type="hidden" value={campaign.id} />
                        <input
                          name="status"
                          type="hidden"
                          value={isActive ? "inactive" : "active"}
                        />
                        <button
                          className={styles.toggleButton}
                          disabled={submittingCampaignId === campaign.id}
                          type="submit"
                        >
                          {submittingCampaignId === campaign.id
                            ? "Saving..."
                            : isActive
                              ? "Deactivate"
                              : "Activate"}
                        </button>
                      </Form>
                    )}
                    <div style={{ flex: 1 }}>
                      <button
                        className={styles.deleteButton}
                        onClick={() =>
                          setCampaignPendingDelete({
                            id: campaign.id,
                            name: campaign.name,
                          })
                        }
                        type="button"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
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
                ×
              </button>
            </div>
            <p className={styles.deleteModalText}>
              This will permanently delete &quot;{campaignPendingDelete.name}&quot;.
              This action cannot be undone.
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
                <input name="campaignId" type="hidden" value={campaignPendingDelete.id} />
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
