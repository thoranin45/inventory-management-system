import { Suspense } from "react";
import type { Metadata } from "next";

import { PurchaseOrdersView } from "@/components/purchase-orders/purchase-orders-view";
import { LoadingState } from "@/components/ui/states";
import { Msg } from "@/components/ui/msg";

export const metadata: Metadata = { title: "Purchase Orders" };

export default function PurchaseOrdersPage() {
  return (
    <Suspense fallback={<LoadingState label={<Msg k="po.loadingList" />} />}>
      <PurchaseOrdersView />
    </Suspense>
  );
}
