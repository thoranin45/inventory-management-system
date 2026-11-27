"use client";

import { StatusBadge } from "@/components/ui/status-badge";
import { useT } from "@/lib/i18n/client";

/**
 * Quotation status chip (icon + text, never colour alone). EXPIRED is not a
 * stored status: the backend flags an ISSUED quotation past its valid-until
 * date with `is_expired`, and the chip says so.
 */
export function QuotationStatusBadge({ status, isExpired }: { status: string; isExpired: boolean }) {
  const t = useT();
  if (isExpired) return <StatusBadge status="EXPIRED" label={t("status.EXPIRED")} tone="warning" />;
  return <StatusBadge status={status.toUpperCase()} />;
}
