"use client";

import * as React from "react";
import { Minus, Plus } from "lucide-react";

import { ExpiryBadge } from "@/components/ui/expiry-badge";
import { QuantityDisplay } from "@/components/ui/quantity-display";
import { compareDecimals, type DecimalString } from "@/lib/decimal";
import { cn } from "@/lib/utils";

export interface WorkLineExpiry {
  days: number | null;
  iso: string | null;
  isExpired?: boolean;
}

/**
 * One order line in a picking / packing console. Quantities are decimal
 * strings; completeness is an exact BigInt comparison, never a float.
 *
 * `−` is intentionally inert: the backend has no decrement/arbitrary-quantity
 * mutation for fulfillment progress — it is set by scanning only. It is shown
 * disabled (with an explanation) to keep the approved layout, per the brief.
 * `+` performs a single backend-confirmed unit scan.
 */
export const WorkLine = React.memo(function WorkLine({
  anchorId,
  name,
  sku,
  lotLabel,
  expiry,
  done,
  required,
  verb,
  onPlusOne,
  plusDisabledReason,
  busy,
  flash,
}: {
  anchorId: string;
  name: string;
  sku: string;
  lotLabel?: string | null;
  expiry?: WorkLineExpiry | null;
  done: DecimalString;
  required: DecimalString;
  /** "picked" | "packed" — used only for the − tooltip copy */
  verb: string;
  onPlusOne?: () => void;
  plusDisabledReason?: string;
  busy?: boolean;
  flash?: "hit" | "miss" | null;
}) {
  const full = compareDecimals(done, required) >= 0;
  const plusDisabled = full || busy || !onPlusOne || !!plusDisabledReason;

  return (
    <div
      id={anchorId}
      className={cn(
        "wc-work-line grid grid-cols-[1fr_auto] items-center gap-x-[14px] gap-y-2 rounded-[var(--r-md)] border bg-[var(--surface)] p-[13px_15px] max-[540px]:grid-cols-1",
        full ? "border-[color-mix(in_srgb,var(--success)_40%,transparent)]" : "border-[var(--border)]",
        flash === "hit" && "wc-line-hit",
        flash === "miss" && "wc-line-miss",
      )}
    >
      <div className="min-w-0">
        <div className="text-[13.5px] font-semibold">{name}</div>
        <div className="mt-[3px] flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-[var(--muted)]">
          <span className="mono">{sku}</span>
          {lotLabel ? <span>lot {lotLabel}</span> : <span className="text-[var(--faint)]">non-batch</span>}
          {expiry && (expiry.iso || expiry.days != null) ? (
            <ExpiryBadge days={expiry.days} isoDate={expiry.iso} />
          ) : null}
        </div>
      </div>

      <div
        className={cn(
          "flex items-center justify-end gap-1 tabular-nums max-[540px]:justify-start",
          full && "text-[var(--success)]",
        )}
      >
        <button
          type="button"
          aria-label={`decrease ${name}`}
          disabled
          title={`${verb} quantity is set by scanning and can't be decreased here`}
          className="grid h-8 w-8 flex-none place-items-center rounded-[var(--r-sm)] border border-[var(--border-strong)] text-[var(--muted)] opacity-40"
        >
          <Minus aria-hidden className="h-[14px] w-[14px]" />
        </button>
        <span className="mx-1 min-w-[64px] text-center text-[15px] font-semibold">
          <QuantityDisplay value={done} />
          <span className="font-normal text-[var(--faint)]">
            {" / "}
            <QuantityDisplay value={required} />
          </span>
        </span>
        <button
          type="button"
          aria-label={`scan one ${name}`}
          onClick={onPlusOne}
          disabled={plusDisabled}
          title={plusDisabledReason || (full ? "Line complete" : "Count one unit (backend-confirmed)")}
          className="grid h-8 w-8 flex-none place-items-center rounded-[var(--r-sm)] border border-[var(--border-strong)] hover:border-[var(--accent)] hover:bg-[var(--accent-subtle)] disabled:opacity-40 disabled:hover:border-[var(--border-strong)] disabled:hover:bg-transparent"
        >
          <Plus aria-hidden className="h-[14px] w-[14px]" />
        </button>
      </div>
    </div>
  );
});
