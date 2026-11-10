import * as React from "react";

import type { DecimalString } from "@/lib/decimal";
import { cn } from "@/lib/utils";
import { Msg } from "./msg";
import { QuantityDisplay } from "./quantity-display";

/**
 * Concept B "triad": On hand / Reserved / Available for one balance or
 * product, each a labelled exact 3-decimal quantity. Values come straight
 * from the backend; nothing is derived here. A missing value shows "—".
 */
export function StockTriad({
  onHand,
  reserved,
  available,
  className,
  compact = false,
}: {
  onHand: DecimalString | null | undefined;
  reserved: DecimalString | null | undefined;
  available: DecimalString | null | undefined;
  className?: string;
  compact?: boolean;
}) {
  const cells: { key: "qty.onHand" | "qty.reserved" | "qty.available"; value: DecimalString | null | undefined; strong?: boolean }[] = [
    { key: "qty.onHand", value: onHand },
    { key: "qty.reserved", value: reserved },
    { key: "qty.available", value: available, strong: true },
  ];
  return (
    <dl
      className={cn(
        "grid grid-cols-3 overflow-hidden rounded-[var(--r-sm)] border border-[var(--border)] bg-[var(--surface-sunken)]",
        className,
      )}
    >
      {cells.map((c, i) => (
        <div key={c.key} className={cn("flex min-w-0 flex-col gap-[2px] px-3", compact ? "py-[6px]" : "py-2", i > 0 && "border-l border-[var(--border)]")}>
          <dt className="text-[12px] text-[var(--muted)]">
            <Msg k={c.key} />
          </dt>
          <dd className={cn("truncate tabular-nums", compact ? "text-[13px]" : "text-[15px]", c.strong ? "font-semibold" : "font-medium")}>
            <QuantityDisplay value={c.value} />
          </dd>
        </div>
      ))}
    </dl>
  );
}
