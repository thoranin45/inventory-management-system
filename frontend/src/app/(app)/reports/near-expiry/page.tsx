import { Suspense } from "react";
import type { Metadata } from "next";

import { NearExpiryReport } from "@/components/reports/near-expiry-report";
import { LoadingState } from "@/components/ui/states";

export const metadata: Metadata = { title: "Near expiry · Reports" };

export default function Page() {
  return (
    <Suspense fallback={<LoadingState label="Loading report…" />}>
      <NearExpiryReport />
    </Suspense>
  );
}
