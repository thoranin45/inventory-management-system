import { Suspense } from "react";

import { SuppliersView } from "@/components/master-data/suppliers-view";
import { LoadingState } from "@/components/ui/states";
import { Msg } from "@/components/ui/msg";
import { pageMetadata } from "@/lib/i18n/server";

export const generateMetadata = () => pageMetadata("pageTitle.suppliers");

export default function SuppliersPage() {
  return (
    <Suspense fallback={<LoadingState label={<Msg k="pages.loadingSuppliers" />} />}>
      <SuppliersView />
    </Suspense>
  );
}
