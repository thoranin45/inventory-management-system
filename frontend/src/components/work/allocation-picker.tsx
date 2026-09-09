"use client";

import * as React from "react";
import { TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { ExpiryBadge } from "@/components/ui/expiry-badge";
import { QuantityDisplay } from "@/components/ui/quantity-display";
import { sortFefo, type AmbiguityCandidate } from "./scan-machine";
import { compareDecimals } from "@/lib/decimal";
import { cn } from "@/lib/utils";

/**
 * Ambiguity resolution — the backend rejected a scan with
 * ALLOCATION_IDENTIFICATION_REQUIRED. We never guess: the operator picks one
 * of the backend's own allocations. Candidates are ordered FEFO when the
 * resolve endpoint supplied expiry metadata; the earliest-expiry option is
 * marked as recommended but nothing is pre-selected.
 */
export function AllocationPicker({
  open,
  onOpenChange,
  productName,
  candidates,
  onChoose,
  onCancel,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  productName: string;
  candidates: AmbiguityCandidate[];
  onChoose: (allocationId: number) => void;
  onCancel: () => void;
}) {
  const ordered = React.useMemo(() => sortFefo(candidates), [candidates]);
  const hasExpiry = ordered.some((c) => c.expiry_date != null);

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onCancel();
        onOpenChange(v);
      }}
    >
      <DialogContent
        title={`Which batch — ${productName}?`}
        description={
          hasExpiry
            ? "More than one allocation matches this scan. Choose the batch to count against (earliest expiry first)."
            : "More than one allocation matches this scan. Choose the one to count against."
        }
      >
        <ul className="flex flex-col gap-2">
          {ordered.map((c, i) => {
            const expired = c.is_expired;
            const full = compareDecimals(c.done, c.quantity) >= 0;
            const firstOpen = ordered.findIndex((x) => compareDecimals(x.done, x.quantity) < 0) === i;
            return (
              <li key={c.allocation_id}>
                <button
                  type="button"
                  disabled={full}
                  onClick={() => onChoose(c.allocation_id)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-[var(--r-sm)] border p-3 text-left disabled:opacity-45",
                    firstOpen
                      ? "border-[var(--accent)] bg-[var(--accent-subtle)]"
                      : "border-[var(--border-strong)] hover:border-[var(--accent)]",
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="mono block text-[12.5px] font-semibold">
                      {c.lot_no ?? (c.batch_id != null ? `batch #${c.batch_id}` : "non-batch")}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--muted)]">
                      {c.expiry_date || c.days_to_expiry != null ? (
                        <ExpiryBadge days={c.days_to_expiry ?? null} isoDate={c.expiry_date ?? null} />
                      ) : null}
                      {expired ? (
                        <span className="inline-flex items-center gap-1 text-[var(--danger)]">
                          <TriangleAlert aria-hidden className="h-3 w-3" /> expired
                        </span>
                      ) : null}
                      <span>
                        <QuantityDisplay value={c.done} /> / <QuantityDisplay value={c.quantity} /> done
                      </span>
                    </span>
                  </span>
                  {full ? (
                    <span className="flex-none text-[10px] font-semibold text-[var(--success)]">done</span>
                  ) : firstOpen && hasExpiry ? (
                    <span className="flex-none rounded-[var(--r-full)] border border-[var(--accent-line)] bg-[var(--surface)] px-2 py-[2px] text-[10px] font-semibold text-[var(--accent)]">
                      FEFO
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>

        <div className="mt-1 flex justify-end">
          <DialogClose asChild>
            <Button variant="ghost" onClick={onCancel}>
              Cancel scan
            </Button>
          </DialogClose>
        </div>
      </DialogContent>
    </Dialog>
  );
}
