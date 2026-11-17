"use client";

import * as React from "react";
import { Ban, Check, CircleDashed, TriangleAlert } from "lucide-react";

import { useT } from "@/lib/i18n/client";
import { DICTIONARIES, type MessageKey } from "@/lib/i18n/translate";
import { cn } from "@/lib/utils";

type NodeState = "completed" | "current" | "upcoming" | "blocked";

const STATE_KEY: Record<NodeState, MessageKey> = {
  completed: "orders.stateDone",
  current: "orders.stateCurrent",
  upcoming: "orders.stateUpcoming",
  blocked: "orders.stateBlocked",
};

/** The translated lifecycle label of a backend status (unknown codes shown as sent). */
export function useStatusLabel() {
  const t = useT();
  return (status: string) => {
    const code = status.toUpperCase();
    return code in DICTIONARIES.en.status ? t(`status.${code}` as MessageKey) : status;
  };
}

/**
 * R5 shared order lifecycle (Concept B LifeSteps): one node per backend
 * status, vertical on phones and horizontal from 768 px. A node is never
 * colour-only — its icon SHAPE and a state word carry the state. CANCELLED is a
 * terminal branch shown as a single node instead of the pipeline.
 */
export function LifecycleSteps({
  pipeline,
  status,
  blocked,
  stepIcon,
  ariaLabelKey,
  cancelledNoteKey,
  className,
}: {
  pipeline: readonly string[];
  status: string;
  /** the current step cannot proceed (e.g. an expired allocation) */
  blocked?: boolean;
  stepIcon: Record<string, React.ComponentType<{ className?: string }>>;
  ariaLabelKey: MessageKey;
  cancelledNoteKey: MessageKey;
  className?: string;
}) {
  const t = useT();
  const label = useStatusLabel();
  const upper = status.toUpperCase();
  const currentIndex = pipeline.indexOf(upper);

  if (upper === "CANCELLED") {
    return (
      <ol className={cn("flex flex-col", className)} aria-label={t(ariaLabelKey)}>
        <li className="flex items-start gap-3 py-2">
          <span
            aria-hidden
            className="mt-[1px] grid h-6 w-6 flex-none place-items-center rounded-[var(--r-full)] border border-[color-mix(in_srgb,var(--danger)_45%,transparent)] bg-[var(--danger-subtle)] text-[var(--danger)]"
          >
            <Ban className="h-[13px] w-[13px]" />
          </span>
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-[var(--danger)]">{label("CANCELLED")}</div>
            <div className="text-[12px] text-[var(--muted)]">{t(cancelledNoteKey)}</div>
          </div>
        </li>
      </ol>
    );
  }

  return (
    <ol className={cn("flex flex-col min-[768px]:flex-row", className)} aria-label={t(ariaLabelKey)}>
      {pipeline.map((step, i) => {
        let state: NodeState;
        if (currentIndex < 0) state = "upcoming";
        else if (i < currentIndex) state = "completed";
        else if (i === currentIndex) state = blocked ? "blocked" : "current";
        else state = "upcoming";

        const StepIcon = stepIcon[step] ?? CircleDashed;
        const Icon = state === "completed" ? Check : state === "blocked" ? TriangleAlert : state === "upcoming" ? CircleDashed : StepIcon;
        const last = i === pipeline.length - 1;

        return (
          <li key={step} className="flex items-stretch gap-3 min-[768px]:flex-1 min-[768px]:flex-col min-[768px]:items-start min-[768px]:gap-2">
            <div className="flex flex-col items-center min-[768px]:w-full min-[768px]:flex-row">
              <span
                aria-hidden
                className={cn(
                  "grid h-6 w-6 flex-none place-items-center rounded-[var(--r-full)] border",
                  state === "completed" && "border-[var(--success)] bg-[var(--success-subtle)] text-[var(--success)]",
                  state === "current" && "border-[var(--accent)] bg-[var(--accent-subtle)] text-[var(--accent)]",
                  state === "blocked" && "border-[color-mix(in_srgb,var(--warning)_45%,transparent)] bg-[var(--warning-subtle)] text-[var(--warning)]",
                  state === "upcoming" && "border-[var(--border-strong)] bg-[var(--surface)] text-[var(--faint)]",
                )}
              >
                <Icon className="h-[13px] w-[13px]" />
              </span>
              {!last ? (
                <span
                  aria-hidden
                  className={cn(
                    "w-px flex-1 min-[768px]:mx-1 min-[768px]:h-px min-[768px]:w-auto",
                    i < currentIndex ? "bg-[var(--success)]" : "bg-[var(--border)]",
                  )}
                />
              ) : null}
            </div>
            <div className={cn("min-w-0 pb-4 min-[768px]:pb-0 min-[768px]:pr-2", last && "pb-0")}>
              <div
                className={cn("text-[13px] font-medium", state === "upcoming" ? "text-[var(--faint)]" : "text-[var(--foreground)]")}
                aria-current={state === "current" || state === "blocked" ? "step" : undefined}
              >
                {label(step)}
              </div>
              <div className="text-[12px] text-[var(--muted)]">{t(STATE_KEY[state])}</div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
