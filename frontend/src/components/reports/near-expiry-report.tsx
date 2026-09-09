"use client";

import * as React from "react";

import { DataTable, type Column } from "@/components/ui/data-table";
import { QuantityDisplay } from "@/components/ui/quantity-display";
import { ExpiryBadge } from "@/components/ui/expiry-badge";
import { ReportShell } from "./report-shell";
import { ReportsFilterBar } from "./reports-filter-bar";
import { useNearExpiryReport } from "@/lib/query/reports";
import { useReportParams } from "@/lib/reports/use-report-params";
import type { BatchExpiryRow } from "@/lib/api/schemas/reports";
import { useProductLookup } from "@/lib/query/sales";

export function NearExpiryReport() {
  const rp = useReportParams(["days"], {});
  const days = rp.values.days || undefined;
  const q = useNearExpiryReport(days ? { days } : {});
  const rows = q.data?.items ?? [];

  const lookup = useProductLookup(rows.map((r) => r.product_id));
  const name = (id: number) => lookup.data?.[id]?.product_name ?? `Product #${id}`;
  const sku = (id: number) => lookup.data?.[id]?.sku ?? "";

  const columns: Column<BatchExpiryRow>[] = [
    {
      key: "product",
      header: "Product",
      cell: (r) => (
        <div>
          <div className="font-medium">{name(r.product_id)}</div>
          <div className="mono text-[11px] text-[var(--faint)]">{sku(r.product_id)}</div>
        </div>
      ),
    },
    { key: "lot", header: "Lot", cell: (r) => <span className="mono text-[var(--muted)]">{r.lot_no ?? "—"}</span> },
    { key: "expiry", header: "Expiry", cell: (r) => <span className="mono">{r.expiry_date ?? "—"}</span> },
    { key: "days", header: "Days to expiry", align: "right", cell: (r) => <span className="tnum">{r.days_to_expiry ?? "—"}</span> },
    { key: "state", header: "State", cell: (r) => <ExpiryBadge days={r.days_to_expiry} isoDate={r.expiry_date} /> },
    { key: "qty", header: "Quantity", align: "right", cell: (r) => <QuantityDisplay value={r.quantity} className="font-semibold" /> },
  ];

  return (
    <ReportShell
      slug="near-expiry"
      query={q}
      isEmpty={rows.length === 0}
      emptyMessage="No in-date batches expire within the selected window."
      exportPath="/api/bff/reports/export/expiring"
      exportQuery={days ? { days } : undefined}
      filters={
        <ReportsFilterBar
          controls={["days"]}
          numeric={{ days: { label: "Within days", min: 1, max: 3650 } }}
          values={rp.values}
          onChange={rp.setParams}
          onClear={rp.clearFilters}
        />
      }
      footNote="Near-expiry stock is a classification of owned stock, not a separate pool. Default window is the backend's near-expiry setting (90 days)."
    >
      <DataTable<BatchExpiryRow>
        columns={columns}
        rows={rows}
        getRowKey={(r) => String(r.batch_id)}
        isFetching={q.isFetching}
        renderCard={(r) => ({
          title: name(r.product_id),
          badge: <ExpiryBadge days={r.days_to_expiry} isoDate={r.expiry_date} />,
          meta: (
            <>
              <span className="mono">{r.lot_no ?? "no lot"}</span>
              <span className="mono">{r.expiry_date ?? "—"}</span>
              <span>
                <QuantityDisplay value={r.quantity} className="font-medium" />
              </span>
            </>
          ),
        })}
      />
    </ReportShell>
  );
}
