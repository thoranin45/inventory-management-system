import { Suspense } from "react";

import { ProductsView } from "@/components/products/products-view";
import { LoadingState } from "@/components/ui/states";
import { Msg } from "@/components/ui/msg";
import { pageMetadata } from "@/lib/i18n/server";

export const generateMetadata = () => pageMetadata("pageTitle.products");

export default function ProductsPage() {
  return (
    <Suspense fallback={<LoadingState label={<Msg k="pages.loadingProducts" />} />}>
      <ProductsView />
    </Suspense>
  );
}
