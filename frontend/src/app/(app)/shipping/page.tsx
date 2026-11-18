import { Suspense } from "react";

import { ShippingView } from "@/components/shipping/shipping-view";
import { LoadingState } from "@/components/ui/states";
import { Msg } from "@/components/ui/msg";
import { pageMetadata } from "@/lib/i18n/server";

export const generateMetadata = () => pageMetadata("pageTitle.shipping");

export default function ShippingPage() {
  return (
    <Suspense fallback={<LoadingState label={<Msg k="ship.loadingList" />} />}>
      <ShippingView />
    </Suspense>
  );
}
