"use client";

import * as React from "react";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";

import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { QuantityDisplay } from "@/components/ui/quantity-display";
import { StatusBadge } from "@/components/ui/status-badge";
import { ExpiryBadge } from "@/components/ui/expiry-badge";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { ProgressRing } from "@/components/work/progress-ring";
import { formatIsoDate } from "@/lib/format";
import { subtractDecimals, sumDecimals } from "@/lib/decimal";
import { useProductLookup } from "@/lib/query/sales";
import { useBatchExpiryMap, useTransfer, useWarehouseNames } from "@/lib/query/transfers";
import { TRANSFER_STATUS_LABEL, type TransferDetail, type TransferRow } from "@/lib/api/schemas/transfers";
import { TransferLifecycle } from "./transfer-lifecycle";
import { TransferRoute } from "./transfer-route";
import { TransferActions } from "./transfer-actions";
import { useT } from "@/lib/i18n/client";
import { statusText } from "@/lib/reports/report-copy";

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

function lineFigures(it: TransferDetail["items"][number]) {
  const total = it.quantity;
  const dispatched = it.dispatched_quantity ?? "0";
  const received = it.received_quantity ?? "0";
  const inTransit = subtractDecimals(dispatched, received, 3); // = outstanding still to receive
  return { total, dispatched, received, inTransit };
}

