import { Suspense } from "react";
import type { Metadata } from "next";

import { SalesView } from "@/components/sales/sales-view";
import { LoadingState } from "@/components/ui/states";
import { Msg } from "@/components/ui/msg";

export const metadata: Metadata = { title: "Sales" };

export default function SalesPage() {
  return (
    <Suspense fallback={<LoadingState label={<Msg k="sales.loadingList" />} />}>
      <SalesView />
    </Suspense>
  );
}
