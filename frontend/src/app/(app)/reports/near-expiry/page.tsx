import { Suspense } from "react";

import { NearExpiryReport } from "@/components/reports/near-expiry-report";
import { LoadingState } from "@/components/ui/states";
import { Msg } from "@/components/ui/msg";
import { pageMetadata } from "@/lib/i18n/server";

export const generateMetadata = () => pageMetadata("pageTitle.reportNearExpiry");

export default function Page() {
  return (
    <Suspense fallback={<LoadingState label={<Msg k="pages.loadingReport" />} />}>
      <NearExpiryReport />
    </Suspense>
  );
}
