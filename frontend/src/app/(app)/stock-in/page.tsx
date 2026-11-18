import { Suspense } from "react";

import { StockInConsole } from "@/components/stock/stock-in-console";
import { LoadingState } from "@/components/ui/states";
import { Msg } from "@/components/ui/msg";
import { pageMetadata } from "@/lib/i18n/server";

export const generateMetadata = () => pageMetadata("pageTitle.stockIn");

export default function StockInPage() {
  return (
    <Suspense fallback={<LoadingState label={<Msg k="pages.loadingStockIn" />} />}>
      <StockInConsole />
    </Suspense>
  );
}
