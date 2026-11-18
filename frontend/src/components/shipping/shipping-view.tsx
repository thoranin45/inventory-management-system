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
import { formatProgressPercent, soPackingComplete } from "@/lib/format-percent";
import { useT } from "@/lib/i18n/client";
import { type SalesOrderRow } from "@/lib/api/schemas/sales";
import { SalesDetailDrawer } from "@/components/sales/sales-detail";

/**
 * Dedicated Ready-to-Ship queue. Only READY_TO_SHIP orders (server `status`
 * filter). A row opens the shared sales detail drawer, which carries the
 * Ship action + the document block. Warehouse + admin both see it (backend
 * `require_warehouse` on ship).
 */
export function ShippingView() {
  const t = useT();
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
  const total = pg?.total_items ?? rows.length;

  const [selected, setSelected] = React.useState<SalesOrderRow | null>(null);
  const [open, setOpen] = React.useState(false);

  const packed = (r: SalesOrderRow) => formatProgressPercent(r.packed_pct, soPackingComplete(r.status));

  const columns: Column<SalesOrderRow>[] = [
    { key: "so", header: t("sales.colSoNumber"), sortField: "so_number", cell: (r) => <span className="mono font-medium">{r.so_number ?? `#${r.id}`}</span> },
    {
      key: "customer",
      header: t("sales.customer"),
      cell: (r) => <span>{r.customer_name ?? (r.customer_id != null ? t("sales.customerRef", { id: r.customer_id }) : "—")}</span>,
    },
    { key: "items", header: t("orders.lines"), align: "right", secondary: true, cell: (r) => <span className="tnum text-[var(--muted)]">{r.item_count}</span> },
    { key: "qty", header: t("sales.colTotalQty"), align: "right", cell: (r) => <QuantityDisplay value={r.total_quantity} /> },
    { key: "packed", header: t("fulfil.colPacked"), align: "right", cell: (r) => <span className="tnum">{packed(r)}</span> },
    {
      key: "activity",
      header: t("sales.lastActivity"),
      sortField: "created_at",
      secondary: true,
      cell: (r) => <span className="mono text-[var(--muted)]">{formatIsoDate(r.last_activity_at)}</span>,
    },
    {
      key: "attention",
      header: t("orders.tabAttention"),
      cell: (r) =>
        r.attention_reason ? <StatusBadge tone="warning" label={t("orders.tabAttention")} /> : <span className="text-[var(--faint)]">—</span>,
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t("ship.title")}
        subtitle={data ? t(total === 1 ? "ship.subtitleOne" : "ship.subtitleMany", { n: total }) : t("ship.loadingInline")}
        actions={
          <Link href="/sales" className="inline-flex min-h-11 items-center text-[13px] font-medium text-[var(--accent)] underline min-[1024px]:min-h-0">
            {t("ship.allSales")}
          </Link>
        }
      />

      <SearchInput
        value={state.search}
        onCommit={setSearch}
        placeholder={t("sales.searchPlaceholder")}
        ariaLabel={t("ship.searchLabel")}
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
        emptyMessage={t("ship.empty")}
        sort={state.sortBy ? { field: state.sortBy, order: state.sortOrder } : null}
        onSort={cycleSort}
        tabletLayout="table"
        pagination={
          pg
            ? { page: pg.page, pageSize: pg.page_size, totalItems: pg.total_items, totalPages: pg.total_pages, onPageChange: setPage }
            : undefined
        }
        renderCard={(r) => ({
          title: r.customer_name ?? r.so_number ?? `#${r.id}`,
          badge: r.attention_reason ? <StatusBadge tone="warning" label={t("orders.tabAttention")} /> : undefined,
          meta: (
            <>
              <span className="mono">{r.so_number}</span>
              <span>
                {t("ship.cardQty")} <QuantityDisplay value={r.total_quantity} className="font-medium" />
              </span>
              <span>{t("ship.cardPacked", { pct: packed(r) })}</span>
            </>
          ),
        })}
      />

      <SalesDetailDrawer row={selected} open={open} onOpenChange={setOpen} role={user.role} />
    </div>
  );
}
