import { Suspense } from "react";

import { AdjustmentsView } from "@/components/invoices/adjustments-view";
import { LoadingState } from "@/components/ui/states";
import { Msg } from "@/components/ui/msg";
import { pageMetadata } from "@/lib/i18n/server";

export const generateMetadata = () => pageMetadata("pageTitle.adjustments");

export default function AdjustmentNotesPage() {
  return (
    <Suspense fallback={<LoadingState label={<Msg k="adjustments.loading" />} />}>
      <AdjustmentsView />
    </Suspense>
  );
}
