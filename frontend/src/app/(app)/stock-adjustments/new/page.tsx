import { Suspense } from "react";

import { StockAdjustmentRequestForm } from "@/components/stock-adjustments/request-form";
import { LoadingState } from "@/components/ui/states";
import { Msg } from "@/components/ui/msg";
import { pageMetadata } from "@/lib/i18n/server";

export const generateMetadata = () => pageMetadata("pageTitle.adjustNew");

export default function NewStockAdjustmentRequestPage() {
  return (
    <Suspense fallback={<LoadingState label={<Msg k="common.loading" />} />}>
      <StockAdjustmentRequestForm />
    </Suspense>
  );
}
