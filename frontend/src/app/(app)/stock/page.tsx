import { Suspense } from "react";
import type { Metadata } from "next";

import { StockView } from "@/components/stock/stock-view";
import { LoadingState } from "@/components/ui/states";
import { Msg } from "@/components/ui/msg";

export const metadata: Metadata = { title: "Stock" };

export default function StockPage() {
  return (
    <Suspense fallback={<LoadingState label={<Msg k="pages.loadingStock" />} />}>
      <StockView />
    </Suspense>
  );
}
