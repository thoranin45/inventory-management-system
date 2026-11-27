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
import { ADJUSTMENT_FILTER_TABS, type AdjustmentRow } from "@/lib/api/schemas/invoices";
import { isAdmin } from "@/lib/auth/permissions";
import { useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/translate";
import { useListParams } from "@/lib/list-params";
import { useAdjustments } from "@/lib/query/invoices";
import { FinanceStatusBadge } from "./doc-parts";
import { useFinanceDrawers, useOpenFromUrl } from "./finance-drawers";

const TAB_LABEL: Record<(typeof ADJUSTMENT_FILTER_TABS)[number], MessageKey> = {
  all: "orders.tabAll",
  DRAFT: "status.DRAFT",
  ISSUED: "status.ISSUED",
  VOID: "status.VOID",
};

/** F2b: internal adjustment notes (Admin only). New notes start from an issued invoice. */
export function AdjustmentsView() {
  const t = useT();
  const { user } = useSession();
  const admin = isAdmin(user.role);
  const sp = useSearchParams();
  const { state, setSearch, setPage, setFilter, cycleSort } = useListParams({
    sortOrder: "desc",
    filter: "all",
    filterKey: "status",
  });
  const filter = (ADJUSTMENT_FILTER_TABS as readonly string[]).includes(state.filter ?? "") ? state.filter! : "all";
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
  const { data, isLoading, isFetching, isError, error, refetch } = useAdjustments(query, admin);
  const { openNote, drawers } = useFinanceDrawers();
  useOpenFromUrl(admin ? sp.get("open") : null, openNote);

  if (!admin) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title={t("adjustments.title")} />
        <EmptyState title={t("invoices.adminsOnlyTitle")} message={t("invoices.adminsOnlyBody")} />
      </div>
    );
  }

  const ref = (r: AdjustmentRow) => r.adjustment_number ?? t("adjustments.draftRef", { id: r.id });
  const columns: Column<AdjustmentRow>[] = [
    {
      key: "number",
      header: t("adjustments.colNumber"),
      sortField: "adjustment_number",
      cell: (r) => <span className="mono font-medium">{ref(r)}</span>,
    },
    {
      key: "invoice",
      header: t("adjustments.invoice"),
      cell: (r) => <span className="mono">{r.invoice_number ?? `#${r.invoice_id}`}</span>,
    },
    { key: "customer", header: t("invoices.customer"), secondary: true, cell: (r) => <span>{r.customer_name ?? "—"}</span> },
    { key: "status", header: t("sales.colStatus"), sortField: "status", cell: (r) => <FinanceStatusBadge status={r.status} /> },
    {
      key: "issue_date",
      header: t("invoices.issueDate"),
      sortField: "issue_date",
      secondary: true,
      cell: (r) => <span className="mono text-[var(--muted)]">{formatDocDate(r.issue_date)}</span>,
    },
    {
      key: "total",
      header: t("adjustments.total"),
      sortField: "grand_total",
      align: "right",
      cell: (r) => <MoneyDisplay value={r.grand_total} />,
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t("adjustments.title")}
        subtitle={data ? t("adjustments.listSubtitle", { n: data.pagination.total_items }) : t("adjustments.loading")}
      />
      <p className="text-[12px] text-[var(--muted)]">{t("adjustments.internalNote")}</p>

      <div className="flex flex-wrap items-center gap-3">
        <FilterStrip
          ariaLabel={t("adjustments.filterLabel")}
          options={ADJUSTMENT_FILTER_TABS.map((key) => ({ key, label: t(TAB_LABEL[key]) }))}
          value={filter}
          onChange={setFilter}
        />
        <SearchInput
          value={state.search}
          onCommit={setSearch}
          placeholder={t("adjustments.searchPlaceholder")}
          ariaLabel={t("adjustments.searchLabel")}
          className="max-w-[320px]"
        />
      </div>

      <DataTable<AdjustmentRow>
        columns={columns}
        rows={data?.items ?? []}
        getRowKey={(r) => String(r.id)}
        onRowActivate={(r) => openNote(r.id)}
        isLoading={isLoading}
        isFetching={isFetching}
        error={isError ? error : undefined}
        onRetry={() => void refetch()}
        emptyMessage={t("adjustments.empty")}
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
              <span className="mono">{r.invoice_number ?? `#${r.invoice_id}`}</span>
              <span>
                <MoneyDisplay value={r.grand_total} className="font-medium" />
              </span>
              <span>{r.reason}</span>
            </>
          ),
        })}
      />
      {drawers}
    </div>
  );
}
