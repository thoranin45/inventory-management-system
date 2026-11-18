import { Suspense } from "react";

import { InventoryLedgerView } from "@/components/inventory-ledger/ledger-view";
import { LoadingState } from "@/components/ui/states";
import { Msg } from "@/components/ui/msg";
import { pageMetadata } from "@/lib/i18n/server";

export const generateMetadata = () => pageMetadata("pageTitle.ledger");

export default function InventoryLedgerPage() {
  return (
    <Suspense fallback={<LoadingState label={<Msg k="pages.loadingLedger" />} />}>
      <InventoryLedgerView />
    </Suspense>
  );
}
