"use client";

import * as React from "react";

import { MoneyDisplay, QuantityDisplay } from "@/components/ui/quantity-display";
import { isDecimalString, sumDecimals } from "@/lib/decimal";
import { useT } from "@/lib/i18n/client";

/**
 * R5 (D-R5-1) — the inline summary of a draft Sales / Purchase Order, shown
 * above the create button instead of a separate review step. It only reads
 * the form: the total quantity is "—" while any entered quantity is still
 * partial or invalid (never a misleading number), and nothing is submitted
 * from here.
 */
export function OrderSummary({
  partyLabel,
  partyName,
  lines,
  grandTotal,
  note,
}: {
  partyLabel: string;
  partyName: string | null;
  lines: { product_id?: number; quantity?: string }[];
  grandTotal: string;
  note: string;
}) {
  const t = useT();
  const entered = lines.filter((l) => (l.product_id ?? 0) > 0 || (l.quantity ?? "").trim() !== "");
  const quantities = entered.map((l) => (l.quantity ?? "").trim());
  const allValid = quantities.length > 0 && quantities.every((q) => isDecimalString(q) && (q.split(".")[1]?.length ?? 0) <= 3);
  const totalQty = allValid ? sumDecimals(quantities, 3) : null;

  return (
    <section aria-label={t("orders.summary")} className="rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface-sunken)] p-3 text-[13px]">
      <h3 className="wc-section-label mb-2">{t("orders.summary")}</h3>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt className="text-[var(--muted)]">{partyLabel}</dt>
        <dd className="text-right">{partyName ?? "—"}</dd>
        <dt className="text-[var(--muted)]">{t("orders.lines")}</dt>
        <dd className="text-right tabular-nums">{entered.length}</dd>
        <dt className="text-[var(--muted)]">{t("orders.totalQuantity")}</dt>
        <dd className="text-right">{totalQty !== null ? <QuantityDisplay value={totalQty} /> : "—"}</dd>
        <dt className="font-semibold">{t("orders.grandTotal")}</dt>
        <dd className="text-right">
          <MoneyDisplay value={grandTotal} className="text-[15px] font-semibold" />
        </dd>
      </dl>
      <p className="mt-2 text-[12px] text-[var(--muted)]">{note}</p>
    </section>
  );
}
