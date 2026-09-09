import { Suspense } from "react";
import type { Metadata } from "next";

import { WorkQueue } from "@/components/work/work-queue";
import { LoadingState } from "@/components/ui/states";

export const metadata: Metadata = { title: "Packing · Warehouse Console" };

export default function PackingPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading packing queue…" />}>
      <WorkQueue mode="pack" />
    </Suspense>
  );
}
