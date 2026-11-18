"use client";

import * as React from "react";
import { Check, FileText, PackageCheck, PackagePlus } from "lucide-react";

import { LifecycleSteps } from "@/components/orders/lifecycle-steps";
import { PO_PIPELINE } from "@/lib/api/schemas/purchase-orders";

const STEP_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  DRAFT: FileText,
  CONFIRMED: Check,
  PARTIALLY_RECEIVED: PackagePlus,
  RECEIVED: PackageCheck,
};

/**
 * Purchase Order lifecycle. Backend pipeline:
 *   DRAFT → CONFIRMED → PARTIALLY_RECEIVED → RECEIVED
 * CANCELLED is a terminal branch reachable from DRAFT / CONFIRMED only.
 */
export function PurchaseOrderLifecycle({
  status,
  blockedReason,
  className,
}: {
  status: string;
  blockedReason?: string | null;
  className?: string;
}) {
  return (
    <LifecycleSteps
      pipeline={PO_PIPELINE}
      status={status}
      blocked={!!blockedReason}
      stepIcon={STEP_ICON}
      ariaLabelKey="orders.poLifecycle"
      cancelledNoteKey="orders.poCancelledNote"
      className={className}
    />
  );
}
