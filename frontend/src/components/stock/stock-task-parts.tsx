"use client";

import * as React from "react";
import { Info, Lock, Warehouse } from "lucide-react";

import { LotChip } from "@/components/ui/lot-chip";
import { QuantityDisplay } from "@/components/ui/quantity-display";
import { useT } from "@/lib/i18n/client";
import { compareDecimals, sumDecimals, type DecimalString } from "@/lib/decimal";
import { useAllProductStock } from "@/lib/query/hooks";
import { useWarehouses } from "@/lib/query/warehouses";
import type { StockBalanceRow } from "@/lib/api/schemas/stock";
import type { StockOutStrategy } from "@/lib/api/schemas/stock-out";

/** Stock In / Stock Out always post at the operational MAIN / DEFAULT storage. */
export const DEFAULT_STORAGE_LABEL = "MAIN / DEFAULT";

export type DefaultStorage =
  | { status: "loading" | "error" | "none" }
  | {
      status: "ready";
      onHand: DecimalString;
      reserved: DecimalString;
      available: DecimalString;
      /** every balance of the product at MAIN / DEFAULT (any lot) */
      rows: StockBalanceRow[];
    };

/**
 * The product's balances at MAIN / DEFAULT, summed exactly. Built only from
 * the COMPLETE verified balance set (`useAllProductStock` walks and checks
 * every page, or fails): a partial page is never presented as the whole.
 * Advisory — the server's result is final.
 */
export function useDefaultStorage(productId: number | null): DefaultStorage {
  const stockQ = useAllProductStock(productId);
  const directoryQ = useWarehouses(false);
  return React.useMemo((): DefaultStorage => {
    if (productId === null) return { status: "none" };
    if (stockQ.isError || directoryQ.isError) return { status: "error" };
    if (!stockQ.data || !directoryQ.data) return { status: "loading" };
    const main = directoryQ.data.find((w) => w.warehouse_code === "MAIN");
    const loc = main?.locations.find((l) => l.location_code === "DEFAULT");
    const rows = stockQ.data.items.filter(
      (b) => !b.is_transit && main && loc && b.warehouse_id === main.id && b.location_id === loc.id,
    );
    return {
      status: "ready",
      rows,
      onHand: sumDecimals(rows.map((r) => r.on_hand_qty), 3),
      reserved: sumDecimals(rows.map((r) => r.reserved_qty), 3),
      available: sumDecimals(rows.map((r) => r.available_qty), 3),
    };
  }, [productId, stockQ.data, stockQ.isError, directoryQ.data, directoryQ.isError]);
}

/** The fixed storage row (destination for Stock In, source for Stock Out). */
export function StorageRow({ direction }: { direction: "in" | "out" }) {
  const t = useT();
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[12px] text-[var(--muted)]">{t(direction === "in" ? "task.destination" : "task.source")}</span>
      <div className="flex items-center gap-2 rounded-[var(--r-sm)] border border-[var(--border)] bg-[var(--surface-sunken)] px-3 py-2 text-[13px]">
        <Warehouse aria-hidden className="h-4 w-4 flex-none text-[var(--muted)]" />
        <span className="mono grow">{DEFAULT_STORAGE_LABEL}</span>
        <Lock aria-hidden className="h-3.5 w-3.5 flex-none text-[var(--muted)]" />
      </div>
      <span className="text-[12px] text-[var(--muted)]">{t("task.storageNote")}</span>
    </div>
  );
}

/**
 * Stock Out "expected lots" (D-R4-3), advisory only. Lots at MAIN / DEFAULT
 * that the server may issue from: batch-linked, not expired, something
 * available. FEFO lists them by expiry date (the server's FEFO key). FIFO
 * cannot be ordered honestly (receipt dates are not available to the client),
 * so FIFO lists the same lots without claiming an order. No per-lot split is
 * ever promised.
 */
export function LotPreview({ storage, strategy }: { storage: DefaultStorage; strategy: StockOutStrategy }) {
  const t = useT();
  if (storage.status === "loading") return <p className="text-[12px] text-[var(--muted)]">{t("task.lotsLoading")}</p>;
  if (storage.status === "error") return <p className="text-[12px] text-[var(--danger)]">{t("task.lotsUnavailable")}</p>;
  if (storage.status !== "ready") return null;
  const eligible = storage.rows.filter((r) => r.batch_id != null && !r.is_expired && compareDecimals(r.available_qty, "0") > 0);
  const lots =
    strategy === "fefo"
      ? [...eligible].sort((a, b) => {
          if (a.batch_expiry_date === b.batch_expiry_date) return 0;
          if (!a.batch_expiry_date) return 1;
          if (!b.batch_expiry_date) return -1;
          return a.batch_expiry_date < b.batch_expiry_date ? -1 : 1;
        })
      : [...eligible].sort((a, b) => (a.batch_lot_no ?? "").localeCompare(b.batch_lot_no ?? ""));
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[12px] font-semibold text-[var(--muted)]">
        {t(strategy === "fefo" ? "task.lotsFefo" : "task.lotsFifo")}
      </span>
      {lots.length === 0 ? (
        <p className="text-[12px] text-[var(--muted)]">{t("task.noEligibleLots")}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-[var(--border)] rounded-[var(--r-sm)] border border-[var(--border)]">
          {lots.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <LotChip lot={r.batch_lot_no ?? null} expiryDate={r.batch_expiry_date} daysToExpiry={r.days_to_expiry} />
              <span className="text-[12px] text-[var(--muted)]">
                {t("qty.available")} <QuantityDisplay value={r.available_qty} className="font-semibold text-[var(--foreground)]" />
              </span>
            </li>
          ))}
        </ul>
      )}
      {strategy === "fifo" ? <p className="text-[12px] text-[var(--muted)]">{t("task.fifoOrderNote")}</p> : null}
      <p className="flex items-start gap-2 text-[12px] text-[var(--muted)]">
        <Info aria-hidden className="mt-[2px] h-3.5 w-3.5 flex-none" />
        {t("review.serverPicksLots")}
      </p>
    </div>
  );
}
