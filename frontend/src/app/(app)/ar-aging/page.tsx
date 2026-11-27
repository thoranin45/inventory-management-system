import { Suspense } from "react";

import { ArAgingView } from "@/components/payments/ar-aging-view";
import { LoadingState } from "@/components/ui/states";
import { Msg } from "@/components/ui/msg";
import { pageMetadata } from "@/lib/i18n/server";

export const generateMetadata = () => pageMetadata("pageTitle.aging");

export default function Page() {
  return (
    <Suspense fallback={<LoadingState label={<Msg k="aging.loading" />} />}>
      <ArAgingView />
    </Suspense>
  );
}
