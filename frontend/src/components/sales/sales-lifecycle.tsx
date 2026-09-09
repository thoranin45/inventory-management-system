"use client";

import * as React from "react";
import {
  Ban,
  Check,
  CircleDashed,
  FileText,
  Package,
  PackageCheck,
  PackageSearch,
  TriangleAlert,
  Truck,
} from "lucide-react";

import { SO_PIPELINE, SO_STATUS_LABEL, type SoStatus } from "@/lib/api/schemas/sales";
import { cn } from "@/lib/utils";

type NodeState = "completed" | "current" | "upcoming" | "blocked";

const STEP_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  DRAFT: FileText,
  CONFIRMED: Check,
  PICKING: PackageSearch,
  PACKING: Package,
  READY_TO_SHIP: Truck,
  SHIPPED: PackageCheck,
  COMPLETED: PackageCheck,
};

const STATE_WORD: Record<NodeState, string> = {
  completed: "Done",
  current: "In progress",
  upcoming: "Not started",
  blocked: "Blocked",
};

/**
 * One reusable lifecycle visualiser for a Sales Order. Backend pipeline:
 *   DRAFT → CONFIRMED → PICKING → PACKING → READY_TO_SHIP → SHIPPED → COMPLETED
 * CANCELLED is a terminal branch reachable from DRAFT…READY_TO_SHIP.
 *
 * State is never colour-only — every node carries an icon whose SHAPE encodes
 * the state (tick / step glyph / dashed ring / warning) plus a text state word.
 */
export function SalesLifecycle({
  status,
  attentionReason,
  className,
}: {
  status: string;
  attentionReason?: string | null;
  className?: string;
}) {
  const upper = status.toUpperCase();
  const cancelled = upper === "CANCELLED";
  const blocked = !cancelled && !!attentionReason;
  const currentIndex = SO_PIPELINE.indexOf(upper as SoStatus);

  return (
    <ol className={cn("flex flex-col", className)} aria-label="Sales order lifecycle">
      {cancelled ? (
        <li className="flex items-start gap-3 py-2">
          <span
            aria-hidden
            className="mt-[1px] grid h-6 w-6 flex-none place-items-center rounded-[var(--r-full)] border border-[color-mix(in_srgb,var(--danger)_45%,transparent)] bg-[var(--danger-subtle)] text-[var(--danger)]"
          >
            <Ban className="h-[13px] w-[13px]" />
          </span>
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-[var(--danger)]">Cancelled</div>
            <div className="text-[11.5px] text-[var(--muted)]">
              This order was cancelled and will not be fulfilled.
            </div>
          </div>
        </li>
      ) : (
        SO_PIPELINE.map((step, i) => {
          let state: NodeState;
          if (currentIndex < 0) state = "upcoming";
          else if (i < currentIndex) state = "completed";
          else if (i === currentIndex) state = blocked ? "blocked" : "current";
          else state = "upcoming";

          const StepIcon = STEP_ICON[step] ?? CircleDashed;
          const Icon =
            state === "completed" ? Check : state === "blocked" ? TriangleAlert : state === "upcoming" ? CircleDashed : StepIcon;
          const last = i === SO_PIPELINE.length - 1;

          return (
            <li key={step} className="flex items-stretch gap-3">
              <div className="flex flex-col items-center">
                <span
                  aria-hidden
                  className={cn(
                    "grid h-6 w-6 flex-none place-items-center rounded-[var(--r-full)] border",
                    state === "completed" && "border-[var(--success)] bg-[var(--success-subtle)] text-[var(--success)]",
                    state === "current" && "border-[var(--accent)] bg-[var(--accent-subtle)] text-[var(--accent)]",
                    state === "blocked" &&
                      "border-[color-mix(in_srgb,var(--warning)_45%,transparent)] bg-[var(--warning-subtle)] text-[var(--warning)]",
                    state === "upcoming" && "border-[var(--border-strong)] bg-[var(--surface)] text-[var(--faint)]",
                  )}
                >
                  <Icon className="h-[13px] w-[13px]" />
                </span>
                {!last ? (
                  <span
                    aria-hidden
                    className={cn(
                      "w-px flex-1",
                      i < currentIndex ? "bg-[var(--success)]" : "bg-[var(--border)]",
                    )}
                  />
                ) : null}
              </div>
              <div className={cn("min-w-0 pb-4", last && "pb-0")}>
                <div
                  className={cn(
                    "text-[13px] font-medium",
                    state === "upcoming" ? "text-[var(--faint)]" : "text-[var(--foreground)]",
                  )}
                  aria-current={state === "current" || state === "blocked" ? "step" : undefined}
                >
                  {SO_STATUS_LABEL[step] ?? step}
                </div>
                <div className="text-[11px] text-[var(--muted)]">{STATE_WORD[state]}</div>
              </div>
            </li>
          );
        })
      )}
    </ol>
  );
}
