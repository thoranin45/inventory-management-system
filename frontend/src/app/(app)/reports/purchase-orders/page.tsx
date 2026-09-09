import { Suspense } from "react";
import type { Metadata } from "next";

import { PurchaseOrdersReport } from "@/components/reports/purchase-orders-report";
import { LoadingState } from "@/components/ui/states";

export const metadata: Metadata = { title: "Purchase order report · Reports" };

export default function Page() {
  return (
    <Suspense fallback={<LoadingState label="Loading report…" />}>
      <PurchaseOrdersReport />
    </Suspense>
  );
}
