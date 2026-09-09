import { MetricCard } from "@/components/ui/metric-card";
import { formatQty } from "@/lib/format";
import type { DashboardSummary } from "@/lib/api/schemas/dashboard";

export function KpiZone({ data }: { data: DashboardSummary }) {
  const inv = data.inventory;
  const openTransfers = data.transfers.IN_TRANSIT + data.transfers.PARTIALLY_RECEIVED;
  return (
    <section className="wc-kpi-zone">
      <MetricCard
        hero
        label="Operational available"
        value={formatQty(inv.operational_available_quantity)}
        sub={`of ${formatQty(inv.owned_quantity)} owned`}
        href="/stock"
      />
      <div className="wc-kpi-rest">
        <MetricCard label="Owned" value={formatQty(inv.owned_quantity)} href="/stock" />
        <MetricCard label="Reserved" value={formatQty(inv.reserved_quantity)} href="/stock" />
        <MetricCard
          label="In transit"
          value={formatQty(inv.in_transit_quantity)}
          sub={`${openTransfers} transfer${openTransfers === 1 ? "" : "s"} open`}
          href="/transfers"
        />
        <MetricCard
          label="Expired"
          tone="danger"
          value={formatQty(inv.expired_quantity)}
          sub={`blocks ${data.sales.attention_required} ${data.sales.attention_required === 1 ? "sale" : "sales"}`}
          href="/stock"
        />
        <MetricCard
          label="Near expiry"
          tone="warning"
          value={formatQty(inv.near_expiry_quantity)}
          sub="within 90 days"
          href="/stock"
        />
      </div>
    </section>
  );
}
