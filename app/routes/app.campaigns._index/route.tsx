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
  useRouteError,
  useSearchParams,
} from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useEffect, useState } from "react";

import { DiscountRouteError } from "../../components/route-error";
import { getBillingSummary } from "../../billing.server";
import { describeCampaign } from "../../campaign-summary";
import {
  activeCampaignLimitError,
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
import { formErrorMessage, rawError, type FormError } from "../../form-errors";
import { createTranslator, formatDate, resolveLocale, withLocale } from "../../i18n";
import { useTranslation } from "../../i18n/react";
import { fieldValue, flag, showToast } from "../../lib/polaris";
import { campaignInputFromConfig } from "../../shopify-api.server";
import { authenticate } from "../../shopify.server";

interface CampaignRow {
  id: string;
  name: string;
  status: CampaignSummary["status"];
  shopifyStatus: string;
  summary: string[];
}

type CampaignsLoaderData = {
  campaigns: CampaignRow[];
  missingDiscountScope: boolean;
  plan: AppPlan;
  /** Pre-formatted on the server so SSR and the client agree on the day. */
  trialEndsLabel: string | null;
};

const DELETE_MODAL_ID = "delete-discount-modal";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const locale = resolveLocale(request);
  const t = createTranslator(locale);

  try {
    const [campaigns, billing] = await Promise.all([
      loadAllCampaigns(admin),
      getBillingSummary(admin, session.shop),
    ]);

    return {
      campaigns: campaigns.map((campaign) => ({
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
        shopifyStatus: campaign.shopifyStatus,
        summary: describeCampaign(campaignInputFromConfig(campaign.config), t, locale),
      })),
      missingDiscountScope: false,
      plan: billing.plan,
      trialEndsLabel: billing.subscription?.trialEndsAt
        ? formatDate(locale, billing.subscription.trialEndsAt)
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
  const locale = resolveLocale(request);
  const formData = await request.formData();
  const campaignId = String(formData.get("campaignId") || "");
  const actionType = String(formData.get("_action") || "");

  if (!campaignId) {
    return { error: rawError("Discount id is required.") };
  }

  if (actionType === "delete") {
    try {
      await deleteCampaignById(admin, campaignId);
      return redirect(withLocale("/app/campaigns?saved=deleted", locale));
    } catch (error) {
      return {
        error:
          error instanceof Error
            ? rawError(error.message)
            : ({ field: null, key: "error.delete.failed" } satisfies FormError),
      };
    }
  }

  const status = String(formData.get("status") || "");

  if (status !== "active" && status !== "inactive") {
    return { error: rawError("Discount status is invalid.") };
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
        return { error: activeCampaignLimitError(billing.plan) };
      }
    }

    await saveCampaignStatus(admin, campaignId, status);
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? rawError(error.message)
          : ({ field: null, key: "error.status.failed" } satisfies FormError),
    };
  }

  return { error: null, status };
};

