"use client";

import * as React from "react";
import { Check } from "lucide-react";

import { QuantityDisplay } from "@/components/ui/quantity-display";
import { ExpiryBadge } from "@/components/ui/expiry-badge";
import { compareDecimals, isDecimalString, subtractDecimals, type DecimalString } from "@/lib/decimal";
import { EXPIRY_STATE_LABEL, daysUntil, expiryState } from "@/lib/business-date";
import type { ProductLite } from "@/lib/query/sales";
import type { ReceiptDraftLine } from "@/lib/receipt-draft";
import { cn } from "@/lib/utils";

const inputCls =
  "min-h-11 rounded-[var(--r-sm)] border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-[13px] tabular-nums outline-none focus-visible:outline-2 focus-visible:outline-[var(--focus)]";

/** Per-line client validation. Mirrors the backend rules EXCEPT it never blocks
 *  an expired / same-day expiry date (Phase 7 accepts those inbound). */
export function validateReceiveLine(
  product: ProductLite | undefined,
  line: ReceiptDraftLine,
  remaining: DecimalString,
): string | null {
  const q = (line.quantity ?? "").trim();
  if (!q) return null; // empty line = not part of this receipt
  if (!isDecimalString(q) || Number(q) <= 0) return "Enter a quantity greater than 0";
  if ((q.split(".")[1]?.length ?? 0) > 3) return "At most 3 decimal places";
  if (compareDecimals(q, remaining) > 0) return `Only ${remaining} remaining on this line`;
  if (!product) return null;
  const lot = (line.lot_no ?? "").trim();
  const mfg = (line.mfg_date ?? "").trim();
  const exp = (line.expiry_date ?? "").trim();
  if (!product.track_batch) {
    if (lot || mfg || exp) return "This product is not batch-tracked — clear the lot / date fields";
    return null;
  }
  if (!lot) return "Lot number is required for this product";
  if (product.track_expiry && (!mfg || !exp)) return "Manufacturing and expiry dates are required";
  if (mfg && exp && exp <= mfg) return "Expiry date must be after the manufacturing date";
  return null;
}

export function ReceiveLine({
  anchorId,
  product,
  productId,
  ordered,
  receivedToDate,
  remaining,
  line,
  onChange,
  highlight,
}: {
  anchorId: string;
  product: ProductLite | undefined;
  productId: number;
  ordered: DecimalString;
  receivedToDate: DecimalString;
  remaining: DecimalString;
  line: ReceiptDraftLine;
  onChange: (patch: ReceiptDraftLine) => void;
  highlight?: boolean;
}) {
  const complete = compareDecimals(remaining, "0") <= 0;
  const q = (line.quantity ?? "").trim();
  const err = validateReceiveLine(product, line, remaining);
  const remainingAfter =
    isDecimalString(q) && Number(q) > 0 && !err ? subtractDecimals(remaining, q, 3) : remaining;
  const expState = expiryState(line.expiry_date || null);
  const name = product?.product_name ?? `Product #${productId}`;
  const sku = product?.sku ?? String(productId);
  const trackHint = !product
    ? ""
    : product.track_batch && product.track_expiry
      ? "batch · expiry"
      : product.track_batch
        ? "batch"
        : "non-batch";

  return (
    <div
      id={anchorId}
      className={cn(
        "rounded-[var(--r-md)] border bg-[var(--surface)] p-[13px_15px]",
        complete
          ? "border-[color-mix(in_srgb,var(--success)_40%,transparent)]"
          : highlight
            ? "border-[var(--accent)] ring-2 ring-[var(--accent-subtle)]"
            : "border-[var(--border)]",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[13.5px] font-semibold">{name}</div>
          <div className="mt-[3px] text-[11.5px] text-[var(--muted)]">
            <span className="mono">{sku}</span>
            {trackHint ? <span> · {trackHint}</span> : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-[var(--muted)]">
          <span>
            Ordered <QuantityDisplay value={ordered} className="text-[var(--foreground)]" />
          </span>
          <span>
            Received <QuantityDisplay value={receivedToDate} className="text-[var(--foreground)]" />
          </span>
          <span>
            Remaining <QuantityDisplay value={remaining} className="text-[var(--foreground)]" />
          </span>
        </div>
      </div>

      {complete ? (
        <div className="mt-2 inline-flex items-center gap-1 text-[12px] text-[var(--success)]">
          <Check aria-hidden className="h-[13px] w-[13px]" /> line fully received
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1" htmlFor={`${anchorId}-qty`}>
              <span className="text-[11px] font-semibold text-[var(--muted)]">Receive now</span>
              <input
                id={`${anchorId}-qty`}
                inputMode="decimal"
                autoComplete="off"
                className={cn(inputCls, err && "border-[var(--danger)]")}
                placeholder="0.000"
                value={line.quantity ?? ""}
                onChange={(e) => onChange({ quantity: e.target.value })}
              />
            </label>
            {product?.track_batch ? (
              <label className="flex flex-col gap-1" htmlFor={`${anchorId}-lot`}>
                <span className="text-[11px] font-semibold text-[var(--muted)]">Lot number</span>
                <input
                  id={`${anchorId}-lot`}
                  autoComplete="off"
                  className={inputCls}
                  placeholder="LOT-…"
                  value={line.lot_no ?? ""}
                  onChange={(e) => onChange({ lot_no: e.target.value })}
                />
              </label>
            ) : null}
          </div>

          {product?.track_batch && product?.track_expiry ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1" htmlFor={`${anchorId}-mfg`}>
                <span className="text-[11px] font-semibold text-[var(--muted)]">Manufacturing date</span>
                <input
                  id={`${anchorId}-mfg`}
                  type="date"
                  className={inputCls}
                  value={line.mfg_date ?? ""}
                  onChange={(e) => onChange({ mfg_date: e.target.value })}
                />
              </label>
              <label className="flex flex-col gap-1" htmlFor={`${anchorId}-exp`}>
                <span className="text-[11px] font-semibold text-[var(--muted)]">Expiry date</span>
                <input
                  id={`${anchorId}-exp`}
                  type="date"
                  className={inputCls}
                  value={line.expiry_date ?? ""}
                  onChange={(e) => onChange({ expiry_date: e.target.value })}
                />
              </label>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px]">
            <span className="text-[var(--muted)]">
              Remaining after this receipt: <QuantityDisplay value={remainingAfter} className="font-semibold text-[var(--foreground)]" />
            </span>
            {expState ? (
              <span className="inline-flex items-center gap-1">
                <ExpiryBadge days={daysUntil(line.expiry_date || "")} isoDate={line.expiry_date} />
                <span
                  className={cn(
                    expState === "expired" && "text-[var(--danger)]",
                    (expState === "same-day" || expState === "near") && "text-[var(--warning)]",
                  )}
                >
                  {EXPIRY_STATE_LABEL[expState]}
                </span>
              </span>
            ) : null}
          </div>

          {err ? <p className="text-[11px] text-[var(--danger)]">{err}</p> : null}
        </div>
      )}
    </div>
  );
}
