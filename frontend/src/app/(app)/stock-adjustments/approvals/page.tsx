import { Suspense } from "react";
import type { Metadata } from "next";

import { StockAdjustmentRequestList } from "@/components/stock-adjustments/request-list";
import { LoadingState } from "@/components/ui/states";
import { Msg } from "@/components/ui/msg";

export const metadata: Metadata = { title: "Stock Adjustment Approvals" };

export default function StockAdjustmentApprovalsPage() {
  return (
    <Suspense fallback={<LoadingState label={<Msg k="pages.loadingApprovals" />} />}>
      <StockAdjustmentRequestList scope="approvals" />
    </Suspense>
  );
}
