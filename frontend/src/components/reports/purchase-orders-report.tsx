"use client";

import * as React from "react";

import { DataTable, type Column } from "@/components/ui/data-table";
import { MoneyDisplay, QuantityDisplay } from "@/components/ui/quantity-display";
import { StatusBadge } from "@/components/ui/status-badge";
import { ProgressRing } from "@/components/work/progress-ring";
import { ReportShell } from "./report-shell";
import { ReportsFilterBar } from "./reports-filter-bar";
import { usePurchaseOrdersReport } from "@/lib/query/reports";
import { useReportParams } from "@/lib/reports/use-report-params";
import { PO_STATUSES, PO_STATUS_LABEL, type PurchaseOrderRow } from "@/lib/api/schemas/purchase-orders";
import { formatIsoDate } from "@/lib/format";
import { useT } from "@/lib/i18n/client";
import { statusText } from "@/lib/reports/report-copy";

const CONTROLS = ["search", "status", "page", "page_size"] as const;

export function PurchaseOrdersReport() {
  const t = useT();
  const rp = useReportParams([...CONTROLS], { page_size: 25 });
  const q = usePurchaseOrdersReport({
    page: rp.page,
    page_size: rp.pageSize,
    search: rp.values.search || undefined,
    status: rp.values.status || undefined,
  });
  const rows = q.data?.data.items ?? [];
  const pg = q.data?.data.pagination;

  const columns: Column<PurchaseOrderRow>[] = [
    { key: "po", header: t("reports.colPo"), cell: (r) => <span className="mono">{r.po_number}</span> },
    { key: "supplier", header: t("reports.colSupplier"), cell: (r) => <span className="font-medium">{r.supplier_name ?? t("reports.supplierFallback", { id: r.supplier_id ?? "—" })}</span> },
    { key: "status", header: t("reports.colStatus"), cell: (r) => <StatusBadge status={r.status} /> },
    { key: "ordered", header: t("reports.colOrdered"), align: "right", cell: (r) => <QuantityDisplay value={r.ordered_quantity} /> },
    { key: "received", header: t("reports.colReceived"), align: "right", cell: (r) => <QuantityDisplay value={r.received_quantity} /> },
    { key: "remaining", header: t("reports.colRemaining"), align: "right", cell: (r) => <QuantityDisplay value={r.remaining_quantity} className="text-[var(--muted)]" /> },
    { key: "total", header: t("reports.colTotal"), align: "right", secondary: true, cell: (r) => <MoneyDisplay value={r.total_amount} /> },
    { key: "progress", header: t("reports.colProgress"), cell: (r) => <ProgressRing done={r.received_quantity} total={r.ordered_quantity} size={26} label={t("reports.pctReceived", { pct: r.receiving_pct })} /> },
    { key: "last", header: t("reports.colLastReceipt"), secondary: true, cell: (r) => <span className="mono text-[var(--muted)]">{r.last_receipt_at ? formatIsoDate(r.last_receipt_at) : "—"}</span> },
  ];

  return (
    <ReportShell
      slug="purchase-orders"
      query={q}
      isEmpty={rows.length === 0}
      emptyMessage={t("reports.emptyPo")}
      filters={
        <ReportsFilterBar
          controls={["search", "status"]}
          searchPlaceholder={t("reports.phPo")}
          statusOptions={PO_STATUSES.map((s) => ({ value: s, label: statusText(t, s, PO_STATUS_LABEL) }))}
          values={rp.values}
          onChange={rp.setParams}
          onClear={rp.clearFilters}
        />
      }
    >
      <DataTable<PurchaseOrderRow>
        columns={columns}
        rows={rows}
        getRowKey={(r) => String(r.id)}
        isFetching={q.isFetching}
        pagination={
          pg
            ? { page: pg.page, pageSize: pg.page_size, totalItems: pg.total_items, totalPages: pg.total_pages, onPageChange: rp.setPage }
            : undefined
        }
        renderCard={(r) => ({
          title: r.supplier_name ?? r.po_number,
          badge: <StatusBadge status={r.status} />,
          meta: (
            <>
              <span className="mono">{r.po_number}</span>
              <span>
                {t("reports.recv")} <QuantityDisplay value={r.received_quantity} className="font-medium" /> /{" "}
                <QuantityDisplay value={r.ordered_quantity} className="font-medium" />
              </span>
              <span>{r.receiving_pct}%</span>
            </>
          ),
        })}
      />
    </ReportShell>
  );
}
