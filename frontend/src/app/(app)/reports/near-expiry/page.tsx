import { Suspense } from "react";
import type { Metadata } from "next";

import { NearExpiryReport } from "@/components/reports/near-expiry-report";
import { LoadingState } from "@/components/ui/states";
import { Msg } from "@/components/ui/msg";

export const metadata: Metadata = { title: "Near expiry · Reports" };

export default function Page() {
  return (
    <Suspense fallback={<LoadingState label={<Msg k="pages.loadingReport" />} />}>
      <NearExpiryReport />
    </Suspense>
  );
}
