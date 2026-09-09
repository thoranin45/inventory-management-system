import { Panel, PanelHead } from "@/components/ui/panel";
import { compareDecimals, ratio, sumDecimals } from "@/lib/decimal";
import { formatQty } from "@/lib/format";
import type { DashboardSummary } from "@/lib/api/schemas/dashboard";

/**
 * Four mutually-exclusive slices of Owned:
 *   available + reserved + in-transit + expired  (should reconcile to owned)
 * Near-expiry overlaps Available, so it is shown as an overlay statistic —
 * never a fifth slice. All maths is Decimal-safe (scaled BigInt), and the
 * only Number derived is the CSS bar width via `ratio()`.
 */
export function InventoryCondition({ data }: { data: DashboardSummary }) {
  const inv = data.inventory;
  const parts: { key: string; label: string; color: string; value: string }[] = [
    { key: "avail", label: "Available", color: "var(--success)", value: inv.operational_available_quantity },
    { key: "res", label: "Reserved", color: "var(--faint)", value: inv.reserved_quantity },
    { key: "tr", label: "In transit", color: "var(--accent)", value: inv.in_transit_quantity },
    { key: "exp", label: "Expired", color: "var(--danger)", value: inv.expired_quantity },
  ];

  const segSum = sumDecimals(parts.map((p) => p.value));
  const owned = inv.owned_quantity;
  const reconciles = compareDecimals(segSum, owned) === 0;
  const denom = compareDecimals(segSum, "0") === 0 ? "1" : segSum;

  const hasStock = compareDecimals(owned, "0") !== 0;

  return (
    <Panel className="wc-condition">
      <PanelHead title="Inventory condition" aside={`${formatQty(owned)} owned`} />
      <div className="p-[18px]">
        {hasStock ? (
          <>
            <div className="flex h-7 overflow-hidden rounded-[var(--r-sm)] border border-[var(--border)]">
              {parts.map((p) =>
                compareDecimals(p.value, "0") === 0 ? null : (
                  <span
                    key={p.key}
                    style={{ width: `${(ratio(p.value, denom) * 100).toFixed(1)}%`, background: p.color }}
                    className="block"
                  />
                ),
              )}
            </div>
            <div className="mt-[9px] flex flex-wrap gap-x-[14px] gap-y-2 text-[11px] text-[var(--muted)]">
              {parts.map((p) => (
                <span key={p.key} className="inline-flex items-center gap-[5px]">
                  <i
                    aria-hidden
                    className="inline-block h-[9px] w-[9px] rounded-[2px] align-middle"
                    style={{ background: p.color }}
                  />
                  {p.label} {formatQty(p.value)}
                </span>
              ))}
            </div>
            <p className="mt-[10px] text-[11px] text-[var(--muted)]">
              {reconciles
                ? `Available + Reserved + In transit + Expired = ${formatQty(segSum)} = Owned.`
                : `Segments shown sum to ${formatQty(segSum)} of ${formatQty(owned)} owned.`}
            </p>
            <p className="mono mt-3 inline-flex items-center gap-[6px] rounded-[var(--r-full)] bg-[var(--warning-subtle)] px-[9px] py-1 text-[11px] text-[var(--warning)]">
              Near expiry {formatQty(inv.near_expiry_quantity)} · overlay
            </p>
          </>
        ) : (
          <p className="py-2 text-[12px] text-[var(--muted)]">No stock on record.</p>
        )}
      </div>
    </Panel>
  );
}
