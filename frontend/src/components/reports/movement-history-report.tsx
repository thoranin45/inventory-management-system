"use client";

import * as React from "react";

import { DataTable, type Column } from "@/components/ui/data-table";
import { QuantityDisplay } from "@/components/ui/quantity-display";
import { StatusBadge } from "@/components/ui/status-badge";
import { ReportShell } from "./report-shell";
import { ReportsFilterBar } from "./reports-filter-bar";
import { useMovementReport } from "@/lib/query/reports";
import { useReportParams } from "@/lib/reports/use-report-params";
import type { MovementRow } from "@/lib/api/schemas/reports";
import { useProductLookup } from "@/lib/query/sales";
import { formatIsoDate } from "@/lib/format";
import { useT } from "@/lib/i18n/client";
import { movementTypeText } from "@/lib/reports/report-copy";

const CONTROLS = ["transaction_type", "date_from", "date_to", "page", "page_size"] as const;

export function MovementHistoryReport() {
  const t = useT();
  const rp = useReportParams([...CONTROLS], { page_size: 25 });
  const query = {
    page: rp.page,
    page_size: rp.pageSize,
    transaction_type: rp.values.transaction_type || undefined,
    date_from: rp.values.date_from || undefined,
    date_to: rp.values.date_to || undefined,
  };
  const q = useMovementReport(query);
  const rows = q.data?.data.items ?? [];
  const pg = q.data?.data.pagination;

  const lookup = useProductLookup(rows.map((r) => r.product_id ?? 0).filter(Boolean));
  const name = (id: number | null) => (id == null ? "—" : lookup.data?.[id]?.product_name ?? t("reports.productFallback", { id }));
  const sku = (id: number | null) => (id == null ? "" : lookup.data?.[id]?.sku ?? "");

  const columns: Column<MovementRow>[] = [
    { key: "when", header: t("reports.colWhen"), cell: (r) => <span className="mono text-[var(--muted)]">{formatIsoDate(r.created_at)}</span> },
    {
      key: "type",
      header: t("reports.colType"),
      cell: (r) => <StatusBadge tone="neutral" label={r.transaction_type ? movementTypeText(t, r.transaction_type) : "—"} />,
    },
    {
      key: "product",
      header: t("reports.colProduct"),
      cell: (r) => (
        <div>
          <div className="font-medium">{name(r.product_id)}</div>
          <div className="mono text-[11px] text-[var(--faint)]">{sku(r.product_id)}</div>
        </div>
      ),
    },
    { key: "qty", header: t("reports.colQuantity"), align: "right", cell: (r) => <QuantityDisplay value={r.quantity} className="font-semibold" /> },
    { key: "ref", header: t("reports.colReference"), secondary: true, cell: (r) => <span className="text-[12px] text-[var(--muted)]">{r.remark || "—"}</span> },
  ];

  return (
    <ReportShell
      slug="movements"
      query={q}
      isEmpty={rows.length === 0}
      emptyMessage={t("reports.emptyMovements")}
      filters={
        <ReportsFilterBar
          controls={["transaction_type", "date_from", "date_to"]}
          values={rp.values}
          onChange={rp.setParams}
          onClear={rp.clearFilters}
        />
      }
      footNote={t("reports.footMovements")}
    >
      <DataTable<MovementRow>
        columns={columns}
        rows={rows}
        getRowKey={(r) => String(r.id)}
        isFetching={q.isFetching}
        pagination={
          pg
            ? {
                page: pg.page,
                pageSize: pg.page_size,
                totalItems: pg.total_items,
                totalPages: pg.total_pages,
                onPageChange: rp.setPage,
              }
            : undefined
        }
        renderCard={(r) => ({
          title: name(r.product_id),
          badge: <StatusBadge tone="neutral" label={r.transaction_type ? movementTypeText(t, r.transaction_type) : "—"} />,
          meta: (
            <>
              <span className="mono">{formatIsoDate(r.created_at)}</span>
              <span>
                {t("reports.qty")} <QuantityDisplay value={r.quantity} className="font-medium" />
              </span>
              {r.remark ? <span className="w-full text-[11px] text-[var(--faint)]">{r.remark}</span> : null}
            </>
          ),
        })}
      />
    </ReportShell>
  );
}
