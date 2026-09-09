"use client";

import * as React from "react";

import { DataTable, type Column } from "@/components/ui/data-table";
import { MoneyDisplay, QuantityDisplay } from "@/components/ui/quantity-display";
import { StatusBadge } from "@/components/ui/status-badge";
import { ReportShell } from "./report-shell";
import { ReportsFilterBar } from "./reports-filter-bar";
import { MiniBars } from "./mini-bars";
import { useSalesChart, useSalesReport, useSalesSummary } from "@/lib/query/reports";
import { useReportParams } from "@/lib/reports/use-report-params";
import { SO_STATUSES, SO_STATUS_LABEL, type SalesOrderRow } from "@/lib/api/schemas/sales";
import { formatIsoDate, formatMoney } from "@/lib/format";

const CONTROLS = ["search", "status", "page", "page_size"] as const;

export function SalesReport() {
  const rp = useReportParams([...CONTROLS], { page_size: 25 });
  const query = {
    page: rp.page,
    page_size: rp.pageSize,
    search: rp.values.search || undefined,
    status: rp.values.status || undefined,
  };
  const q = useSalesReport(query);
  const summary = useSalesSummary({});
  const chart = useSalesChart({});

  const rows = q.data?.data.items ?? [];
  const pg = q.data?.data.pagination;

  const columns: Column<SalesOrderRow>[] = [
    { key: "so", header: "SO #", cell: (r) => <span className="mono">{r.so_number}</span> },
    { key: "customer", header: "Customer", cell: (r) => <span className="font-medium">{r.customer_name ?? `Customer #${r.customer_id ?? "—"}`}</span> },
    { key: "status", header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
    { key: "items", header: "Lines", align: "right", secondary: true, cell: (r) => <span className="tnum">{r.item_count}</span> },
    { key: "qty", header: "Total qty", align: "right", cell: (r) => <QuantityDisplay value={r.total_quantity} /> },
    { key: "amount", header: "Total amount", align: "right", cell: (r) => <MoneyDisplay value={r.total_amount} className="font-semibold" /> },
    { key: "created", header: "Created", secondary: true, cell: (r) => <span className="mono text-[var(--muted)]">{formatIsoDate(r.created_at)}</span> },
  ];

  return (
    <ReportShell
      slug="sales"
      query={q}
      isEmpty={rows.length === 0}
      emptyMessage="No sales orders for the selected filters."
      exportPath="/api/bff/reports/export/sales"
      filters={
        <ReportsFilterBar
          controls={["search", "status"]}
          searchPlaceholder="SO number, customer…"
          statusOptions={SO_STATUSES.map((s) => ({ value: s, label: SO_STATUS_LABEL[s] ?? s }))}
          values={rp.values}
          onChange={rp.setParams}
          onClear={rp.clearFilters}
        />
      }
    >
      <div className="flex flex-col gap-4">
        {summary.data ? (
          <div className="flex flex-wrap gap-2">
            <span className="inline-flex items-baseline gap-1 rounded-[var(--r-sm)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[12px] text-[var(--muted)]">
              <span className="tnum text-[15px] font-semibold text-[var(--foreground)]">{summary.data.total_orders}</span>
              orders (all time)
            </span>
            <span className="inline-flex items-baseline gap-1 rounded-[var(--r-sm)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[12px] text-[var(--muted)]">
              <span className="tnum text-[15px] font-semibold text-[var(--foreground)]">{formatMoney(summary.data.total_sales_amount)}</span>
              total amount
            </span>
          </div>
        ) : null}
        {chart.data && chart.data.length > 1 ? (
          <MiniBars
            title="Order amount by day"
            data={chart.data.slice(-14).map((d) => ({ label: d.date, value: d.sales, hint: `${d.orders} order${d.orders === 1 ? "" : "s"}` }))}
            format={(v) => formatMoney(v)}
          />
        ) : null}
        <DataTable<SalesOrderRow>
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
            title: r.customer_name ?? r.so_number,
            badge: <StatusBadge status={r.status} />,
            meta: (
              <>
                <span className="mono">{r.so_number}</span>
                <span>
                  Qty <QuantityDisplay value={r.total_quantity} className="font-medium" />
                </span>
                <span>
                  <MoneyDisplay value={r.total_amount} className="font-medium" />
                </span>
                <span className="mono text-[var(--faint)]">{formatIsoDate(r.created_at)}</span>
              </>
            ),
          })}
        />
      </div>
    </ReportShell>
  );
}
