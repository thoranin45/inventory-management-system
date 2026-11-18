"use client";

import * as React from "react";
import Link from "next/link";
import { BookOpen, TriangleAlert } from "lucide-react";

import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { LocalDate } from "@/components/ui/local-date";
import { MoneyDisplay, QuantityDisplay } from "@/components/ui/quantity-display";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { useOrderCopy } from "@/components/orders/use-order-copy";
import { formatBusinessDateTime, formatStoredWallClock } from "@/lib/format";
import { type Role } from "@/lib/auth/permissions";
import { useT } from "@/lib/i18n/client";
import { attentionMessage } from "@/lib/order-copy";
import { useProductLookup, useSalesOrder } from "@/lib/query/sales";
import { type SalesOrderDetail, type SalesOrderRow } from "@/lib/api/schemas/sales";
import { SalesLifecycle } from "./sales-lifecycle";
import { SalesActions } from "./sales-actions";
import { SalesDocuments } from "./sales-documents";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-[var(--border)] py-[7px] text-[13px] last:border-b-0">
      <span className="flex-none text-[var(--muted)]">{label}</span>
      <span className="min-w-0 text-right">{children}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="wc-section-label mb-2">{title}</h3>
      <div className="rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface)] px-3">{children}</div>
    </section>
  );
}

/** A backend timestamp: Bangkok business time when it carries a zone, the stored wall-clock otherwise. */
function When({ iso }: { iso: string | null | undefined }) {
  if (!iso) return <span className="mono">—</span>;
  const zoned = /(Z|[+-]\d{2}:?\d{2})$/.test(iso);
  return <span className="mono">{zoned ? formatBusinessDateTime(iso) : formatStoredWallClock(iso)}</span>;
}

function AttentionBanner({ reason }: { reason: string }) {
  const copy = useOrderCopy();
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-[var(--r-md)] border border-[color-mix(in_srgb,var(--warning)_38%,transparent)] bg-[var(--warning-subtle)] p-3 text-[13px] text-[var(--foreground)]"
    >
      <TriangleAlert aria-hidden className="h-4 w-4 flex-none text-[var(--warning)]" />
      <span>{copy(attentionMessage(reason))}</span>
    </div>
  );
}

/** Order lines with their allocations and fulfilment progress (backend figures only). */
function Lines({ detail, name }: { detail: SalesOrderDetail; name: (productId: number) => { name: string; sku: string } }) {
  const t = useT();
  return (
    <ul className="divide-y divide-[var(--border)]">
      {detail.items.map((it) => {
        const p = name(it.product_id);
        return (
          <li key={it.id} className="flex flex-col gap-1 py-[9px] text-[13px]">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <span className="min-w-0 font-medium">{p.name}</span>
              <span className="mono text-[12px] text-[var(--muted)]">{p.sku}</span>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-[var(--muted)]">
              <span>
                {t("sales.qtyShort")} <QuantityDisplay value={it.quantity} className="font-medium text-[var(--foreground)]" />
              </span>
              <span>
                @ <MoneyDisplay value={it.unit_price} className="font-medium text-[var(--foreground)]" />
              </span>
              <span>
                = <MoneyDisplay value={it.total_price} className="font-medium text-[var(--foreground)]" />
              </span>
            </div>
            {it.fulfillment_allocations.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-[var(--r-sm)] bg-[var(--surface-sunken)] px-2 py-1 text-[12px] text-[var(--muted)]">
                <span className="mono">{a.batch_id != null ? t("sales.batchRef", { id: a.batch_id }) : t("task.trackNone")}</span>
                <span className="ml-auto flex flex-wrap items-center gap-3">
                  <span>
                    {t("sales.allocShort")} <QuantityDisplay value={a.quantity} className="font-medium text-[var(--foreground)]" />
                  </span>
                  <span>
                    {t("sales.pickedShort")} <QuantityDisplay value={a.picked_quantity} className="font-medium text-[var(--foreground)]" />
                  </span>
                  <span>
                    {t("sales.packedShort")} <QuantityDisplay value={a.packed_quantity} className="font-medium text-[var(--foreground)]" />
                  </span>
                </span>
              </div>
            ))}
          </li>
        );
      })}
    </ul>
  );
}

