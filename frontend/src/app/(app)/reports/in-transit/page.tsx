import { Suspense } from "react";
import type { Metadata } from "next";

import { InTransitReport } from "@/components/reports/in-transit-report";
import { LoadingState } from "@/components/ui/states";
import { Msg } from "@/components/ui/msg";

export const metadata: Metadata = { title: "In transit · Reports" };

export default function Page() {
  return (
    <Suspense fallback={<LoadingState label={<Msg k="pages.loadingReport" />} />}>
      <InTransitReport />
    </Suspense>
  );
}
