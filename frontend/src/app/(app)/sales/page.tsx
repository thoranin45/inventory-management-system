import { Suspense } from "react";
import type { Metadata } from "next";

import { SalesView } from "@/components/sales/sales-view";
import { LoadingState } from "@/components/ui/states";

export const metadata: Metadata = { title: "Sales · Warehouse Console" };

export default function SalesPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading sales orders…" />}>
      <SalesView />
    </Suspense>
  );
}
