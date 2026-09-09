"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { PageHeader } from "@/components/ui/page-header";
import { SearchInput } from "@/components/ui/search-input";
import { DataTable, type Column } from "@/components/ui/data-table";
import { QuantityDisplay } from "@/components/ui/quantity-display";
import { StatusBadge } from "@/components/ui/status-badge";
import { useListParams } from "@/lib/list-params";
import { useSalesOrders } from "@/lib/query/sales";
import { formatIsoDate } from "@/lib/format";
import { PICKING_QUEUE_STATUSES, PACKING_QUEUE_STATUSES, type SalesOrderRow } from "@/lib/api/schemas/sales";

function pct(n: number): string {
  if (!Number.isFinite(n)) return "0%";
  return `${Math.round(n <= 1 ? n * 100 : n)}%`;
}

const CFG = {
  pick: {
    title: "Picking queue",
    statuses: PICKING_QUEUE_STATUSES,
    href: (id: number) => `/picking/${id}`,
    blurb: "orders to pick",
  },
  pack: {
    title: "Packing queue",
    statuses: PACKING_QUEUE_STATUSES,
    href: (id: number) => `/packing/${id}`,
    blurb: "orders to verify and pack",
  },
} as const;

export function WorkQueue({ mode }: { mode: "pick" | "pack" }) {
  const cfg = CFG[mode];
  const router = useRouter();
  const { state, setSearch, setPage, cycleSort } = useListParams({ sortOrder: "desc" });

  const query = React.useMemo(
    () => ({
      page: state.page,
      page_size: state.pageSize,
      search: state.search || undefined,
      status: cfg.statuses.join(","),
      sort_by: state.sortBy || undefined,
      sort_order: state.sortBy ? state.sortOrder : undefined,
    }),
    [state.page, state.pageSize, state.search, state.sortBy, state.sortOrder, cfg.statuses],
  );

  const { data, isLoading, isFetching, isError, error, refetch } = useSalesOrders(query);
  const rows = data?.items ?? [];

  const open = (r: SalesOrderRow) => router.push(cfg.href(r.id));

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
      key: "lines",
      header: "Lines",
      align: "right",
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
      key: "picked",
      header: "Picked",
      align: "right",
      cell: (r) => <span className="tnum">{pct(r.picked_pct)}</span>,
    },
    {
      key: "packed",
      header: "Packed",
      align: "right",
      cell: (r) => <span className="tnum">{pct(r.packed_pct)}</span>,
    },
    {
      key: "status",
      header: "Status",
      sortField: "status",
      cell: (r) => <StatusBadge status={r.status.toUpperCase()} />,
    },
    {
      key: "attention",
      header: "Attention",
      cell: (r) =>
        r.attention_reason ? (
          <StatusBadge tone="warning" label="Attention" />
        ) : (
          <span className="text-[var(--faint)]">—</span>
        ),
    },
    {
      key: "activity",
      header: "Last activity",
      sortField: "created_at",
      secondary: true,
      cell: (r) => <span className="mono text-[var(--muted)]">{formatIsoDate(r.last_activity_at ?? r.created_at)}</span>,
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={cfg.title}
        subtitle={
          data
            ? `${data.pagination.total_items} ${cfg.blurb} · tap an order to open the console`
            : `Loading ${cfg.title.toLowerCase()}…`
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <SearchInput
          value={state.search}
          onCommit={setSearch}
          placeholder="SO number, customer…"
          ariaLabel={`Search ${cfg.title.toLowerCase()}`}
          className="max-w-[320px]"
        />
      </div>

      <DataTable<SalesOrderRow>
        columns={columns}
        rows={rows}
        getRowKey={(r) => String(r.id)}
        onRowActivate={open}
        isLoading={isLoading}
        isFetching={isFetching}
        error={isError ? error : undefined}
        onRetry={() => void refetch()}
        emptyMessage={`Nothing in the ${cfg.title.toLowerCase()} right now.`}
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
          title: <span className="mono">{r.so_number ?? `#${r.id}`}</span>,
          badge: <StatusBadge status={r.status.toUpperCase()} />,
          meta: (
            <>
              <span>{r.customer_name ?? "—"}</span>
              <span>{r.item_count} lines</span>
              <span>
                pick {pct(r.picked_pct)} · pack {pct(r.packed_pct)}
              </span>
              {r.attention_reason ? <span className="text-[var(--warning)]">Needs attention</span> : null}
            </>
          ),
        })}
      />
    </div>
  );
}
