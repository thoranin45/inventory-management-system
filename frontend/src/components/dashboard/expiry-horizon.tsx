"use client";

import { CircleCheck, CircleX, Clock, TriangleAlert, type LucideIcon } from "lucide-react";

import { Panel, PanelHead } from "@/components/ui/panel";
import { ErrorState, Skeleton } from "@/components/ui/states";
import { bucketWidth, type ExpiryBuckets } from "@/lib/dashboard-metrics";
import { formatCount } from "@/lib/format";
import { useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/translate";
import { useExpiryBucketsQuery } from "./dashboard-data";

type Tone = "danger" | "warning" | "info" | "success";

/** The design's five buckets: tone, icon and wording carry the state together, never colour alone. */
const BUCKETS: { key: keyof ExpiryBuckets; label: MessageKey; tone: Tone; icon: LucideIcon }[] = [
  { key: "expired", label: "dashboard.expExpired", tone: "danger", icon: CircleX },
  { key: "d30", label: "dashboard.expD30", tone: "warning", icon: TriangleAlert },
  { key: "d60", label: "dashboard.expD60", tone: "warning", icon: Clock },
  { key: "d90", label: "dashboard.expD90", tone: "info", icon: Clock },
  { key: "later", label: "dashboard.expLater", tone: "success", icon: CircleCheck },
];

/**
 * UI-1 — the design's "Expiry horizon": lots that still hold stock, by days
 * left until expiry on the business calendar. Lots, not quantities, so
 * products with different units can be compared.
 */
export function ExpiryHorizon() {
  const t = useT();
  const { buckets, isError, error, refetch } = useExpiryBucketsQuery();
  const total = buckets ? BUCKETS.reduce((n, b) => n + buckets[b.key], 0) : 0;
  const max = buckets ? Math.max(...BUCKETS.map((b) => buckets[b.key])) : 0;

  return (
    <Panel className="wc-expiry">
      <PanelHead
        title={t("dashboard.expTitle")}
        aside={buckets ? t("dashboard.lotsCount", { n: formatCount(total) }) : undefined}
      />
      <div className="wc-panel-scroll px-[18px] py-[10px]">
        {buckets ? (
          <ul aria-label={t("dashboard.expTitle")} className="flex flex-col">
            {BUCKETS.map(({ key, label, tone, icon: Icon }) => (
              <li key={key} className="wc-hbar" data-bucket={key}>
                <span className="wc-hbar-label">
                  <Icon aria-hidden className="h-[15px] w-[15px] flex-none" style={{ color: `var(--${tone})` }} />
                  <span className="truncate">{t(label)}</span>
                </span>
                <span className="wc-hbar-track" aria-hidden>
                  <i style={{ width: `${bucketWidth(buckets[key], max)}%`, background: `var(--${tone})` }} />
                </span>
                <span className="wc-hbar-count qty">{formatCount(buckets[key])}</span>
              </li>
            ))}
          </ul>
        ) : isError ? (
          <ErrorState error={error} onRetry={refetch} compact className="my-2" />
        ) : (
          <div className="flex flex-col gap-[10px] py-1" aria-hidden>
            {BUCKETS.map((b) => (
              <Skeleton key={b.key} className="h-[18px]" />
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
}
