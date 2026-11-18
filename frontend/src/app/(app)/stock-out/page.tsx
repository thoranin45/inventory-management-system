import { Suspense } from "react";
import type { Metadata } from "next";

import { StockOutConsole } from "@/components/stock/stock-out-console";
import { LoadingState } from "@/components/ui/states";
import { Msg } from "@/components/ui/msg";

export const metadata: Metadata = { title: "Stock Out" };

export default function StockOutPage() {
  return (
    <Suspense fallback={<LoadingState label={<Msg k="pages.loadingStockOut" />} />}>
      <StockOutConsole />
    </Suspense>
  );
}
