import { Suspense } from "react";

import { PurchaseOrdersReport } from "@/components/reports/purchase-orders-report";
import { LoadingState } from "@/components/ui/states";
import { Msg } from "@/components/ui/msg";
import { pageMetadata } from "@/lib/i18n/server";

export const generateMetadata = () => pageMetadata("pageTitle.reportPurchaseOrders");

export default function Page() {
  return (
    <Suspense fallback={<LoadingState label={<Msg k="pages.loadingReport" />} />}>
      <PurchaseOrdersReport />
    </Suspense>
  );
}
