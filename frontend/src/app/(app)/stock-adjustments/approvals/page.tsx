import { Suspense } from "react";
import type { Metadata } from "next";

import { StockAdjustmentRequestList } from "@/components/stock-adjustments/request-list";
import { LoadingState } from "@/components/ui/states";

export const metadata: Metadata = { title: "Stock Adjustment Approvals" };

export default function StockAdjustmentApprovalsPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading approvals…" />}>
      <StockAdjustmentRequestList scope="approvals" title="Stock Adjustment Approvals" />
    </Suspense>
  );
}
