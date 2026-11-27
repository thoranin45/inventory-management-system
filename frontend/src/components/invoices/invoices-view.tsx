"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";

import { useSession } from "@/components/session-provider";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FilterStrip } from "@/components/ui/filter-strip";
import { PageHeader } from "@/components/ui/page-header";
import { MoneyDisplay } from "@/components/ui/quantity-display";
import { SearchInput } from "@/components/ui/search-input";
import { EmptyState } from "@/components/ui/states";
import { formatDocDate } from "@/components/quotations/quotation-detail";
import { INVOICE_FILTER_TABS, type InvoiceRow } from "@/lib/api/schemas/invoices";
import { isAdmin } from "@/lib/auth/permissions";
import { useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/translate";
import { useListParams } from "@/lib/list-params";
import { useInvoices } from "@/lib/query/invoices";
import { FinanceStatusBadge } from "./doc-parts";
import { useFinanceDrawers, useOpenFromUrl } from "./finance-drawers";
import { RevenueCard } from "./revenue-card";

const TAB_LABEL: Record<(typeof INVOICE_FILTER_TABS)[number], MessageKey> = {
  all: "orders.tabAll",
  DRAFT: "status.DRAFT",
  ISSUED: "status.ISSUED",
  OVERDUE: "status.OVERDUE",
  VOID: "status.VOID",
};

/** F2b: invoice list (Admin only). Invoices are created from a shipped sales order. */
export function InvoicesView() {
  const t = useT();
  const { user } = useSession();
  const admin = isAdmin(user.role);
  const sp = useSearchParams();
  const { state, setSearch, setPage, setFilter, cycleSort } = useListParams({
    sortOrder: "desc",
    filter: "all",
    filterKey: "status",
  });
  const filter = (INVOICE_FILTER_TABS as readonly string[]).includes(state.filter ?? "") ? state.filter! : "all";
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
  const { data, isLoading, isFetching, isError, error, refetch } = useInvoices(query, admin);
  const { openInvoice, drawers } = useFinanceDrawers();
  useOpenFromUrl(admin ? sp.get("open") : null, openInvoice);

  if (!admin) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title={t("invoices.title")} />
        <EmptyState title={t("invoices.adminsOnlyTitle")} message={t("invoices.adminsOnlyBody")} />
      </div>
    );
  }

  const ref = (r: InvoiceRow) => r.invoice_number ?? t("invoices.draftRef", { id: r.id });
  const columns: Column<InvoiceRow>[] = [
    {
      key: "number",
      header: t("invoices.colNumber"),
      sortField: "invoice_number",
      cell: (r) => <span className="mono font-medium">{ref(r)}</span>,
    },
    { key: "customer", header: t("invoices.customer"), cell: (r) => <span>{r.customer_name ?? "—"}</span> },
    {
      key: "so",
      header: t("invoices.salesOrder"),
      secondary: true,
      cell: (r) => <span className="mono text-[var(--muted)]">{r.sales_order_number ?? `#${r.sales_order_id}`}</span>,
    },
    {
      key: "status",
      header: t("sales.colStatus"),
      sortField: "status",
      cell: (r) => <FinanceStatusBadge status={r.status} overdue={r.is_overdue} />,
    },
    {
      key: "due_date",
      header: t("invoices.dueDate"),
      sortField: "due_date",
      secondary: true,
      cell: (r) => <span className="mono text-[var(--muted)]">{formatDocDate(r.due_date)}</span>,
    },
    {
      key: "total",
      header: t("invoices.grandTotal"),
      sortField: "grand_total",
      align: "right",
      cell: (r) => <MoneyDisplay value={r.grand_total} />,
    },
    {
      key: "balance",
      header: t("invoices.balance"),
      align: "right",
      secondary: true,
      cell: (r) => <MoneyDisplay value={r.balance} />,
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t("invoices.title")}
        subtitle={data ? t("invoices.listSubtitle", { n: data.pagination.total_items }) : t("invoices.loading")}
      />
      <RevenueCard />

      <div className="flex flex-wrap items-center gap-3">
        <FilterStrip
          ariaLabel={t("invoices.filterLabel")}
          options={INVOICE_FILTER_TABS.map((key) => ({ key, label: t(TAB_LABEL[key]) }))}
          value={filter}
          onChange={setFilter}
        />
        <SearchInput
          value={state.search}
          onCommit={setSearch}
          placeholder={t("invoices.searchPlaceholder")}
          ariaLabel={t("invoices.searchLabel")}
          className="max-w-[320px]"
        />
      </div>

      <DataTable<InvoiceRow>
        columns={columns}
        rows={data?.items ?? []}
        getRowKey={(r) => String(r.id)}
        onRowActivate={(r) => openInvoice(r.id)}
        isLoading={isLoading}
        isFetching={isFetching}
        error={isError ? error : undefined}
        onRetry={() => void refetch()}
        emptyMessage={t("invoices.empty")}
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
          title: <span className="mono">{ref(r)}</span>,
          badge: <FinanceStatusBadge status={r.status} overdue={r.is_overdue} />,
          meta: (
            <>
              <span>{r.customer_name ?? "—"}</span>
              <span>
                <MoneyDisplay value={r.grand_total} className="font-medium" />
              </span>
              {r.due_date ? <span>{t("invoices.cardDue", { date: formatDocDate(r.due_date) })}</span> : null}
            </>
          ),
        })}
      />
      {drawers}
    </div>
  );
}
