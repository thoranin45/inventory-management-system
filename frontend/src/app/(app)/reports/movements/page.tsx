import { Suspense } from "react";
import type { Metadata } from "next";

import { MovementHistoryReport } from "@/components/reports/movement-history-report";
import { LoadingState } from "@/components/ui/states";

export const metadata: Metadata = { title: "Movement history · Reports" };

export default function Page() {
  return (
    <Suspense fallback={<LoadingState label="Loading report…" />}>
      <MovementHistoryReport />
    </Suspense>
  );
}
