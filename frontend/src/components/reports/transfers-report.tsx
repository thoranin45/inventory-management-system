"use client";

import * as React from "react";

import { DataTable, type Column } from "@/components/ui/data-table";
import { QuantityDisplay } from "@/components/ui/quantity-display";
import { StatusBadge } from "@/components/ui/status-badge";
import { ProgressRing } from "@/components/work/progress-ring";
import { ReportShell } from "./report-shell";
import { ReportsFilterBar } from "./reports-filter-bar";
import { useTransfersReport } from "@/lib/query/reports";
import { useWarehouseNames } from "@/lib/query/transfers";
import { useReportParams } from "@/lib/reports/use-report-params";
import { TRANSFER_STATUSES, TRANSFER_STATUS_LABEL, type TransferRow } from "@/lib/api/schemas/transfers";
import { formatIsoDate } from "@/lib/format";
import { useT } from "@/lib/i18n/client";
import { statusText } from "@/lib/reports/report-copy";

const CONTROLS = ["search", "status", "page", "page_size"] as const;

export function TransfersReport() {
  const t = useT();
  const rp = useReportParams([...CONTROLS], { page_size: 25 });
  const q = useTransfersReport({
    page: rp.page,
    page_size: rp.pageSize,
    search: rp.values.search || undefined,
    status: rp.values.status || undefined,
  });
  const rows = q.data?.data.items ?? [];
  const pg = q.data?.data.pagination;

  // Directory names first (inactive ones labelled), then the row's own name.
  const whNames = useWarehouseNames().data ?? {};
  const wh = (id: number, name: string | null) => whNames[id] ?? name ?? t("reports.warehouseFallback", { id });

  const columns: Column<TransferRow>[] = [
    { key: "tr", header: t("reports.colTransfer"), cell: (r) => <span className="mono">{r.transfer_number}</span> },
    { key: "route", header: t("reports.colRoute"), cell: (r) => (
      <span className="text-[12px]">
        {wh(r.source_warehouse_id, r.source_warehouse_name)} <span className="text-[var(--faint)]">→</span> {wh(r.destination_warehouse_id, r.destination_warehouse_name)}
      </span>
    ) },
    {
      key: "status",
      header: t("reports.colStatus"),
      cell: (r) => (r.legacy_completed ? <StatusBadge tone="neutral" label={t("reports.legacyCompleted")} /> : <StatusBadge status={r.status} />),
    },
    { key: "total", header: t("reports.colTotal"), align: "right", cell: (r) => <QuantityDisplay value={r.total_quantity} /> },
    { key: "disp", header: t("reports.colDispatched"), align: "right", cell: (r) => <QuantityDisplay value={r.dispatched_quantity} /> },
    { key: "recv", header: t("reports.colReceived"), align: "right", cell: (r) => <QuantityDisplay value={r.received_quantity} /> },
    { key: "out", header: t("reports.colOutstanding"), align: "right", secondary: true, cell: (r) => <QuantityDisplay value={r.outstanding_quantity} className="text-[var(--muted)]" /> },
    { key: "progress", header: t("reports.colProgress"), cell: (r) => <ProgressRing done={r.received_quantity} total={r.total_quantity} size={26} label={t("reports.pctReceived", { pct: r.progress_pct })} /> },
    { key: "dispat", header: t("reports.colDispatchedAt"), secondary: true, cell: (r) => <span className="mono text-[var(--muted)]">{r.dispatched_at ? formatIsoDate(r.dispatched_at) : "—"}</span> },
    { key: "latest", header: t("reports.colLatestReceipt"), secondary: true, cell: (r) => <span className="mono text-[var(--muted)]">{r.latest_receipt_at ? formatIsoDate(r.latest_receipt_at) : "—"}</span> },
  ];

  return (
    <ReportShell
      slug="transfers"
      query={q}
      isEmpty={rows.length === 0}
      emptyMessage={t("reports.emptyTransfers")}
      filters={
        <ReportsFilterBar
          controls={["search", "status"]}
          searchPlaceholder={t("reports.phTransfers")}
          statusOptions={TRANSFER_STATUSES.map((s) => ({ value: s, label: statusText(t, s, TRANSFER_STATUS_LABEL) }))}
          values={rp.values}
          onChange={rp.setParams}
          onClear={rp.clearFilters}
        />
      }
      footNote={t("reports.footTransfers")}
    >
      <DataTable<TransferRow>
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
          title: `${wh(r.source_warehouse_id, r.source_warehouse_name)} → ${wh(r.destination_warehouse_id, r.destination_warehouse_name)}`,
          badge: r.legacy_completed ? <StatusBadge tone="neutral" label={t("reports.legacyCompleted")} /> : <StatusBadge status={r.status} />,
          meta: (
            <>
              <span className="mono">{r.transfer_number}</span>
              <span>
                {t("reports.recv")} <QuantityDisplay value={r.received_quantity} className="font-medium" /> /{" "}
                <QuantityDisplay value={r.total_quantity} className="font-medium" />
              </span>
              <span>{r.progress_pct}%</span>
            </>
          ),
        })}
      />
    </ReportShell>
  );
}
