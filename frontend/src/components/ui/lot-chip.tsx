import * as React from "react";
import { Layers } from "lucide-react";

import { cn } from "@/lib/utils";
import { ExpiryBadge } from "./expiry-badge";
import { Msg } from "./msg";

/**
 * Concept B lot identity: the lot number (mono, never translated), its expiry
 * state as icon + text, and optionally the storage location code. A balance
 * without a lot reads "No lot" rather than an invented label.
 */
export function LotChip({
  lot,
  expiryDate,
  daysToExpiry,
  location,
  className,
}: {
  lot: string | null | undefined;
  expiryDate?: string | null;
  daysToExpiry?: number | null;
  location?: string | null;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1", className)}>
      <span className="inline-flex items-center gap-[5px] text-[13px]">
        <Layers aria-hidden className="h-3.5 w-3.5 flex-none text-[var(--muted)]" />
        {lot ? (
          <span className="mono font-medium">{lot}</span>
        ) : (
          <span className="text-[var(--muted)]">
            <Msg k="qty.noLot" />
          </span>
        )}
      </span>
      {expiryDate !== undefined || daysToExpiry !== undefined ? (
        <ExpiryBadge days={daysToExpiry} isoDate={expiryDate} />
      ) : null}
      {location ? <span className="mono text-[12px] text-[var(--muted)]">{location}</span> : null}
    </span>
  );
}
