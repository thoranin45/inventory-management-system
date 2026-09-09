import * as React from "react";

import { formatMoney, formatQty } from "@/lib/format";
import type { DecimalString } from "@/lib/decimal";
import { cn } from "@/lib/utils";

/**
 * Renders a backend fixed-scale quantity string in the approved 2-decimal
 * form. The RAW value is preserved on `data-raw` and `title` — never
 * converted to a float. Tabular + plain-zero via the `.qty` class.
 */
export function QuantityDisplay({
  value,
  className,
  as: Tag = "span",
}: {
  value: DecimalString | number | null | undefined;
  className?: string;
  as?: React.ElementType;
}) {
  const raw = value === null || value === undefined ? "" : String(value);
  return (
    <Tag
      className={cn("qty", className)}
      data-raw={raw || undefined}
      title={raw || undefined}
    >
      {formatQty(value)}
    </Tag>
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
