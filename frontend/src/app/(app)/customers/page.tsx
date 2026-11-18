import { Suspense } from "react";

import { CustomersView } from "@/components/master-data/customers-view";
import { LoadingState } from "@/components/ui/states";
import { Msg } from "@/components/ui/msg";
import { pageMetadata } from "@/lib/i18n/server";

export const generateMetadata = () => pageMetadata("pageTitle.customers");

export default function CustomersPage() {
  return (
    <Suspense fallback={<LoadingState label={<Msg k="pages.loadingCustomers" />} />}>
      <CustomersView />
    </Suspense>
  );
}
