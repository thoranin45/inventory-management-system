import { Suspense } from "react";

import { TransfersReport } from "@/components/reports/transfers-report";
import { LoadingState } from "@/components/ui/states";
import { Msg } from "@/components/ui/msg";
import { pageMetadata } from "@/lib/i18n/server";

export const generateMetadata = () => pageMetadata("pageTitle.reportTransfers");

export default function Page() {
  return (
    <Suspense fallback={<LoadingState label={<Msg k="pages.loadingReport" />} />}>
      <TransfersReport />
    </Suspense>
  );
}
