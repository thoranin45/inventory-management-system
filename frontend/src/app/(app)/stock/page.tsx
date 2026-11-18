import { Suspense } from "react";

import { StockView } from "@/components/stock/stock-view";
import { LoadingState } from "@/components/ui/states";
import { Msg } from "@/components/ui/msg";
import { pageMetadata } from "@/lib/i18n/server";

export const generateMetadata = () => pageMetadata("pageTitle.stock");

export default function StockPage() {
  return (
    <Suspense fallback={<LoadingState label={<Msg k="pages.loadingStock" />} />}>
      <StockView />
    </Suspense>
  );
}
