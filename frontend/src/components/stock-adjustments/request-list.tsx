"use client";

import * as React from "react";
import Link from "next/link";

import { PageHeader } from "@/components/ui/page-header";
import { FilterStrip } from "@/components/ui/filter-strip";
import { DataTable, type Column } from "@/components/ui/data-table";
import { QuantityDisplay } from "@/components/ui/quantity-display";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { EmptyState } from "@/components/ui/states";
import { useSession } from "@/components/session-provider";
import { formatIsoDate } from "@/lib/format";
import { useListParams } from "@/lib/list-params";
import { useStockAdjustmentRequests } from "@/lib/query/stock-adjustment-requests";
import {
  ADJUSTMENT_REQUEST_FILTER_TABS,
  REASON_LABELS,
  type AdjustmentRequestRow,
  type ReasonCode,
} from "@/lib/api/schemas/stock-adjustment-requests";
import { StockAdjustmentRequestDetailBody } from "./request-detail";

/**
 * Shared list + detail-drawer view for both role-specific routes (D3):
 * `/stock-adjustments/mine` (scope="mine", every role) and
 * `/stock-adjustments/approvals` (scope="approvals", admin only — the
 * backend already scopes the underlying list by requester unless the
 * caller is admin, so "approvals" here only changes the default filter
 * tab and the page's own framing, not the authorization boundary itself).
 */
export function StockAdjustmentRequestList({ scope, title }: { scope: "mine" | "approvals"; title: string }) {
  const { user } = useSession();
  const { state, setPage, setFilter } = useListParams({
    sortOrder: "desc",
    filter: scope === "approvals" ? "PENDING" : "all",
    filterKey: "status",
  });

  const filter = state.filter ?? (scope === "approvals" ? "PENDING" : "all");
  const tab = ADJUSTMENT_REQUEST_FILTER_TABS.find((t) => t.key === filter) ?? ADJUSTMENT_REQUEST_FILTER_TABS[0];

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

  const columns: Column<AdjustmentRequestRow>[] = [
    {
      key: "reference_number",
      header: "Reference",
      cell: (r) => <span className="mono font-medium">{r.reference_number ?? `#${r.id}`}</span>,
    },
    { key: "status", header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
    {
      key: "diff",
      header: "Observed → Requested",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums">
          <QuantityDisplay value={r.observed_quantity} className="text-[var(--muted)]" /> {"→"}{" "}
          <QuantityDisplay value={r.requested_quantity} />
        </span>
      ),
    },
    {
      key: "reason",
      header: "Reason",
      secondary: true,
      cell: (r) => <span>{REASON_LABELS[r.reason_code as ReasonCode]?.label ?? r.reason_code}</span>,
    },
    {
      key: "created",
      header: "Submitted",
      secondary: true,
      cell: (r) => <span className="mono text-[var(--muted)]">{formatIsoDate(r.created_at)}</span>,
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={title}
        subtitle={data ? `${data.pagination.total_items} requests` : "Loading…"}
        actions={
          <Button asChild variant="primary">
            <Link href="/stock-adjustments/new">New request</Link>
          </Button>
        }
      />

      <FilterStrip
        ariaLabel="Stock adjustment request status filter"
        options={ADJUSTMENT_REQUEST_FILTER_TABS.map((t) => ({ key: t.key, label: t.label }))}
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
        emptyMessage="No stock adjustment requests match this filter."
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
              <span>
                <QuantityDisplay value={r.observed_quantity} /> {"→"} <QuantityDisplay value={r.requested_quantity} />
              </span>
              <span>{REASON_LABELS[r.reason_code as ReasonCode]?.label ?? r.reason_code}</span>
            </>
          ),
        })}
      />

      <Drawer open={drawerOpen} onOpenChange={setDrawerOpen}>
        <DrawerContent title={selected ? (selected.reference_number ?? `Request #${selected.id}`) : "Request"}>
          {selected ? (
            <StockAdjustmentRequestDetailBody id={selected.id} role={user.role} onDone={() => setDrawerOpen(false)} />
          ) : (
            <EmptyState message="No request selected." />
          )}
        </DrawerContent>
      </Drawer>
    </div>
  );
}
