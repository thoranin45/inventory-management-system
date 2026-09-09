"use client";

import * as React from "react";

import { DataTable, type Column } from "@/components/ui/data-table";
import { QuantityDisplay } from "@/components/ui/quantity-display";
import { MiniBars } from "./mini-bars";
import { ReportShell } from "./report-shell";
import { ReportsFilterBar } from "./reports-filter-bar";
import { useOperationalStockReport, useStockChart } from "@/lib/query/reports";
import { useReportParams } from "@/lib/reports/use-report-params";
import { OPERATIONAL_STOCK_SORT_FIELDS } from "@/lib/api/schemas/reports";
import type { ProductRow } from "@/lib/api/schemas/products";
import { formatQty } from "@/lib/format";
import { cn } from "@/lib/utils";
import { isZero } from "@/lib/decimal";

const CONTROLS = ["search", "page", "page_size", "sort_by", "sort_order"] as const;

export function OperationalStockReport() {
  const rp = useReportParams([...CONTROLS], { page_size: 20 });
  const query = {
    page: rp.page,
    page_size: rp.pageSize,
    search: rp.values.search || undefined,
    sort_by: rp.sortBy || undefined,
    sort_order: rp.sortBy ? rp.sortOrder : undefined,
  };
  const q = useOperationalStockReport(query);
  const chart = useStockChart({ limit: 10 });

  const rows = q.data?.data.items ?? [];
  const pg = q.data?.data.pagination;

  const columns: Column<ProductRow>[] = [
    { key: "sku", header: "SKU", sortField: "sku", cell: (p) => <span className="mono text-[var(--muted)]">{p.sku}</span> },
    { key: "name", header: "Product", sortField: "product_name", cell: (p) => <span className="font-medium">{p.product_name}</span> },
    { key: "owned", header: "Owned", align: "right", sortField: "stock_qty", cell: (p) => <QuantityDisplay value={p.owned_quantity} /> },
    { key: "avail", header: "Operational available", align: "right", cell: (p) => <QuantityDisplay value={p.operational_available_quantity} className="font-semibold" /> },
    { key: "reserved", header: "Reserved", align: "right", secondary: true, cell: (p) => <QuantityDisplay value={p.reserved_quantity} className="text-[var(--muted)]" /> },
    {
      key: "expired",
      header: "Expired",
      align: "right",
      cell: (p) => <QuantityDisplay value={p.expired_quantity} className={cn(!isZero(p.expired_quantity) && "text-[var(--danger)]")} />,
    },
    {
      key: "near",
      header: "Near expiry",
      align: "right",
      secondary: true,
      cell: (p) => <QuantityDisplay value={p.near_expiry_quantity} className={cn(!isZero(p.near_expiry_quantity) && "text-[var(--warning)]")} />,
    },
    { key: "transit", header: "In transit", align: "right", secondary: true, cell: (p) => <QuantityDisplay value={p.transit_quantity} className="text-[var(--muted)]" /> },
  ];

  return (
    <ReportShell
      slug="operational-stock"
      query={q}
      isEmpty={rows.length === 0}
      emptyMessage="No products match the current search."
      filters={
        <ReportsFilterBar
          controls={["search"]}
          searchPlaceholder="SKU, name, barcode…"
          values={rp.values}
          onChange={rp.setParams}
          onClear={rp.clearFilters}
        />
      }
      footNote={`Near-expiry and expired quantities are classifications of owned stock, not a separate pool. Owned = operational available + reserved + expired + near-expiry + transit. As of ${rows[0]?.as_of_date ?? "today"}.`}
    >
      <div className="flex flex-col gap-4">
        {chart.data && chart.data.length > 0 ? (
          <MiniBars
            title="Top stock holders (owned quantity)"
            data={chart.data.slice(0, 10).map((d) => ({ label: d.product_name, value: d.stock_qty }))}
            format={(v) => formatQty(v)}
          />
        ) : null}
        <DataTable<ProductRow>
          columns={columns}
          rows={rows}
          getRowKey={(p) => String(p.id)}
          isFetching={q.isFetching}
          sort={rp.sortBy ? { field: rp.sortBy, order: rp.sortOrder } : null}
          onSort={(f) => OPERATIONAL_STOCK_SORT_FIELDS.includes(f as never) && rp.cycleSort(f)}
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
          renderCard={(p) => ({
            title: p.product_name,
            meta: (
              <>
                <span className="mono">{p.sku}</span>
                <span>
                  Avail <QuantityDisplay value={p.operational_available_quantity} className="font-medium" />
                </span>
                <span>
                  Owned <QuantityDisplay value={p.owned_quantity} className="font-medium" />
                </span>
                {!isZero(p.expired_quantity) ? (
                  <span className="text-[var(--danger)]">
                    Expired <QuantityDisplay value={p.expired_quantity} />
                  </span>
                ) : null}
              </>
            ),
          })}
        />
      </div>
    </ReportShell>
  );
}
