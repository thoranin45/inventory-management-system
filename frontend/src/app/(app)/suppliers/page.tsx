import { Suspense } from "react";
import type { Metadata } from "next";

import { SuppliersView } from "@/components/master-data/suppliers-view";
import { LoadingState } from "@/components/ui/states";
import { Msg } from "@/components/ui/msg";

export const metadata: Metadata = { title: "Suppliers" };

export default function SuppliersPage() {
  return (
    <Suspense fallback={<LoadingState label={<Msg k="pages.loadingSuppliers" />} />}>
      <SuppliersView />
    </Suspense>
  );
}
