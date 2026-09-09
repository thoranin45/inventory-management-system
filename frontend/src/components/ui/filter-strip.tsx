"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

export interface FilterOption {
  key: string;
  label: string;
  count?: number;
}

/**
 * Production version of the Phase 0.6 segmented filter strip.
 *  - flex-wrap: nowrap, horizontal-scrolls on narrow screens (only the strip,
 *    never the page)
 *  - ≥44px touch targets, clear active state, labels never overlap or clip
 */
export function FilterStrip({
  options,
  value,
  onChange,
  className,
  ariaLabel = "Filter",
}: {
  options: FilterOption[];
  value: string;
  onChange: (key: string) => void;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        "wc-scrollbar-none flex max-w-full flex-nowrap gap-[2px] overflow-x-auto rounded-[var(--r-sm)] border border-[var(--border)] bg-[var(--surface-sunken)] p-[2px]",
        className,
      )}
    >
      {options.map((o) => {
        const active = o.key === value;
        return (
          <button
            key={o.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(o.key)}
            className={cn(
              "flex flex-none items-center gap-[5px] whitespace-nowrap rounded-[var(--r-xs)] px-3 text-[12px] font-semibold transition-colors duration-[var(--dur-1)]",
              "min-h-9 max-[1023.98px]:min-h-11",
              active
                ? "bg-[var(--surface)] text-[var(--foreground)] shadow-[var(--shadow-sm)]"
                : "text-[var(--muted)] hover:text-[var(--foreground)]",
            )}
          >
            {o.label}
            {o.count !== undefined ? (
              <span className="tnum text-[10px] font-medium opacity-70">{o.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
