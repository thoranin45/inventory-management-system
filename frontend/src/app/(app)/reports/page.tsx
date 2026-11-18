
import { ReportsLanding } from "@/components/reports/reports-landing";
import { pageMetadata } from "@/lib/i18n/server";

export const generateMetadata = () => pageMetadata("pageTitle.reports");

export default function ReportsPage() {
  return <ReportsLanding />;
}
