"use client";

import * as React from "react";
import { Check, TriangleAlert } from "lucide-react";

import { QuantityDisplay } from "@/components/ui/quantity-display";
import { ExpiryBadge } from "@/components/ui/expiry-badge";
import { compareDecimals, isDecimalString, subtractDecimals, type DecimalString } from "@/lib/decimal";
import type { BatchExpiryInfo } from "@/lib/query/transfers";
import type { ProductLite } from "@/lib/query/sales";
import { cn } from "@/lib/utils";

const inputCls =
  "min-h-11 rounded-[var(--r-sm)] border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-[13px] tabular-nums outline-none focus-visible:outline-2 focus-visible:outline-[var(--focus)]";

/** Client validation for one transfer receive line. Never blocks an
 *  expired-in-transit batch — that receipt MUST still be allowed. */
export function validateTransferReceiveLine(quantity: string | undefined, outstanding: DecimalString): string | null {
  const q = (quantity ?? "").trim();
  if (!q) return null;
  if (!isDecimalString(q) || Number(q) <= 0) return "Enter a quantity greater than 0";
  if ((q.split(".")[1]?.length ?? 0) > 3) return "At most 3 decimal places";
  if (compareDecimals(q, outstanding) > 0) return `Only ${outstanding} still in transit for this line`;
  return null;
}

export function TransferReceiveLine({
  anchorId,
  product,
  productId,
  batchId,
  batchExpiry,
  dispatched,
  received,
  outstanding,
  quantity,
  onChange,
  highlight,
}: {
  anchorId: string;
  product: ProductLite | undefined;
  productId: number;
  batchId: number | null;
  batchExpiry?: BatchExpiryInfo;
  dispatched: DecimalString;
  received: DecimalString;
  outstanding: DecimalString;
  quantity: string | undefined;
  onChange: (quantity: string) => void;
  highlight?: boolean;
}) {
  const done = compareDecimals(outstanding, "0") <= 0;
  const err = validateTransferReceiveLine(quantity, outstanding);
  const q = (quantity ?? "").trim();
  const inTransitAfter =
    isDecimalString(q) && Number(q) > 0 && !err ? subtractDecimals(outstanding, q, 3) : outstanding;
  const expiredInTransit = batchExpiry?.is_expired === true;
  const name = product?.product_name ?? `Product #${productId}`;
  const sku = product?.sku ?? String(productId);

  return (
    <div
      id={anchorId}
      className={cn(
        "rounded-[var(--r-md)] border bg-[var(--surface)] p-[13px_15px]",
        done
          ? "border-[color-mix(in_srgb,var(--success)_40%,transparent)]"
          : highlight
            ? "border-[var(--accent)] ring-2 ring-[var(--accent-subtle)]"
            : "border-[var(--border)]",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[13.5px] font-semibold">{name}</div>
          <div className="mt-[3px] flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-[var(--muted)]">
            <span className="mono">{sku}</span>
            <span>{batchId != null ? `batch #${batchId}` : "non-batch"}</span>
            {batchExpiry && (batchExpiry.expiry_date || batchExpiry.days_to_expiry != null) ? (
              <ExpiryBadge days={batchExpiry.days_to_expiry} isoDate={batchExpiry.expiry_date} />
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-[var(--muted)]">
          <span>
            Dispatched <QuantityDisplay value={dispatched} className="text-[var(--foreground)]" />
          </span>
          <span>
            Received <QuantityDisplay value={received} className="text-[var(--foreground)]" />
          </span>
          <span>
            Outstanding <QuantityDisplay value={outstanding} className="text-[var(--foreground)]" />
          </span>
        </div>
      </div>

      {expiredInTransit && !done ? (
        <p className="mt-2 flex items-start gap-1.5 text-[11px] text-[var(--warning)]">
          <TriangleAlert aria-hidden className="mt-[1px] h-3 w-3 flex-none" />
          Expired in transit — receive required. Stock will stay owned at the destination but operationally ineligible. No
          substitution.
        </p>
      ) : null}

      {done ? (
        <div className="mt-2 inline-flex items-center gap-1 text-[12px] text-[var(--success)]">
          <Check aria-hidden className="h-[13px] w-[13px]" /> line fully received
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          <label className="flex max-w-[220px] flex-col gap-1" htmlFor={`${anchorId}-qty`}>
            <span className="text-[11px] font-semibold text-[var(--muted)]">Receive now</span>
            <input
              id={`${anchorId}-qty`}
              inputMode="decimal"
              autoComplete="off"
              className={cn(inputCls, err && "border-[var(--danger)]")}
              placeholder="0.000"
              value={quantity ?? ""}
              onChange={(e) => onChange(e.target.value)}
            />
          </label>
          <p className="text-[11.5px] text-[var(--muted)]">
            In transit after this receipt:{" "}
            <QuantityDisplay value={inTransitAfter} className="font-semibold text-[var(--foreground)]" />
          </p>
          {err ? <p className="text-[11px] text-[var(--danger)]">{err}</p> : null}
        </div>
      )}
    </div>
  );
}
