"use client";

import * as React from "react";
import Link from "next/link";

import { PageHeader } from "@/components/ui/page-header";
import { FilterStrip } from "@/components/ui/filter-strip";
import { DataTable, type Column } from "@/components/ui/data-table";
import { QuantityChange } from "@/components/ui/quantity-display";
import { StatusBadge } from "@/components/ui/status-badge";
import { LocalDate } from "@/components/ui/local-date";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { EmptyState } from "@/components/ui/states";
import { useSession } from "@/components/session-provider";
import { useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/translate";
import { useListParams } from "@/lib/list-params";
import { useStockAdjustmentRequests } from "@/lib/query/stock-adjustment-requests";
import { ADJUSTMENT_REQUEST_FILTER_TABS, type AdjustmentRequestRow } from "@/lib/api/schemas/stock-adjustment-requests";
import { StockAdjustmentRequestDetailBody, useReasonLabel } from "./request-detail";

const TAB_LABEL_KEY: Record<(typeof ADJUSTMENT_REQUEST_FILTER_TABS)[number]["key"], MessageKey> = {
  PENDING: "status.PENDING",
  all: "adjust.tabAll",
  APPROVED: "status.APPROVED",
  REJECTED: "status.REJECTED",
  CANCELLED: "status.CANCELLED",
};

/**
 * Shared list + detail-drawer view for both role-specific routes (D3):
 * `/stock-adjustments/mine` (scope="mine", every role) and
 * `/stock-adjustments/approvals` (scope="approvals", admin only — the
 * backend already scopes the underlying list by requester unless the
 * caller is admin, so "approvals" here only changes the default filter
 * tab and the page's own framing, not the authorization boundary itself).
 */
export function StockAdjustmentRequestList({ scope, title }: { scope: "mine" | "approvals"; title?: string }) {
  const t = useT();
  const heading = title ?? t(scope === "approvals" ? "adjust.titleApprovals" : "adjust.titleMine");
  const reasonLabel = useReasonLabel();
  const { user } = useSession();
  const { state, setPage, setFilter } = useListParams({
    sortOrder: "desc",
    filter: scope === "approvals" ? "PENDING" : "all",
    filterKey: "status",
  });

  const filter = state.filter ?? (scope === "approvals" ? "PENDING" : "all");
  const tab = ADJUSTMENT_REQUEST_FILTER_TABS.find((x) => x.key === filter) ?? ADJUSTMENT_REQUEST_FILTER_TABS[0];

  const query = React.useMemo(
    () => ({ page: state.page, page_size: state.pageSize, status: tab.status ?? undefined }),
    [state.page, state.pageSize, tab.status],
  );

  const { data, isLoading, isFetching, isError, error, refetch } = useStockAdjustmentRequests(query);
  const rows = data?.items ?? [];

  const [selected, setSelected] = React.useState<AdjustmentRequestRow | null>(null);
  const [drawerOpen, setDrawerOpen] = React.useState(false);

  const openRow = (r: AdjustmentRequestRow) => {
    setSelected(r);
    setDrawerOpen(true);
  };

  const mine = (r: AdjustmentRequestRow) => user.id != null && r.requested_by_user_id === user.id;

  const columns: Column<AdjustmentRequestRow>[] = [
    {
      key: "reference_number",
      header: t("adjust.colReference"),
      cell: (r) => (
        <span className="inline-flex items-center gap-2">
          <span className="mono font-medium">{r.reference_number ?? `#${r.id}`}</span>
          {mine(r) ? <span className="text-[12px] text-[var(--muted)]">{t("adjust.yours")}</span> : null}
        </span>
      ),
    },
    { key: "status", header: t("adjust.colStatus"), cell: (r) => <StatusBadge status={r.status} /> },
    {
      key: "diff",
      header: t("adjust.observedToRequested"),
      align: "right",
      cell: (r) => <QuantityChange before={r.observed_quantity} after={r.requested_quantity} className="tabular-nums" />,
    },
    {
      key: "reason",
      header: t("adjust.reason"),
      secondary: true,
      cell: (r) => <span>{reasonLabel(r.reason_code)}</span>,
    },
    {
      key: "created",
      header: t("adjust.colSubmitted"),
      secondary: true,
      cell: (r) => (
        <span className="mono text-[var(--muted)]">
          <LocalDate iso={r.created_at} isoInEnglish />
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={heading}
        subtitle={data ? t("adjust.requestsCount", { n: data.pagination.total_items }) : t("common.loading")}
        actions={
          <Button asChild variant="primary">
            <Link href="/stock-adjustments/new">{t("adjust.newRequest")}</Link>
          </Button>
        }
      />

      <FilterStrip
        ariaLabel={t("adjust.filterLabel")}
        options={ADJUSTMENT_REQUEST_FILTER_TABS.map((x) => ({ key: x.key, label: t(TAB_LABEL_KEY[x.key]) }))}
        value={filter}
        onChange={setFilter}
      />

      <DataTable<AdjustmentRequestRow>
        columns={columns}
        rows={rows}
        getRowKey={(r) => String(r.id)}
        onRowActivate={openRow}
        isLoading={isLoading}
        isFetching={isFetching}
        error={isError ? error : undefined}
        onRetry={() => void refetch()}
        emptyMessage={t("adjust.empty")}
        tabletLayout="table"
        pagination={
          data
            ? {
                page: data.pagination.page,
                pageSize: data.pagination.page_size,
                totalItems: data.pagination.total_items,
                totalPages: data.pagination.total_pages,
                onPageChange: setPage,
              }
            : undefined
        }
        renderCard={(r) => ({
          title: <span className="mono">{r.reference_number ?? `#${r.id}`}</span>,
          badge: <StatusBadge status={r.status} />,
          meta: (
            <>
              <QuantityChange before={r.observed_quantity} after={r.requested_quantity} />
              <span>{reasonLabel(r.reason_code)}</span>
            </>
          ),
        })}
      />

      <Drawer open={drawerOpen} onOpenChange={setDrawerOpen}>
        <DrawerContent title={selected ? (selected.reference_number ?? t("adjust.requestN", { id: selected.id })) : t("adjust.request")}>
          {selected ? (
            <StockAdjustmentRequestDetailBody
              id={selected.id}
              role={user.role}
              currentUserId={user.id}
              onDone={() => setDrawerOpen(false)}
            />
          ) : (
            <EmptyState message={t("adjust.noneSelected")} />
          )}
        </DrawerContent>
      </Drawer>
    </div>
  );
}
