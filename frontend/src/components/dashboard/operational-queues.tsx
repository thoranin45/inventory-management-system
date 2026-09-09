import Link from "next/link";
import {
  ChevronRight,
  ClipboardCheck,
  PackageSearch,
  Truck,
  ArrowLeftRight,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Panel, PanelHead } from "@/components/ui/panel";
import { formatCount } from "@/lib/format";
import type { DashboardSummary } from "@/lib/api/schemas/dashboard";

function QueueRow({
  icon: Icon,
  name,
  desc,
  count,
  href,
}: {
  icon: LucideIcon;
  name: string;
  desc: string;
  count: number;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-[14px] border-t border-[var(--border)] px-[18px] py-[14px] first:border-t-0 hover:bg-[var(--surface-sunken)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--accent)] max-[767.98px]:px-[14px]"
    >
      <span className="grid h-[34px] w-[34px] flex-none place-items-center rounded-[var(--r-md)] bg-[var(--surface-sunken)] text-[var(--muted)] group-hover:text-[var(--foreground)]">
        <Icon aria-hidden className="h-4 w-4" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-[1px]">
        <span className="text-[13.5px] font-semibold">{name}</span>
        <span className="truncate text-[11.5px] text-[var(--muted)]">{desc}</span>
      </span>
      <span className="qty min-w-[2ch] flex-none text-right text-[19px] font-semibold">
        {formatCount(count)}
      </span>
      <ChevronRight
        aria-hidden
        className="h-[15px] w-[15px] flex-none text-[var(--faint)] transition-transform duration-[var(--dur-1)] group-hover:translate-x-[3px] group-hover:text-[var(--muted)]"
      />
    </Link>
  );
}

export function OperationalQueues({ data }: { data: DashboardSummary }) {
  const s = data.sales;
  const openTransfers = data.transfers.IN_TRANSIT + data.transfers.PARTIALLY_RECEIVED;
  const active = s.PICKING + s.PACKING + s.READY_TO_SHIP + data.purchase_orders.pending_receiving + openTransfers;

  return (
    <Panel className="wc-queues">
      <PanelHead title="Operational queues" aside={`${active} active`} />
      <div className="flex flex-col">
        <QueueRow icon={PackageSearch} name="Picking" desc="orders being picked" count={s.PICKING} href="/picking" />
        <QueueRow icon={ClipboardCheck} name="Packing" desc="orders being verified" count={s.PACKING} href="/packing" />
        <QueueRow icon={Truck} name="Ready to ship" desc="awaiting dispatch" count={s.READY_TO_SHIP} href="/sales" />
        <QueueRow
          icon={Truck}
          name="PO receiving"
          desc="purchase orders inbound"
          count={data.purchase_orders.pending_receiving}
          href="/purchase-orders"
        />
        <QueueRow
          icon={ArrowLeftRight}
          name="Transfers"
          desc="in transit / partial"
          count={openTransfers}
          href="/transfers"
        />
      </div>
    </Panel>
  );
}
