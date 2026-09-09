import { Suspense } from "react";
import type { Metadata } from "next";

import { TransfersView } from "@/components/transfers/transfers-view";
import { LoadingState } from "@/components/ui/states";

export const metadata: Metadata = { title: "Transfers · Warehouse Console" };

export default function TransfersPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading transfers…" />}>
      <TransfersView />
    </Suspense>
  );
}
