import { Suspense } from "react";
import type { Metadata } from "next";

import { ProductsView } from "@/components/products/products-view";
import { LoadingState } from "@/components/ui/states";
import { Msg } from "@/components/ui/msg";

export const metadata: Metadata = { title: "Products" };

export default function ProductsPage() {
  return (
    <Suspense fallback={<LoadingState label={<Msg k="pages.loadingProducts" />} />}>
      <ProductsView />
    </Suspense>
  );
}
