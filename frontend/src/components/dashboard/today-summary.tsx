"use client";

import { Panel, PanelHead } from "@/components/ui/panel";
import { formatCount } from "@/lib/format";
import { useT } from "@/lib/i18n/client";
import type { DashboardSummary } from "@/lib/api/schemas/dashboard";

export function TodaySummary({ data }: { data: DashboardSummary }) {
  const t = useT();
  const rows: [string, number][] = [
    [t("dashboard.ordersConfirmed"), data.sales.CONFIRMED],
    [t("dashboard.inPicking"), data.sales.PICKING],
    [t("dashboard.inPacking"), data.sales.PACKING],
    [t("dashboard.readyToShip"), data.sales.READY_TO_SHIP],
    [t("dashboard.shippedToday"), data.sales.shipped_today],
    [t("dashboard.poReceivedToday"), data.purchase_orders.received_today],
    [t("dashboard.transfersInTransit"), data.transfers.IN_TRANSIT],
    [t("dashboard.blockedSales"), data.sales.attention_required],
  ];

  return (
    <Panel className="wc-summary">
      <PanelHead title={t("dashboard.summaryTitle")} />
      <div className="p-[18px]">
        <div className="flex flex-col">
          {rows.map(([label, value]) => (
            <div
              key={label}
              className="flex items-center justify-between gap-3 border-b border-[var(--border)] py-2 text-[12.5px] last:border-b-0"
            >
              <span className="text-[var(--muted)]">{label}</span>
              <b className="qty font-semibold">{formatCount(value)}</b>
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}
