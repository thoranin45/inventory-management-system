import { Suspense } from "react";
import type { Metadata } from "next";

import { ShippingView } from "@/components/shipping/shipping-view";
import { LoadingState } from "@/components/ui/states";
import { Msg } from "@/components/ui/msg";

export const metadata: Metadata = { title: "Shipping" };

export default function ShippingPage() {
  return (
    <Suspense fallback={<LoadingState label={<Msg k="ship.loadingList" />} />}>
      <ShippingView />
    </Suspense>
  );
}
