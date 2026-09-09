import { Suspense } from "react";
import type { Metadata } from "next";

import { CategoriesView } from "@/components/master-data/categories-view";
import { LoadingState } from "@/components/ui/states";

export const metadata: Metadata = { title: "Categories · Warehouse Console" };

export default function CategoriesPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading categories…" />}>
      <CategoriesView />
    </Suspense>
  );
}
