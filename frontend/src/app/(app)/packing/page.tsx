import { Suspense } from "react";
import type { Metadata } from "next";

import { WorkQueue } from "@/components/work/work-queue";
import { LoadingState } from "@/components/ui/states";
import { Msg } from "@/components/ui/msg";

export const metadata: Metadata = { title: "Packing" };

export default function PackingPage() {
  return (
    <Suspense fallback={<LoadingState label={<Msg k="fulfil.loadingPackQueue" />} />}>
      <WorkQueue mode="pack" />
    </Suspense>
  );
}
