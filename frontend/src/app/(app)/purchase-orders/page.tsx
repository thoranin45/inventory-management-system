import { Suspense } from "react";

import { PurchaseOrdersView } from "@/components/purchase-orders/purchase-orders-view";
import { LoadingState } from "@/components/ui/states";
import { Msg } from "@/components/ui/msg";
import { pageMetadata } from "@/lib/i18n/server";

export const generateMetadata = () => pageMetadata("pageTitle.purchaseOrders");

export default function PurchaseOrdersPage() {
  return (
    <Suspense fallback={<LoadingState label={<Msg k="po.loadingList" />} />}>
      <PurchaseOrdersView />
    </Suspense>
  );
}
