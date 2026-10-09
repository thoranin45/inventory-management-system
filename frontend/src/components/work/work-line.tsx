"use client";

import * as React from "react";
import { ScanLine, Undo2 } from "lucide-react";

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
 * Phase 12C:
 *   [Scan +1] does NOT mutate — it targets this line so the next physical scan
 *   (hardware wedge, camera or typed) is attributed to it. One scan is still
 *   one backend round-trip; the backend response is the authority.
 *   [Undo] is a real backend `undo-pick` / `undo-pack` of one unit.
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
  onTargetScan,
  targetDisabledReason,
  targeted,
  onUndo,
  undoDisabledReason,
  lastActivity,
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
  /** "picked" | "packed" — used in copy */
  verb: string;
  /** target this line for the next scan (no mutation) */
  onTargetScan?: () => void;
  targetDisabledReason?: string;
  targeted?: boolean;
  /** reverse one unit of confirmed progress on this line */
  onUndo?: () => void;
  undoDisabledReason?: string;
  /** short local activity note, e.g. "↶ Pick undone · -1" */
  lastActivity?: React.ReactNode;
  busy?: boolean;
  flash?: "hit" | "miss" | null;
}) {
  const full = compareDecimals(done, required) >= 0;
  const none = compareDecimals(done, "0") <= 0;
  const targetDisabled = full || busy || !onTargetScan || !!targetDisabledReason;
  const undoDisabled = none || busy || !onUndo || !!undoDisabledReason;

  return (
    <div
      id={anchorId}
      className={cn(
        "wc-work-line grid grid-cols-[1fr_auto] items-center gap-x-[14px] gap-y-2 rounded-[var(--r-md)] border bg-[var(--surface)] p-[13px_15px] max-[540px]:grid-cols-1",
        full
          ? "border-[color-mix(in_srgb,var(--success)_40%,transparent)]"
          : targeted
            ? "border-[var(--accent)] ring-1 ring-[var(--accent)]"
            : "border-[var(--border)]",
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
        {targeted && !full ? (
          <div className="mt-[5px] text-[11px] font-medium text-[var(--accent)]">
            Waiting for a scan of this item…
          </div>
        ) : null}
        {lastActivity ? (
          <div className="mt-[5px] text-[11px] text-[var(--muted)]">{lastActivity}</div>
        ) : null}
      </div>

      <div
        className={cn(
          "flex items-center justify-end gap-1 tabular-nums max-[540px]:justify-start",
          full && "text-[var(--success)]",
        )}
      >
        <button
          type="button"
          aria-label={`undo one ${name}`}
          onClick={onUndo}
          disabled={undoDisabled}
          title={undoDisabledReason || (none ? `Nothing ${verb.toLowerCase()} to undo` : `Undo one ${verb.toLowerCase()} unit`)}
          className="grid h-8 w-8 flex-none place-items-center rounded-[var(--r-sm)] border border-[var(--border-strong)] hover:border-[var(--danger)] hover:bg-[var(--danger-subtle)] disabled:opacity-40 disabled:hover:border-[var(--border-strong)] disabled:hover:bg-transparent"
        >
          <Undo2 aria-hidden className="h-[14px] w-[14px]" />
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
          onClick={onTargetScan}
          disabled={targetDisabled}
          title={targetDisabledReason || (full ? "Line complete" : "Target this line for the next scan")}
          className={cn(
            "inline-flex h-8 flex-none items-center gap-1 rounded-[var(--r-sm)] border px-2 text-[12px] font-medium",
            targeted && !full
              ? "border-[var(--accent)] bg-[var(--accent-subtle)] text-[var(--accent)]"
              : "border-[var(--border-strong)] hover:border-[var(--accent)] hover:bg-[var(--accent-subtle)]",
            "disabled:opacity-40 disabled:hover:border-[var(--border-strong)] disabled:hover:bg-transparent",
          )}
        >
          <ScanLine aria-hidden className="h-[14px] w-[14px]" />
          Scan +1
        </button>
      </div>
    </div>
  );
});
