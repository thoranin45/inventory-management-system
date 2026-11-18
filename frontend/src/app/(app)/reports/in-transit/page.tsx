import { Suspense } from "react";

import { InTransitReport } from "@/components/reports/in-transit-report";
import { LoadingState } from "@/components/ui/states";
import { Msg } from "@/components/ui/msg";
import { pageMetadata } from "@/lib/i18n/server";

export const generateMetadata = () => pageMetadata("pageTitle.reportInTransit");

export default function Page() {
  return (
    <Suspense fallback={<LoadingState label={<Msg k="pages.loadingReport" />} />}>
      <InTransitReport />
    </Suspense>
  );
}
