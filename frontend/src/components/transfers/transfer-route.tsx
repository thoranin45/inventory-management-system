"use client";

import * as React from "react";
import { ArrowDown, Factory, Lock, Truck } from "lucide-react";

import { QuantityDisplay } from "@/components/ui/quantity-display";
import { formatQty } from "@/lib/format";
import { useT } from "@/lib/i18n/client";
import type { DecimalString } from "@/lib/decimal";
import { cn } from "@/lib/utils";

/**
 * SOURCE ↓ TRANSIT ↓ DESTINATION route, built from real transfer figures.
 * TRANSIT reads as SYSTEM CONTROLLED (lock glyph, accent frame, explicit note)
 * and is never a selectable warehouse/location anywhere in the app.
 *
 * All values are decimal strings — the caller derives them with exact BigInt
 * helpers (in_transit = dispatched − received).
 */
function Stage({
  icon: Icon,
  name,
  sub,
  qty,
  qtyLabel,
  transit,
}: {
  icon: React.ComponentType<{ className?: string }>;
  name: React.ReactNode;
  sub: string;
  qty: DecimalString;
  qtyLabel: string;
  transit?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-[var(--r-md)] border p-3",
        transit
          ? "border-[var(--accent-line)] bg-[var(--accent-subtle)]"
          : "border-[var(--border)] bg-[var(--surface)]",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "grid h-8 w-8 flex-none place-items-center rounded-[var(--r-sm)]",
          transit ? "bg-[var(--surface)] text-[var(--accent)]" : "bg-[var(--surface-sunken)] text-[var(--muted)]",
        )}
      >
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <div className="flex items-center gap-1 text-[13px] font-semibold">
          {name}
          {transit ? <Lock aria-hidden className="h-3 w-3 text-[var(--accent)]" /> : null}
        </div>
        <div className="text-[12px] text-[var(--muted)]">{sub}</div>
      </div>
      <div className="ml-auto text-right">
        <div className="mono text-[13px] font-semibold">
          <QuantityDisplay value={qty} />
        </div>
        <div className="text-[12px] text-[var(--faint)]">{qtyLabel}</div>
      </div>
    </div>
  );
}

export function TransferRoute({
  sourceLabel,
  destinationLabel,
  total,
  dispatched,
  inTransit,
  received,
  className,
}: {
  sourceLabel: React.ReactNode;
  destinationLabel: React.ReactNode;
  total: DecimalString;
  dispatched: DecimalString;
  inTransit: DecimalString;
  received: DecimalString;
  className?: string;
}) {
  const t = useT();
  return (
    <div className={cn("flex flex-col gap-0", className)}>
      <Stage
        icon={Factory}
        name={sourceLabel}
        sub={t("transfer.routeSource", { qty: formatQty(total) })}
        qty={dispatched}
        qtyLabel={t("transfer.dispatched")}
      />
      <div className="flex justify-center py-1 text-[var(--faint)]">
        <ArrowDown aria-hidden className="h-4 w-4" />
      </div>
      <Stage
        icon={Truck}
        name={t("transfer.systemTransit")}
        sub={t("transfer.routeTransit")}
        qty={inTransit}
        qtyLabel={t("transfer.inTransit")}
        transit
      />
      <div className="flex justify-center py-1 text-[var(--faint)]">
        <ArrowDown aria-hidden className="h-4 w-4" />
      </div>
      <Stage
        icon={Factory}
        name={destinationLabel}
        sub={t("transfer.routeDestination")}
        qty={received}
        qtyLabel={t("transfer.received")}
      />
      <p className="mt-2 flex items-start gap-1.5 text-[12px] text-[var(--muted)]">
        <Lock aria-hidden className="mt-[1px] h-3 w-3 flex-none" />
        {t("transfer.transitNote")}
      </p>
    </div>
  );
}
