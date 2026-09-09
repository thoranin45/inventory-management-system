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
import { useSalesOrders } from "@/lib/query/sales";
import { formatIsoDate } from "@/lib/format";
import {
  SO_FILTER_TABS,
  type SalesMutationResult,
  type SalesOrderRow,
} from "@/lib/api/schemas/sales";
import { SalesDetailDrawer } from "./sales-detail";
import { CreateSalesOrderDrawer } from "./create-sales-order";

function pct(n: number): string {
  if (!Number.isFinite(n)) return "0%";
  const v = n <= 1 ? n * 100 : n; // tolerate 0–1 or 0–100
  return `${Math.round(v)}%`;
}

export function SalesView() {
  const { user } = useSession();
  const admin = isAdmin(user.role);
  const { state, setSearch, setPage, setFilter, cycleSort } = useListParams({
    sortOrder: "desc",
    filter: "all",
    filterKey: "status",
  });

  const filter = state.filter ?? "all";
  const tab = SO_FILTER_TABS.find((t) => t.key === filter) ?? SO_FILTER_TABS[0];
  const clientOnly = tab.clientOnly;

  // Server tabs paginate normally. The client-only "Attention" tab pulls one
  // large page and filters locally — the backend has no attention filter.
  const query = React.useMemo(
    () => ({
      page: clientOnly ? 1 : state.page,
      page_size: clientOnly ? 100 : state.pageSize,
      search: state.search || undefined,
      status: tab.status ?? undefined,
      sort_by: state.sortBy || undefined,
      sort_order: state.sortBy ? state.sortOrder : undefined,
    }),
    [clientOnly, state.page, state.pageSize, state.search, state.sortBy, state.sortOrder, tab.status],
  );

  const { data, isLoading, isFetching, isError, error, refetch } = useSalesOrders(query);

  const rows = React.useMemo(() => {
    const items = data?.items ?? [];
    return clientOnly ? items.filter((r) => r.attention_reason != null) : items;
  }, [data, clientOnly]);

  const [selected, setSelected] = React.useState<SalesOrderRow | null>(null);
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [createOpen, setCreateOpen] = React.useState(false);

  const openRow = (r: SalesOrderRow) => {
    setSelected(r);
    setDrawerOpen(true);
  };

  const onCreated = (r: SalesMutationResult) => {
    setCreateOpen(false);
    void refetch();
    // Synthesise a minimal row so the detail drawer can open immediately;
    // it merges with the live detail query on mount.
    setSelected({
      id: r.sales_order_id,
      so_number: r.so_number,
      customer_id: null,
      customer_name: null,
      status: r.status,
      item_count: 0,
      total_quantity: "0",
      total_amount: r.total_amount ?? "0",
      created_at: new Date().toISOString(),
      last_activity_at: null,
      picked_pct: 0,
      packed_pct: 0,
      attention_reason: null,
    });
    setDrawerOpen(true);
  };

  const columns: Column<SalesOrderRow>[] = [
    {
      key: "so_number",
      header: "SO number",
      sortField: "so_number",
      cell: (r) => <span className="mono font-medium">{r.so_number ?? `#${r.id}`}</span>,
    },
    {
      key: "customer",
      header: "Customer",
      cell: (r) => <span>{r.customer_name ?? (r.customer_id != null ? `Customer #${r.customer_id}` : "—")}</span>,
    },
    {
      key: "status",
      header: "Status",
      sortField: "status",
      cell: (r) => <StatusBadge status={r.status.toUpperCase()} />,
    },
    {
      key: "items",
      header: "Items",
      align: "right",
      secondary: true,
      cell: (r) => <span className="tnum text-[var(--muted)]">{r.item_count}</span>,
    },
    {
      key: "qty",
      header: "Total qty",
      align: "right",
      secondary: true,
      cell: (r) => <QuantityDisplay value={r.total_quantity} className="text-[var(--muted)]" />,
    },
    {
      key: "amount",
      header: "Total amount",
      align: "right",
      sortField: "total_amount",
      cell: (r) => <MoneyDisplay value={r.total_amount} />,
    },
    {
      key: "progress",
      header: "Pick / pack",
      align: "right",
      secondary: true,
      cell: (r) => (
        <span className="tnum text-[var(--muted)]">
          {pct(r.picked_pct)} / {pct(r.packed_pct)}
        </span>
      ),
    },
    {
      key: "created",
      header: "Created",
      sortField: "created_at",
      secondary: true,
      cell: (r) => <span className="mono text-[var(--muted)]">{formatIsoDate(r.created_at)}</span>,
    },
    {
      key: "attention",
      header: "Attention",
      cell: (r) =>
        r.attention_reason ? (
          <StatusBadge tone="warning" label="Attention" className="capitalize" />
        ) : (
          <span className="text-[var(--faint)]">—</span>
        ),
    },
  ];

  const total = data?.pagination.total_items ?? 0;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Sales Orders"
        subtitle={
          data
            ? clientOnly
              ? `${rows.length} of the first ${data.items.length} orders need attention (client-side filter — the backend has no attention status)`
              : `${total} orders · amounts in ฿ at 2-decimal precision`
            : "Loading sales orders…"
        }
        actions={
          admin ? (
            <Button variant="primary" onClick={() => setCreateOpen(true)}>
              New sales order
            </Button>
          ) : undefined
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <FilterStrip
          ariaLabel="Sales order status filter"
          options={SO_FILTER_TABS.map((t) => ({ key: t.key, label: t.label }))}
          value={filter}
          onChange={setFilter}
        />
        <SearchInput
          value={state.search}
          onCommit={setSearch}
          placeholder="SO number, customer…"
          ariaLabel="Search sales orders"
          className="max-w-[320px]"
        />
      </div>

      {clientOnly ? (
        <p className="text-[11.5px] text-[var(--faint)]">
          “Attention” is computed in the browser from <span className="mono">attention_reason</span> over the first{" "}
          {data?.items.length ?? 0} orders — the backend list endpoint has no server-side attention filter.
        </p>
      ) : null}

      <DataTable<SalesOrderRow>
        columns={columns}
        rows={rows}
        getRowKey={(r) => String(r.id)}
        onRowActivate={openRow}
        isLoading={isLoading}
        isFetching={isFetching}
        error={isError ? error : undefined}
        onRetry={() => void refetch()}
        emptyMessage="No sales orders match the current filter."
        sort={state.sortBy ? { field: state.sortBy, order: state.sortOrder } : null}
        onSort={cycleSort}
        pagination={
          clientOnly || !data
            ? undefined
            : {
                page: data.pagination.page,
                pageSize: data.pagination.page_size,
                totalItems: data.pagination.total_items,
                totalPages: data.pagination.total_pages,
                onPageChange: setPage,
              }
        }
        renderCard={(r) => ({
          title: <span className="mono">{r.so_number ?? `#${r.id}`}</span>,
          badge: <StatusBadge status={r.status.toUpperCase()} />,
          meta: (
            <>
              <span>{r.customer_name ?? "—"}</span>
              <span>
                <MoneyDisplay value={r.total_amount} className="font-medium" />
              </span>
              <span>{r.item_count} items</span>
              {r.attention_reason ? (
                <span className="text-[var(--warning)]">Needs attention</span>
              ) : null}
            </>
          ),
        })}
      />

      <SalesDetailDrawer row={selected} open={drawerOpen} onOpenChange={setDrawerOpen} role={user.role} />
      {admin ? (
        <CreateSalesOrderDrawer open={createOpen} onOpenChange={setCreateOpen} onCreated={onCreated} />
      ) : null}
    </div>
  );
}
