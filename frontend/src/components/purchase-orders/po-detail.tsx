"use client";

import * as React from "react";

import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { MoneyDisplay, QuantityDisplay } from "@/components/ui/quantity-display";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { ProgressRing } from "@/components/work/progress-ring";
import { formatIsoDate } from "@/lib/format";
import { type Role } from "@/lib/auth/permissions";
import { useProductLookup } from "@/lib/query/sales";
import { usePurchaseOrder } from "@/lib/query/purchase-orders";
import { sumDecimals } from "@/lib/decimal";
import { PO_STATUS_LABEL, type PurchaseOrderRow } from "@/lib/api/schemas/purchase-orders";
import { PurchaseOrderLifecycle } from "./po-lifecycle";
import { PurchaseOrderActions } from "./po-actions";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-[var(--border)] py-[7px] text-[12.5px] last:border-b-0">
      <span className="text-[var(--muted)]">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h4 className="wc-section-label mb-2">{title}</h4>
      <div className="rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface)] px-3">{children}</div>
    </section>
  );
}

function PurchaseOrderDetailBody({ row, role, onDone }: { row: PurchaseOrderRow; role: Role; onDone: () => void }) {
  const q = usePurchaseOrder(row.id);
  const detail = q.data;
  const status = detail?.status ?? row.status;
  const poNumber = detail?.po_number ?? row.po_number;
  const supplierName = row.supplier_name ?? (row.supplier_id != null ? `Supplier #${row.supplier_id}` : "—");

  const productIds = React.useMemo(() => detail?.items.map((i) => i.product_id) ?? [], [detail]);
  const lookupQ = useProductLookup(productIds);
  const lookup = lookupQ.data ?? {};

  const ordered = detail ? sumDecimals(detail.items.map((i) => i.quantity), 3) : "0";
  const received = detail ? sumDecimals(detail.items.map((i) => i.received_quantity), 3) : "0";

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="mono text-[15px] font-semibold">{poNumber ?? `PO #${row.id}`}</div>
          <div className="text-[12px] text-[var(--muted)]">{supplierName}</div>
        </div>
        <StatusBadge status={status.toUpperCase()} />
      </div>

      <Section title="Summary">
        <Row label="Status">{PO_STATUS_LABEL[status.toUpperCase()] ?? status}</Row>
        <Row label="Supplier">{supplierName}</Row>
        <Row label="Created">
          <span className="mono">{formatIsoDate(detail?.created_at ?? row.created_at)}</span>
        </Row>
        <Row label="Last receipt">
          <span className="mono">{formatIsoDate(row.last_receipt_at)}</span>
        </Row>
        <Row label="Total">
          <MoneyDisplay value={detail?.total_amount ?? row.total_amount} />
        </Row>
      </Section>

      <Section title="Lifecycle">
        <div className="py-3">
          <PurchaseOrderLifecycle status={status} />
        </div>
      </Section>

      {q.isLoading ? (
        <LoadingState label="Loading order lines…" />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} compact />
      ) : detail ? (
        <>
          <Section title="Receiving progress">
            <div className="flex items-center gap-4 py-3">
              <ProgressRing done={received} total={ordered} label="Received progress" />
              <div className="text-[12.5px]">
                <div>
                  <QuantityDisplay value={received} className="font-semibold" /> of{" "}
                  <QuantityDisplay value={ordered} /> received
                </div>
                <div className="text-[var(--muted)]">
                  {row.receipt_count} receipt{row.receipt_count === 1 ? "" : "s"} logged
                </div>
              </div>
            </div>
          </Section>

          <Section title="Items">
            <div className="divide-y divide-[var(--border)]">
              {detail.items.map((it) => {
                const p = lookup[it.product_id];
                return (
                  <div key={it.id} className="py-[9px] text-[12px]">
                    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                      <span className="font-medium">{p?.product_name ?? `Product #${it.product_id}`}</span>
                      <span className="mono text-[var(--muted)]">{p?.sku ?? it.product_id}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-[var(--muted)]">
                      <span>
                        ord <QuantityDisplay value={it.quantity} className="text-[var(--foreground)]" />
                      </span>
                      <span>
                        rcv <QuantityDisplay value={it.received_quantity} className="text-[var(--foreground)]" />
                      </span>
                      <span>
                        rem <QuantityDisplay value={it.remaining_quantity} className="text-[var(--foreground)]" />
                      </span>
                      <span>
                        @ <MoneyDisplay value={it.unit_price} />
                      </span>
                      <span>
                        = <MoneyDisplay value={it.total_price} className="text-[var(--foreground)]" />
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>

          <Section title="Tracking requirements">
            <div className="divide-y divide-[var(--border)]">
              {detail.items.map((it) => {
                const p = lookup[it.product_id];
                const label = !p
                  ? "—"
                  : p.track_batch && p.track_expiry
                    ? "Lot + manufacturing + expiry date required per receipt"
                    : p.track_batch
                      ? "Lot number required per receipt (dates optional)"
                      : "Non-batch — no lot or date entry";
                return (
                  <div key={it.id} className="flex flex-wrap items-baseline justify-between gap-3 py-[7px] text-[12px]">
                    <span className="mono text-[var(--muted)]">{p?.sku ?? `#${it.product_id}`}</span>
                    <span className="text-right text-[11.5px]">{label}</span>
                  </div>
                );
              })}
            </div>
            <p className="pb-2 pt-1 text-[11px] text-[var(--faint)]">
              Lot / manufacturing / expiry are entered per receipt in the receiving console, not stored on the PO.
            </p>
          </Section>

          <Section title="Receipt history">
            <Row label="Receipts logged">{row.receipt_count}</Row>
            <Row label="Last receipt at">
              <span className="mono">{formatIsoDate(row.last_receipt_at)}</span>
            </Row>
            <p className="pb-2 pt-1 text-[11px] text-[var(--faint)]">
              The backend exposes a receipt count and last-receipt time only — individual historical receipts are not
              retrievable through the API. Each receipt made in this session is listed in the receiving console.
            </p>
          </Section>
        </>
      ) : null}

      <div className="sticky bottom-0 -mx-4 mt-1 border-t border-[var(--border)] bg-[var(--surface)] px-4 pt-3">
        <PurchaseOrderActions id={row.id} status={status} poNumber={poNumber} role={role} onDone={onDone} />
      </div>
    </div>
  );
}

export function PurchaseOrderDetailDrawer({
  row,
  open,
  onOpenChange,
  role,
}: {
  row: PurchaseOrderRow | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  role: Role;
}) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent title={row ? (row.po_number ?? `Purchase order #${row.id}`) : "Purchase order"}>
        {row ? (
          <PurchaseOrderDetailBody row={row} role={role} onDone={() => onOpenChange(false)} />
        ) : (
          <EmptyState message="No purchase order selected." />
        )}
      </DrawerContent>
    </Drawer>
  );
}
