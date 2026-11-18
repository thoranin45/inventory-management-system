import { Suspense } from "react";

import { CategoriesView } from "@/components/master-data/categories-view";
import { LoadingState } from "@/components/ui/states";
import { Msg } from "@/components/ui/msg";
import { pageMetadata } from "@/lib/i18n/server";

export const generateMetadata = () => pageMetadata("pageTitle.categories");

export default function CategoriesPage() {
  return (
    <Suspense fallback={<LoadingState label={<Msg k="pages.loadingCategories" />} />}>
      <CategoriesView />
    </Suspense>
  );
}
