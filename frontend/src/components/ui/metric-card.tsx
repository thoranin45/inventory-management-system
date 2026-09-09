import * as React from "react";
import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * KPI tile from the approved dashboard. `hero` renders the emphasised
 * primary card (filled with --primary). `tone` colours only the value
 * (danger/warning) — the label always carries the meaning in text.
 */
export function MetricCard({
  label,
  value,
  sub,
  href,
  hero = false,
  tone,
  className,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  href?: string;
  hero?: boolean;
  tone?: "danger" | "warning";
  className?: string;
}) {
  const body = (
    <>
      <div
        className={cn(
          "text-[10px] font-semibold uppercase tracking-[0.09em]",
          hero ? "text-[var(--primary-fg)]/[0.66]" : "text-[var(--faint)]",
        )}
      >
        {label}
      </div>
      <div
        className={cn(
          "qty mt-[2px] font-semibold",
          hero ? "text-[40px] leading-[1.04] tracking-[-0.01em] text-[var(--primary-fg)]" : "text-[22px]",
          !hero && tone === "danger" && "text-[var(--danger)]",
          !hero && tone === "warning" && "text-[var(--warning)]",
        )}
      >
        {value}
      </div>
      {sub ? (
        <div className={cn("text-[11px]", hero ? "text-[var(--primary-fg)]/[0.66]" : "text-[var(--muted)]")}>
          {sub}
        </div>
      ) : null}
    </>
  );

  const classes = cn(
    "flex min-h-[94px] flex-col justify-center gap-[3px] rounded-[var(--r-lg)] border p-4 text-left shadow-[var(--shadow-panel)] transition-colors duration-[var(--dur-1)] focus-visible:outline-2 focus-visible:outline-[var(--accent)] focus-visible:outline-offset-2",
    hero
      ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-fg)] hover:brightness-[1.07]"
      : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border-strong)]",
    className,
  );

  if (href) {
    return (
      <Link href={href} className={classes}>
        {body}
      </Link>
    );
  }
  return <div className={classes}>{body}</div>;
}
