"use client";

import * as React from "react";

import { useSession } from "@/components/session-provider";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FilterStrip } from "@/components/ui/filter-strip";
import { PageHeader } from "@/components/ui/page-header";
import { MoneyDisplay } from "@/components/ui/quantity-display";
import { SearchInput } from "@/components/ui/search-input";
import { EmptyState } from "@/components/ui/states";
import { QUOTATION_FILTER_TABS, type QuotationDetail, type QuotationRow } from "@/lib/api/schemas/quotations";
import { isAdmin } from "@/lib/auth/permissions";
import { useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/translate";
import { useListParams } from "@/lib/list-params";
import { useQuotations } from "@/lib/query/quotations";
import { formatDocDate, QuotationDetailDrawer } from "./quotation-detail";
import { QuotationFormDrawer } from "./quotation-form";
import { QuotationStatusBadge } from "./quotation-status";

const TAB_LABEL: Record<(typeof QUOTATION_FILTER_TABS)[number], MessageKey> = {
  all: "orders.tabAll",
  DRAFT: "status.DRAFT",
  ISSUED: "status.ISSUED",
  EXPIRED: "status.EXPIRED",
  ACCEPTED: "status.ACCEPTED",
  CONVERTED: "status.CONVERTED",
  REJECTED: "status.REJECTED",
  VOID: "status.VOID",
};

/** F1b: quotation list (Admin only: finance is Admin-only, Owner 26 Nov). */
export function QuotationsView() {
  const t = useT();
  const { user } = useSession();
  const admin = isAdmin(user.role);
  const { state, setSearch, setPage, setFilter, cycleSort } = useListParams({
    sortOrder: "desc",
    filter: "all",
    filterKey: "status",
  });
  const filter = (QUOTATION_FILTER_TABS as readonly string[]).includes(state.filter ?? "") ? state.filter! : "all";

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
  const { data, isLoading, isFetching, isError, error, refetch } = useQuotations(query, admin);

  const [detailId, setDetailId] = React.useState<number | null>(null);
  const [detailOpen, setDetailOpen] = React.useState(false);
  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<QuotationDetail | null>(null);

  const openDetail = (id: number) => {
    setDetailId(id);
    setDetailOpen(true);
  };
  const openForm = (draft: QuotationDetail | null) => {
    setEditing(draft);
    setDetailOpen(false);
    setFormOpen(true);
  };
  const onSaved = (d: QuotationDetail) => {
    setFormOpen(false);
    openDetail(d.id);
  };
  const openOther = (id: number, draft?: QuotationDetail) => {
    if (draft && draft.status === "DRAFT") openForm(draft);
    else openDetail(id);
  };

  if (!admin) {
    return (
      <div className="flex flex-col gap-5">
        <PageHeader title={t("quotations.title")} />
        <EmptyState title={t("quotations.adminsOnlyTitle")} message={t("quotations.adminsOnlyBody")} />
      </div>
    );
  }

  const rows = data?.items ?? [];
  const columns: Column<QuotationRow>[] = [
    {
      key: "number",
      header: t("quotations.colNumber"),
      sortField: "quotation_number",
      cell: (r) => <span className="mono font-medium">{r.quotation_number ?? t("quotations.draftRef", { id: r.id })}</span>,
    },
    { key: "customer", header: t("quotations.customer"), cell: (r) => <span>{r.customer_name ?? "—"}</span> },
    {
      key: "status",
      header: t("sales.colStatus"),
      sortField: "status",
      cell: (r) => <QuotationStatusBadge status={r.status} isExpired={r.is_expired} />,
    },
    {
      key: "issue_date",
      header: t("quotations.issueDate"),
      sortField: "issue_date",
      secondary: true,
      cell: (r) => <span className="mono text-[var(--muted)]">{formatDocDate(r.issue_date)}</span>,
    },
    {
      key: "valid_until",
      header: t("quotations.validUntil"),
      secondary: true,
      cell: (r) => <span className="mono text-[var(--muted)]">{formatDocDate(r.valid_until)}</span>,
    },
    {
      key: "total",
      header: t("quotations.grandTotal"),
      sortField: "grand_total",
      align: "right",
      cell: (r) => <MoneyDisplay value={r.grand_total} />,
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t("quotations.title")}
        subtitle={data ? t("quotations.listSubtitle", { n: data.pagination.total_items }) : t("quotations.loading")}
        actions={
          <Button variant="primary" onClick={() => openForm(null)}>
            {t("quotations.newQuotation")}
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <FilterStrip
          ariaLabel={t("quotations.filterLabel")}
          options={QUOTATION_FILTER_TABS.map((key) => ({ key, label: t(TAB_LABEL[key]) }))}
          value={filter}
          onChange={setFilter}
        />
        <SearchInput
          value={state.search}
          onCommit={setSearch}
          placeholder={t("quotations.searchPlaceholder")}
          ariaLabel={t("quotations.searchLabel")}
          className="max-w-[320px]"
        />
      </div>

      <DataTable<QuotationRow>
        columns={columns}
        rows={rows}
        getRowKey={(r) => String(r.id)}
        onRowActivate={(r) => openDetail(r.id)}
        isLoading={isLoading}
        isFetching={isFetching}
        error={isError ? error : undefined}
        onRetry={() => void refetch()}
        emptyMessage={t("quotations.empty")}
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
          title: <span className="mono">{r.quotation_number ?? t("quotations.draftRef", { id: r.id })}</span>,
          badge: <QuotationStatusBadge status={r.status} isExpired={r.is_expired} />,
          meta: (
            <>
              <span>{r.customer_name ?? "—"}</span>
              <span>
                <MoneyDisplay value={r.grand_total} className="font-medium" />
              </span>
              <span>{t("quotations.cardValidUntil", { date: formatDocDate(r.valid_until) })}</span>
            </>
          ),
        })}
      />

      <QuotationDetailDrawer
        id={detailId}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        onEdit={openForm}
        onOpenOther={openOther}
      />
      <QuotationFormDrawer open={formOpen} onOpenChange={setFormOpen} draft={editing} onSaved={onSaved} />
    </div>
  );
}
