"use client";

import * as React from "react";

import { DataTable, type Column } from "@/components/ui/data-table";
import { QuantityDisplay } from "@/components/ui/quantity-display";
import { StatusBadge } from "@/components/ui/status-badge";
import { ReportShell } from "./report-shell";
import { useLowStockOperationalReport } from "@/lib/query/reports";
import type { LowStockOperationalRow } from "@/lib/api/schemas/reports";
import { compareDecimals, subtractDecimals } from "@/lib/decimal";

export function LowStockReport() {
  const q = useLowStockOperationalReport({});
  const rows = q.data?.items ?? [];

  const columns: Column<LowStockOperationalRow>[] = [
    { key: "sku", header: "SKU", cell: (r) => <span className="mono text-[var(--muted)]">{r.sku}</span> },
    { key: "name", header: "Product", cell: (r) => <span className="font-medium">{r.product_name}</span> },
    { key: "avail", header: "Operational available", align: "right", cell: (r) => <QuantityDisplay value={r.operational_available_quantity} className="font-semibold" /> },
    { key: "threshold", header: "Threshold", align: "right", cell: (r) => <QuantityDisplay value={r.threshold} className="text-[var(--muted)]" /> },
    {
      key: "short",
      header: "Short by",
      align: "right",
      cell: (r) => {
        const short = subtractDecimals(r.threshold, r.operational_available_quantity, 3);
        return compareDecimals(short, "0") > 0 ? (
          <span className="tnum font-medium text-[var(--warning)]">
            <QuantityDisplay value={short} />
          </span>
        ) : (
          "—"
        );
      },
    },
    { key: "state", header: "State", cell: () => <StatusBadge tone="warning" label="Below threshold" /> },
  ];

  return (
    <ReportShell
      slug="low-stock"
      query={q}
      isEmpty={rows.length === 0}
      emptyMessage="No products are below their operational low-stock threshold."
      exportPath="/api/bff/reports/export/low-stock"
      footNote="Threshold is the backend operational rule: safety stock if > 0, else minimum stock, else the default of 10. Never recomputed from a product's total stock quantity."
    >
      <DataTable<LowStockOperationalRow>
        columns={columns}
        rows={rows}
        getRowKey={(r) => String(r.product_id)}
        isFetching={q.isFetching}
        renderCard={(r) => ({
          title: r.product_name,
          badge: <StatusBadge tone="warning" label="Below threshold" />,
          meta: (
            <>
              <span className="mono">{r.sku}</span>
              <span>
                Avail <QuantityDisplay value={r.operational_available_quantity} className="font-medium" />
              </span>
              <span>
                Threshold <QuantityDisplay value={r.threshold} className="font-medium" />
              </span>
            </>
          ),
        })}
      />
    </ReportShell>
  );
}
