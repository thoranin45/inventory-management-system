import { Suspense } from "react";

import { WorkQueue } from "@/components/work/work-queue";
import { LoadingState } from "@/components/ui/states";
import { Msg } from "@/components/ui/msg";
import { pageMetadata } from "@/lib/i18n/server";

export const generateMetadata = () => pageMetadata("pageTitle.picking");

export default function PickingPage() {
  return (
    <Suspense fallback={<LoadingState label={<Msg k="fulfil.loadingPickQueue" />} />}>
      <WorkQueue mode="pick" />
    </Suspense>
  );
}
