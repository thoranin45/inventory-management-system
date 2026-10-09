import { Suspense } from "react";
import type { Metadata } from "next";

import { SuppliersView } from "@/components/master-data/suppliers-view";
import { LoadingState } from "@/components/ui/states";

export const metadata: Metadata = { title: "Suppliers" };

export default function SuppliersPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading suppliers…" />}>
      <SuppliersView />
    </Suspense>
  );
}
