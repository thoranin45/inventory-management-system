import { Suspense } from "react";
import type { Metadata } from "next";

import { TransfersReport } from "@/components/reports/transfers-report";
import { LoadingState } from "@/components/ui/states";

export const metadata: Metadata = { title: "Transfer report · Reports" };

export default function Page() {
  return (
    <Suspense fallback={<LoadingState label="Loading report…" />}>
      <TransfersReport />
    </Suspense>
  );
}
