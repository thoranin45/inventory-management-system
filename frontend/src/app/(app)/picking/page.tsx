import { Suspense } from "react";
import type { Metadata } from "next";

import { WorkQueue } from "@/components/work/work-queue";
import { LoadingState } from "@/components/ui/states";

export const metadata: Metadata = { title: "Picking" };

export default function PickingPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading picking queue…" />}>
      <WorkQueue mode="pick" />
    </Suspense>
  );
}
