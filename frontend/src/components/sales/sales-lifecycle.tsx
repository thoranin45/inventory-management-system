"use client";

import * as React from "react";
import { Check, FileText, Package, PackageCheck, PackageSearch, Truck } from "lucide-react";

import { LifecycleSteps } from "@/components/orders/lifecycle-steps";
import { SO_PIPELINE } from "@/lib/api/schemas/sales";

const STEP_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  DRAFT: FileText,
  CONFIRMED: Check,
  PICKING: PackageSearch,
  PACKING: Package,
  READY_TO_SHIP: Truck,
  SHIPPED: PackageCheck,
  COMPLETED: PackageCheck,
};

/**
 * Sales Order lifecycle. Backend pipeline:
 *   DRAFT → CONFIRMED → PICKING → PACKING → READY_TO_SHIP → SHIPPED → COMPLETED
 * CANCELLED is a terminal branch reachable from DRAFT…READY_TO_SHIP. An
 * attention reason marks the current step blocked.
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
  return (
    <LifecycleSteps
      pipeline={SO_PIPELINE}
      status={status}
      blocked={!!attentionReason}
      stepIcon={STEP_ICON}
      ariaLabelKey="orders.soLifecycle"
      cancelledNoteKey="orders.soCancelledNote"
      className={className}
    />
  );
}
