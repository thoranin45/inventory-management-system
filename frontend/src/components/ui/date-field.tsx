"use client";

import * as React from "react";

import { formatDisplayDate, isIsoDate, normalizeBuddhistEraIso } from "@/lib/business-date";
import { useI18n } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

/**
 * Concept B date field (decision D-R4-8). The control is the native date
 * input, so the value is always a Gregorian ISO `YYYY-MM-DD` date (or "") —
 * exactly what the backend already receives; no time zone is ever applied.
 * Under it, the chosen date is shown in the UI language: Thai uses the
 * Buddhist-era year ("30 ก.ย. 2570"). In Thai, a Buddhist-era year typed into
 * the input (2570) is converted to Gregorian (2027) before it reaches the form.
 */
export function DateField({
  id,
  label,
  value,
  onChange,
  max,
  min,
  className,
  inputClassName,
  describedBy,
  invalid,
}: {
  id: string;
  label: React.ReactNode;
  value: string;
  onChange: (iso: string) => void;
  max?: string;
  min?: string;
  className?: string;
  inputClassName?: string;
  describedBy?: string;
  invalid?: boolean;
}) {
  const { locale } = useI18n();
  const hintId = `${id}-local`;
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label htmlFor={id} className="text-[12px] text-[var(--muted)]">
        {label}
      </label>
      <input
        id={id}
        type="date"
        className={inputClassName}
        value={value}
        max={max}
        min={min}
        aria-invalid={invalid || undefined}
        aria-describedby={[hintId, describedBy].filter(Boolean).join(" ") || undefined}
        onChange={(e) => {
          const raw = e.target.value;
          onChange(locale === "th" ? normalizeBuddhistEraIso(raw) : raw);
        }}
      />
      <span id={hintId} className="text-[12px] text-[var(--muted)]" aria-live="polite">
        {isIsoDate(value) ? formatDisplayDate(value, locale) : " "}
      </span>
    </div>
  );
}
