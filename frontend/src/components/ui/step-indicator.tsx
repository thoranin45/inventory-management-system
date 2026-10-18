"use client";

import * as React from "react";
import { Check } from "lucide-react";

import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

/**
 * Concept B progress steps. From 768 px every step is labelled; below that the
 * frozen spec's compact form shows "Step 2 of 4 · Details" with a segment bar
 * (no wrapping step labels on a phone). The current step has aria-current.
 */
export function StepIndicator({ steps, current, className }: { steps: string[]; current: number; className?: string }) {
  const t = useT();
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <ol className="wc-steps-full flex flex-wrap items-center gap-2" aria-label={t("review.progress")}>
        {steps.map((label, i) => {
          const state = i < current ? "done" : i === current ? "current" : "todo";
          return (
            <React.Fragment key={label}>
              {i > 0 ? <li aria-hidden className="h-px w-5 bg-[var(--border-strong)]" /> : null}
              <li
                aria-current={state === "current" ? "step" : undefined}
                className={cn(
                  "inline-flex items-center gap-2 text-[13px]",
                  state === "current" ? "font-semibold text-[var(--foreground)]" : "text-[var(--muted)]",
                )}
              >
                <span
                  className={cn(
                    "grid h-6 w-6 flex-none place-items-center rounded-full border text-[12px] font-semibold",
                    state === "done" && "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-fg)]",
                    state === "current" && "border-[var(--accent)] text-[var(--accent)]",
                    state === "todo" && "border-[var(--border-strong)]",
                  )}
                >
                  {state === "done" ? <Check aria-hidden className="h-3.5 w-3.5" /> : i + 1}
                </span>
                {label}
              </li>
            </React.Fragment>
          );
        })}
      </ol>
      {/* CSS shows exactly one of the two forms, so assistive tech gets one too */}
      <div className="wc-steps-compact flex flex-col gap-[6px]">
        <span className="text-[13px] font-semibold">
          {t("review.stepOf", { n: current + 1, total: steps.length })} · {steps[current]}
        </span>
        <span aria-hidden className="grid gap-1" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
          {steps.map((s, i) => (
            <span key={s} className={cn("h-1 rounded-full", i <= current ? "bg-[var(--accent)]" : "bg-[var(--border)]")} />
          ))}
        </span>
      </div>
    </div>
  );
}
