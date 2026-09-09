import { Suspense } from "react";
import type { Metadata } from "next";

import { CustomersView } from "@/components/master-data/customers-view";
import { LoadingState } from "@/components/ui/states";

export const metadata: Metadata = { title: "Customers · Warehouse Console" };

export default function CustomersPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading customers…" />}>
      <CustomersView />
    </Suspense>
  );
}
