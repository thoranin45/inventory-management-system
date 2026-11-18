"use client";

import * as React from "react";

import { DataTable, type Column } from "@/components/ui/data-table";
import { QuantityDisplay } from "@/components/ui/quantity-display";
import { ExpiryBadge } from "@/components/ui/expiry-badge";
import { ReportShell } from "./report-shell";
import { CountStrip } from "./mini-bars";
import { useExpiredStockReport, useExpiryChart } from "@/lib/query/reports";
import { EXPIRY_SERIES, type BatchExpiryRow } from "@/lib/api/schemas/reports";
import { useProductLookup } from "@/lib/query/sales";
import { useT } from "@/lib/i18n/client";
import { EXPIRY_SERIES_KEY } from "@/lib/reports/report-copy";

export function ExpiredStockReport() {
  const t = useT();
  const q = useExpiredStockReport({});
  const rows = q.data?.items ?? [];
  const chart = useExpiryChart({ limit: 200 });

  const lookup = useProductLookup(rows.map((r) => r.product_id));
  const name = (id: number) => lookup.data?.[id]?.product_name ?? t("reports.productFallback", { id });
  const sku = (id: number) => lookup.data?.[id]?.sku ?? "";

  const seriesCounts = React.useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of chart.data ?? []) c[r.series] = (c[r.series] ?? 0) + 1;
    return c;
  }, [chart.data]);

  const columns: Column<BatchExpiryRow>[] = [
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
    { key: "lot", header: t("reports.colLot"), cell: (r) => <span className="mono text-[var(--muted)]">{r.lot_no ?? "—"}</span> },
    { key: "expiry", header: t("reports.colExpiry"), cell: (r) => <span className="mono">{r.expiry_date ?? "—"}</span> },
    { key: "state", header: t("reports.colState"), cell: (r) => <ExpiryBadge days={r.days_to_expiry} isoDate={r.expiry_date} /> },
    { key: "qty", header: t("reports.colExpiredQty"), align: "right", cell: (r) => <QuantityDisplay value={r.quantity} className="font-semibold text-[var(--danger)]" /> },
  ];

  return (
    <ReportShell
      slug="expired"
      query={q}
      isEmpty={rows.length === 0}
      emptyMessage={t("reports.emptyExpired")}
      footNote={t("reports.footExpired")}
    >
      <div className="flex flex-col gap-4">
        {chart.data && chart.data.length > 0 ? (
          <CountStrip
            items={EXPIRY_SERIES.map((s) => ({
              label: t(EXPIRY_SERIES_KEY[s]),
              value: seriesCounts[s] ?? 0,
              tone: s === "expired" ? "danger" : s === "near_expiry" ? "warning" : "muted",
            }))}
          />
        ) : null}
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
                <span className="mono">{r.lot_no ?? t("reports.noLot")}</span>
                <span className="mono">{r.expiry_date ?? "—"}</span>
                <span className="text-[var(--danger)]">
                  <QuantityDisplay value={r.quantity} className="font-medium" /> {t("reports.expiredSuffix")}
                </span>
              </>
            ),
          })}
        />
      </div>
    </ReportShell>
  );
}
