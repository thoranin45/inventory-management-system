import { Suspense } from "react";
import type { Metadata } from "next";

import { StockInConsole } from "@/components/stock/stock-in-console";
import { LoadingState } from "@/components/ui/states";

export const metadata: Metadata = { title: "Stock In" };

export default function StockInPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading Stock In…" />}>
      <StockInConsole />
    </Suspense>
  );
}
