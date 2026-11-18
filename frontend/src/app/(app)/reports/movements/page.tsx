import { Suspense } from "react";
import type { Metadata } from "next";

import { MovementHistoryReport } from "@/components/reports/movement-history-report";
import { LoadingState } from "@/components/ui/states";
import { Msg } from "@/components/ui/msg";

export const metadata: Metadata = { title: "Transaction summary · Reports" };

export default function Page() {
  return (
    <Suspense fallback={<LoadingState label={<Msg k="pages.loadingReport" />} />}>
      <MovementHistoryReport />
    </Suspense>
  );
}
