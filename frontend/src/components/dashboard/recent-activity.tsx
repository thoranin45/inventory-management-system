"use client";

import { Activity } from "lucide-react";

import { Panel, PanelHead } from "@/components/ui/panel";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { QuantityDisplay } from "@/components/ui/quantity-display";
import { useRecentActivity } from "@/lib/query/hooks";
import { agoFromIso } from "@/lib/format";
import { useT } from "@/lib/i18n/client";
import { movementTypeText } from "@/lib/reports/report-copy";

/**
 * Nearest real backend source for the prototype's "Recent activity" band:
 * GET /api/v1/dashboard/recent-transactions (stock movements). The exact
 * multi-entity feed the prototype mocked has no 1:1 endpoint — see the
 * Phase 1 report, section H.
 */
export function RecentActivity() {
  const { data, isLoading, isError, error, refetch } = useRecentActivity();
  const t = useT();

  return (
    <Panel className="wc-activity">
      <PanelHead
        title={t("dashboard.activityTitle")}
        aside={data ? t("dashboard.activityAside", { n: data.length }) : undefined}
      />
      <div className="flex flex-col">
        {isLoading ? (
          <LoadingState />
        ) : isError ? (
          <ErrorState error={error} onRetry={() => void refetch()} compact className="m-4" />
        ) : !data || data.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-8 text-center text-[12px] text-[var(--muted)]">
            <Activity aria-hidden className="h-5 w-5 text-[var(--faint)]" />
            {t("dashboard.activityEmpty")}
          </div>
        ) : (
          data.slice(0, 10).map((tx) => (
            <div
              key={tx.id}
              className="flex items-start gap-3 border-t border-[var(--border)] px-[18px] py-[11px] first:border-t-0 max-[767.98px]:px-[14px]"
            >
              <span className="qty w-[66px] flex-none pt-[2px] text-[10.5px] text-[var(--faint)]">
                {agoFromIso(tx.created_at)}
              </span>
              <span className="grid h-[22px] w-[22px] flex-none place-items-center rounded-[var(--r-sm)] bg-[var(--surface-sunken)] text-[var(--muted)]">
                <Activity aria-hidden className="h-3 w-3" />
              </span>
              <span className="flex min-w-0 flex-col leading-[1.35]">
                <span className="text-[12.5px] font-semibold">
                  {tx.transaction_type ? movementTypeText(t, tx.transaction_type) : t("dashboard.movementFallback")}
                </span>
                <span className="truncate text-[11px] text-[var(--muted)]">
                  {tx.remark || t("dashboard.productFallback", { id: tx.product_id ?? "—" })}
                </span>
              </span>
              <QuantityDisplay value={tx.quantity} className="ml-auto flex-none text-[12px] font-medium" />
            </div>
          ))
        )}
      </div>
    </Panel>
  );
}
