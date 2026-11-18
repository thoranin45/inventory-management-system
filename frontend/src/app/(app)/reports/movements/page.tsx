import { Suspense } from "react";

import { MovementHistoryReport } from "@/components/reports/movement-history-report";
import { LoadingState } from "@/components/ui/states";
import { Msg } from "@/components/ui/msg";
import { pageMetadata } from "@/lib/i18n/server";

export const generateMetadata = () => pageMetadata("pageTitle.reportMovements");

export default function Page() {
  return (
    <Suspense fallback={<LoadingState label={<Msg k="pages.loadingReport" />} />}>
      <MovementHistoryReport />
    </Suspense>
  );
}
