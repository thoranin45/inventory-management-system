"use client";

import * as React from "react";
import { TriangleAlert } from "lucide-react";

import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { MoneyDisplay, QuantityDisplay } from "@/components/ui/quantity-display";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { formatIsoDate } from "@/lib/format";
import { type Role } from "@/lib/auth/permissions";
import { useSalesOrder } from "@/lib/query/sales";
import {
  SO_ATTENTION_LABEL,
  type SalesOrderDetail,
  type SalesOrderRow,
} from "@/lib/api/schemas/sales";
import { SalesLifecycle } from "./sales-lifecycle";
import { SalesActions } from "./sales-actions";
import { SalesDocuments } from "./sales-documents";

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

function AttentionBanner({ reason }: { reason: string }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-[var(--r-md)] border border-[color-mix(in_srgb,var(--warning)_38%,transparent)] bg-[var(--warning-subtle)] p-3 text-[12px] text-[var(--foreground)]"
    >
      <TriangleAlert aria-hidden className="h-4 w-4 flex-none text-[var(--warning)]" />
      <span>{SO_ATTENTION_LABEL[reason] ?? `Needs attention: ${reason.replace(/_/g, " ")}.`}</span>
    </div>
  );
}

function Allocations({ detail }: { detail: SalesOrderDetail }) {
  const lines = detail.items.flatMap((it) =>
    it.fulfillment_allocations.map((a) => ({ ...a, product_id: it.product_id })),
  );
  if (lines.length === 0) {
    return (
      <div className="py-4 text-[12px] text-[var(--muted)]">
        No stock is allocated yet. The backend allocates batches when the order is confirmed.
      </div>
    );
  }
  return (
    <div className="divide-y divide-[var(--border)]">
      {lines.map((a) => (
        <div key={a.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-[9px] text-[12px]">
          <span className="mono text-[var(--muted)]">
            product #{a.product_id} · batch {a.batch_id ?? "—"}
          </span>
          <span className="ml-auto flex items-center gap-3">
            <span>
              alloc <QuantityDisplay value={a.quantity} className="font-medium" />
            </span>
            <span>
              picked <QuantityDisplay value={a.picked_quantity} className="font-medium" />
            </span>
            <span>
              packed <QuantityDisplay value={a.packed_quantity} className="font-medium" />
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}

function SalesDetailBody({
  row,
  role,
  onDone,
}: {
  row: SalesOrderRow;
  role: Role;
  onDone: () => void;
}) {
  const q = useSalesOrder(row.id);
  const detail = q.data;
  const status = detail?.status ?? row.status;
  const soNumber = detail?.so_number ?? row.so_number;
  const customerName = row.customer_name ?? (row.customer_id != null ? `Customer #${row.customer_id}` : "—");

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="mono text-[15px] font-semibold">{soNumber ?? `SO #${row.id}`}</div>
          <div className="text-[12px] text-[var(--muted)]">{customerName}</div>
        </div>
        <StatusBadge status={status.toUpperCase()} />
      </div>

      {row.attention_reason ? <AttentionBanner reason={row.attention_reason} /> : null}

      <Section title="Summary">
        <Row label="Status">{status.toUpperCase()}</Row>
        <Row label="Customer">{customerName}</Row>
        <Row label="Created">
          <span className="mono">{formatIsoDate(detail?.created_at ?? row.created_at)}</span>
        </Row>
        <Row label="Last activity">
          <span className="mono">{formatIsoDate(row.last_activity_at)}</span>
        </Row>
        <Row label="Items">{row.item_count}</Row>
        <Row label="Total quantity">
          <QuantityDisplay value={row.total_quantity} />
        </Row>
        <Row label="Total amount">
          <MoneyDisplay value={row.total_amount} />
        </Row>
      </Section>

      <Section title="Lifecycle">
        <div className="py-3">
          <SalesLifecycle status={status} attentionReason={row.attention_reason} />
        </div>
      </Section>

      {q.isLoading ? (
        <LoadingState label="Loading order lines…" />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} compact />
      ) : detail ? (
        <>
          <Section title="Items">
            <div className="divide-y divide-[var(--border)]">
              {detail.items.map((it) => (
                <div key={it.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-[9px] text-[12px]">
                  <span className="mono text-[var(--muted)]">product #{it.product_id}</span>
                  <span className="ml-auto flex items-center gap-3">
                    <span>
                      qty <QuantityDisplay value={it.quantity} className="font-medium" />
                    </span>
                    <span>
                      @ <MoneyDisplay value={it.unit_price} className="font-medium" />
                    </span>
                    <span>
                      = <MoneyDisplay value={it.total_price} className="font-medium" />
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </Section>

          <Section title="Allocations">
            <Allocations detail={detail} />
          </Section>

          <Section title="Fulfillment">
            <Row label="Picked at">
              <span className="mono">{detail.picked_at ? formatIsoDate(detail.picked_at) : "—"}</span>
            </Row>
            <Row label="Packed at">
              <span className="mono">{detail.packed_at ? formatIsoDate(detail.packed_at) : "—"}</span>
            </Row>
            <Row label="Shipped at">
              <span className="mono">{detail.shipped_at ? formatIsoDate(detail.shipped_at) : "—"}</span>
            </Row>
            <Row label="Shipped by">
              <span className="mono">{detail.shipped_by_user_id != null ? `User #${detail.shipped_by_user_id}` : "—"}</span>
            </Row>
            <Row label="Shipment number">
              <span className="mono">{detail.shipment_number ?? "—"}</span>
            </Row>
          </Section>

          {["READY_TO_SHIP", "SHIPPED", "COMPLETED"].includes(status.toUpperCase()) ? (
            <Section title="Documents">
              <div className="py-3">
                <SalesDocuments orderId={row.id} />
              </div>
            </Section>
          ) : null}
        </>
      ) : null}

      <div className="sticky bottom-0 -mx-4 mt-1 border-t border-[var(--border)] bg-[var(--surface)] px-4 pt-3">
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
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent title={row ? (row.so_number ?? `Sales order #${row.id}`) : "Sales order"}>
        {row ? (
          <SalesDetailBody row={row} role={role} onDone={() => onOpenChange(false)} />
        ) : (
          <EmptyState message="No sales order selected." />
        )}
      </DrawerContent>
    </Drawer>
  );
}
