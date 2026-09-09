import { Suspense } from "react";
import type { Metadata } from "next";

import { PurchaseOrdersView } from "@/components/purchase-orders/purchase-orders-view";
import { LoadingState } from "@/components/ui/states";

export const metadata: Metadata = { title: "Purchase Orders · Warehouse Console" };

export default function PurchaseOrdersPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading purchase orders…" />}>
      <PurchaseOrdersView />
    </Suspense>
  );
}
