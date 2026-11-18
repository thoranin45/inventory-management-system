import { Suspense } from "react";
import type { Metadata } from "next";

import { TransfersView } from "@/components/transfers/transfers-view";
import { LoadingState } from "@/components/ui/states";
import { Msg } from "@/components/ui/msg";

export const metadata: Metadata = { title: "Transfers" };

export default function TransfersPage() {
  return (
    <Suspense fallback={<LoadingState label={<Msg k="pages.loadingTransfers" />} />}>
      <TransfersView />
    </Suspense>
  );
}
