import { Suspense } from "react";
import type { Metadata } from "next";

import { StockAdjustmentRequestForm } from "@/components/stock-adjustments/request-form";
import { LoadingState } from "@/components/ui/states";

export const metadata: Metadata = { title: "New Stock Adjustment Request" };

export default function NewStockAdjustmentRequestPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading…" />}>
      <StockAdjustmentRequestForm />
    </Suspense>
  );
}
