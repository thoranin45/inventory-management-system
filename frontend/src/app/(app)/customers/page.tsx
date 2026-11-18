import { Suspense } from "react";
import type { Metadata } from "next";

import { CustomersView } from "@/components/master-data/customers-view";
import { LoadingState } from "@/components/ui/states";
import { Msg } from "@/components/ui/msg";

export const metadata: Metadata = { title: "Customers" };

export default function CustomersPage() {
  return (
    <Suspense fallback={<LoadingState label={<Msg k="pages.loadingCustomers" />} />}>
      <CustomersView />
    </Suspense>
  );
}
