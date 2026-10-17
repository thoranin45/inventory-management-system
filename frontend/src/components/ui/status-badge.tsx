"use client";

import * as React from "react";

import { useT } from "@/lib/i18n/client";
import { CANONICAL_STATUS, TONE_ICON, humanizeStatus, isCanonicalStatus, type Tone } from "@/lib/status";
import { cn } from "@/lib/utils";

/** Concept B filled chips: tone text on its tinted fill, no outline. */
const TONE_CLASS: Record<Tone, string> = {
  neutral: "bg-[var(--surface-sunken)] text-[var(--muted)]",
  info: "bg-[var(--info-subtle)] text-[var(--info)]",
  accent: "bg-[var(--accent-subtle)] text-[var(--accent)]",
  success: "bg-[var(--success-subtle)] text-[var(--success)]",
  warning: "bg-[var(--warning-subtle)] text-[var(--warning)]",
  danger: "bg-[var(--danger-subtle)] text-[var(--danger)]",
};

/**
 * Status chip (R2.6). Never colour-only: an icon **and** a text label always
 * render. A known API status gets its typed tone, icon and translated label;
 * an unknown one is shown humanized and neutral (`data-status-unmapped`).
 * Caller `label` / `tone` overrides keep working exactly as before.
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
  const t = useT();
  const known = status !== undefined && isCanonicalStatus(status) ? CANONICAL_STATUS[status] : null;
  const finalTone: Tone = tone ?? known?.tone ?? "neutral";
  const Icon = known && !tone ? known.icon : TONE_ICON[finalTone];
  const finalLabel = label ?? (known ? t(known.labelKey) : status ? humanizeStatus(status) : "");
  return (
    <span
      data-tone={finalTone}
      data-status-unmapped={status !== undefined && !known ? "" : undefined}
      className={cn(
        "inline-flex h-[22px] flex-none items-center gap-[5px] whitespace-nowrap rounded-[var(--r-xs)] px-[7px] text-[12px] font-semibold leading-none",
        TONE_CLASS[finalTone],
        className,
      )}
    >
      <Icon aria-hidden className="h-[14px] w-[14px] flex-none" />
      {finalLabel}
    </span>
  );
}
