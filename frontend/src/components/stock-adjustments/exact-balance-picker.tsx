"use client";

import * as React from "react";

import { QuantityDisplay } from "@/components/ui/quantity-display";
import { LocalDate } from "@/components/ui/local-date";
import { LotChip } from "@/components/ui/lot-chip";
import { useT } from "@/lib/i18n/client";
import type { StockBalanceRow } from "@/lib/api/schemas/stock";
import type { Warehouse } from "@/lib/api/schemas/warehouses";

/**
 * Phase 14D — one exact (warehouse, location, batch) balance a batch
 * adjustment may target. Only balances that already EXIST are offered: an
 * adjustment never creates one (D3).
 */
export interface BalanceOption {
  key: string;
  productId: number;
  warehouseId: number;
  locationId: number;
  batchId: number;
  warehouseLabel: string;
  locationLabel: string;
  lotNo: string;
  expiryDate: string | null;
  isExpired: boolean;
  onHand: string;
  reserved: string;
  available: string;
}

/**
 * Operational lot balances only: never transit, never inactive storage,
 * never an unbatched row. Expired lots are kept (they are exactly what an
 * expiry write-off targets) and clearly marked.
 */
export function operationalBatchOptions(balances: StockBalanceRow[], directory: Warehouse[]): BalanceOption[] {
  const options: BalanceOption[] = [];
  for (const b of balances) {
    if (b.is_transit || b.batch_id === null || b.warehouse_id === null || b.location_id === null) continue;
    const warehouse = directory.find((w) => w.id === b.warehouse_id);
    const location = warehouse?.locations.find((l) => l.id === b.location_id);
    if (!warehouse || !location || !warehouse.is_active || !location.is_active) continue;
    options.push({
      key: `${b.warehouse_id}:${b.location_id}:${b.batch_id}`,
      productId: b.product_id,
      warehouseId: b.warehouse_id,
      locationId: b.location_id,
      batchId: b.batch_id,
      warehouseLabel: `${warehouse.warehouse_name} (${warehouse.warehouse_code})`,
      locationLabel: location.location_name ?? location.location_code,
      lotNo: b.batch_lot_no ?? `Batch #${b.batch_id}`,
      expiryDate: b.batch_expiry_date,
      isExpired: b.is_expired,
      onHand: b.on_hand_qty,
      reserved: b.reserved_qty,
      available: b.available_qty,
    });
  }
  return options.sort((a, b) =>
    a.warehouseLabel === b.warehouseLabel
      ? a.locationLabel.localeCompare(b.locationLabel) || a.lotNo.localeCompare(b.lotNo)
      : a.warehouseLabel.localeCompare(b.warehouseLabel),
  );
}

export function ExactBalancePicker({
  options,
  loading,
  error,
  selectedKey,
  onPick,
}: {
  options: BalanceOption[];
  loading: boolean;
  error: boolean;
  selectedKey: string | null;
  onPick: (option: BalanceOption) => void;
}) {
  const t = useT();
  if (loading) {
    return <p className="text-[13px] text-[var(--muted)]">{t("adjust.lotsLoading")}</p>;
  }
  if (error) {
    return (
      <p role="alert" className="text-[13px] text-[var(--danger)]">
        {t("adjust.lotsError")}
      </p>
    );
  }
  if (options.length === 0) {
    return (
      <p className="rounded-[var(--r-md)] border border-dashed border-[var(--border)] p-4 text-center text-[13px] text-[var(--muted)]">
        {t("adjust.lotsNone")}
      </p>
    );
  }
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-[12px] text-[var(--muted)]">{t("adjust.lotsLegend")}</legend>
      {options.map((o) => {
        const active = o.key === selectedKey;
        return (
          <button
            key={o.key}
            type="button"
            aria-pressed={active}
            onClick={() => onPick(o)}
            className={
              "flex flex-col gap-1 rounded-[var(--r-sm)] border px-3 py-2 text-left transition-colors sm:flex-row sm:items-center sm:justify-between " +
              (active
                ? "border-[var(--accent)] bg-[var(--accent-subtle)]"
                : "border-[var(--border-strong)] bg-[var(--surface)] hover:border-[var(--accent)]")
            }
          >
            <span className="flex min-w-0 flex-col gap-1">
              <span className="flex flex-wrap items-center gap-2 text-[14px] font-semibold">
                <LotChip lot={o.lotNo} />
                {o.isExpired ? (
                  <span className="rounded-[var(--r-full)] bg-[var(--danger-subtle)] px-2 py-[1px] text-[12px] font-semibold text-[var(--danger)]">
                    {t("adjust.expired")}
                  </span>
                ) : null}
              </span>
              <span className="text-[12px] text-[var(--muted)]">
                {o.warehouseLabel} · {o.locationLabel}
                {o.expiryDate ? (
                  <>
                    {" · "}
                    {t("adjust.exp")} <LocalDate iso={o.expiryDate} isoInEnglish />
                  </>
                ) : null}
              </span>
            </span>
            {/* phrasing content only — a button cannot hold the <dl> StockTriad */}
            <span className="grid grid-cols-3 gap-3 text-[12px] tabular-nums">
              <span className="flex flex-col">
                <span className="text-[var(--muted)]">{t("qty.onHand")}</span>
                <QuantityDisplay value={o.onHand} className="font-semibold" />
              </span>
              <span className="flex flex-col">
                <span className="text-[var(--muted)]">{t("qty.reserved")}</span>
                <QuantityDisplay value={o.reserved} />
              </span>
              <span className="flex flex-col">
                <span className="text-[var(--muted)]">{t("qty.available")}</span>
                <QuantityDisplay value={o.available} className="font-semibold" />
              </span>
            </span>
          </button>
        );
      })}
    </fieldset>
  );
}
