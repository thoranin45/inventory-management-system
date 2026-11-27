import { Suspense } from "react";

import { InvoicesView } from "@/components/invoices/invoices-view";
import { LoadingState } from "@/components/ui/states";
import { Msg } from "@/components/ui/msg";
import { pageMetadata } from "@/lib/i18n/server";

export const generateMetadata = () => pageMetadata("pageTitle.invoices");

export default function InvoicesPage() {
  return (
    <Suspense fallback={<LoadingState label={<Msg k="invoices.loading" />} />}>
      <InvoicesView />
    </Suspense>
  );
}
