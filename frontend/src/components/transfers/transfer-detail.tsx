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
  const q = useTransfer(row.id);
  const detail = q.data;
  const status = (detail?.status ?? row.status).toUpperCase();
  const legacy = detail?.legacy_completed ?? row.legacy_completed;

  const whNames = useWarehouseNames().data ?? {};
  const wh = (id: number, fallbackName: string | null) => whNames[id] ?? fallbackName ?? `Warehouse #${id}`;
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
        {legacy ? <StatusBadge tone="neutral" label="Legacy completed" /> : <StatusBadge status={status} />}
      </div>

      {expiredInTransit ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-[var(--r-md)] border border-[color-mix(in_srgb,var(--warning)_38%,transparent)] bg-[var(--warning-subtle)] p-3 text-[12px]"
        >
          <TriangleAlert aria-hidden className="h-4 w-4 flex-none text-[var(--warning)]" />
          <span>
            A batch on this transfer expired in transit. Receiving is still required — the stock stays owned at the
            destination but is operationally ineligible. Batches are never substituted.
          </span>
        </div>
      ) : null}

      <Section title="Summary">
        <Row label="Status">{legacy ? "Legacy completed" : TRANSFER_STATUS_LABEL[status] ?? status}</Row>
        <Row label="Source">{sourceLabel}</Row>
        <Row label="Destination">{destLabel}</Row>
        <Row label="Created">
          <span className="mono">{formatIsoDate(detail?.created_at ?? undefined)}</span>
        </Row>
        <Row label="Dispatched at">
          <span className="mono">{formatIsoDate(detail?.dispatched_at ?? row.dispatched_at)}</span>
        </Row>
        <Row label="Latest receipt">
          <span className="mono">{formatIsoDate(row.latest_receipt_at)}</span>
        </Row>
        {detail?.completed_at ? (
          <Row label="Completed at">
            <span className="mono">{formatIsoDate(detail.completed_at)}</span>
          </Row>
        ) : null}
        {detail?.remark ? <Row label="Remark">{detail.remark}</Row> : null}
      </Section>

      <Section title="Lifecycle">
        <div className="py-3">
          <TransferLifecycle status={status} legacyCompleted={legacy} />
        </div>
      </Section>

      {q.isLoading ? (
        <LoadingState label="Loading transfer lines…" />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} compact />
      ) : detail ? (
        legacy ? (
          <Section title="Lines">
            <p className="py-3 text-[12px] text-[var(--muted)]">
              {detail.items.length} line{detail.items.length === 1 ? "" : "s"} · legacy completed before transit-lifecycle
              tracking, so per-line dispatch / receipt progress is not available.
            </p>
          </Section>
        ) : (
          <>
            <Section title="Route">
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

            <Section title="Progress">
              <div className="flex items-center gap-4 py-3">
                <ProgressRing done={totals.received} total={totals.total} label="Received progress" />
                <div className="text-[12.5px]">
                  <div>
                    <QuantityDisplay value={totals.received} className="font-semibold" /> of{" "}
                    <QuantityDisplay value={totals.total} /> received
                  </div>
                  <div className="text-[var(--muted)]">
                    <QuantityDisplay value={totals.inTransit} /> still in transit
                  </div>
                </div>
              </div>
            </Section>

            <Section title="Items">
              <div className="divide-y divide-[var(--border)]">
                {detail.items.map((it) => {
                  const f = lineFigures(it);
                  const p = lookup[it.product_id];
                  const be = it.batch_id != null ? batchExpiry[it.batch_id] : undefined;
                  return (
                    <div key={it.id} className="py-[9px] text-[12px]">
                      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                        <span className="font-medium">{p?.product_name ?? `Product #${it.product_id}`}</span>
                        <span className="mono text-[var(--muted)]">
                          {p?.sku ?? it.product_id}
                          {it.batch_id != null ? ` · batch #${it.batch_id}` : " · non-batch"}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-[var(--muted)]">
                        <span>
                          total <QuantityDisplay value={f.total} className="text-[var(--foreground)]" />
                        </span>
                        <span>
                          disp <QuantityDisplay value={f.dispatched} className="text-[var(--foreground)]" />
                        </span>
                        <span>
                          rec <QuantityDisplay value={f.received} className="text-[var(--foreground)]" />
                        </span>
                        <span>
                          in transit <QuantityDisplay value={f.inTransit} className="text-[var(--foreground)]" />
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

            <Section title="Dispatch">
              <Row label="Dispatched at">
                <span className="mono">{detail.dispatched_at ? formatIsoDate(detail.dispatched_at) : "—"}</span>
              </Row>
              <Row label="Dispatched by">
                <span className="mono">
                  {detail.dispatched_by_user_id != null ? `User #${detail.dispatched_by_user_id}` : "—"}
                </span>
              </Row>
            </Section>

            <Section title="Receipts">
              <Row label="Latest receipt at">
                <span className="mono">{formatIsoDate(row.latest_receipt_at)}</span>
              </Row>
              <p className="pb-2 pt-1 text-[11px] text-[var(--faint)]">
                The API exposes a latest-receipt time only — individual historical transfer receipts are not retrievable.
                Receipts made in this session are listed in the receiving console.
              </p>
              {receivable ? (
                <p className="pb-2 text-[11px]">
                  <Link href={`/transfers/${row.id}/receive`} className="font-medium text-[var(--accent)] underline">
                    Open the receiving console
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
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent title={row ? row.transfer_number : "Transfer"}>
        {row ? (
          <TransferDetailBody row={row} onDone={() => onOpenChange(false)} />
        ) : (
          <EmptyState message="No transfer selected." />
        )}
      </DrawerContent>
    </Drawer>
  );
}
