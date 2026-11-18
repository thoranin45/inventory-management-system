import { Suspense } from "react";

import { StockAdjustmentRequestList } from "@/components/stock-adjustments/request-list";
import { LoadingState } from "@/components/ui/states";
import { Msg } from "@/components/ui/msg";
import { pageMetadata } from "@/lib/i18n/server";

export const generateMetadata = () => pageMetadata("pageTitle.adjustApprovals");

export default function StockAdjustmentApprovalsPage() {
  return (
    <Suspense fallback={<LoadingState label={<Msg k="pages.loadingApprovals" />} />}>
      <StockAdjustmentRequestList scope="approvals" />
    </Suspense>
  );
}
