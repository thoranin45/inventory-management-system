"use client";

import * as React from "react";

import { ErrorState, LoadingState } from "@/components/ui/states";
import { usePackingSlipData, useShippingLabelData } from "@/lib/query/sales";

/**
 * Read-only preview of the backend's packing-slip and shipping-label JSON.
 * This is not a print centre — it renders exactly what
 * GET /sales-orders/{id}/packing-slip-data and /shipping-label-data return.
 */
function JsonBlock({ title, data }: { title: string; data: unknown }) {
  return (
    <section>
      <h4 className="wc-section-label mb-1.5">{title}</h4>
      <pre className="max-h-[240px] overflow-auto rounded-[var(--r-sm)] bg-[var(--surface-sunken)] p-3 text-[11px] leading-[1.6] text-[var(--muted)] wc-scrollbar-none">
        {JSON.stringify(data, null, 2)}
      </pre>
    </section>
  );
}

export function PrintPreview({ orderId, enabled = true }: { orderId: number; enabled?: boolean }) {
  const slip = usePackingSlipData(orderId, enabled);
  const label = useShippingLabelData(orderId, enabled);

  if (!enabled) return null;
  if (slip.isLoading || label.isLoading) return <LoadingState label="Loading print data…" />;
  if (slip.isError) return <ErrorState error={slip.error} onRetry={() => void slip.refetch()} compact />;
  if (label.isError) return <ErrorState error={label.error} onRetry={() => void label.refetch()} compact />;

  return (
    <div className="flex flex-col gap-4">
      {slip.data ? <JsonBlock title="Packing slip data" data={slip.data} /> : null}
      {label.data ? <JsonBlock title="Shipping label data" data={label.data} /> : null}
    </div>
  );
}
