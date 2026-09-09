import { Suspense } from "react";
import type { Metadata } from "next";

import { AuditView } from "@/components/audit/audit-view";
import { LoadingState } from "@/components/ui/states";

export const metadata: Metadata = { title: "Audit log · Warehouse Console" };

export default function AuditPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading audit log…" />}>
      <AuditView />
    </Suspense>
  );
}
