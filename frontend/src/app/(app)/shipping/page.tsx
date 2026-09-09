import { Suspense } from "react";
import type { Metadata } from "next";

import { ShippingView } from "@/components/shipping/shipping-view";
import { LoadingState } from "@/components/ui/states";

export const metadata: Metadata = { title: "Shipping · Warehouse Console" };

export default function ShippingPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading shipping queue…" />}>
      <ShippingView />
    </Suspense>
  );
}
