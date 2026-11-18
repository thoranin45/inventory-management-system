import { Suspense } from "react";

import { TransfersView } from "@/components/transfers/transfers-view";
import { LoadingState } from "@/components/ui/states";
import { Msg } from "@/components/ui/msg";
import { pageMetadata } from "@/lib/i18n/server";

export const generateMetadata = () => pageMetadata("pageTitle.transfers");

export default function TransfersPage() {
  return (
    <Suspense fallback={<LoadingState label={<Msg k="pages.loadingTransfers" />} />}>
      <TransfersView />
    </Suspense>
  );
}
