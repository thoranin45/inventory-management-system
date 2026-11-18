import { Suspense } from "react";
import type { Metadata } from "next";

import { CategoriesView } from "@/components/master-data/categories-view";
import { LoadingState } from "@/components/ui/states";
import { Msg } from "@/components/ui/msg";

export const metadata: Metadata = { title: "Categories" };

export default function CategoriesPage() {
  return (
    <Suspense fallback={<LoadingState label={<Msg k="pages.loadingCategories" />} />}>
      <CategoriesView />
    </Suspense>
  );
}
