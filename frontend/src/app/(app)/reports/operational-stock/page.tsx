import { Suspense } from "react";
import type { Metadata } from "next";

import { OperationalStockReport } from "@/components/reports/operational-stock-report";
import { LoadingState } from "@/components/ui/states";

export const metadata: Metadata = { title: "Operational stock · Reports" };

export default function Page() {
  return (
    <Suspense fallback={<LoadingState label="Loading report…" />}>
      <OperationalStockReport />
    </Suspense>
  );
}
