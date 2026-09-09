import type { Metadata } from "next";

import { ReportsLanding } from "@/components/reports/reports-landing";

export const metadata: Metadata = { title: "Reports · Warehouse Console" };

export default function ReportsPage() {
  return <ReportsLanding />;
}
