"use client";

import Link from "next/link";
import { PackageMinus, PackagePlus, PackageSearch, RefreshCw, ShieldCheck } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { businessTimeOfDay } from "@/lib/dashboard-metrics";
import { formatCount } from "@/lib/format";
import { useT } from "@/lib/i18n/client";
import { queryKeys } from "@/lib/query/keys";
import { usePendingAdjustmentCount, usePickQueueCount, type Figure } from "./dashboard-data";

/** Every source the dashboard reads; Refresh re-fetches exactly these. */
export const DASHBOARD_QUERY_KEYS = [
  queryKeys.dashboardSummary,
  queryKeys.attentionSummary,
  queryKeys.recentActivity,
  queryKeys.reports.all,
  queryKeys.stockAdjustmentRequests.all,
  queryKeys.products.all,
] as const;

export function useDashboardRefresh(): () => void {
  const qc = useQueryClient();
  return () => {
    for (const queryKey of DASHBOARD_QUERY_KEYS) void qc.invalidateQueries({ queryKey });
  };
}

function CountSuffix({ n }: { n: Figure }) {
  // The space only reaches the spoken name ("Review approvals · 4"): the button's flex gap spaces it visually.
  return typeof n === "number" ? (
    <>
      {" "}
      <span className="qty">· {formatCount(n)}</span>
    </>
  ) : null;
}

/** Admin's next job in the design: the approvals queue, with its count. */
function ReviewApprovalsAction() {
  const t = useT();
  const n = usePendingAdjustmentCount();
  return (
    <Button asChild variant="primary">
      <Link href="/stock-adjustments/approvals" data-qa="dash-primary">
        <ShieldCheck aria-hidden className="h-[15px] w-[15px]" />
        {t("dashboard.qaReview")}
        <CountSuffix n={n} />
      </Link>
    </Button>
  );
}

/** Warehouse's next job in the design: the picking queue, with its count. */
function PickOrdersAction() {
  const t = useT();
  const n = usePickQueueCount();
  return (
    <Button asChild variant="primary">
      <Link href="/picking" data-qa="dash-primary">
        <PackageSearch aria-hidden className="h-[15px] w-[15px]" />
        {t("dashboard.qaPick")}
        <CountSuffix n={n} />
      </Link>
    </Button>
  );
}

/**
 * UI-1 — the page-head actions of the design: when the figures were taken,
 * Refresh, Stock in, Stock out and the role's primary job. On phones the
 * stock buttons move to the large pair below the title instead.
 */
export function DashboardActions({
  admin,
  generatedAt,
  refreshing,
  onRefresh,
}: {
  admin: boolean;
  generatedAt?: string;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const t = useT();
  return (
    <div className="flex flex-wrap items-center gap-2">
      {generatedAt ? (
        <span className="text-[12px] text-[var(--faint)]">
          {t("dashboard.updatedAt", { time: businessTimeOfDay(generatedAt) })}
        </span>
      ) : null}
      <Button
        variant="ghost"
        size="icon"
        aria-label={t("dashboard.refresh")}
        title={t("dashboard.refresh")}
        aria-busy={refreshing}
        onClick={onRefresh}
      >
        <RefreshCw aria-hidden className={`h-[15px] w-[15px] ${refreshing ? "animate-spin motion-reduce:animate-none" : ""}`} />
      </Button>
      <span className="wc-dash-desk-actions">
        <Button asChild variant="secondary">
          <Link href="/stock-in">
            <PackagePlus aria-hidden className="h-[15px] w-[15px]" />
            {t("nav.stockIn")}
          </Link>
        </Button>
        <Button asChild variant="secondary">
          <Link href="/stock-out">
            <PackageMinus aria-hidden className="h-[15px] w-[15px]" />
            {t("nav.stockOut")}
          </Link>
        </Button>
        {admin ? <ReviewApprovalsAction /> : <PickOrdersAction />}
      </span>
    </div>
  );
}

/** Phones: the design's two large buttons for the most frequent jobs. */
export function PhoneQuickActions() {
  const t = useT();
  return (
    <div className="wc-dash-phone-actions">
      <Button asChild variant="primary" size="lg">
        <Link href="/stock-in">
          <PackagePlus aria-hidden className="h-[17px] w-[17px]" />
          {t("nav.stockIn")}
        </Link>
      </Button>
      <Button asChild variant="secondary" size="lg">
        <Link href="/stock-out">
          <PackageMinus aria-hidden className="h-[17px] w-[17px]" />
          {t("nav.stockOut")}
        </Link>
      </Button>
    </div>
  );
}
