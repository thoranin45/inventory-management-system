import { Suspense } from "react";

import { CompanyProfileView } from "@/components/company-profile/company-profile-view";
import { LoadingState } from "@/components/ui/states";
import { Msg } from "@/components/ui/msg";
import { pageMetadata } from "@/lib/i18n/server";

export const generateMetadata = () => pageMetadata("pageTitle.companyProfile");

export default function CompanyProfilePage() {
  return (
    <Suspense fallback={<LoadingState label={<Msg k="pages.loadingCompanyProfile" />} />}>
      <CompanyProfileView />
    </Suspense>
  );
}
