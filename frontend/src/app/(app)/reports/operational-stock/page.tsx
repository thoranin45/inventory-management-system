import { Suspense } from "react";

import { OperationalStockReport } from "@/components/reports/operational-stock-report";
import { LoadingState } from "@/components/ui/states";
import { Msg } from "@/components/ui/msg";
import { pageMetadata } from "@/lib/i18n/server";

export const generateMetadata = () => pageMetadata("pageTitle.reportOperationalStock");

export default function Page() {
  return (
    <Suspense fallback={<LoadingState label={<Msg k="pages.loadingReport" />} />}>
      <OperationalStockReport />
    </Suspense>
  );
}
