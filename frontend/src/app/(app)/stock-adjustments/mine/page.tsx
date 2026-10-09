import { Suspense } from "react";
import type { Metadata } from "next";

import { StockAdjustmentRequestList } from "@/components/stock-adjustments/request-list";
import { LoadingState } from "@/components/ui/states";

export const metadata: Metadata = { title: "My Stock Adjustment Requests" };

export default function MyStockAdjustmentRequestsPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading requests…" />}>
      <StockAdjustmentRequestList scope="mine" title="My Stock Adjustment Requests" />
    </Suspense>
  );
}
