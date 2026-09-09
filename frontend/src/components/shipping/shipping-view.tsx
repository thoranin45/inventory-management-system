"use client";

import * as React from "react";
import Link from "next/link";

import { PageHeader } from "@/components/ui/page-header";
import { SearchInput } from "@/components/ui/search-input";
import { DataTable, type Column } from "@/components/ui/data-table";
import { QuantityDisplay } from "@/components/ui/quantity-display";
import { StatusBadge } from "@/components/ui/status-badge";
import { useSession } from "@/components/session-provider";
import { useSalesOrders } from "@/lib/query/sales";
import { useListParams } from "@/lib/list-params";
import { formatIsoDate } from "@/lib/format";
import { type SalesOrderRow } from "@/lib/api/schemas/sales";
import { SalesDetailDrawer } from "@/components/sales/sales-detail";

function pct(n: number): string {
  if (!Number.isFinite(n)) return "0%";
  return `${Math.round(n <= 1 ? n * 100 : n)}%`;
}

/**
 * Dedicated Ready-to-Ship queue. Only READY_TO_SHIP orders (server `status`
 * filter). A row opens the shared sales detail drawer, which carries the
 * Ship action + the document block. Warehouse + admin both see it (backend
 * `require_warehouse` on ship).
 */
export function ShippingView() {
  const { user } = useSession();
  const { state, setSearch, setPage, cycleSort } = useListParams({ sortOrder: "desc" });

  const query = React.useMemo(
    () => ({
      status: "READY_TO_SHIP",
      page: state.page,
      page_size: state.pageSize,
      search: state.search || undefined,
      sort_by: state.sortBy || undefined,
      sort_order: state.sortBy ? state.sortOrder : undefined,
    }),
    [state.page, state.pageSize, state.search, state.sortBy, state.sortOrder],
  );

  const { data, isLoading, isFetching, isError, error, refetch } = useSalesOrders(query);
  const rows = data?.items ?? [];
  const pg = data?.pagination;

  const [selected, setSelected] = React.useState<SalesOrderRow | null>(null);
  const [open, setOpen] = React.useState(false);

  const columns: Column<SalesOrderRow>[] = [
    { key: "so", header: "SO number", sortField: "so_number", cell: (r) => <span className="mono font-medium">{r.so_number ?? `#${r.id}`}</span> },
    { key: "customer", header: "Customer", cell: (r) => <span>{r.customer_name ?? (r.customer_id != null ? `Customer #${r.customer_id}` : "—")}</span> },
    { key: "items", header: "Lines", align: "right", secondary: true, cell: (r) => <span className="tnum text-[var(--muted)]">{r.item_count}</span> },
    { key: "qty", header: "Total qty", align: "right", cell: (r) => <QuantityDisplay value={r.total_quantity} /> },
    { key: "packed", header: "Packed", align: "right", cell: (r) => <span className="tnum">{pct(r.packed_pct)}</span> },
    { key: "activity", header: "Last activity", sortField: "created_at", secondary: true, cell: (r) => <span className="mono text-[var(--muted)]">{formatIsoDate(r.last_activity_at)}</span> },
    {
      key: "attention",
      header: "Attention",
      cell: (r) => (r.attention_reason ? <StatusBadge tone="warning" label="Attention" /> : <span className="text-[var(--faint)]">—</span>),
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Shipping"
        subtitle={data ? `${pg?.total_items ?? rows.length} order${(pg?.total_items ?? rows.length) === 1 ? "" : "s"} ready to ship` : "Loading…"}
        actions={
          <Link href="/sales" className="text-[12px] font-medium text-[var(--accent)] underline">
            All sales orders
          </Link>
        }
      />

      <SearchInput
        value={state.search}
        onCommit={setSearch}
        placeholder="SO number, customer…"
        ariaLabel="Search ready-to-ship orders"
        className="max-w-[320px]"
      />

      <DataTable<SalesOrderRow>
        columns={columns}
        rows={rows}
        getRowKey={(r) => String(r.id)}
        onRowActivate={(r) => {
          setSelected(r);
          setOpen(true);
        }}
        isLoading={isLoading}
        isFetching={isFetching}
        error={isError ? error : undefined}
        onRetry={() => void refetch()}
        emptyMessage="No orders are ready to ship."
        sort={state.sortBy ? { field: state.sortBy, order: state.sortOrder } : null}
        onSort={cycleSort}
        pagination={
          pg
            ? { page: pg.page, pageSize: pg.page_size, totalItems: pg.total_items, totalPages: pg.total_pages, onPageChange: setPage }
            : undefined
        }
        renderCard={(r) => ({
          title: r.customer_name ?? r.so_number ?? `#${r.id}`,
          badge: r.attention_reason ? <StatusBadge tone="warning" label="Attention" /> : undefined,
          meta: (
            <>
              <span className="mono">{r.so_number}</span>
              <span>
                Qty <QuantityDisplay value={r.total_quantity} className="font-medium" />
              </span>
              <span>Packed {pct(r.packed_pct)}</span>
            </>
          ),
        })}
      />

      <SalesDetailDrawer row={selected} open={open} onOpenChange={setOpen} role={user.role} />
    </div>
  );
}
