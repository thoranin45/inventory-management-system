"use client";

import * as React from "react";

import { DataTable, type Column } from "@/components/ui/data-table";
import { QuantityDisplay } from "@/components/ui/quantity-display";
import { ReportShell } from "./report-shell";
import { useInTransitReport } from "@/lib/query/reports";
import type { InTransitStockRow } from "@/lib/api/schemas/reports";
import { useProductLookup } from "@/lib/query/sales";
import { compareDecimals, sumDecimals } from "@/lib/decimal";

export function InTransitReport() {
  const q = useInTransitReport({});
  const rows = React.useMemo(() => q.data?.items ?? [], [q.data]);

  const lookup = useProductLookup(rows.map((r) => r.product_id));
  const name = (id: number) => lookup.data?.[id]?.product_name ?? `Product #${id}`;
  const sku = (id: number) => lookup.data?.[id]?.sku ?? "";

  const total = React.useMemo(() => sumDecimals(rows.map((r) => r.on_hand_qty), 3), [rows]);
  const nonZero = rows.filter((r) => compareDecimals(r.on_hand_qty, "0") > 0);

  const columns: Column<InTransitStockRow>[] = [
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
    { key: "batch", header: "Batch", cell: (r) => <span className="mono text-[var(--muted)]">{r.batch_id != null ? `#${r.batch_id}` : "non-batch"}</span> },
    { key: "loc", header: "Holding", cell: () => <span className="text-[12px] text-[var(--muted)]">System transit</span> },
    { key: "qty", header: "In transit", align: "right", cell: (r) => <QuantityDisplay value={r.on_hand_qty} className="font-semibold" /> },
  ];

  return (
    <ReportShell
      slug="in-transit"
      query={q}
      isEmpty={nonZero.length === 0}
      emptyMessage="Nothing is currently held in system transit."
      footNote={
        <>
          {total} total in the transit warehouse across {rows.length} balance row
          {rows.length === 1 ? "" : "s"}. Transit is a system-controlled holding area — these are
          balance rows, not attributed to any one transfer.
        </>
      }
    >
      <DataTable<InTransitStockRow>
        columns={columns}
        rows={nonZero}
        getRowKey={(r) => String(r.id)}
        isFetching={q.isFetching}
        renderCard={(r) => ({
          title: name(r.product_id),
          meta: (
            <>
              <span className="mono">{r.batch_id != null ? `batch #${r.batch_id}` : "non-batch"}</span>
              <span>System transit</span>
              <span>
                <QuantityDisplay value={r.on_hand_qty} className="font-medium" /> in transit
              </span>
            </>
          ),
        })}
      />
    </ReportShell>
  );
}
