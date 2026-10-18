"use client";

import * as React from "react";
import { Truck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { LotChip } from "@/components/ui/lot-chip";
import { StockTriad } from "@/components/ui/stock-triad";
import { Banner, ErrorState, LoadingState } from "@/components/ui/states";
import { useT } from "@/lib/i18n/client";
import { useProductBalancePages } from "@/lib/query/hooks";
import { useWarehouses } from "@/lib/query/warehouses";

/**
 * Concept B "Lots and locations" for one product (D-R4-7): the first verified
 * page of balances, more on request ("Load more"), with honest loading,
 * partial-result and failure states. Lots and storage codes come from the
 * balance rows and the warehouse directory; nothing is invented (an unknown
 * storage id shows as its id).
 */
export function ProductBalances({ productId }: { productId: number }) {
  const t = useT();
  const q = useProductBalancePages(productId);
  const directoryQ = useWarehouses(false);
  const directory = directoryQ.data ?? [];

  const storage = (warehouseId: number | null, locationId: number | null) => {
    const wh = directory.find((w) => w.id === warehouseId);
    const loc = wh?.locations.find((l) => l.id === locationId);
    return `${wh?.warehouse_code ?? (warehouseId ?? "—")} / ${loc?.location_code ?? (locationId ?? "—")}`;
  };

  if (q.isLoading) return <LoadingState label={t("stock.loadingBalances")} />;
  if (q.isError && !q.balances) return <ErrorState error={q.error} onRetry={() => void q.refetch()} compact />;
  const b = q.balances;
  if (!b || b.total === 0) return <p className="py-3 text-[13px] text-[var(--muted)]">{t("stock.noBalances")}</p>;

  return (
    <div className="flex flex-col gap-2">
      {b.inconsistent ? (
        <Banner
          tone="warning"
          title={t("stock.balancesChanged")}
          actions={
            <Button size="sm" variant="secondary" onClick={() => void q.refetch()}>
              {t("stock.reloadBalances")}
            </Button>
          }
        />
      ) : null}
      <ul className="flex flex-col divide-y divide-[var(--border)]" aria-label={t("stock.lotsAndLocations")}>
        {b.rows.map((row) => (
          <li key={row.id} className="flex flex-col gap-2 py-[10px]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <LotChip
                lot={row.batch_id != null ? (row.batch_lot_no ?? null) : null}
                expiryDate={row.batch_id != null ? row.batch_expiry_date : undefined}
                daysToExpiry={row.batch_id != null ? row.days_to_expiry : undefined}
                location={storage(row.warehouse_id, row.location_id)}
              />
              {row.is_transit ? (
                <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-[var(--accent)]">
                  <Truck aria-hidden className="h-3.5 w-3.5" />
                  {t("stock.inTransit")}
                </span>
              ) : null}
            </div>
            <StockTriad onHand={row.on_hand_qty} reserved={row.reserved_qty} available={row.available_qty} compact />
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-[var(--muted)]">
        <span role="status">{t("stock.showingBalances", { n: b.rows.length, total: b.total })}</span>
        {q.hasNextPage ? (
          <Button size="sm" variant="secondary" onClick={() => void q.fetchNextPage()} disabled={q.isFetchingNextPage}>
            {q.isFetchingNextPage ? t("common.loading") : t("stock.loadMoreBalances")}
          </Button>
        ) : null}
      </div>
      {q.isFetchNextPageError ? (
        <Banner
          tone="danger"
          title={t("stock.loadMoreFailed")}
          actions={
            <Button size="sm" variant="secondary" onClick={() => void q.fetchNextPage()}>
              {t("common.tryAgain")}
            </Button>
          }
        />
      ) : null}
    </div>
  );
}