function TransferDetailBody({ row, onDone }: { row: TransferRow; onDone: () => void }) {
  const t = useT();
  const q = useTransfer(row.id);
  const detail = q.data;
  const status = (detail?.status ?? row.status).toUpperCase();
  const legacy = detail?.legacy_completed ?? row.legacy_completed;

  const whNames = useWarehouseNames().data ?? {};
  const wh = (id: number, fallbackName: string | null) => whNames[id] ?? fallbackName ?? t("reports.warehouseFallback", { id });
  const sourceLabel = wh(row.source_warehouse_id, row.source_warehouse_name);
  const destLabel = wh(row.destination_warehouse_id, row.destination_warehouse_name);

  const productIds = React.useMemo(() => detail?.items.map((i) => i.product_id) ?? [], [detail]);
  const lookup = useProductLookup(productIds).data ?? {};
  const { map: batchExpiry } = useBatchExpiryMap(productIds);

  const totals = React.useMemo(() => {
    const items = detail?.items ?? [];
    return {
      total: sumDecimals(items.map((i) => i.quantity), 3),
      dispatched: sumDecimals(items.map((i) => i.dispatched_quantity ?? "0"), 3),
      received: sumDecimals(items.map((i) => i.received_quantity ?? "0"), 3),
      inTransit: sumDecimals(
        items.map((i) => subtractDecimals(i.dispatched_quantity ?? "0", i.received_quantity ?? "0", 3)),
        3,
      ),
    };
  }, [detail]);

  const receivable = status === "IN_TRANSIT" || status === "PARTIALLY_RECEIVED";
  const expiredInTransit =
    receivable &&
    (detail?.items ?? []).some((it) => it.batch_id != null && batchExpiry[it.batch_id]?.is_expired);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="mono text-[15px] font-semibold">{row.transfer_number}</div>
          <div className="text-[12px] text-[var(--muted)]">
            {sourceLabel} → {destLabel}
          </div>
        </div>
        {legacy ? <StatusBadge tone="neutral" label={t("reports.legacyCompleted")} /> : <StatusBadge status={status} />}
      </div>

      {expiredInTransit ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-[var(--r-md)] border border-[color-mix(in_srgb,var(--warning)_38%,transparent)] bg-[var(--warning-subtle)] p-3 text-[12px]"
        >
          <TriangleAlert aria-hidden className="h-4 w-4 flex-none text-[var(--warning)]" />
          <span>{t("transfers.expiredInTransitBody")}</span>
        </div>
      ) : null}

      <Section title={t("transfers.secSummary")}>
        <Row label={t("reports.colStatus")}>
          {legacy ? t("reports.legacyCompleted") : statusText(t, status, TRANSFER_STATUS_LABEL)}
        </Row>
        <Row label={t("transfers.colSource")}>{sourceLabel}</Row>
        <Row label={t("transfers.colDestination")}>{destLabel}</Row>
        <Row label={t("reports.colCreated")}>
          <span className="mono">{formatIsoDate(detail?.created_at ?? undefined)}</span>
        </Row>
        <Row label={t("reports.colDispatchedAt")}>
          <span className="mono">{formatIsoDate(detail?.dispatched_at ?? row.dispatched_at)}</span>
        </Row>
        <Row label={t("reports.colLatestReceipt")}>
          <span className="mono">{formatIsoDate(row.latest_receipt_at)}</span>
        </Row>
        {detail?.completed_at ? (
          <Row label={t("transfers.completedAt")}>
            <span className="mono">{formatIsoDate(detail.completed_at)}</span>
          </Row>
        ) : null}
        {detail?.remark ? <Row label={t("transfers.remark")}>{detail.remark}</Row> : null}
      </Section>

      <Section title={t("transfers.secLifecycle")}>
        <div className="py-3">
          <TransferLifecycle status={status} legacyCompleted={legacy} />
        </div>
      </Section>

      {q.isLoading ? (
        <LoadingState label={t("transfers.loadingLines")} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} compact />
      ) : detail ? (
        legacy ? (
          <Section title={t("transfers.secLines")}>
            <p className="py-3 text-[12px] text-[var(--muted)]">
              {t(detail.items.length === 1 ? "transfers.legacyLinesOne" : "transfers.legacyLinesMany", { n: detail.items.length })}
            </p>
          </Section>
        ) : (
          <>
            <Section title={t("transfers.secRoute")}>
              <div className="py-3">
                <TransferRoute
                  sourceLabel={sourceLabel}
                  destinationLabel={destLabel}
                  total={totals.total}
                  dispatched={totals.dispatched}
                  inTransit={totals.inTransit}
                  received={totals.received}
                />
              </div>
            </Section>

            <Section title={t("reports.colProgress")}>
              <div className="flex items-center gap-4 py-3">
                <ProgressRing done={totals.received} total={totals.total} label={t("transfers.receivedProgress")} />
                <div className="text-[12.5px]">
                  <div>
                    <QuantityDisplay value={totals.received} className="font-semibold" /> {t("transfers.of")}{" "}
                    <QuantityDisplay value={totals.total} /> {t("transfer.received")}
                  </div>
                  <div className="text-[var(--muted)]">
                    <QuantityDisplay value={totals.inTransit} /> {t("transfers.stillInTransit")}
                  </div>
                </div>
              </div>
            </Section>

            <Section title={t("transfers.secItems")}>
              <div className="divide-y divide-[var(--border)]">
                {detail.items.map((it) => {
                  const f = lineFigures(it);
                  const p = lookup[it.product_id];
                  const be = it.batch_id != null ? batchExpiry[it.batch_id] : undefined;
                  return (
                    <div key={it.id} className="py-[9px] text-[12px]">
                      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                        <span className="font-medium">{p?.product_name ?? t("reports.productFallback", { id: it.product_id })}</span>
                        <span className="mono text-[var(--muted)]">
                          {p?.sku ?? it.product_id}
                          {" · "}
                          {it.batch_id != null ? (be?.lot_no ?? t("reports.batchNo", { id: it.batch_id })) : t("reports.nonBatch")}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-[var(--muted)]">
                        <span>
                          {t("transfers.lineTotal")} <QuantityDisplay value={f.total} className="text-[var(--foreground)]" />
                        </span>
                        <span>
                          {t("transfers.lineDisp")} <QuantityDisplay value={f.dispatched} className="text-[var(--foreground)]" />
                        </span>
                        <span>
                          {t("transfers.lineRec")} <QuantityDisplay value={f.received} className="text-[var(--foreground)]" />
                        </span>
                        <span>
                          {t("transfer.inTransit")} <QuantityDisplay value={f.inTransit} className="text-[var(--foreground)]" />
                        </span>
                        {be && (be.expiry_date || be.days_to_expiry != null) ? (
                          <ExpiryBadge days={be.days_to_expiry} isoDate={be.expiry_date} />
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Section>

            <Section title={t("transfers.secDispatch")}>
              <Row label={t("reports.colDispatchedAt")}>
                <span className="mono">{detail.dispatched_at ? formatIsoDate(detail.dispatched_at) : "—"}</span>
              </Row>
              <Row label={t("transfers.dispatchedBy")}>
                <span className="mono">
                  {detail.dispatched_by_user_id != null ? t("transfers.userNo", { id: detail.dispatched_by_user_id }) : "—"}
                </span>
              </Row>
            </Section>

            <Section title={t("transfers.secReceipts")}>
              <Row label={t("transfers.latestReceiptAt")}>
                <span className="mono">{formatIsoDate(row.latest_receipt_at)}</span>
              </Row>
              <p className="pb-2 pt-1 text-[11px] text-[var(--faint)]">{t("transfers.receiptsNote")}</p>
              {receivable ? (
                <p className="pb-2 text-[11px]">
                  <Link href={`/transfers/${row.id}/receive`} className="font-medium text-[var(--accent)] underline">
                    {t("transfers.openReceivingLink")}
                  </Link>
                </p>
              ) : null}
            </Section>
          </>
        )
      ) : null}

      <div className="sticky bottom-0 -mx-4 mt-1 border-t border-[var(--border)] bg-[var(--surface)] px-4 pt-3">
        <TransferActions
          id={row.id}
          status={status}
          transferNumber={row.transfer_number}
          legacyCompleted={legacy}
          onDone={onDone}
        />
      </div>
    </div>
  );
}

export function TransferDetailDrawer({
  row,
  open,
  onOpenChange,
}: {
  row: TransferRow | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const t = useT();
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent title={row ? row.transfer_number : t("transfers.transfer")}>
        {row ? (
          <TransferDetailBody row={row} onDone={() => onOpenChange(false)} />
        ) : (
          <EmptyState message={t("transfers.noneSelected")} />
        )}
      </DrawerContent>
    </Drawer>
  );
}
