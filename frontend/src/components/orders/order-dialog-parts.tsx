"use client";

import * as React from "react";
import { ArrowUpFromLine, Lock, LockOpen, MinusCircle } from "lucide-react";

import { useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/translate";
import { cn } from "@/lib/utils";

/**
 * R5 (D-R5-2) — the VERIFIED stock consequence of a lifecycle action, shown
 * inside its existing confirmation dialog (sales_order_service /
 * purchase_order_service at 7a2d9db):
 *   reserve  — SO confirm: reserved += min(remaining, available) per balance; on hand unchanged
 *   release  — SO cancel: reserved stock for the order is released; on hand unchanged
 *   deduct   — SO ship: on hand and reserved both decrease by every allocation
 *   none     — SO complete, PO confirm / cancel: no stock change
 */
export type StockEffectKind = "reserve" | "release" | "deduct" | "none";

const EFFECT: Record<StockEffectKind, { key: MessageKey; icon: React.ComponentType<{ className?: string }>; tone: string }> = {
  reserve: { key: "orders.effectReserve", icon: Lock, tone: "text-[var(--accent)]" },
  release: { key: "orders.effectRelease", icon: LockOpen, tone: "text-[var(--success)]" },
  deduct: { key: "orders.effectDeduct", icon: ArrowUpFromLine, tone: "text-[var(--warning)]" },
  none: { key: "orders.effectNone", icon: MinusCircle, tone: "text-[var(--muted)]" },
};

export function StockEffect({ kind, className }: { kind: StockEffectKind; className?: string }) {
  const t = useT();
  const e = EFFECT[kind];
  const Icon = e.icon;
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-[var(--r-sm)] border border-[var(--border)] bg-[var(--surface-sunken)] p-2 text-[13px]",
        className,
      )}
    >
      <Icon aria-hidden className={cn("mt-[2px] h-4 w-4 flex-none", e.tone)} />
      <span>
        <span className="font-semibold">{t("orders.stockEffect")}</span> {t(e.key)}
      </span>
    </div>
  );
}

/** A rejected action's message, with the backend request id when there is one. */
export function ActionError({ message, requestId, className }: { message: string; requestId?: string; className?: string }) {
  const t = useT();
  return (
    <p role="alert" className={cn("rounded-[var(--r-sm)] bg-[var(--danger-subtle)] p-2 text-[12px] text-[var(--danger)]", className)}>
      {message}
      {requestId ? (
        <span className="mt-1 block text-[12px] text-[var(--muted)]">
          {t("common.requestId")} <span className="mono select-all">{requestId}</span>
        </span>
      ) : null}
    </p>
  );
}
