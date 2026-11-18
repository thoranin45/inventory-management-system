"use client";

import * as React from "react";

import { DataTable, type Column } from "@/components/ui/data-table";
import { QuantityDisplay } from "@/components/ui/quantity-display";
import { ReportShell } from "./report-shell";
import { useInTransitReport } from "@/lib/query/reports";
import type { InTransitStockRow } from "@/lib/api/schemas/reports";
import { useProductLookup } from "@/lib/query/sales";
import { compareDecimals, sumDecimals } from "@/lib/decimal";
import { useT } from "@/lib/i18n/client";

export function InTransitReport() {
  const t = useT();
  const q = useInTransitReport({});
  const rows = React.useMemo(() => q.data?.items ?? [], [q.data]);

  const lookup = useProductLookup(rows.map((r) => r.product_id));
  const name = (id: number) => lookup.data?.[id]?.product_name ?? t("reports.productFallback", { id });
  const sku = (id: number) => lookup.data?.[id]?.sku ?? "";

  const total = React.useMemo(() => sumDecimals(rows.map((r) => r.on_hand_qty), 3), [rows]);
  const nonZero = rows.filter((r) => compareDecimals(r.on_hand_qty, "0") > 0);

  const columns: Column<InTransitStockRow>[] = [
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
    { key: "batch", header: t("reports.colBatch"), cell: (r) => <span className="mono text-[var(--muted)]">{r.batch_id != null ? `#${r.batch_id}` : t("reports.nonBatch")}</span> },
    { key: "loc", header: t("reports.colHolding"), cell: () => <span className="text-[12px] text-[var(--muted)]">{t("reports.systemTransit")}</span> },
    { key: "qty", header: t("reports.colInTransit"), align: "right", cell: (r) => <QuantityDisplay value={r.on_hand_qty} className="font-semibold" /> },
  ];

  return (
    <ReportShell
      slug="in-transit"
      query={q}
      isEmpty={nonZero.length === 0}
      emptyMessage={t("reports.emptyTransit")}
      footNote={t(rows.length === 1 ? "reports.footTransitOne" : "reports.footTransitMany", { total, n: rows.length })}
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
              <span className="mono">{r.batch_id != null ? t("reports.batchNo", { id: r.batch_id }) : t("reports.nonBatch")}</span>
              <span>{t("reports.systemTransit")}</span>
              <span>
                <QuantityDisplay value={r.on_hand_qty} className="font-medium" /> {t("reports.inTransitSuffix")}
              </span>
            </>
          ),
        })}
      />
    </ReportShell>
  );
}
