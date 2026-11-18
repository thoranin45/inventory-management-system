import { Suspense } from "react";

import { AuditView } from "@/components/audit/audit-view";
import { LoadingState } from "@/components/ui/states";
import { Msg } from "@/components/ui/msg";
import { pageMetadata } from "@/lib/i18n/server";

export const generateMetadata = () => pageMetadata("pageTitle.audit");

export default function AuditPage() {
  return (
    <Suspense fallback={<LoadingState label={<Msg k="pages.loadingAudit" />} />}>
      <AuditView />
    </Suspense>
  );
}
