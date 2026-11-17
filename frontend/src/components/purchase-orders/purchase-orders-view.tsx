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
import { formatProgressPercent, poReceivingComplete } from "@/lib/format-percent";
import { useT } from "@/lib/i18n/client";
import { useListParams } from "@/lib/list-params";
import { filterTabKey } from "@/lib/order-copy";
import { usePurchaseOrders } from "@/lib/query/purchase-orders";
import { PO_FILTER_TABS, type PurchaseOrderDetail, type PurchaseOrderRow } from "@/lib/api/schemas/purchase-orders";
import { PurchaseOrderDetailDrawer } from "./po-detail";
import { CreatePurchaseOrderDrawer } from "./create-purchase-order";

export function PurchaseOrdersView() {
  const t = useT();
  const { user } = useSession();
  const admin = isAdmin(user.role);
  const { state, setSearch, setPage, setFilter, cycleSort } = useListParams({
    sortOrder: "desc",
    filter: "all",
    filterKey: "status",
  });

  const filter = state.filter ?? "all";
  const tab = PO_FILTER_TABS.find((x) => x.key === filter) ?? PO_FILTER_TABS[0];

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

  const received = (r: PurchaseOrderRow) => formatProgressPercent(r.receiving_pct, poReceivingComplete(r.status));

  const columns: Column<PurchaseOrderRow>[] = [
    {
      key: "po_number",
      header: t("po.colPoNumber"),
      sortField: "po_number",
      cell: (r) => <span className="mono font-medium">{r.po_number ?? `#${r.id}`}</span>,
    },
    {
      key: "supplier",
      header: t("po.supplier"),
      cell: (r) => <span>{r.supplier_name ?? (r.supplier_id != null ? t("po.supplierRef", { id: r.supplier_id }) : "—")}</span>,
    },
    { key: "status", header: t("sales.colStatus"), sortField: "status", cell: (r) => <StatusBadge status={r.status.toUpperCase()} /> },
    {
      key: "ordered",
      header: t("receive.ordered"),
      align: "right",
      secondary: true,
      cell: (r) => <QuantityDisplay value={r.ordered_quantity} className="text-[var(--muted)]" />,
    },
    { key: "received", header: t("receive.received"), align: "right", cell: (r) => <QuantityDisplay value={r.received_quantity} /> },
    {
      key: "remaining",
      header: t("receive.outstanding"),
      align: "right",
      secondary: true,
      cell: (r) => <QuantityDisplay value={r.remaining_quantity} className="text-[var(--muted)]" />,
    },
    { key: "progress", header: t("po.colReceivedPct"), align: "right", cell: (r) => <span className="tnum">{received(r)}</span> },
    { key: "amount", header: t("po.total"), align: "right", secondary: true, cell: (r) => <MoneyDisplay value={r.total_amount} /> },
    {
      key: "receipts",
      header: t("po.colReceipts"),
      align: "right",
      secondary: true,
      cell: (r) => <span className="tnum text-[var(--muted)]">{r.receipt_count}</span>,
    },
    {
      key: "created",
      header: t("sales.created"),
      sortField: "created_at",
      secondary: true,
      cell: (r) => (
        <span className="mono text-[var(--muted)]">
          <LocalDate iso={r.created_at} isoInEnglish />
        </span>
      ),
    },
    {
      key: "last_receipt",
      header: t("po.lastReceipt"),
      cell: (r) => (
        <span className="mono text-[var(--muted)]">
          <LocalDate iso={r.last_receipt_at} isoInEnglish />
        </span>
      ),
    },
  ];

  const total = data?.pagination.total_items ?? 0;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t("po.title")}
        subtitle={data ? t("po.listSubtitle", { n: total }) : t("po.loadingList")}
        actions={
          admin ? (
            <Button variant="primary" onClick={() => setCreateOpen(true)}>
              {t("po.newOrder")}
            </Button>
          ) : undefined
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <FilterStrip
          ariaLabel={t("po.filterLabel")}
          options={PO_FILTER_TABS.map((x) => ({ key: x.key, label: t(filterTabKey(x.key)) }))}
          value={filter}
          onChange={setFilter}
        />
        <SearchInput
          value={state.search}
          onCommit={setSearch}
          placeholder={t("po.searchPlaceholder")}
          ariaLabel={t("po.searchLabel")}
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
        emptyMessage={t("po.empty")}
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
          title: <span className="mono">{r.po_number ?? `#${r.id}`}</span>,
          badge: <StatusBadge status={r.status.toUpperCase()} />,
          meta: (
            <>
              <span>{r.supplier_name ?? "—"}</span>
              <span>
                <MoneyDisplay value={r.total_amount} className="font-medium" />
              </span>
              <span>
                {t(r.receipt_count === 1 ? "po.cardReceipt" : "po.cardReceipts", { pct: received(r), n: r.receipt_count })}
              </span>
            </>
          ),
        })}
      />

      <PurchaseOrderDetailDrawer row={selected} open={drawerOpen} onOpenChange={setDrawerOpen} role={user.role} />
      {admin ? <CreatePurchaseOrderDrawer open={createOpen} onOpenChange={setCreateOpen} onCreated={onCreated} /> : null}
    </div>
  );
}
