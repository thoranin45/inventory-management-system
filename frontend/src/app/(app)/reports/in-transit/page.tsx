import { Suspense } from "react";
import type { Metadata } from "next";

import { InTransitReport } from "@/components/reports/in-transit-report";
import { LoadingState } from "@/components/ui/states";

export const metadata: Metadata = { title: "In transit · Reports" };

export default function Page() {
  return (
    <Suspense fallback={<LoadingState label="Loading report…" />}>
      <InTransitReport />
    </Suspense>
  );
}
