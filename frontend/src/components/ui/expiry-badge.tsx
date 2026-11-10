import { AlertTriangle, Clock } from "lucide-react";

import { cn } from "@/lib/utils";
import { LocalDate } from "./local-date";
import { Msg } from "./msg";

/**
 * Expiry state for a batch/allocation. Icon + text, never colour alone.
 *   days < 0   → expired (danger)
 *   0..90      → near expiry (warning)
 *   > 90       → ok (neutral)
 * Wording follows the UI language; the English text is unchanged (ISO date),
 * Thai shows the Buddhist-era date.
 */
export function ExpiryBadge({
  days,
  isoDate,
  className,
}: {
  days: number | null | undefined;
  isoDate?: string | null;
  className?: string;
}) {
  if (days === null || days === undefined) {
    return (
      <span className={cn("inline-flex items-center gap-1 text-[11px] text-[var(--faint)]", className)}>
        <Msg k="qty.noExpiry" />
      </span>
    );
  }
  const expired = days < 0;
  const near = days >= 0 && days <= 90;
  const tone = expired
    ? "text-[var(--danger)] bg-[var(--danger-subtle)] border-[color-mix(in_srgb,var(--danger)_32%,transparent)]"
    : near
      ? "text-[var(--warning)] bg-[var(--warning-subtle)] border-[color-mix(in_srgb,var(--warning)_32%,transparent)]"
      : "text-[var(--muted)] bg-[var(--surface-sunken)] border-[var(--border)]";
  const Icon = expired ? Clock : near ? AlertTriangle : Clock;
  const label = expired ? (
    <Msg k="qty.expiredDays" vars={{ n: Math.abs(days) }} />
  ) : near ? (
    <Msg k="qty.daysLeft" vars={{ n: days }} />
  ) : isoDate ? (
    <>
      <Msg k="qty.expPrefix" /> <LocalDate iso={isoDate} isoInEnglish />
    </>
  ) : (
    <Msg k="qty.inDate" />
  );
  return (
    <span
      className={cn(
        "inline-flex items-center gap-[5px] rounded-[var(--r-full)] border px-2 py-[2px] text-[11px] font-semibold tnum",
        tone,
        className,
      )}
    >
      <Icon aria-hidden className="h-[11px] w-[11px] flex-none" />
      {label}
    </span>
  );
}
