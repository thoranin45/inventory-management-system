"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { PageHeader } from "@/components/ui/page-header";
import { SearchInput } from "@/components/ui/search-input";
import { DataTable, type Column } from "@/components/ui/data-table";
import { LocalDate } from "@/components/ui/local-date";
import { QuantityDisplay } from "@/components/ui/quantity-display";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatProgressPercent, soPackingComplete, soPickingComplete } from "@/lib/format-percent";
import { useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/translate";
import { useListParams } from "@/lib/list-params";
import { useSalesOrders } from "@/lib/query/sales";
import { PICKING_QUEUE_STATUSES, PACKING_QUEUE_STATUSES, type SalesOrderRow } from "@/lib/api/schemas/sales";

const CFG = {
  pick: { k: "Pick", statuses: PICKING_QUEUE_STATUSES, href: (id: number) => `/picking/${id}` },
  pack: { k: "Pack", statuses: PACKING_QUEUE_STATUSES, href: (id: number) => `/packing/${id}` },
} as const;

export function WorkQueue({ mode }: { mode: "pick" | "pack" }) {
  const t = useT();
  const cfg = CFG[mode];
  const mk = (base: string) => `${base}${cfg.k}` as MessageKey;
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
  const picked = (r: SalesOrderRow) => formatProgressPercent(r.picked_pct, soPickingComplete(r.status));
  const packed = (r: SalesOrderRow) => formatProgressPercent(r.packed_pct, soPackingComplete(r.status));

  const columns: Column<SalesOrderRow>[] = [
    {
      key: "so_number",
      header: t("sales.colSoNumber"),
      sortField: "so_number",
      cell: (r) => <span className="mono font-medium">{r.so_number ?? `#${r.id}`}</span>,
    },
    {
      key: "customer",
      header: t("sales.customer"),
      cell: (r) => <span>{r.customer_name ?? (r.customer_id != null ? t("sales.customerRef", { id: r.customer_id }) : "—")}</span>,
    },
    { key: "lines", header: t("orders.lines"), align: "right", cell: (r) => <span className="tnum text-[var(--muted)]">{r.item_count}</span> },
    {
      key: "qty",
      header: t("sales.colTotalQty"),
      align: "right",
      secondary: true,
      cell: (r) => <QuantityDisplay value={r.total_quantity} className="text-[var(--muted)]" />,
    },
    { key: "picked", header: t("fulfil.colPicked"), align: "right", cell: (r) => <span className="tnum">{picked(r)}</span> },
    { key: "packed", header: t("fulfil.colPacked"), align: "right", cell: (r) => <span className="tnum">{packed(r)}</span> },
    { key: "status", header: t("sales.colStatus"), sortField: "status", cell: (r) => <StatusBadge status={r.status.toUpperCase()} /> },
    {
      key: "attention",
      header: t("orders.tabAttention"),
      cell: (r) =>
        r.attention_reason ? <StatusBadge tone="warning" label={t("orders.tabAttention")} /> : <span className="text-[var(--faint)]">—</span>,
    },
    {
      key: "activity",
      header: t("sales.lastActivity"),
      sortField: "created_at",
      secondary: true,
      cell: (r) => (
        <span className="mono text-[var(--muted)]">
          <LocalDate iso={r.last_activity_at ?? r.created_at} isoInEnglish />
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t(mk("fulfil.queueTitle"))}
        subtitle={data ? t(mk("fulfil.queueSubtitle"), { n: data.pagination.total_items }) : t(mk("fulfil.loadingQueueInline"))}
      />

      <div className="flex flex-wrap items-center gap-3">
        <SearchInput
          value={state.search}
          onCommit={setSearch}
          placeholder={t("sales.searchPlaceholder")}
          ariaLabel={t(mk("fulfil.queueSearchLabel"))}
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
        emptyMessage={t(mk("fulfil.queueEmpty"))}
        sort={state.sortBy ? { field: state.sortBy, order: state.sortOrder } : null}
        onSort={cycleSort}
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
          title: <span className="mono">{r.so_number ?? `#${r.id}`}</span>,
          badge: <StatusBadge status={r.status.toUpperCase()} />,
          meta: (
            <>
              <span>{r.customer_name ?? "—"}</span>
              <span>{t("fulfil.linesCount", { n: r.item_count })}</span>
              <span>{t("fulfil.cardProgress", { picked: picked(r), packed: packed(r) })}</span>
              {r.attention_reason ? <span className="text-[var(--warning)]">{t("sales.needsAttention")}</span> : null}
            </>
          ),
        })}
      />
    </div>
  );
}
