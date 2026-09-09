"use client";

import * as React from "react";

import { compareDecimals, ratio, type DecimalString } from "@/lib/decimal";
import { cn } from "@/lib/utils";

export interface MiniBarDatum {
  label: string;
  value: DecimalString;
  hint?: string;
}

/**
 * A bounded, accessible horizontal bar list — no chart library. The numeric
 * value is always shown as text beside each bar; the bar is decoration on top
 * of it. `ratio()` is the only place a Number is derived (for the CSS width).
 */
export function MiniBars({
  title,
  data,
  format,
  emptyLabel = "No data",
  className,
}: {
  title?: string;
  data: MiniBarDatum[];
  format: (v: DecimalString) => string;
  emptyLabel?: string;
  className?: string;
}) {
  const max = data.reduce<DecimalString>((m, d) => (compareDecimals(d.value, m) > 0 ? d.value : m), "0");

  return (
    <section className={cn("rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface)] p-4", className)}>
      {title ? <h3 className="wc-section-label mb-3">{title}</h3> : null}
      {data.length === 0 ? (
        <p className="text-[12px] text-[var(--muted)]">{emptyLabel}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {data.map((d, i) => {
            const pct = compareDecimals(max, "0") > 0 ? Math.round(ratio(d.value, max) * 100) : 0;
            return (
              <li key={`${d.label}-${i}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
                <span className="truncate text-[12px]" title={d.label}>
                  {d.label}
                </span>
                <span className="tnum text-[12px] font-semibold">{format(d.value)}</span>
                <span className="col-span-2 h-[6px] overflow-hidden rounded-[var(--r-full)] bg-[var(--surface-sunken)]">
                  <span
                    className="block h-full rounded-[var(--r-full)] bg-[var(--accent)]"
                    style={{ width: `${Math.max(pct, 2)}%` }}
                    aria-hidden
                  />
                </span>
                {d.hint ? <span className="col-span-2 text-[10.5px] text-[var(--faint)]">{d.hint}</span> : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Series-count summary strip (expiry chart) — plain numbers, no bars. */
export function CountStrip({ items }: { items: { label: string; value: number; tone?: "danger" | "warning" | "muted" }[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((it) => (
        <span
          key={it.label}
          className={cn(
            "inline-flex items-baseline gap-1 rounded-[var(--r-sm)] border px-3 py-2 text-[12px]",
            it.tone === "danger"
              ? "border-[color-mix(in_srgb,var(--danger)_30%,transparent)] bg-[var(--danger-subtle)] text-[var(--danger)]"
              : it.tone === "warning"
                ? "border-[color-mix(in_srgb,var(--warning)_30%,transparent)] bg-[var(--warning-subtle)] text-[var(--warning)]"
                : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)]",
          )}
        >
          <span className="tnum text-[15px] font-semibold">{it.value}</span>
          {it.label}
        </span>
      ))}
    </div>
  );
}
