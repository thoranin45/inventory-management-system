import * as React from "react";

import { cn } from "@/lib/utils";

type Tone = "neutral" | "info" | "accent" | "success" | "warning" | "danger";

const TONE_CLASS: Record<Tone, string> = {
  neutral: "bg-[var(--surface-sunken)] text-[var(--muted)] border-[var(--border)]",
  info: "bg-[var(--info-subtle)] text-[var(--info)] border-[color-mix(in_srgb,var(--info)_30%,transparent)]",
  accent: "bg-[var(--accent-subtle)] text-[var(--accent)] border-[var(--accent-line)]",
  success:
    "bg-[var(--success-subtle)] text-[var(--success)] border-[color-mix(in_srgb,var(--success)_30%,transparent)]",
  warning:
    "bg-[var(--warning-subtle)] text-[var(--warning)] border-[color-mix(in_srgb,var(--warning)_32%,transparent)]",
  danger:
    "bg-[var(--danger-subtle)] text-[var(--danger)] border-[color-mix(in_srgb,var(--danger)_32%,transparent)]",
};

/** SO/PO/Transfer lifecycle → tone + human label. */
const STATUS_META: Record<string, { tone: Tone; label: string }> = {
  DRAFT: { tone: "neutral", label: "Draft" },
  CONFIRMED: { tone: "info", label: "Confirmed" },
  PICKING: { tone: "info", label: "Picking" },
  PACKING: { tone: "info", label: "Packing" },
  READY_TO_SHIP: { tone: "accent", label: "Ready to ship" },
  IN_TRANSIT: { tone: "accent", label: "In transit" },
  SHIPPED: { tone: "success", label: "Shipped" },
  PARTIALLY_RECEIVED: { tone: "warning", label: "Partially received" },
  RECEIVED: { tone: "success", label: "Received" },
  COMPLETED: { tone: "success", label: "Completed" },
  CANCELLED: { tone: "danger", label: "Cancelled" },
  active: { tone: "success", label: "Active" },
  inactive: { tone: "neutral", label: "Inactive" },
};

export function statusMeta(status: string): { tone: Tone; label: string } {
  return STATUS_META[status] ?? { tone: "neutral", label: status.replace(/_/g, " ").toLowerCase() };
}

/**
 * Status is never colour-only: a dot **and** a text label always render, so
 * the state is legible without perceiving hue.
 */
export function StatusBadge({
  status,
  tone,
  label,
  className,
}: {
  status?: string;
  tone?: Tone;
  label?: React.ReactNode;
  className?: string;
}) {
  const meta = status ? statusMeta(status) : { tone: tone ?? "neutral", label: "" };
  const finalTone = tone ?? meta.tone;
  const finalLabel = label ?? meta.label;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-[5px] whitespace-nowrap rounded-[var(--r-full)] border px-2 py-[2px] text-[11px] font-semibold tracking-[0.02em]",
        TONE_CLASS[finalTone],
        className,
      )}
    >
      <span aria-hidden className="h-[6px] w-[6px] flex-none rounded-[var(--r-full)] bg-current" />
      {finalLabel}
    </span>
  );
}
