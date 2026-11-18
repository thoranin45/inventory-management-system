"use client";

import * as React from "react";

import { DataTable, type Column } from "@/components/ui/data-table";
import { QuantityDisplay } from "@/components/ui/quantity-display";
import { StatusBadge } from "@/components/ui/status-badge";
import { ReportShell } from "./report-shell";
import { useLowStockOperationalReport } from "@/lib/query/reports";
import type { LowStockOperationalRow } from "@/lib/api/schemas/reports";
import { compareDecimals, subtractDecimals } from "@/lib/decimal";
import { useT } from "@/lib/i18n/client";

export function LowStockReport() {
  const t = useT();
  const q = useLowStockOperationalReport({});
  const rows = q.data?.items ?? [];

  const columns: Column<LowStockOperationalRow>[] = [
    { key: "sku", header: t("product.sku"), cell: (r) => <span className="mono text-[var(--muted)]">{r.sku}</span> },
    { key: "name", header: t("reports.colProduct"), cell: (r) => <span className="font-medium">{r.product_name}</span> },
    { key: "avail", header: t("reports.colOpAvailable"), align: "right", cell: (r) => <QuantityDisplay value={r.operational_available_quantity} className="font-semibold" /> },
    { key: "threshold", header: t("reports.colThreshold"), align: "right", cell: (r) => <QuantityDisplay value={r.threshold} className="text-[var(--muted)]" /> },
    {
      key: "short",
      header: t("reports.colShortBy"),
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
    { key: "state", header: t("reports.colState"), cell: () => <StatusBadge tone="warning" label={t("reports.belowThreshold")} /> },
  ];

  return (
    <ReportShell
      slug="low-stock"
      query={q}
      isEmpty={rows.length === 0}
      emptyMessage={t("reports.emptyLow")}
      exportPath="/api/bff/reports/export/low-stock"
      footNote={t("reports.footLow")}
    >
      <DataTable<LowStockOperationalRow>
        columns={columns}
        rows={rows}
        getRowKey={(r) => String(r.product_id)}
        isFetching={q.isFetching}
        renderCard={(r) => ({
          title: r.product_name,
          badge: <StatusBadge tone="warning" label={t("reports.belowThreshold")} />,
          meta: (
            <>
              <span className="mono">{r.sku}</span>
              <span>
                {t("reports.avail")} <QuantityDisplay value={r.operational_available_quantity} className="font-medium" />
              </span>
              <span>
                {t("reports.threshold")} <QuantityDisplay value={r.threshold} className="font-medium" />
              </span>
            </>
          ),
        })}
      />
    </ReportShell>
  );
}
