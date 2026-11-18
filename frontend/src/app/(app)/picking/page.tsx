import { Suspense } from "react";
import type { Metadata } from "next";

import { WorkQueue } from "@/components/work/work-queue";
import { LoadingState } from "@/components/ui/states";
import { Msg } from "@/components/ui/msg";

export const metadata: Metadata = { title: "Picking" };

export default function PickingPage() {
  return (
    <Suspense fallback={<LoadingState label={<Msg k="fulfil.loadingPickQueue" />} />}>
      <WorkQueue mode="pick" />
    </Suspense>
  );
}
