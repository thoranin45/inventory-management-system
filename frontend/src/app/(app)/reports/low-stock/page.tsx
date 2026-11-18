import { Suspense } from "react";
import type { Metadata } from "next";

import { LowStockReport } from "@/components/reports/low-stock-report";
import { LoadingState } from "@/components/ui/states";
import { Msg } from "@/components/ui/msg";

export const metadata: Metadata = { title: "Low stock · Reports" };

export default function Page() {
  return (
    <Suspense fallback={<LoadingState label={<Msg k="pages.loadingReport" />} />}>
      <LowStockReport />
    </Suspense>
  );
}
