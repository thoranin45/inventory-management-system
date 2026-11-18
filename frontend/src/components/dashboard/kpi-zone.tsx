"use client";

import { MetricCard } from "@/components/ui/metric-card";
import { formatQty } from "@/lib/format";
import { useT } from "@/lib/i18n/client";
import type { DashboardSummary } from "@/lib/api/schemas/dashboard";

export function KpiZone({ data }: { data: DashboardSummary }) {
  const t = useT();
  const inv = data.inventory;
  const openTransfers = data.transfers.IN_TRANSIT + data.transfers.PARTIALLY_RECEIVED;
  return (
    <section className="wc-kpi-zone">
      <MetricCard
        hero
        label={t("dashboard.operationalAvailable")}
        value={formatQty(inv.operational_available_quantity)}
        sub={t("dashboard.ofOwned", { qty: formatQty(inv.owned_quantity) })}
        href="/stock"
      />
      <div className="wc-kpi-rest">
        <MetricCard label={t("dashboard.owned")} value={formatQty(inv.owned_quantity)} href="/stock" />
        <MetricCard label={t("dashboard.reserved")} value={formatQty(inv.reserved_quantity)} href="/stock" />
        <MetricCard
          label={t("dashboard.inTransit")}
          value={formatQty(inv.in_transit_quantity)}
          sub={t(openTransfers === 1 ? "dashboard.transfersOpenOne" : "dashboard.transfersOpenMany", { n: openTransfers })}
          href="/transfers"
        />
        <MetricCard
          label={t("dashboard.expired")}
          tone="danger"
          value={formatQty(inv.expired_quantity)}
          sub={t(data.sales.attention_required === 1 ? "dashboard.blocksSalesOne" : "dashboard.blocksSalesMany", { n: data.sales.attention_required })}
          href="/stock"
        />
        <MetricCard
          label={t("dashboard.nearExpiry")}
          tone="warning"
          value={formatQty(inv.near_expiry_quantity)}
          sub={t("dashboard.within90Days")}
          href="/stock"
        />
      </div>
    </section>
  );
}
