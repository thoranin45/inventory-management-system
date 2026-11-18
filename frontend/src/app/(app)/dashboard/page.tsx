
import { DashboardView } from "@/components/dashboard/dashboard-view";
import { pageMetadata } from "@/lib/i18n/server";

export const generateMetadata = () => pageMetadata("pageTitle.dashboard");

export default function DashboardPage() {
  return <DashboardView />;
}
