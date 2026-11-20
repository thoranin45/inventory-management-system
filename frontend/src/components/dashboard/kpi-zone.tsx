"use client";

import * as React from "react";
import Link from "next/link";

import { Skeleton } from "@/components/ui/states";
import { useSession } from "@/components/session-provider";
import { isAdmin } from "@/lib/auth/permissions";
import { NEAR_EXPIRY_WINDOW_DAYS, kpiKeysFor, nearExpiryLots, type KpiKey } from "@/lib/dashboard-metrics";
import { formatCount } from "@/lib/format";
import { useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/translate";
import { useAttentionSummary, useDashboardSummary, useProducts } from "@/lib/query/hooks";
import { useExpiredStockReport } from "@/lib/query/reports";
import {
  figureOf,
  useExpiryBucketsQuery,
  usePendingAdjustmentCount,
  usePickQueueCount,
  type Figure,
} from "./dashboard-data";

/* One small component per tile, so only the tiles a role sees fetch anything. */

function LowTile() {
  return <KpiTile k="low" figure={figureOf(useAttentionSummary(), (d) => d.low_operational_stock)} />;
}

function NearTile() {
  const { buckets, isError } = useExpiryBucketsQuery();
  return <KpiTile k="near" figure={buckets ? nearExpiryLots(buckets) : isError ? null : undefined} />;
}

function ExpiredTile() {
  return <KpiTile k="expired" figure={figureOf(useExpiredStockReport({}), (d) => d.items.length)} />;
}

function ApprovalsTile() {
  return <KpiTile k="approvals" figure={usePendingAdjustmentCount()} />;
}

function MineTile() {
  return <KpiTile k="mine" figure={usePendingAdjustmentCount()} />;
}

function PickTile() {
  return <KpiTile k="pick" figure={usePickQueueCount()} />;
}

function ReceiptsTile() {
  return <KpiTile k="receipts" figure={figureOf(useDashboardSummary(), (d) => d.purchase_orders.pending_receiving)} />;
}

function SkusTile() {
  return <KpiTile k="skus" figure={figureOf(useProducts({ page: 1, page_size: 1 }), (d) => d.pagination.total_items)} />;
}

const TILE: Record<KpiKey, () => React.ReactElement> = {
  low: LowTile,
  near: NearTile,
  expired: ExpiredTile,
  approvals: ApprovalsTile,
  pick: PickTile,
  skus: SkusTile,
  receipts: ReceiptsTile,
  mine: MineTile,
};

const LABEL: Record<KpiKey, MessageKey> = {
  low: "dashboard.kpiLow",
  near: "dashboard.kpiNear",
  expired: "dashboard.kpiExpired",
  approvals: "dashboard.kpiApprovals",
  pick: "dashboard.kpiPick",
  skus: "dashboard.kpiSkus",
  receipts: "dashboard.kpiReceipts",
  mine: "dashboard.kpiMine",
};

/** Each tile opens the page that lists exactly what it counts. */
export const KPI_HREF: Record<KpiKey, string> = {
  low: "/reports/low-stock",
  near: `/reports/near-expiry?days=${NEAR_EXPIRY_WINDOW_DAYS}`,
  expired: "/reports/expired",
  approvals: "/stock-adjustments/approvals",
  pick: "/picking",
  skus: "/products",
  receipts: "/purchase-orders",
  mine: "/stock-adjustments/mine?status=PENDING",
};

function KpiTile({ k, figure }: { k: KpiKey; figure: Figure }) {
  const t = useT();
  return (
    <Link href={KPI_HREF[k]} className="wc-kpi" data-kpi={k}>
      <span className="wc-kpi-label">{t(LABEL[k])}</span>{" "}
      {/* the space keeps label and figure apart in the link's spoken name; flex layout does not render it */}
      {figure === undefined ? (
        <Skeleton className="wc-kpi-skeleton" />
      ) : figure === null ? (
        <span className="wc-kpi-value text-[var(--faint)]" title={t("dashboard.kpiUnavailable")}>
          —<span className="sr-only">{t("dashboard.kpiUnavailable")}</span>
        </span>
      ) : (
        <span className="wc-kpi-value qty">{formatCount(figure)}</span>
      )}
    </Link>
  );
}

/** UI-1 — the design's KPI strip: six whole-number counts, chosen by role (phones show four). */
export function KpiZone() {
  const t = useT();
  const { user } = useSession();
  return (
    <section className="wc-kpi-strip" aria-label={t("dashboard.kpiAria")}>
      {kpiKeysFor(isAdmin(user.role)).map((k) => {
        const Tile = TILE[k];
        return <Tile key={k} />;
      })}
    </section>
  );
}
