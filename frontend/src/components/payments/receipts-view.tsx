"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";

import { useSession } from "@/components/session-provider";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FilterStrip } from "@/components/ui/filter-strip";
import { PageHeader } from "@/components/ui/page-header";
import { MoneyDisplay } from "@/components/ui/quantity-display";
import { SearchInput } from "@/components/ui/search-input";
import { EmptyState } from "@/components/ui/states";
import { formatDocDate } from "@/components/quotations/quotation-detail";
import { FinanceStatusBadge } from "@/components/invoices/doc-parts";
import { useFinanceDrawers, useOpenFromUrl } from "@/components/invoices/finance-drawers";
import { RECEIPT_FILTER_TABS, type ReceiptRow } from "@/lib/api/schemas/payments";
import { isAdmin } from "@/lib/auth/permissions";
import { useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/translate";
import { useListParams } from "@/lib/list-params";
import { useReceipts } from "@/lib/query/payments";
import { methodLabel } from "./payment-parts";

const TAB_LABEL: Record<(typeof RECEIPT_FILTER_TABS)[number], MessageKey> = {
  all: "orders.tabAll",
  ISSUED: "status.ISSUED",
  VOID: "status.VOID",
};

/** F3b: payment receipts (Admin only). A receipt is issued as soon as it is recorded. */
export function ReceiptsView() {
  const t = useT();
  const { user } = useSession();
  const admin = isAdmin(user.role);
  const sp = useSearchParams();
  const { state, setSearch, setPage, setFilter, cycleSort } = useListParams({
    sortOrder: "desc",
    filter: "all",
    filterKey: "status",
  });
  const filter = (RECEIPT_FILTER_TABS as readonly string[]).includes(state.filter ?? "") ? state.filter! : "all";
  const query = React.useMemo(
    () => ({
      page: state.page,
      page_size: state.pageSize,
      search: state.search || undefined,
      status: filter === "all" ? undefined : filter,
      sort_by: state.sortBy || undefined,
      sort_order: state.sortBy ? state.sortOrder : undefined,
    }),
    [state.page, state.pageSize, state.search, state.sortBy, state.sortOrder, filter],
  );
  const { data, isLoading, isFetching, isError, error, refetch } = useReceipts(query, admin);
  const { openReceipt, openPayment, drawers } = useFinanceDrawers();
  useOpenFromUrl(admin ? sp.get("open") : null, openReceipt);

  if (!admin) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title={t("payments.title")} />
        <EmptyState title={t("invoices.adminsOnlyTitle")} message={t("invoices.adminsOnlyBody")} />
      </div>
    );
  }

  const columns: Column<ReceiptRow>[] = [
    {
      key: "number",
      header: t("payments.colNumber"),
      sortField: "receipt_number",
      cell: (r) => <span className="mono font-medium">{r.receipt_number}</span>,
    },
    { key: "customer", header: t("payments.customer"), cell: (r) => <span>{r.customer_name ?? "—"}</span> },
    {
      key: "date",
      header: t("payments.receivedDate"),
      sortField: "received_date",
      secondary: true,
      cell: (r) => <span className="mono text-[var(--muted)]">{formatDocDate(r.received_date)}</span>,
    },
    { key: "method", header: t("payments.method"), secondary: true, cell: (r) => <span>{methodLabel(t, r.method)}</span> },
    { key: "status", header: t("sales.colStatus"), sortField: "status", cell: (r) => <FinanceStatusBadge status={r.status} /> },
    {
      key: "amount",
      header: t("payments.cashReceived"),
      sortField: "settled_total",
      align: "right",
      cell: (r) => <MoneyDisplay value={r.amount_total} />,
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t("payments.title")}
        subtitle={data ? t("payments.listSubtitle", { n: data.pagination.total_items }) : t("payments.loading")}
        actions={<Button variant="primary" onClick={() => openPayment(null)}>{t("payments.recordPayment")}</Button>}
      />
      <div className="flex flex-wrap items-center gap-3">
        <FilterStrip
          ariaLabel={t("payments.filterLabel")}
          options={RECEIPT_FILTER_TABS.map((key) => ({ key, label: t(TAB_LABEL[key]) }))}
          value={filter}
          onChange={setFilter}
        />
        <SearchInput
          value={state.search}
          onCommit={setSearch}
          placeholder={t("payments.searchPlaceholder")}
          ariaLabel={t("payments.searchLabel")}
          className="max-w-[320px]"
        />
      </div>
      <DataTable<ReceiptRow>
        columns={columns}
        rows={data?.items ?? []}
        getRowKey={(r) => String(r.id)}
        onRowActivate={(r) => openReceipt(r.id)}
        isLoading={isLoading}
        isFetching={isFetching}
        error={isError ? error : undefined}
        onRetry={() => void refetch()}
        emptyMessage={t("payments.empty")}
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
          title: <span className="mono">{r.receipt_number}</span>,
          badge: <FinanceStatusBadge status={r.status} />,
          meta: (
            <>
              <span>{r.customer_name ?? "—"}</span>
              <span>
                <MoneyDisplay value={r.amount_total} className="font-medium" />
              </span>
              <span>{formatDocDate(r.received_date)}</span>
            </>
          ),
        })}
      />
      {drawers}
    </div>
  );
}