function SalesDetailBody({ row, role, onDone }: { row: SalesOrderRow; role: Role; onDone: () => void }) {
  const t = useT();
  const q = useSalesOrder(row.id);
  const detail = q.data;
  const status = detail?.status ?? row.status;
  const upper = status.toUpperCase();
  const soNumber = detail?.so_number ?? row.so_number;
  const customerName = row.customer_name ?? (row.customer_id != null ? t("sales.customerRef", { id: row.customer_id }) : "—");

  const productIds = React.useMemo(() => detail?.items.map((i) => i.product_id) ?? [], [detail]);
  const lookup = useProductLookup(productIds).data ?? {};
  const name = (pid: number) => ({
    name: lookup[pid]?.product_name ?? t("receive.productFallback", { id: pid }),
    sku: lookup[pid]?.sku ?? "",
  });
  const allocated = detail?.items.some((it) => it.fulfillment_allocations.length > 0) ?? false;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mono text-[16px] font-semibold">{soNumber ?? t("sales.soRef", { id: row.id })}</div>
          <div className="text-[13px] text-[var(--muted)]">{customerName}</div>
        </div>
        <StatusBadge status={upper} />
      </div>

      {row.attention_reason ? <AttentionBanner reason={row.attention_reason} /> : null}

      <Section title={t("sales.lifecycle")}>
        <div className="py-3">
          <SalesLifecycle status={status} attentionReason={row.attention_reason} />
        </div>
      </Section>

      <Section title={t("sales.summary")}>
        <Row label={t("sales.customer")}>{customerName}</Row>
        <Row label={t("sales.created")}>
          <span className="mono">
            <LocalDate iso={detail?.created_at ?? row.created_at} isoInEnglish />
          </span>
        </Row>
        <Row label={t("sales.lastActivity")}>
          <span className="mono">
            <LocalDate iso={row.last_activity_at} isoInEnglish />
          </span>
        </Row>
        <Row label={t("sales.items")}>{row.item_count}</Row>
        <Row label={t("sales.totalQuantity")}>
          <QuantityDisplay value={row.total_quantity} />
        </Row>
        <Row label={t("sales.totalAmount")}>
          <MoneyDisplay value={row.total_amount} />
        </Row>
      </Section>

      {q.isLoading ? (
        <LoadingState label={t("sales.loadingLines")} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} compact />
      ) : detail ? (
        <>
          <Section title={t("sales.items")}>
            <Lines detail={detail} name={name} />
            {!allocated ? <p className="pb-3 text-[12px] text-[var(--muted)]">{t("sales.noAllocation")}</p> : null}
          </Section>

          {/* D-R5-7: supported timestamps only — the backend gives user ids, not names */}
          <Section title={t("sales.fulfillment")}>
            <Row label={t("sales.pickedAt")}>
              <When iso={detail.picked_at} />
            </Row>
            <Row label={t("sales.packedAt")}>
              <When iso={detail.packed_at} />
            </Row>
            <Row label={t("sales.shippedAt")}>
              <When iso={detail.shipped_at} />
            </Row>
            <Row label={t("sales.shipmentNumber")}>
              <span className="mono">{detail.shipment_number ?? "—"}</span>
            </Row>
          </Section>

          {/* D-R5-6: shipment and return movements carry reference_number = SO number (verified) */}
          {(upper === "SHIPPED" || upper === "COMPLETED") && soNumber ? (
            <Link
              href={`/inventory/ledger?reference_number=${encodeURIComponent(soNumber)}`}
              className="inline-flex min-h-11 items-center gap-2 self-start text-[13px] font-medium text-[var(--accent)] underline-offset-2 hover:underline"
            >
              <BookOpen aria-hidden className="h-4 w-4" />
              {t("sales.viewMovements")}
            </Link>
          ) : null}

          {["READY_TO_SHIP", "SHIPPED", "COMPLETED"].includes(upper) ? (
            <Section title={t("sales.documents")}>
              <div className="py-3">
                <SalesDocuments orderId={row.id} />
              </div>
            </Section>
          ) : null}
        </>
      ) : null}

      <div className="sticky bottom-0 -mx-4 mt-1 border-t border-[var(--border)] bg-[var(--surface)] px-4 pb-[env(safe-area-inset-bottom)] pt-3">
        <SalesActions id={row.id} status={status} soNumber={soNumber} role={role} onDone={onDone} />
      </div>
    </div>
  );
}

export function SalesDetailDrawer({
  row,
  open,
  onOpenChange,
  role,
}: {
  row: SalesOrderRow | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  role: Role;
}) {
  const t = useT();
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent title={row ? (row.so_number ?? t("sales.soRef", { id: row.id })) : t("sales.salesOrder")}>
        {row ? <SalesDetailBody row={row} role={role} onDone={() => onOpenChange(false)} /> : <EmptyState message={t("sales.noneSelected")} />}
      </DrawerContent>
    </Drawer>
  );
}
