"use client";

import * as React from "react";
import { Ban, Check, CircleDashed, FileText, PackageCheck, PackagePlus, TriangleAlert, Truck } from "lucide-react";

import { TRANSFER_PIPELINE, TRANSFER_STATUS_LABEL, type TransferStatus } from "@/lib/api/schemas/transfers";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/translate";
import { statusText } from "@/lib/reports/report-copy";

type NodeState = "completed" | "current" | "upcoming" | "blocked";

const STEP_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  DRAFT: FileText,
  IN_TRANSIT: Truck,
  PARTIALLY_RECEIVED: PackagePlus,
  COMPLETED: PackageCheck,
};

const STATE_WORD: Record<NodeState, MessageKey> = {
  completed: "transfers.stepDone",
  current: "transfers.stepCurrent",
  upcoming: "transfers.stepUpcoming",
  blocked: "transfers.stepBlocked",
};

/**
 * Reusable Inventory Transfer lifecycle. Backend pipeline:
 *   DRAFT → IN_TRANSIT → PARTIALLY_RECEIVED → COMPLETED
 * CANCELLED is a terminal branch reachable from DRAFT only.
 * There is NO "complete" action — COMPLETED happens automatically when every
 * line is fully received. State is never colour-only.
 */
export function TransferLifecycle({
  status,
  legacyCompleted,
  blockedReason,
  className,
}: {
  status: string;
  legacyCompleted?: boolean;
  blockedReason?: string | null;
  className?: string;
}) {
  const t = useT();
  const upper = status.toUpperCase();
  const cancelled = upper === "CANCELLED";
  const blocked = !cancelled && !!blockedReason;
  const currentIndex = TRANSFER_PIPELINE.indexOf(upper as TransferStatus);

  if (legacyCompleted) {
    return (
      <div className={cn("flex items-start gap-3 py-2", className)}>
        <span
          aria-hidden
          className="mt-[1px] grid h-6 w-6 flex-none place-items-center rounded-[var(--r-full)] border border-[var(--border-strong)] bg-[var(--surface-sunken)] text-[var(--muted)]"
        >
          <PackageCheck className="h-[13px] w-[13px]" />
        </span>
        <div className="min-w-0">
          <div className="text-[13px] font-semibold">{t("transfers.legacyTransfer")}</div>
          <div className="text-[11.5px] text-[var(--muted)]">{t("transfers.legacyTransferBody")}</div>
        </div>
      </div>
    );
  }

  return (
    <ol className={cn("flex flex-col", className)} aria-label={t("transfers.lifecycleAria")}>
      {cancelled ? (
        <li className="flex items-start gap-3 py-2">
          <span
            aria-hidden
            className="mt-[1px] grid h-6 w-6 flex-none place-items-center rounded-[var(--r-full)] border border-[color-mix(in_srgb,var(--danger)_45%,transparent)] bg-[var(--danger-subtle)] text-[var(--danger)]"
          >
            <Ban className="h-[13px] w-[13px]" />
          </span>
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-[var(--danger)]">{t("status.CANCELLED")}</div>
            <div className="text-[11.5px] text-[var(--muted)]">{t("transfers.cancelledBody")}</div>
          </div>
        </li>
      ) : (
        TRANSFER_PIPELINE.map((step, i) => {
          let state: NodeState;
          if (currentIndex < 0) state = "upcoming";
          else if (i < currentIndex) state = "completed";
          else if (i === currentIndex) state = blocked ? "blocked" : "current";
          else state = "upcoming";

          const StepIcon = STEP_ICON[step] ?? CircleDashed;
          const Icon =
            state === "completed"
              ? Check
              : state === "blocked"
                ? TriangleAlert
                : state === "upcoming"
                  ? CircleDashed
                  : StepIcon;
          const last = i === TRANSFER_PIPELINE.length - 1;

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
                    className={cn("w-px flex-1", i < currentIndex ? "bg-[var(--success)]" : "bg-[var(--border)]")}
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
                  {statusText(t, step, TRANSFER_STATUS_LABEL)}
                </div>
                <div className="text-[11px] text-[var(--muted)]">{t(STATE_WORD[state])}</div>
              </div>
            </li>
          );
        })
      )}
    </ol>
  );
}
