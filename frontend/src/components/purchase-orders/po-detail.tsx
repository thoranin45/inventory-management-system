"use client";

import * as React from "react";

import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { LocalDate } from "@/components/ui/local-date";
import { MoneyDisplay, QuantityDisplay } from "@/components/ui/quantity-display";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { ProgressRing } from "@/components/work/progress-ring";
import { useStatusLabel } from "@/components/orders/lifecycle-steps";
import { type Role } from "@/lib/auth/permissions";
import { sumDecimals } from "@/lib/decimal";
import { useT } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/translate";
import { useProductLookup } from "@/lib/query/sales";
import { usePurchaseOrder } from "@/lib/query/purchase-orders";
import { type PurchaseOrderRow } from "@/lib/api/schemas/purchase-orders";
import { PurchaseOrderLifecycle } from "./po-lifecycle";
import { PurchaseOrderActions } from "./po-actions";

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

function PurchaseOrderDetailBody({ row, role, onDone }: { row: PurchaseOrderRow; role: Role; onDone: () => void }) {
  const t = useT();
  const statusLabel = useStatusLabel();
  const q = usePurchaseOrder(row.id);
  const detail = q.data;
  const status = detail?.status ?? row.status;
  const poNumber = detail?.po_number ?? row.po_number;
  const supplierName = row.supplier_name ?? (row.supplier_id != null ? t("po.supplierRef", { id: row.supplier_id }) : "—");

  const productIds = React.useMemo(() => detail?.items.map((i) => i.product_id) ?? [], [detail]);
  const lookupQ = useProductLookup(productIds);
  const lookup = lookupQ.data ?? {};

  const ordered = detail ? sumDecimals(detail.items.map((i) => i.quantity), 3) : "0";
  const received = detail ? sumDecimals(detail.items.map((i) => i.received_quantity), 3) : "0";

  const tracking = (pid: number): MessageKey | null => {
    const p = lookup[pid];
    if (!p) return null;
    return p.track_batch && p.track_expiry ? "po.trackBatchExpiry" : p.track_batch ? "po.trackBatch" : "po.trackNone";
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mono text-[16px] font-semibold">{poNumber ?? t("po.poRef", { id: row.id })}</div>
          <div className="text-[13px] text-[var(--muted)]">{supplierName}</div>
        </div>
        <StatusBadge status={status.toUpperCase()} />
      </div>

      <Section title={t("sales.lifecycle")}>
        <div className="py-3">
          <PurchaseOrderLifecycle status={status} />
        </div>
      </Section>

      <Section title={t("sales.summary")}>
        <Row label={t("sales.colStatus")}>{statusLabel(status)}</Row>
        <Row label={t("po.supplier")}>{supplierName}</Row>
        <Row label={t("sales.created")}>
          <span className="mono">
            <LocalDate iso={detail?.created_at ?? row.created_at} isoInEnglish />
          </span>
        </Row>
        <Row label={t("po.lastReceipt")}>
          <span className="mono">
            <LocalDate iso={row.last_receipt_at} isoInEnglish />
          </span>
        </Row>
        <Row label={t("po.total")}>
          <MoneyDisplay value={detail?.total_amount ?? row.total_amount} />
        </Row>
      </Section>

      {q.isLoading ? (
        <LoadingState label={t("sales.loadingLines")} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} compact />
      ) : detail ? (
        <>
          <Section title={t("po.receivingProgress")}>
            <div className="flex items-center gap-4 py-3">
              <ProgressRing done={received} total={ordered} label={t("po.receivedProgress")} />
              <div className="text-[13px]">
                <div>
                  <QuantityDisplay value={received} className="font-semibold" /> {t("po.of")} <QuantityDisplay value={ordered} />{" "}
                  {t("po.receivedWord")}
                </div>
                <div className="text-[var(--muted)]">
                  {t(row.receipt_count === 1 ? "po.receiptLogged" : "po.receiptsLogged", { n: row.receipt_count })}
                </div>
              </div>
            </div>
          </Section>

          <Section title={t("sales.items")}>
            <ul className="divide-y divide-[var(--border)]">
              {detail.items.map((it) => {
                const p = lookup[it.product_id];
                const tk = tracking(it.product_id);
                return (
                  <li key={it.id} className="py-[9px] text-[13px]">
                    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                      <span className="font-medium">{p?.product_name ?? t("receive.productFallback", { id: it.product_id })}</span>
                      <span className="mono text-[12px] text-[var(--muted)]">{p?.sku ?? it.product_id}</span>
                    </div>
                    <dl className="mt-1 grid grid-cols-3 gap-x-4 gap-y-1 text-[12px] text-[var(--muted)] min-[480px]:grid-cols-5">
                      <div>
                        <dt>{t("receive.ordered")}</dt>
                        <dd><QuantityDisplay value={it.quantity} className="text-[var(--foreground)]" /></dd>
                      </div>
                      <div>
                        <dt>{t("receive.received")}</dt>
                        <dd><QuantityDisplay value={it.received_quantity} className="text-[var(--foreground)]" /></dd>
                      </div>
                      <div>
                        <dt>{t("receive.outstanding")}</dt>
                        <dd><QuantityDisplay value={it.remaining_quantity} className="font-semibold text-[var(--foreground)]" /></dd>
                      </div>
                      <div>
                        <dt>{t("orders.fieldUnitPrice")}</dt>
                        <dd><MoneyDisplay value={it.unit_price} /></dd>
                      </div>
                      <div>
                        <dt>{t("orders.lineTotal")}</dt>
                        <dd><MoneyDisplay value={it.total_price} className="text-[var(--foreground)]" /></dd>
                      </div>
                    </dl>
                    {tk ? <p className="mt-1 text-[12px] text-[var(--muted)]">{t(tk)}</p> : null}
                  </li>
                );
              })}
            </ul>
            <p className="pb-2 pt-1 text-[12px] text-[var(--faint)]">{t("po.trackingNote")}</p>
          </Section>

          <Section title={t("po.receiptHistory")}>
            <Row label={t("po.receiptsLoggedLabel")}>{row.receipt_count}</Row>
            <Row label={t("po.lastReceiptAt")}>
              <span className="mono">
                <LocalDate iso={row.last_receipt_at} isoInEnglish />
              </span>
            </Row>
            <p className="pb-2 pt-1 text-[12px] text-[var(--faint)]">{t("po.receiptHistoryNote")}</p>
          </Section>
        </>
      ) : null}

      <div className="sticky bottom-0 -mx-4 mt-1 border-t border-[var(--border)] bg-[var(--surface)] px-4 pb-[env(safe-area-inset-bottom)] pt-3">
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
  const t = useT();
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent title={row ? (row.po_number ?? t("po.poRef", { id: row.id })) : t("po.purchaseOrder")}>
        {row ? <PurchaseOrderDetailBody row={row} role={role} onDone={() => onOpenChange(false)} /> : <EmptyState message={t("po.noneSelected")} />}
      </DrawerContent>
    </Drawer>
  );
}
