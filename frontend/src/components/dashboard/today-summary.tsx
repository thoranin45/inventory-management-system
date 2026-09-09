import { Panel, PanelHead } from "@/components/ui/panel";
import { formatCount } from "@/lib/format";
import type { DashboardSummary } from "@/lib/api/schemas/dashboard";

export function TodaySummary({ data }: { data: DashboardSummary }) {
  const rows: [string, number][] = [
    ["Orders confirmed", data.sales.CONFIRMED],
    ["In picking", data.sales.PICKING],
    ["In packing", data.sales.PACKING],
    ["Ready to ship", data.sales.READY_TO_SHIP],
    ["Shipped today", data.sales.shipped_today],
    ["PO received today", data.purchase_orders.received_today],
    ["Transfers in transit", data.transfers.IN_TRANSIT],
    ["Blocked sales", data.sales.attention_required],
  ];

  return (
    <Panel className="wc-summary">
      <PanelHead title="Today’s summary" />
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
