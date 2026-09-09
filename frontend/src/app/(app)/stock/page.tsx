import { Suspense } from "react";
import type { Metadata } from "next";

import { StockView } from "@/components/stock/stock-view";
import { LoadingState } from "@/components/ui/states";

export const metadata: Metadata = { title: "Stock · Warehouse Console" };

export default function StockPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading stock balances…" />}>
      <StockView />
    </Suspense>
  );
}
