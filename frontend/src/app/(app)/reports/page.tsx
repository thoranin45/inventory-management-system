import type { Metadata } from "next";

import { ReportsLanding } from "@/components/reports/reports-landing";

export const metadata: Metadata = { title: "Reports" };

export default function ReportsPage() {
  return <ReportsLanding />;
}
