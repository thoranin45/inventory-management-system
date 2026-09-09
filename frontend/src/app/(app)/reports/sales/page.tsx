import { Suspense } from "react";
import type { Metadata } from "next";

import { SalesReport } from "@/components/reports/sales-report";
import { LoadingState } from "@/components/ui/states";

export const metadata: Metadata = { title: "Sales report · Reports" };

export default function Page() {
  return (
    <Suspense fallback={<LoadingState label="Loading report…" />}>
      <SalesReport />
    </Suspense>
  );
}
