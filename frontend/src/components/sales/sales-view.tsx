"use client";

import * as React from "react";

import { PageHeader } from "@/components/ui/page-header";
import { FilterStrip } from "@/components/ui/filter-strip";
import { SearchInput } from "@/components/ui/search-input";
import { DataTable, type Column } from "@/components/ui/data-table";
import { LocalDate } from "@/components/ui/local-date";
import { MoneyDisplay, QuantityDisplay } from "@/components/ui/quantity-display";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { useSession } from "@/components/session-provider";
import { isAdmin } from "@/lib/auth/permissions";
import { formatProgressPercent, soPackingComplete, soPickingComplete } from "@/lib/format-percent";
import { useT } from "@/lib/i18n/client";
import { useListParams } from "@/lib/list-params";
import { filterTabKey } from "@/lib/order-copy";
import { useSalesOrders } from "@/lib/query/sales";
import { SO_FILTER_TABS, type SalesMutationResult, type SalesOrderRow } from "@/lib/api/schemas/sales";
import { SalesDetailDrawer } from "./sales-detail";
import { CreateSalesOrderDrawer } from "./create-sales-order";

export function SalesView() {
  const t = useT();
  const { user } = useSession();
  const admin = isAdmin(user.role);
  const { state, setSearch, setPage, setFilter, cycleSort } = useListParams({
    sortOrder: "desc",
    filter: "all",
    filterKey: "status",
  });

  const filter = state.filter ?? "all";
  const tab = SO_FILTER_TABS.find((x) => x.key === filter) ?? SO_FILTER_TABS[0];
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
  // The drawer shows the live list row once the list has it: a row synthesised
  // right after a create (no customer/supplier name, zero totals) is replaced
  // as soon as the refetch lands, and status changes flow in the same way.
  const liveSelected = React.useMemo(
    () => (selected ? (rows.find((r) => r.id === selected.id) ?? selected) : null),
    [rows, selected],
  );
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

  const customer = (r: SalesOrderRow) => r.customer_name ?? (r.customer_id != null ? t("sales.customerRef", { id: r.customer_id }) : "—");
  const progress = (r: SalesOrderRow) =>
    `${formatProgressPercent(r.picked_pct, soPickingComplete(r.status))} / ${formatProgressPercent(r.packed_pct, soPackingComplete(r.status))}`;

  const columns: Column<SalesOrderRow>[] = [
    {
      key: "so_number",
      header: t("sales.colSoNumber"),
      sortField: "so_number",
      cell: (r) => <span className="mono font-medium">{r.so_number ?? `#${r.id}`}</span>,
    },
    { key: "customer", header: t("sales.customer"), cell: (r) => <span>{customer(r)}</span> },
    {
      key: "status",
      header: t("sales.colStatus"),
      sortField: "status",
      cell: (r) => <StatusBadge status={r.status.toUpperCase()} />,
    },
    {
      key: "items",
      header: t("sales.items"),
      align: "right",
      secondary: true,
      cell: (r) => <span className="tnum text-[var(--muted)]">{r.item_count}</span>,
    },
    {
      key: "qty",
      header: t("sales.colTotalQty"),
      align: "right",
      secondary: true,
      cell: (r) => <QuantityDisplay value={r.total_quantity} className="text-[var(--muted)]" />,
    },
    {
      key: "amount",
      header: t("sales.totalAmount"),
      align: "right",
      sortField: "total_amount",
      cell: (r) => <MoneyDisplay value={r.total_amount} />,
    },
    {
      key: "progress",
      header: t("sales.colPickPack"),
      align: "right",
      secondary: true,
      cell: (r) => <span className="tnum text-[var(--muted)]">{progress(r)}</span>,
    },
    {
      key: "created",
      header: t("sales.created"),
      sortField: "created_at",
      secondary: true,
      cell: (r) => (
        <span className="mono whitespace-nowrap text-[var(--muted)]">
          <LocalDate iso={r.created_at} isoInEnglish />
        </span>
      ),
    },
    {
      key: "attention",
      header: t("orders.tabAttention"),
      cell: (r) =>
        r.attention_reason ? <StatusBadge tone="warning" label={t("orders.tabAttention")} /> : <span className="text-[var(--faint)]">—</span>,
    },
  ];

  const total = data?.pagination.total_items ?? 0;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t("sales.title")}
        subtitle={
          data
            ? clientOnly
              ? t("sales.attentionSubtitle", { n: rows.length, total: data.items.length })
              : t("sales.listSubtitle", { n: total })
            : t("sales.loadingList")
        }
        actions={
          admin ? (
            <Button variant="primary" onClick={() => setCreateOpen(true)}>
              {t("sales.newOrder")}
            </Button>
          ) : undefined
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <FilterStrip
          ariaLabel={t("sales.filterLabel")}
          options={SO_FILTER_TABS.map((x) => ({ key: x.key, label: t(filterTabKey(x.key)) }))}
          value={filter}
          onChange={setFilter}
        />
        <SearchInput
          value={state.search}
          onCommit={setSearch}
          placeholder={t("sales.searchPlaceholder")}
          ariaLabel={t("sales.searchLabel")}
          className="max-w-[320px]"
        />
      </div>

      {clientOnly ? <p className="text-[12px] text-[var(--faint)]">{t("sales.attentionNote", { n: data?.items.length ?? 0 })}</p> : null}

      <DataTable<SalesOrderRow>
        columns={columns}
        rows={rows}
        getRowKey={(r) => String(r.id)}
        onRowActivate={openRow}
        isLoading={isLoading}
        isFetching={isFetching}
        error={isError ? error : undefined}
        onRetry={() => void refetch()}
        emptyMessage={t("sales.empty")}
        sort={state.sortBy ? { field: state.sortBy, order: state.sortOrder } : null}
        onSort={cycleSort}
        tabletLayout="table"
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
              <span>{t("sales.itemsCount", { n: r.item_count })}</span>
              <span>
                {t("sales.colPickPack")} {progress(r)}
              </span>
              {r.attention_reason ? <span className="text-[var(--warning)]">{t("sales.needsAttention")}</span> : null}
            </>
          ),
        })}
      />

      <SalesDetailDrawer row={liveSelected} open={drawerOpen} onOpenChange={setDrawerOpen} role={user.role} />
      {admin ? <CreateSalesOrderDrawer open={createOpen} onOpenChange={setCreateOpen} onCreated={onCreated} /> : null}
    </div>
  );
}
