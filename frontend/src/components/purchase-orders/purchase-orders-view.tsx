"use client";

import * as React from "react";

import { PageHeader } from "@/components/ui/page-header";
import { FilterStrip } from "@/components/ui/filter-strip";
import { SearchInput } from "@/components/ui/search-input";
import { DataTable, type Column } from "@/components/ui/data-table";
import { MoneyDisplay, QuantityDisplay } from "@/components/ui/quantity-display";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { useSession } from "@/components/session-provider";
import { isAdmin } from "@/lib/auth/permissions";
import { useListParams } from "@/lib/list-params";
import { usePurchaseOrders } from "@/lib/query/purchase-orders";
import { formatIsoDate } from "@/lib/format";
import { PO_FILTER_TABS, type PurchaseOrderDetail, type PurchaseOrderRow } from "@/lib/api/schemas/purchase-orders";
import { PurchaseOrderDetailDrawer } from "./po-detail";
import { CreatePurchaseOrderDrawer } from "./create-purchase-order";

function pct(n: number): string {
  if (!Number.isFinite(n)) return "0%";
  return `${Math.round(n <= 1 ? n * 100 : n)}%`;
}

export function PurchaseOrdersView() {
  const { user } = useSession();
  const admin = isAdmin(user.role);
  const { state, setSearch, setPage, setFilter, cycleSort } = useListParams({
    sortOrder: "desc",
    filter: "all",
    filterKey: "status",
  });

  const filter = state.filter ?? "all";
  const tab = PO_FILTER_TABS.find((t) => t.key === filter) ?? PO_FILTER_TABS[0];

  const query = React.useMemo(
    () => ({
      page: state.page,
      page_size: state.pageSize,
      search: state.search || undefined,
      status: tab.status ?? undefined,
      sort_by: state.sortBy || undefined,
      sort_order: state.sortBy ? state.sortOrder : undefined,
    }),
    [state.page, state.pageSize, state.search, state.sortBy, state.sortOrder, tab.status],
  );

  const { data, isLoading, isFetching, isError, error, refetch } = usePurchaseOrders(query);
  const rows = data?.items ?? [];

  const [selected, setSelected] = React.useState<PurchaseOrderRow | null>(null);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [createOpen, setCreateOpen] = React.useState(false);

  const openRow = (r: PurchaseOrderRow) => {
    setSelected(r);
    setDrawerOpen(true);
  };

  const onCreated = (d: PurchaseOrderDetail) => {
    setCreateOpen(false);
    void refetch();
    setSelected({
      id: d.id,
      po_number: d.po_number,
      supplier_id: d.supplier_id,
      supplier_name: null,
      status: d.status,
      ordered_quantity: "0",
      received_quantity: "0",
      remaining_quantity: "0",
      receiving_pct: 0,
      total_amount: d.total_amount,
      created_at: d.created_at ?? new Date().toISOString(),
      last_receipt_at: null,
      receipt_count: 0,
    });
    setDrawerOpen(true);
  };

  const columns: Column<PurchaseOrderRow>[] = [
    {
      key: "po_number",
      header: "PO number",
      sortField: "po_number",
      cell: (r) => <span className="mono font-medium">{r.po_number ?? `#${r.id}`}</span>,
    },
    {
      key: "supplier",
      header: "Supplier",
      cell: (r) => <span>{r.supplier_name ?? (r.supplier_id != null ? `Supplier #${r.supplier_id}` : "—")}</span>,
    },
    {
      key: "status",
      header: "Status",
      sortField: "status",
      cell: (r) => <StatusBadge status={r.status.toUpperCase()} />,
    },
    {
      key: "ordered",
      header: "Ordered",
      align: "right",
      secondary: true,
      cell: (r) => <QuantityDisplay value={r.ordered_quantity} className="text-[var(--muted)]" />,
    },
    {
      key: "received",
      header: "Received",
      align: "right",
      cell: (r) => <QuantityDisplay value={r.received_quantity} />,
    },
    {
      key: "remaining",
      header: "Remaining",
      align: "right",
      secondary: true,
      cell: (r) => <QuantityDisplay value={r.remaining_quantity} className="text-[var(--muted)]" />,
    },
    {
      key: "progress",
      header: "Received %",
      align: "right",
      cell: (r) => <span className="tnum">{pct(r.receiving_pct)}</span>,
    },
    {
      key: "amount",
      header: "Total",
      align: "right",
      secondary: true,
      cell: (r) => <MoneyDisplay value={r.total_amount} />,
    },
    {
      key: "receipts",
      header: "Receipts",
      align: "right",
      secondary: true,
      cell: (r) => <span className="tnum text-[var(--muted)]">{r.receipt_count}</span>,
    },
    {
      key: "created",
      header: "Created",
      sortField: "created_at",
      secondary: true,
      cell: (r) => <span className="mono text-[var(--muted)]">{formatIsoDate(r.created_at)}</span>,
    },
    {
      key: "last_receipt",
      header: "Last receipt",
      cell: (r) => <span className="mono text-[var(--muted)]">{formatIsoDate(r.last_receipt_at)}</span>,
    },
  ];

  const total = data?.pagination.total_items ?? 0;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Purchase Orders"
        subtitle={data ? `${total} purchase orders · amounts in ฿` : "Loading purchase orders…"}
        actions={
          admin ? (
            <Button variant="primary" onClick={() => setCreateOpen(true)}>
              New purchase order
            </Button>
          ) : undefined
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <FilterStrip
          ariaLabel="Purchase order status filter"
          options={PO_FILTER_TABS.map((t) => ({ key: t.key, label: t.label }))}
          value={filter}
          onChange={setFilter}
        />
        <SearchInput
          value={state.search}
          onCommit={setSearch}
          placeholder="PO number, supplier…"
          ariaLabel="Search purchase orders"
          className="max-w-[320px]"
        />
      </div>

      <DataTable<PurchaseOrderRow>
        columns={columns}
        rows={rows}
        getRowKey={(r) => String(r.id)}
        onRowActivate={openRow}
        isLoading={isLoading}
        isFetching={isFetching}
        error={isError ? error : undefined}
        onRetry={() => void refetch()}
        emptyMessage="No purchase orders match the current filter."
        sort={state.sortBy ? { field: state.sortBy, order: state.sortOrder } : null}
        onSort={cycleSort}
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
          title: <span className="mono">{r.po_number ?? `#${r.id}`}</span>,
          badge: <StatusBadge status={r.status.toUpperCase()} />,
          meta: (
            <>
              <span>{r.supplier_name ?? "—"}</span>
              <span>
                <MoneyDisplay value={r.total_amount} className="font-medium" />
              </span>
              <span>
                {pct(r.receiving_pct)} received · {r.receipt_count} receipt{r.receipt_count === 1 ? "" : "s"}
              </span>
            </>
          ),
        })}
      />

      <PurchaseOrderDetailDrawer row={selected} open={drawerOpen} onOpenChange={setDrawerOpen} role={user.role} />
      {admin ? (
        <CreatePurchaseOrderDrawer open={createOpen} onOpenChange={setCreateOpen} onCreated={onCreated} />
      ) : null}
    </div>
  );
}
