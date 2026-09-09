import { Suspense } from "react";
import type { Metadata } from "next";

import { ExpiredStockReport } from "@/components/reports/expired-stock-report";
import { LoadingState } from "@/components/ui/states";

export const metadata: Metadata = { title: "Expired inventory · Reports" };

export default function Page() {
  return (
    <Suspense fallback={<LoadingState label="Loading report…" />}>
      <ExpiredStockReport />
    </Suspense>
  );
}
