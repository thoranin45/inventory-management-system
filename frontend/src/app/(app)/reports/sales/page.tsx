import { Suspense } from "react";
import type { Metadata } from "next";

import { SalesReport } from "@/components/reports/sales-report";
import { LoadingState } from "@/components/ui/states";
import { Msg } from "@/components/ui/msg";

export const metadata: Metadata = { title: "Sales report · Reports" };

export default function Page() {
  return (
    <Suspense fallback={<LoadingState label={<Msg k="pages.loadingReport" />} />}>
      <SalesReport />
    </Suspense>
  );
}
