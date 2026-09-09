import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { Panel, PanelHead } from "@/components/ui/panel";
import { isZero } from "@/lib/decimal";
import { formatQty } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AttentionSummary, DashboardSummary } from "@/lib/api/schemas/dashboard";

type Severity = "warning" | "danger" | "accent" | "ok";

const BAR: Record<Severity, string> = {
  warning: "bg-[var(--warning)]",
  danger: "bg-[var(--danger)]",
  accent: "bg-[var(--accent)]",
  ok: "bg-[var(--border-strong)]",
};

function AttnRow({
  severity,
  name,
  figure,
  sub,
  href,
}: {
  severity: Severity;
  name: string;
  figure: string;
  sub: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="group relative flex items-center gap-3 border-t border-[var(--border)] py-[14px] pl-5 pr-[18px] first:border-t-0 hover:bg-[var(--surface-sunken)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--accent)] max-[767.98px]:pl-4 max-[767.98px]:pr-[14px]"
    >
      <span aria-hidden className={cn("absolute inset-y-3 left-0 w-[3px] rounded-[2px]", BAR[severity])} />
      <span className="flex min-w-0 flex-1 flex-col gap-[1px]">
        <span className="text-[13px] font-semibold">{name}</span>
        <span className="truncate text-[11px] text-[var(--muted)]">{sub}</span>
      </span>
      <span className="qty flex-none text-[15px] font-semibold">{figure}</span>
      <ChevronRight
        aria-hidden
        className="h-[15px] w-[15px] flex-none text-[var(--faint)] transition-transform duration-[var(--dur-1)] group-hover:translate-x-[3px]"
      />
    </Link>
  );
}

export function NeedsAttention({
  dashboard,
  attention,
}: {
  dashboard: DashboardSummary;
  attention?: AttentionSummary;
}) {
  const inv = dashboard.inventory;
  const blocked = dashboard.sales.attention_required;
  const lowStock = attention?.low_operational_stock ?? 0;

  return (
    <Panel className="flex flex-col">
      <PanelHead title="Needs attention" />
      <div className="flex flex-1 flex-col justify-between">
        <AttnRow
          severity={lowStock ? "warning" : "ok"}
          name="Low stock"
          figure={`${lowStock} ${lowStock === 1 ? "SKU" : "SKUs"}`}
          sub={lowStock ? "operational available below threshold" : "all above reorder point"}
          href="/products"
        />
        <AttnRow
          severity={!isZero(inv.expired_quantity) ? "danger" : "ok"}
          name="Expired inventory"
          figure={formatQty(inv.expired_quantity)}
          sub={`units · blocks ${blocked} ${blocked === 1 ? "sale" : "sales"}`}
          href="/stock"
        />
        <AttnRow
          severity={!isZero(inv.near_expiry_quantity) ? "warning" : "ok"}
          name="Near expiry"
          figure={formatQty(inv.near_expiry_quantity)}
          sub="units · subset of available, ≤ 90 days"
          href="/stock"
        />
        <AttnRow
          severity={blocked ? "accent" : "ok"}
          name="Blocked sales"
          figure={`${blocked} ${blocked === 1 ? "order" : "orders"}`}
          sub={blocked ? "cannot ship on an expired lot" : "no blocked orders"}
          href="/sales"
        />
      </div>
    </Panel>
  );
}
