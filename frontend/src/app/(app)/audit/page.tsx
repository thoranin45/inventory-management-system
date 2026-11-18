import { Suspense } from "react";
import type { Metadata } from "next";

import { AuditView } from "@/components/audit/audit-view";
import { LoadingState } from "@/components/ui/states";
import { Msg } from "@/components/ui/msg";

export const metadata: Metadata = { title: "Audit log" };

export default function AuditPage() {
  return (
    <Suspense fallback={<LoadingState label={<Msg k="pages.loadingAudit" />} />}>
      <AuditView />
    </Suspense>
  );
}
