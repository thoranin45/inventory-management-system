import { Suspense } from "react";

import { ReceiptsView } from "@/components/payments/receipts-view";
import { LoadingState } from "@/components/ui/states";
import { Msg } from "@/components/ui/msg";
import { pageMetadata } from "@/lib/i18n/server";

export const generateMetadata = () => pageMetadata("pageTitle.receipts");

export default function Page() {
  return (
    <Suspense fallback={<LoadingState label={<Msg k="payments.loading" />} />}>
      <ReceiptsView />
    </Suspense>
  );
}
