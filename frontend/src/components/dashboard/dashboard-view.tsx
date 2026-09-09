"use client";

import { RotateCcw } from "lucide-react";

import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { ErrorState, Skeleton } from "@/components/ui/states";
import { useAttentionSummary, useDashboardSummary } from "@/lib/query/hooks";
import { formatIsoDate } from "@/lib/format";
import { InventoryCondition } from "./inventory-condition";
import { KpiZone } from "./kpi-zone";
import { NeedsAttention } from "./needs-attention";
import { OperationalQueues } from "./operational-queues";
import { RecentActivity } from "./recent-activity";
import { TodaySummary } from "./today-summary";

export function DashboardView() {
  const summary = useDashboardSummary();
  const attention = useAttentionSummary();

  const subtitle = summary.data
    ? `Operational overview · as of ${formatIsoDate(summary.data.as_of_date)} · business time UTC+7`
    : "Operational overview";

  return (
    <div className="wc-dash">
      <PageHeader
        title="Dashboard"
        subtitle={subtitle}
        actions={
          <Button
            variant="secondary"
            onClick={() => {
              void summary.refetch();
              void attention.refetch();
            }}
          >
            <RotateCcw aria-hidden className="h-[15px] w-[15px]" />
            Refresh
          </Button>
        }
      />

      {summary.isLoading ? (
        <DashboardSkeleton />
      ) : summary.isError ? (
        <ErrorState error={summary.error} onRetry={() => void summary.refetch()} />
      ) : summary.data ? (
        <>
          <KpiZone data={summary.data} />

          <section className="wc-work-zone">
            <OperationalQueues data={summary.data} />
            <NeedsAttention dashboard={summary.data} attention={attention.data} />
          </section>

          <section className="wc-lower-zone">
            <RecentActivity />
            <InventoryCondition data={summary.data} />
            <TodaySummary data={summary.data} />
          </section>
        </>
      ) : null}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-5" aria-hidden>
      <div className="wc-kpi-zone">
        <Skeleton className="h-[110px]" />
        <div className="wc-kpi-rest">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-[94px]" />
          ))}
        </div>
      </div>
      <div className="wc-work-zone">
        <Skeleton className="h-[360px]" />
        <Skeleton className="h-[360px]" />
      </div>
      <div className="wc-lower-zone">
        <Skeleton className="h-[420px]" />
        <Skeleton className="h-[220px]" />
        <Skeleton className="h-[300px]" />
      </div>
    </div>
  );
}
