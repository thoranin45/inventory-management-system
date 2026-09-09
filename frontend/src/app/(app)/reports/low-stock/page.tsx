import { Suspense } from "react";
import type { Metadata } from "next";

import { LowStockReport } from "@/components/reports/low-stock-report";
import { LoadingState } from "@/components/ui/states";

export const metadata: Metadata = { title: "Low stock · Reports" };

export default function Page() {
  return (
    <Suspense fallback={<LoadingState label="Loading report…" />}>
      <LowStockReport />
    </Suspense>
  );
}
