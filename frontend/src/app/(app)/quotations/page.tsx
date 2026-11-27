import { Suspense } from "react";

import { QuotationsView } from "@/components/quotations/quotations-view";
import { LoadingState } from "@/components/ui/states";
import { Msg } from "@/components/ui/msg";
import { pageMetadata } from "@/lib/i18n/server";

export const generateMetadata = () => pageMetadata("pageTitle.quotations");

export default function QuotationsPage() {
  return (
    <Suspense fallback={<LoadingState label={<Msg k="quotations.loading" />} />}>
      <QuotationsView />
    </Suspense>
  );
}
