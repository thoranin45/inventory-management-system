import { Suspense } from "react";
import type { Metadata } from "next";

import { StockOutConsole } from "@/components/stock/stock-out-console";
import { LoadingState } from "@/components/ui/states";

export const metadata: Metadata = { title: "Stock Out" };

export default function StockOutPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading Stock Out…" />}>
      <StockOutConsole />
    </Suspense>
  );
}
