import { Suspense } from "react";
import type { Metadata } from "next";

import { StockInConsole } from "@/components/stock/stock-in-console";
import { LoadingState } from "@/components/ui/states";
import { Msg } from "@/components/ui/msg";

export const metadata: Metadata = { title: "Stock In" };

export default function StockInPage() {
  return (
    <Suspense fallback={<LoadingState label={<Msg k="pages.loadingStockIn" />} />}>
      <StockInConsole />
    </Suspense>
  );
}
