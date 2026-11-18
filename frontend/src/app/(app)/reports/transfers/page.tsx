import { Suspense } from "react";
import type { Metadata } from "next";

import { TransfersReport } from "@/components/reports/transfers-report";
import { LoadingState } from "@/components/ui/states";
import { Msg } from "@/components/ui/msg";

export const metadata: Metadata = { title: "Transfer report · Reports" };

export default function Page() {
  return (
    <Suspense fallback={<LoadingState label={<Msg k="pages.loadingReport" />} />}>
      <TransfersReport />
    </Suspense>
  );
}
