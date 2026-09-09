import { AlertTriangle, Clock } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Expiry state for a batch/allocation. Icon + text, never colour alone.
 *   days < 0   → expired (danger)
 *   0..90      → near expiry (warning)
 *   > 90       → ok (neutral)
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
        no expiry
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
  const label = expired
    ? `expired ${Math.abs(days)}d`
    : near
      ? `${days}d left`
      : isoDate
        ? `exp ${isoDate.slice(0, 10)}`
        : "in date";
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
