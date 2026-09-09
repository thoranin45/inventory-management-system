"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronRight, ScanLine, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { StatusBadge } from "@/components/ui/status-badge";
import { QuantityDisplay } from "@/components/ui/quantity-display";
import { ProgressRing } from "@/components/work/progress-ring";
import { useScanner } from "@/components/work/use-scanner";
import { isApiError } from "@/lib/api/errors";
import { compareDecimals, subtractDecimals, sumDecimals } from "@/lib/decimal";
import { resolveBarcode, useProductLookup } from "@/lib/query/sales";
import { useBatchExpiryMap, useReceiveTransfer, useTransfer, useWarehouseNames } from "@/lib/query/transfers";
import { useTransferReceiptDraft } from "@/lib/transfer-receipt-draft";
import {
  RECEIVABLE_TRANSFER_STATUSES,
  TRANSFER_ERROR_COPY,
  type TransferReceiptResponse,
} from "@/lib/api/schemas/transfers";
import { TransferRoute } from "./transfer-route";
import { TransferReceiveLine, validateTransferReceiveLine } from "./transfer-receive-line";

const MISMATCH_MSG = "Idempotency-Key already used with a different payload";

export function TransferReceivingConsole({ transferId }: { transferId: number }) {
  const detailQ = useTransfer(transferId);
  const detail = detailQ.data;

  const productIds = React.useMemo(() => detail?.items.map((i) => i.product_id) ?? [], [detail]);
  const lookup = useProductLookup(productIds).data ?? {};
  const { map: batchExpiry } = useBatchExpiryMap(productIds);
  const whNames = useWarehouseNames().data ?? {};

  const draft = useTransferReceiptDraft(transferId);
  const receive = useReceiveTransfer();

  const [sessionReceipts, setSessionReceipts] = React.useState<TransferReceiptResponse[]>([]);
  const [mismatch, setMismatch] = React.useState(false);
  const [highlightItemId, setHighlightItemId] = React.useState<number | null>(null);

  const scanner = useScanner({
    onScan: async (code) => {
      try {
        const res = await resolveBarcode(code, "stock_in");
        const matches = (detail?.items ?? []).filter((i) => i.product_id === res.product.id);
        if (matches.length === 0) {
          toast.error(`${res.product.product_name} is not on this transfer.`);
          return;
        }
        const open = matches.find(
          (i) => compareDecimals(subtractDecimals(i.dispatched_quantity ?? "0", i.received_quantity ?? "0", 3), "0") > 0,
        );
        if (!open) {
          toast.info(`${res.product.product_name} is already fully received.`);
          return;
        }
        if (matches.length > 1) toast.info(`${res.product.product_name} has ${matches.length} lines — jumped to the first with stock in transit.`);
        setHighlightItemId(open.id);
        const el = document.getElementById(`trl-${open.id}-qty`);
        el?.scrollIntoView({ block: "center", behavior: "smooth" });
        (el as HTMLInputElement | null)?.focus();
      } catch (e) {
        toast.error(isApiError(e) && e.status === 404 ? `Unknown barcode ${code}.` : "Could not resolve that barcode.");
      }
    },
  });

  if (detailQ.isLoading) return <LoadingState label="Loading receiving console…" />;
  if (detailQ.isError) return <ErrorState error={detailQ.error} onRetry={() => void detailQ.refetch()} />;
  if (!detail) return <EmptyState message="Transfer not found." />;

  const status = detail.status.toUpperCase();
  const receivable = (RECEIVABLE_TRANSFER_STATUSES as readonly string[]).includes(status) && !detail.legacy_completed;
  const wh = (id: number) => whNames[id] ?? `Warehouse #${id}`;

  if (!receivable) {
    return (
      <div className="flex flex-col gap-4">
        <Breadcrumb transferNumber={detail.transfer_number} />
        <div className="rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface)] p-6">
          <div className="flex items-center gap-2">
            <StatusBadge status={status} />
            <span className="text-[13px] text-[var(--muted)]">
              {detail.transfer_number} is not in transit — nothing to receive.
            </span>
          </div>
          <Button asChild className="mt-4" variant="secondary">
            <Link href="/transfers">Back to transfers</Link>
          </Button>
        </div>
      </div>
    );
  }

  const figs = (it: (typeof detail.items)[number]) => {
    const dispatched = it.dispatched_quantity ?? "0";
    const received = it.received_quantity ?? "0";
    const outstanding = subtractDecimals(dispatched, received, 3);
    return { dispatched, received, outstanding };
  };

  const totals = {
    total: sumDecimals(detail.items.map((i) => i.quantity), 3),
    dispatched: sumDecimals(detail.items.map((i) => figs(i).dispatched), 3),
    received: sumDecimals(detail.items.map((i) => figs(i).received), 3),
    inTransit: sumDecimals(detail.items.map((i) => figs(i).outstanding), 3),
  };

  const lineErrors = detail.items
    .map((it) => validateTransferReceiveLine(draft.lines[it.id]?.quantity, figs(it).outstanding))
    .filter(Boolean) as string[];

  const receivingNow = sumDecimals(
    detail.items.map((it) => {
      const q = (draft.lines[it.id]?.quantity ?? "").trim();
      const bad = validateTransferReceiveLine(q, figs(it).outstanding);
      return !bad && q ? q : "0";
    }),
    3,
  );
  const selectedCount = detail.items.filter((it) => {
    const q = (draft.lines[it.id]?.quantity ?? "").trim();
    return !validateTransferReceiveLine(q, figs(it).outstanding) && q && Number(q) > 0;
  }).length;

  const canReceive = draft.ready && !!draft.payload && lineErrors.length === 0 && selectedCount > 0 && !receive.isPending && !mismatch;

  const submit = () => {
    if (!draft.payload) return;
    receive.mutate(
      { id: transferId, idempotencyKey: draft.idempotencyKey, payload: draft.payload },
      {
        onSuccess: (data) => {
          setSessionReceipts((prev) =>
            prev.some((r) => r.receipt_number === data.receipt_number) ? prev : [data, ...prev],
          );
          toast.success(`Receipt ${data.receipt_number.replace(/^TRR-/, "").slice(0, 8)}… recorded`, {
            description:
              data.transfer.status === "COMPLETED" ? "Transfer fully received." : "Transfer partially received.",
          });
          draft.commitSuccess();
          setMismatch(false);
          setHighlightItemId(null);
          void detailQ.refetch();
        },
        onError: (error) => {
          const msg = isApiError(error) ? error.message : "";
          const rid = isApiError(error) ? error.requestId : undefined;
          if (msg === MISMATCH_MSG) {
            setMismatch(true);
            return;
          }
          const copy = TRANSFER_ERROR_COPY[msg] ?? (isApiError(error) ? error.userMessage : "The receipt was rejected.");
          toast.error("Receipt rejected", { description: rid ? `${copy} · Request ${rid}` : copy });
        },
      },
    );
  };

  const receiveError =
    receive.isError && isApiError(receive.error) && receive.error.message !== MISMATCH_MSG ? receive.error : null;

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumb transferNumber={detail.transfer_number} />

      <div className="wc-receive-layout">
        <div className="wc-receive-main flex min-w-0 flex-col gap-3">
          <div className="wc-work-head">
            <div>
              <div className="mono text-[16px] font-bold">{detail.transfer_number}</div>
              <div className="text-[12px] text-[var(--muted)]">
                {wh(detail.source_warehouse_id)} → {wh(detail.destination_warehouse_id)} · {detail.items.length} lines
              </div>
            </div>
            <div className="ml-auto">
              <ProgressRing done={totals.received} total={totals.total} label="Received to date" />
            </div>
          </div>

          <TransferRoute
            sourceLabel={wh(detail.source_warehouse_id)}
            destinationLabel={wh(detail.destination_warehouse_id)}
            total={totals.total}
            dispatched={totals.dispatched}
            inTransit={totals.inTransit}
            received={totals.received}
          />

          <div className="flex items-center gap-2 rounded-[var(--r-sm)] border border-[var(--border-strong)] bg-[var(--surface)] px-3">
            <ScanLine aria-hidden className="h-4 w-4 flex-none text-[var(--muted)]" />
            <input
              {...scanner.inputProps}
              placeholder="Scan a barcode to jump to its line…"
              aria-label="Barcode assist"
              className="min-h-11 w-full min-w-0 bg-transparent text-[13px] outline-none"
            />
          </div>

          {detail.items.map((it) => {
            const f = figs(it);
            return (
              <TransferReceiveLine
                key={it.id}
                anchorId={`trl-${it.id}`}
                product={lookup[it.product_id]}
                productId={it.product_id}
                batchId={it.batch_id}
                batchExpiry={it.batch_id != null ? batchExpiry[it.batch_id] : undefined}
                dispatched={f.dispatched}
                received={f.received}
                outstanding={f.outstanding}
                quantity={draft.lines[it.id]?.quantity}
                onChange={(quantity) => draft.setLine(it.id, { quantity })}
                highlight={highlightItemId === it.id}
              />
            );
          })}
        </div>

        <aside className="wc-receive-side">
          <div className="rounded-[var(--r-lg)] border border-[var(--border-strong)] bg-[var(--surface)] p-4">
            <h3 className="wc-section-label mb-2">This receipt</h3>

            {mismatch ? (
              <div
                role="alert"
                className="mb-3 flex flex-col gap-2 rounded-[var(--r-sm)] border border-[color-mix(in_srgb,var(--danger)_35%,transparent)] bg-[var(--danger-subtle)] p-2 text-[12px]"
              >
                <span className="flex items-start gap-2 text-[var(--danger)]">
                  <TriangleAlert aria-hidden className="h-4 w-4 flex-none" />
                  {TRANSFER_ERROR_COPY[MISMATCH_MSG]}
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    draft.startNewDraft();
                    setMismatch(false);
                  }}
                >
                  Start a new receipt
                </Button>
              </div>
            ) : null}

            <div className="flex flex-col gap-1 text-[12px]">
              {selectedCount === 0 ? (
                <p className="text-[var(--muted)]">Enter a quantity on one or more lines to build a receipt.</p>
              ) : (
                detail.items.map((it) => {
                  const q = (draft.lines[it.id]?.quantity ?? "").trim();
                  if (!q || Number(q) <= 0) return null;
                  const bad = validateTransferReceiveLine(q, figs(it).outstanding);
                  return (
                    <div key={it.id} className="flex items-baseline justify-between gap-3">
                      <span className={bad ? "text-[var(--danger)]" : ""}>
                        {lookup[it.product_id]?.sku ?? `#${it.product_id}`}
                        {it.batch_id != null ? ` · b#${it.batch_id}` : ""}
                      </span>
                      <span className={bad ? "text-[var(--danger)]" : "font-medium"}>
                        {bad ? "invalid" : <QuantityDisplay value={q} />}
                      </span>
                    </div>
                  );
                })
              )}
            </div>

            <div className="mt-3 flex items-center gap-3 border-t border-[var(--border)] pt-3">
              <ProgressRing
                done={sumDecimals([totals.received, receivingNow], 3)}
                total={totals.total}
                size={40}
                label="Received after this receipt"
              />
              <div className="text-[12px]">
                <div>
                  Receiving now <QuantityDisplay value={receivingNow} className="font-semibold" />
                </div>
                <div className="text-[var(--muted)]">
                  {selectedCount} line{selectedCount === 1 ? "" : "s"} in this receipt
                </div>
              </div>
            </div>

            {receiveError ? (
              <p role="alert" className="mt-3 rounded-[var(--r-sm)] bg-[var(--danger-subtle)] p-2 text-[12px] text-[var(--danger)]">
                {TRANSFER_ERROR_COPY[receiveError.message] ?? receiveError.userMessage}
                {receiveError.requestId ? (
                  <span className="mt-1 block text-[11px] text-[var(--muted)]">
                    Request ID: <span className="mono select-all">{receiveError.requestId}</span>
                  </span>
                ) : null}
              </p>
            ) : null}

            <Button variant="primary" className="mt-3 h-11 w-full" disabled={!canReceive} onClick={submit}>
              {receive.isPending ? "Submitting…" : "Receive"}
            </Button>
            <p className="mt-2 text-[11px] text-[var(--muted)]">
              Partial receipts are allowed — outstanding stock stays in transit until every line is fully received, when
              the transfer completes automatically. The Idempotency-Key is generated once and reused on retry.
            </p>
          </div>

          <div className="wc-receive-history">
            <section>
              <h3 className="wc-section-label mb-2">Receipts this session</h3>
              <div className="rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface)] p-3">
                {sessionReceipts.length === 0 ? (
                  <p className="text-[12px] text-[var(--muted)]">No receipts recorded in this session yet.</p>
                ) : (
                  <ul className="flex flex-col divide-y divide-[var(--border)]">
                    {sessionReceipts.map((r) => (
                      <li key={r.receipt_number} className="py-[9px] text-[12px] first:pt-0 last:pb-0">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <span className="mono font-medium">{r.receipt_number}</span>
                          <span className="text-[var(--muted)]">→ {r.transfer.status}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-2 border-t border-[var(--border)] pt-2 text-[11px] text-[var(--faint)]">
                  The API does not return individual historical transfer receipts.
                </p>
              </div>
            </section>
          </div>
        </aside>
      </div>

      <div className="wc-receive-dock">
        <div className="text-[12px] font-semibold">
          {selectedCount} line{selectedCount === 1 ? "" : "s"} · <QuantityDisplay value={receivingNow} />
        </div>
        <Button variant="primary" className="h-11 flex-none px-5" disabled={!canReceive} onClick={submit}>
          {receive.isPending ? "Submitting…" : "Receive"}
        </Button>
      </div>
    </div>
  );
}

function Breadcrumb({ transferNumber }: { transferNumber: string }) {
  return (
    <nav className="flex items-center gap-1 text-[12px] text-[var(--muted)]" aria-label="Breadcrumb">
      <Link href="/transfers" className="font-medium hover:text-[var(--foreground)]">
        Transfers
      </Link>
      <ChevronRight aria-hidden className="h-3 w-3" />
      <span className="mono text-[var(--foreground)]">{transferNumber}</span>
      <ChevronRight aria-hidden className="h-3 w-3" />
      <span>Receive</span>
    </nav>
  );
}