export default function CampaignsIndex() {
  const { campaigns, missingDiscountScope, plan, trialEndsLabel } =
    useLoaderData<typeof loader>() as CampaignsLoaderData;
  const { t } = useTranslation();
  const entitlements = entitlementForPlan(plan);
  const { search } = useLocation();
  const navigation = useNavigation();
  const [searchParams] = useSearchParams();
  const statusFetcher = useFetcher<typeof action>();
  const deleteFetcher = useFetcher<typeof action>();
  const [campaignPendingDelete, setCampaignPendingDelete] = useState<CampaignRow | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const link = (pathname: string) => `${pathname}${search}`;

  const saved = searchParams.get("saved");
  const savedMessage =
    saved === "created"
      ? t("toast.created")
      : saved === "updated"
        ? t("toast.updated")
        : saved === "deleted"
          ? t("toast.deleted")
          : "";
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
  const showFilters = campaigns.length > 5;
  const visibleCampaigns = campaigns.filter((campaign) => {
    if (statusFilter !== "all" && campaign.status !== statusFilter) {
      return false;
    }
    const needle = query.trim().toLowerCase();

    return (
      !needle ||
      campaign.name.toLowerCase().includes(needle) ||
      campaign.summary.some((line) => line.toLowerCase().includes(needle))
    );
  });

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
        statusFetcher.data.status === "active" ? t("toast.activated") : t("toast.deactivated"),
      );
    }
  }, [statusFetcher.state, statusFetcher.data, t]);

  const toggleStatus = (campaign: CampaignRow) => {
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
    <s-page heading={t("list.title")}>
      <s-button
        href={link("/app/campaigns/new")}
        loading={flag(isOpeningNewCampaign)}
        slot="primary-action"
        variant="primary"
      >
        {t("common.createDiscount")}
      </s-button>
      <s-button href={link("/app/plans")} slot="secondary-actions">
        {t("common.plans")}
      </s-button>

      {missingDiscountScope ? (
        <s-banner heading={t("list.scope.heading")} tone="critical">
          <s-paragraph>{t("list.scope.text")}</s-paragraph>
        </s-banner>
      ) : null}

      {actionError ? (
        <s-banner heading={t("list.error.heading")} tone="critical">
          <s-paragraph>{formErrorMessage(actionError, t)}</s-paragraph>
        </s-banner>
      ) : null}

      {overLimit > 0 ? (
        <s-banner
          heading={
            overLimit === 1
              ? t("list.overLimit.heading1")
              : t("list.overLimit.headingN", { over: overLimit })
          }
          tone="warning"
        >
          <s-paragraph>
            {t("list.overLimit.text", {
              plan: entitlements.name,
              limit: formatCampaignLimit(entitlements.maxActiveCampaigns),
              over: overLimit,
            })}{" "}
            <s-link href={link("/app/plans")}>{t("common.viewPlans")}</s-link>
          </s-paragraph>
        </s-banner>
      ) : null}

      {plan === "free" && campaigns.length > 0 ? (
        <s-banner
          dismissible
          heading={t("list.upgrade.heading", { days: PAID_PLAN_TRIAL_DAYS })}
          tone="info"
        >
          <s-paragraph>
            {t("list.upgrade.text", {
              limit: formatCampaignLimit(PLAN_ENTITLEMENTS.pro.maxActiveCampaigns),
            })}{" "}
            <s-link href={link("/app/plans")}>{t("common.viewPlans")}</s-link>
          </s-paragraph>
        </s-banner>
      ) : null}

      {campaigns.length === 0 && !missingDiscountScope ? (
        <s-section heading={t("list.empty.heading")}>
          <s-stack direction="block" gap="base">
            <s-paragraph>{t("list.empty.text")}</s-paragraph>
            <s-stack direction="inline" gap="base">
              <s-button href={link("/app/campaigns/new")} variant="primary">
                {t("list.empty.cta")}
              </s-button>
            </s-stack>
          </s-stack>
        </s-section>
      ) : null}

      {campaigns.length > 0 ? (
        <s-section heading={t("list.all")}>
          <s-stack direction="block" gap="base">
            <s-stack alignItems="center" direction="inline" gap="small">
              <s-badge tone={overLimit > 0 ? "warning" : "neutral"}>
                {t("common.activeCount", {
                  count: activeCampaignCount,
                  limit: formatCampaignLimit(entitlements.maxActiveCampaigns),
                })}
              </s-badge>
              <s-badge tone="neutral">
                {draftCount === 1
                  ? t("common.draftCount", { count: draftCount })
                  : t("common.draftCountPlural", { count: draftCount })}
              </s-badge>
              <s-badge tone={trialEndsLabel ? "info" : "neutral"}>
                {trialEndsLabel
                  ? t("common.trialEnds", { plan: entitlements.name, date: trialEndsLabel })
                  : t("common.planLabel", { plan: entitlements.name })}
              </s-badge>
            </s-stack>

            {showFilters ? (
              <s-grid alignItems="end" gap="base" gridTemplateColumns="2fr 1fr">
                <s-search-field
                  label={t("list.search")}
                  labelAccessibilityVisibility="exclusive"
                  onInput={(event) => setQuery(fieldValue(event))}
                  placeholder={t("list.search")}
                  value={query}
                />
                <s-select
                  label={t("list.column.status")}
                  labelAccessibilityVisibility="exclusive"
                  onChange={(event) =>
                    setStatusFilter(fieldValue(event) as "all" | "active" | "inactive")
                  }
                  value={statusFilter}
                >
                  <s-option value="all">{t("list.filter.all")}</s-option>
                  <s-option value="active">{t("list.filter.active")}</s-option>
                  <s-option value="inactive">{t("list.filter.draft")}</s-option>
                </s-select>
              </s-grid>
            ) : null}

            {visibleCampaigns.length === 0 ? (
              <s-text color="subdued">{t("list.noMatches")}</s-text>
            ) : (
              <s-table variant="auto">
                <s-table-header-row>
                  <s-table-header listSlot="primary">{t("list.column.discount")}</s-table-header>
                  <s-table-header listSlot="labeled">{t("list.column.status")}</s-table-header>
                  <s-table-header listSlot="inline">{t("list.column.actions")}</s-table-header>
                </s-table-header-row>
                <s-table-body>
                  {visibleCampaigns.map((campaign) => {
                    const isActive = campaign.status === "active";
                    const blockedByLimit = !isActive && atLimit;
                    const isSubmitting = submittingCampaignId === campaign.id;
                    const href = link(`/app/campaigns/${encodeURIComponent(campaign.id)}`);

                    return (
                      <s-table-row key={campaign.id}>
                        <s-table-cell>
                          <s-stack direction="block" gap="small-300">
                            <s-link href={href}>{campaign.name}</s-link>
                            <s-text color="subdued">
                              {campaign.summary.length
                                ? campaign.summary.join(" · ")
                                : campaignStatusDetail(campaign, t)}
                            </s-text>
                          </s-stack>
                        </s-table-cell>
                        <s-table-cell>
                          <s-stack direction="block" gap="small-300">
                            <s-badge tone={isActive ? "success" : "neutral"}>
                              {isActive ? t("common.active") : t("common.draft")}
                            </s-badge>
                            {campaign.summary.length ? (
                              <s-text color="subdued">{campaignStatusDetail(campaign, t)}</s-text>
                            ) : null}
                          </s-stack>
                        </s-table-cell>
                        <s-table-cell>
                          <s-button-group>
                            <s-button href={href} variant="secondary">
                              {t("common.edit")}
                            </s-button>
                            {blockedByLimit ? (
                              <s-button href={link("/app/plans")} variant="secondary">
                                {t("common.upgradeToActivate")}
                              </s-button>
                            ) : (
                              <s-button
                                disabled={flag(Boolean(submittingCampaignId))}
                                loading={flag(isSubmitting)}
                                onClick={() => toggleStatus(campaign)}
                                variant="secondary"
                              >
                                {isActive ? t("common.deactivate") : t("common.activate")}
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
                              {t("common.delete")}
                            </s-button>
                          </s-button-group>
                        </s-table-cell>
                      </s-table-row>
                    );
                  })}
                </s-table-body>
              </s-table>
            )}
          </s-stack>
        </s-section>
      ) : null}

      <s-modal heading={t("list.delete.heading")} id={DELETE_MODAL_ID}>
        <s-paragraph>
          {t("list.delete.text", { name: campaignPendingDelete?.name ?? "" })}
        </s-paragraph>
        <s-button
          command="--hide"
          commandFor={DELETE_MODAL_ID}
          onClick={confirmDelete}
          slot="primary-action"
          tone="critical"
          variant="primary"
        >
          {t("list.delete.confirm")}
        </s-button>
        <s-button command="--hide" commandFor={DELETE_MODAL_ID} slot="secondary-actions">
          {t("common.cancel")}
        </s-button>
      </s-modal>
    </s-page>
  );
}

export function ErrorBoundary() {
  return <DiscountRouteError error={useRouteError()} />;
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};

function campaignStatusDetail(
  campaign: Pick<CampaignRow, "status" | "shopifyStatus">,
  t: ReturnType<typeof useTranslation>["t"],
) {
  if (campaign.status === "active") {
    return t("list.detail.live");
  }

  // Older campaigns were left ACTIVE in Shopify while inactive here; the
  // function still skips them, and the next status change re-syncs Shopify.
  if (campaign.shopifyStatus === "ACTIVE") {
    return t("list.detail.draft");
  }

  return t("list.detail.shopify", { status: formatStatus(campaign.shopifyStatus) });
}

function formatStatus(status: string) {
  return status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
}

function isMissingDiscountScopeError(error: unknown) {
  return (
    error instanceof Error &&
    error.message.includes("read_discounts") &&
    error.message.includes("discountNodes")
  );
}
