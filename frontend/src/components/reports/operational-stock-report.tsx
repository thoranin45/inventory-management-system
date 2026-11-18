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
import { useT } from "@/lib/i18n/client";

const CONTROLS = ["search", "page", "page_size", "sort_by", "sort_order"] as const;

export function OperationalStockReport() {
  const t = useT();
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
    { key: "sku", header: t("product.sku"), sortField: "sku", cell: (p) => <span className="mono text-[var(--muted)]">{p.sku}</span> },
    { key: "name", header: t("reports.colProduct"), sortField: "product_name", cell: (p) => <span className="font-medium">{p.product_name}</span> },
    { key: "owned", header: t("reports.colOwned"), align: "right", sortField: "stock_qty", cell: (p) => <QuantityDisplay value={p.owned_quantity} /> },
    { key: "avail", header: t("reports.colOpAvailable"), align: "right", cell: (p) => <QuantityDisplay value={p.operational_available_quantity} className="font-semibold" /> },
    { key: "reserved", header: t("reports.colReserved"), align: "right", secondary: true, cell: (p) => <QuantityDisplay value={p.reserved_quantity} className="text-[var(--muted)]" /> },
    {
      key: "expired",
      header: t("reports.colExpired"),
      align: "right",
      cell: (p) => <QuantityDisplay value={p.expired_quantity} className={cn(!isZero(p.expired_quantity) && "text-[var(--danger)]")} />,
    },
    {
      key: "near",
      header: t("reports.colNearExpiry"),
      align: "right",
      secondary: true,
      cell: (p) => <QuantityDisplay value={p.near_expiry_quantity} className={cn(!isZero(p.near_expiry_quantity) && "text-[var(--warning)]")} />,
    },
    { key: "transit", header: t("reports.colInTransit"), align: "right", secondary: true, cell: (p) => <QuantityDisplay value={p.transit_quantity} className="text-[var(--muted)]" /> },
  ];

  return (
    <ReportShell
      slug="operational-stock"
      query={q}
      isEmpty={rows.length === 0}
      emptyMessage={t("reports.emptyOperational")}
      filters={
        <ReportsFilterBar
          controls={["search"]}
          searchPlaceholder={t("reports.phOperational")}
          values={rp.values}
          onChange={rp.setParams}
          onClear={rp.clearFilters}
        />
      }
      footNote={t("reports.footOperational", { date: rows[0]?.as_of_date ?? t("reports.today") })}
    >
      <div className="flex flex-col gap-4">
        {chart.data && chart.data.length > 0 ? (
          <MiniBars
            title={t("reports.topHolders")}
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
                  {t("reports.avail")} <QuantityDisplay value={p.operational_available_quantity} className="font-medium" />
                </span>
                <span>
                  {t("reports.owned")} <QuantityDisplay value={p.owned_quantity} className="font-medium" />
                </span>
                {!isZero(p.expired_quantity) ? (
                  <span className="text-[var(--danger)]">
                    {t("reports.expired")} <QuantityDisplay value={p.expired_quantity} />
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
