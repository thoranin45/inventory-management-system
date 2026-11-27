import { Suspense } from "react";

import { BillingView } from "@/components/payments/billing-view";
import { LoadingState } from "@/components/ui/states";
import { Msg } from "@/components/ui/msg";
import { pageMetadata } from "@/lib/i18n/server";

export const generateMetadata = () => pageMetadata("pageTitle.billing");

export default function Page() {
  return (
    <Suspense fallback={<LoadingState label={<Msg k="billing.loading" />} />}>
      <BillingView />
    </Suspense>
  );
}
