import { Suspense } from "react";

import { StockOutConsole } from "@/components/stock/stock-out-console";
import { LoadingState } from "@/components/ui/states";
import { Msg } from "@/components/ui/msg";
import { pageMetadata } from "@/lib/i18n/server";

export const generateMetadata = () => pageMetadata("pageTitle.stockOut");

export default function StockOutPage() {
  return (
    <Suspense fallback={<LoadingState label={<Msg k="pages.loadingStockOut" />} />}>
      <StockOutConsole />
    </Suspense>
  );
}
