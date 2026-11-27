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
import { BILLING_FILTER_TABS, type BillingRow } from "@/lib/api/schemas/payments";
import { isAdmin } from "@/lib/auth/permissions";
import { useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/translate";
import { useListParams } from "@/lib/list-params";
import { useBillingNotes } from "@/lib/query/payments";

const TAB_LABEL: Record<(typeof BILLING_FILTER_TABS)[number], MessageKey> = {
  all: "orders.tabAll",
  DRAFT: "status.DRAFT",
  ISSUED: "status.ISSUED",
  VOID: "status.VOID",
};

/** F3b: billing notes (Admin only). Informational: they never change invoice balances. */
export function BillingView() {
  const t = useT();
  const { user } = useSession();
  const admin = isAdmin(user.role);
  const sp = useSearchParams();
  const { state, setSearch, setPage, setFilter, cycleSort } = useListParams({
    sortOrder: "desc",
    filter: "all",
    filterKey: "status",
  });
  const filter = (BILLING_FILTER_TABS as readonly string[]).includes(state.filter ?? "") ? state.filter! : "all";
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
  const { data, isLoading, isFetching, isError, error, refetch } = useBillingNotes(query, admin);
  const { openBilling, openBillingForm, drawers } = useFinanceDrawers();
  useOpenFromUrl(admin ? sp.get("open") : null, openBilling);

  if (!admin) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title={t("billing.title")} />
        <EmptyState title={t("invoices.adminsOnlyTitle")} message={t("invoices.adminsOnlyBody")} />
      </div>
    );
  }

  const ref = (r: BillingRow) => r.billing_number ?? t("billing.draftRef", { id: r.id });
  const columns: Column<BillingRow>[] = [
    {
      key: "number",
      header: t("billing.colNumber"),
      sortField: "billing_number",
      cell: (r) => <span className="mono font-medium">{ref(r)}</span>,
    },
    { key: "customer", header: t("payments.customer"), cell: (r) => <span>{r.customer_name ?? "—"}</span> },
    {
      key: "issue_date",
      header: t("invoices.issueDate"),
      sortField: "issue_date",
      secondary: true,
      cell: (r) => <span className="mono text-[var(--muted)]">{formatDocDate(r.issue_date)}</span>,
    },
    { key: "count", header: t("billing.colInvoices"), secondary: true, align: "right", cell: (r) => <span>{r.invoice_count}</span> },
    { key: "status", header: t("sales.colStatus"), sortField: "status", cell: (r) => <FinanceStatusBadge status={r.status} /> },
    {
      key: "total",
      header: t("billing.total"),
      sortField: "total_amount",
      align: "right",
      cell: (r) => <MoneyDisplay value={r.total_amount} />,
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t("billing.title")}
        subtitle={data ? t("billing.listSubtitle", { n: data.pagination.total_items }) : t("billing.loading")}
        actions={<Button variant="primary" onClick={() => openBillingForm(null)}>{t("billing.newTitle")}</Button>}
      />
      <div className="flex flex-wrap items-center gap-3">
        <FilterStrip
          ariaLabel={t("billing.filterLabel")}
          options={BILLING_FILTER_TABS.map((key) => ({ key, label: t(TAB_LABEL[key]) }))}
          value={filter}
          onChange={setFilter}
        />
        <SearchInput
          value={state.search}
          onCommit={setSearch}
          placeholder={t("billing.searchPlaceholder")}
          ariaLabel={t("billing.searchLabel")}
          className="max-w-[320px]"
        />
      </div>
      <DataTable<BillingRow>
        columns={columns}
        rows={data?.items ?? []}
        getRowKey={(r) => String(r.id)}
        onRowActivate={(r) => openBilling(r.id)}
        isLoading={isLoading}
        isFetching={isFetching}
        error={isError ? error : undefined}
        onRetry={() => void refetch()}
        emptyMessage={t("billing.empty")}
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
          badge: <FinanceStatusBadge status={r.status} />,
          meta: (
            <>
              <span>{r.customer_name ?? "—"}</span>
              <span>
                <MoneyDisplay value={r.total_amount} className="font-medium" />
              </span>
            </>
          ),
        })}
      />
      {drawers}
    </div>
  );
}
