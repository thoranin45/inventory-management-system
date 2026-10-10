import { Suspense } from "react";
import type { Metadata } from "next";

import { InventoryLedgerView } from "@/components/inventory-ledger/ledger-view";
import { LoadingState } from "@/components/ui/states";

export const metadata: Metadata = { title: "Inventory Ledger" };

export default function InventoryLedgerPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading ledger…" />}>
      <InventoryLedgerView />
    </Suspense>
  );
}
