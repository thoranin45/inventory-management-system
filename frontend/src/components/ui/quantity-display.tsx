import * as React from "react";
import { ArrowRight } from "lucide-react";

import { formatMoney, formatQty, formatQtyDelta, qtyScaleAnomaly } from "@/lib/format";
import type { DecimalString } from "@/lib/decimal";
import { cn } from "@/lib/utils";
import { Msg } from "./msg";

/**
 * Renders a backend inventory quantity in the Concept B form: fixed 3
 * decimals, exact, never rounded (`formatQty`). The RAW value is preserved on
 * `data-raw` and `title`. A value with more than 3 decimals is shown in full
 * and flagged with `data-scale-anomaly` (it should not occur; nothing is
 * hidden). `signed` shows an explicit +/− for changes. Tabular + plain-zero
 * via the `.qty` class.
 */
export function QuantityDisplay({
  value,
  className,
  signed = false,
  as: Tag = "span",
}: {
  value: DecimalString | number | null | undefined;
  className?: string;
  signed?: boolean;
  as?: React.ElementType;
}) {
  const raw = value === null || value === undefined ? "" : String(value);
  return (
    <Tag
      className={cn("qty", className)}
      data-raw={raw || undefined}
      data-scale-anomaly={qtyScaleAnomaly(value) ? "true" : undefined}
      title={raw || undefined}
    >
      {signed && typeof value !== "number" ? formatQtyDelta(value) : formatQty(value)}
    </Tag>
  );
}

/**
 * "before → after" for a quantity. `estimate` marks a client-side preview
 * that the backend has not confirmed (review sheets, approval previews).
 */
export function QuantityChange({
  before,
  after,
  estimate = false,
  className,
}: {
  before: DecimalString | null | undefined;
  after: DecimalString | null | undefined;
  estimate?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex flex-wrap items-baseline gap-x-[6px]", className)}>
      <QuantityDisplay value={before} />
      <ArrowRight aria-hidden className="h-3.5 w-3.5 self-center text-[var(--muted)]" />
      <span className="sr-only">
        <Msg k="qty.becomes" />
      </span>
      <QuantityDisplay value={after} className="font-semibold" />
      {estimate ? (
        <span className="text-[12px] font-normal text-[var(--muted)]">
          (<Msg k="qty.estimate" />)
        </span>
      ) : null}
    </span>
  );
}

export function MoneyDisplay({
  value,
  symbol = "฿",
  className,
  as: Tag = "span",
}: {
  value: DecimalString | number | null | undefined;
  symbol?: string;
  className?: string;
  as?: React.ElementType;
}) {
  const raw = value === null || value === undefined ? "" : String(value);
  return (
    <Tag className={cn("money", className)} data-raw={raw || undefined} title={raw || undefined}>
      {formatMoney(value, symbol)}
    </Tag>
  );
}
