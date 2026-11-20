"use client";

import { PageHeader } from "@/components/ui/page-header";
import { ErrorState, Skeleton } from "@/components/ui/states";
import { useSession } from "@/components/session-provider";
import { isAdmin } from "@/lib/auth/permissions";
import { formatDisplayDate } from "@/lib/business-date";
import { useAttentionSummary, useDashboardSummary } from "@/lib/query/hooks";
import { useI18n } from "@/lib/i18n/client";
import { ExpiryHorizon } from "./expiry-horizon";
import { InventoryCondition } from "./inventory-condition";
import { KpiZone } from "./kpi-zone";
import { NeedsAttention } from "./needs-attention";
import { OperationalQueues } from "./operational-queues";
import { DashboardActions, PhoneQuickActions, useDashboardRefresh } from "./quick-actions";
import { RecentActivity } from "./recent-activity";
import { TodaySummary } from "./today-summary";

export function DashboardView() {
  const summary = useDashboardSummary();
  const attention = useAttentionSummary();
  const { t, locale } = useI18n();
  const { user } = useSession();
  const refresh = useDashboardRefresh();

  const subtitle = summary.data
    ? t("dashboard.subtitleAsOf", { date: formatDisplayDate(summary.data.as_of_date, locale) })
    : t("dashboard.subtitle");

  return (
    <div className="wc-dash">
      <PageHeader
        title={t("dashboard.title")}
        subtitle={subtitle}
        actions={
          <DashboardActions
            admin={isAdmin(user.role)}
            generatedAt={summary.data?.generated_at}
            refreshing={summary.isFetching}
            onRefresh={refresh}
          />
        }
      />
      <PhoneQuickActions />

      {/* Each tile loads on its own, so the strip shows even while the summary is still loading. */}
      <KpiZone />

      {summary.isLoading ? (
        <DashboardSkeleton />
      ) : summary.isError ? (
        <ErrorState error={summary.error} onRetry={() => void summary.refetch()} />
      ) : summary.data ? (
        <>
          <section className="wc-work-zone">
            <OperationalQueues data={summary.data} />
            <NeedsAttention dashboard={summary.data} attention={attention.data} />
          </section>

          <section className="wc-lower-zone">
            <RecentActivity />
            <ExpiryHorizon />
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
      <div className="wc-work-zone">
        <Skeleton className="h-[360px]" />
        <Skeleton className="h-[360px]" />
      </div>
      <div className="wc-lower-zone">
        <Skeleton className="h-[420px]" />
        <Skeleton className="h-[220px]" />
        <Skeleton className="h-[220px]" />
        <Skeleton className="h-[300px]" />
      </div>
    </div>
  );
}
