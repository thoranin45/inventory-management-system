import { Suspense } from "react";

import { SalesView } from "@/components/sales/sales-view";
import { LoadingState } from "@/components/ui/states";
import { Msg } from "@/components/ui/msg";
import { pageMetadata } from "@/lib/i18n/server";

export const generateMetadata = () => pageMetadata("pageTitle.sales");

export default function SalesPage() {
  return (
    <Suspense fallback={<LoadingState label={<Msg k="sales.loadingList" />} />}>
      <SalesView />
    </Suspense>
  );
}
