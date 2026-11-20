"use client";

import { EXPIRY_HORIZON_DAYS, expiryBuckets, type ExpiryBuckets } from "@/lib/dashboard-metrics";
import { useDashboardSummary } from "@/lib/query/hooks";
import { useExpiredStockReport, useNearExpiryReport } from "@/lib/query/reports";
import { useStockAdjustmentRequests } from "@/lib/query/stock-adjustment-requests";

/**
 * UI-1 — data sources shared by the dashboard's KPI strip, quick actions and
 * expiry horizon. TanStack Query de-duplicates identical keys, so a source
 * read by several parts of the page is requested once.
 */

/** A figure: undefined while loading, null when its source failed. */
export type Figure = number | null | undefined;

export function figureOf<D>(q: { data?: D; isError: boolean }, pick: (data: D) => number): Figure {
  if (q.data !== undefined) return pick(q.data);
  return q.isError ? null : undefined;
}

/** Lots with stock by days to expiry (near-expiry report at its widest window + expired-stock report). */
export function useExpiryBucketsQuery(): {
  buckets: ExpiryBuckets | undefined;
  isError: boolean;
  error: unknown;
  refetch: () => void;
} {
  const near = useNearExpiryReport({ days: EXPIRY_HORIZON_DAYS });
  const expired = useExpiredStockReport({});
  return {
    buckets: near.data && expired.data ? expiryBuckets(near.data.items, expired.data.items) : undefined,
    isError: near.isError || expired.isError,
    error: near.error ?? expired.error,
    refetch: () => {
      if (near.isError) void near.refetch();
      if (expired.isError) void expired.refetch();
    },
  };
}

/** Pending stock adjustment requests: all of them for an admin, the viewer's own otherwise (the backend scopes the list). */
export function usePendingAdjustmentCount(): Figure {
  return figureOf(
    useStockAdjustmentRequests({ status: "PENDING", page: 1, page_size: 1 }),
    (d) => d.pagination.total_items,
  );
}

/** Sales orders in the picking queue: the statuses the picking page lists (PICKING_QUEUE_STATUSES). */
export function usePickQueueCount(): Figure {
  return figureOf(useDashboardSummary(), (d) => d.sales.CONFIRMED + d.sales.PICKING);
}
