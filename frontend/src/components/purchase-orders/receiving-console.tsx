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
import { compareDecimals, sumDecimals } from "@/lib/decimal";
import { resolveBarcode, useProductLookup } from "@/lib/query/sales";
import { usePurchaseOrder, useReceivePurchaseOrder } from "@/lib/query/purchase-orders";
import { useReceiptDraft } from "@/lib/receipt-draft";
import {
  RECEIVABLE_STATUSES,
  RECEIVE_ERROR_COPY,
  type PurchaseOrderReceiveResult,
} from "@/lib/api/schemas/purchase-orders";
import { ReceiveLine, validateReceiveLine } from "./receive-line";
import { ReceiptHistory } from "./receipt-history";

const MISMATCH_MSG = "Idempotency-Key already used with a different payload";

export function ReceivingConsole({ poId }: { poId: number }) {
  const detailQ = usePurchaseOrder(poId);
  const detail = detailQ.data;
  const productIds = React.useMemo(() => detail?.items.map((i) => i.product_id) ?? [], [detail]);
  const lookupQ = useProductLookup(productIds);
  const lookup = lookupQ.data ?? {};

  const draft = useReceiptDraft(poId);
  const receive = useReceivePurchaseOrder();

  const [sessionReceipts, setSessionReceipts] = React.useState<PurchaseOrderReceiveResult[]>([]);
  const [mismatch, setMismatch] = React.useState(false);
  const [highlightPid, setHighlightPid] = React.useState<number | null>(null);

  /* barcode assist — read-only product resolver, never a receive mutation */
  const scanner = useScanner({
    onScan: async (code) => {
      try {
        const res = await resolveBarcode(code, "stock_in");
        const item = detail?.items.find((i) => i.product_id === res.product.id);
        if (!item) {
          toast.error(`${res.product.product_name} is not on this purchase order.`);
          return;
        }
        if (compareDecimals(item.remaining_quantity, "0") <= 0) {
          toast.info(`${res.product.product_name} is already fully received.`);
          return;
        }
        setHighlightPid(item.product_id);
        const el = document.getElementById(`rl-${item.product_id}-qty`);
        el?.scrollIntoView({ block: "center", behavior: "smooth" });
        (el as HTMLInputElement | null)?.focus();
      } catch (e) {
        toast.error(isApiError(e) && e.status === 404 ? `Unknown barcode ${code}.` : "Could not resolve that barcode.");
      }
    },
  });

  if (detailQ.isLoading) return <LoadingState label="Loading receiving console…" />;
  if (detailQ.isError) return <ErrorState error={detailQ.error} onRetry={() => void detailQ.refetch()} />;
  if (!detail) return <EmptyState message="Purchase order not found." />;

  const status = detail.status.toUpperCase();
  const receivable = (RECEIVABLE_STATUSES as readonly string[]).includes(status);

  if (!receivable) {
    return (
      <div className="flex flex-col gap-4">
        <Breadcrumb poNumber={detail.po_number} />
        <div className="rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface)] p-6">
          <div className="flex items-center gap-2">
            <StatusBadge status={status} />
            <span className="text-[13px] text-[var(--muted)]">
              {detail.po_number} is not in a receivable state (needs Confirmed or Partially received).
            </span>
          </div>
          <Button asChild className="mt-4" variant="secondary">
            <Link href="/purchase-orders">Back to purchase orders</Link>
          </Button>
        </div>
      </div>
    );
  }

  const ordered = sumDecimals(detail.items.map((i) => i.quantity), 3);
  const receivedToDate = sumDecimals(detail.items.map((i) => i.received_quantity), 3);

  const lineErrors = detail.items
    .map((it) => validateReceiveLine(lookup[it.product_id], draft.lines[it.product_id] ?? {}, it.remaining_quantity))
    .filter(Boolean) as string[];

  const receivingNow = sumDecimals(
    detail.items.map((it) => {
      const q = (draft.lines[it.product_id]?.quantity ?? "").trim();
      const bad = validateReceiveLine(lookup[it.product_id], draft.lines[it.product_id] ?? {}, it.remaining_quantity);
      return !bad && q ? q : "0";
    }),
    3,
  );

  const selectedCount = detail.items.filter((it) => {
    const q = (draft.lines[it.product_id]?.quantity ?? "").trim();
    const bad = validateReceiveLine(lookup[it.product_id], draft.lines[it.product_id] ?? {}, it.remaining_quantity);
    return !bad && q && Number(q) > 0;
  }).length;

  const canReceive =
    draft.ready &&
    !!draft.payload &&
    lineErrors.length === 0 &&
    selectedCount > 0 &&
    !receive.isPending &&
    !mismatch;

  const submit = () => {
    if (!draft.payload) return;
    receive.mutate(
      { id: poId, idempotencyKey: draft.idempotencyKey, payload: draft.payload },
      {
        onSuccess: (data) => {
          // replay-safe: dedupe by receipt_number so a re-submit doesn't double-list
          setSessionReceipts((prev) =>
            prev.some((r) => r.receipt_number === data.receipt_number) ? prev : [data, ...prev],
          );
          toast.success(`Receipt ${data.receipt_number.replace(/^POR-/, "").slice(0, 8)}… recorded`, {
            description:
              data.status === "RECEIVED" ? "Purchase order fully received." : "Purchase order partially received.",
          });
          draft.commitSuccess(); // clears the key + starts a fresh draft
          setMismatch(false);
          setHighlightPid(null);
          void detailQ.refetch();
        },
        onError: (error) => {
          const msg = isApiError(error) ? error.message : "";
          const rid = isApiError(error) ? error.requestId : undefined;
          if (msg === MISMATCH_MSG) {
            setMismatch(true); // never auto-generate a new key — the operator decides
            return;
          }
          const copy = RECEIVE_ERROR_COPY[msg] ?? (isApiError(error) ? error.userMessage : "The receipt was rejected.");
          toast.error("Receipt rejected", {
            description: rid ? `${copy} · Request ${rid}` : copy,
          });
        },
      },
    );
  };

  const receiveError =
    receive.isError && isApiError(receive.error) && receive.error.message !== MISMATCH_MSG ? receive.error : null;

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumb poNumber={detail.po_number} />

      <div className="wc-receive-layout">
        <div className="wc-receive-main flex min-w-0 flex-col gap-3">
          <div className="wc-work-head">
            <div>
              <div className="mono text-[16px] font-bold">{detail.po_number}</div>
              <div className="text-[12px] text-[var(--muted)]">{detail.items.length} lines · receiving</div>
            </div>
            <div className="ml-auto">
              <ProgressRing done={receivedToDate} total={ordered} label="Received to date" />
            </div>
          </div>

          {/* barcode assist — jumps to a line, does not receive */}
          <div className="flex items-center gap-2 rounded-[var(--r-sm)] border border-[var(--border-strong)] bg-[var(--surface)] px-3">
            <ScanLine aria-hidden className="h-4 w-4 flex-none text-[var(--muted)]" />
            <input
              {...scanner.inputProps}
              placeholder="Scan a barcode to jump to its line…"
              aria-label="Barcode assist"
              className="min-h-11 w-full min-w-0 bg-transparent text-[13px] outline-none"
            />
          </div>

          {detail.items.map((it) => (
            <ReceiveLine
              key={it.id}
              anchorId={`rl-${it.product_id}`}
              product={lookup[it.product_id]}
              productId={it.product_id}
              ordered={it.quantity}
              receivedToDate={it.received_quantity}
              remaining={it.remaining_quantity}
              line={draft.lines[it.product_id] ?? {}}
              onChange={(patch) => draft.setLine(it.product_id, patch)}
              highlight={highlightPid === it.product_id}
            />
          ))}
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
                  {RECEIVE_ERROR_COPY[MISMATCH_MSG]}
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
                  const q = (draft.lines[it.product_id]?.quantity ?? "").trim();
                  const bad = validateReceiveLine(
                    lookup[it.product_id],
                    draft.lines[it.product_id] ?? {},
                    it.remaining_quantity,
                  );
                  if (!q || Number(q) <= 0) return null;
                  return (
                    <div key={it.id} className="flex items-baseline justify-between gap-3">
                      <span className={bad ? "text-[var(--danger)]" : ""}>
                        {lookup[it.product_id]?.sku ?? `#${it.product_id}`}
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
                done={sumDecimals([receivedToDate, receivingNow], 3)}
                total={ordered}
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
                {RECEIVE_ERROR_COPY[receiveError.message] ?? receiveError.userMessage}
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
              Partial receipts are allowed. An Idempotency-Key is generated once and reused on every retry of this
              receipt — you never type it.
            </p>
          </div>

          <div className="wc-receive-history">
            <ReceiptHistory
              sessionReceipts={sessionReceipts}
              receiptCount={sessionReceipts.length}
              lookup={lookup}
            />
          </div>
        </aside>
      </div>

      {/* compact mobile action dock — form fields stay in normal flow above */}
      <div className="wc-receive-dock">
        <div className="text-[12px]">
          <div className="font-semibold">
            {selectedCount} line{selectedCount === 1 ? "" : "s"} · <QuantityDisplay value={receivingNow} />
          </div>
        </div>
        <Button variant="primary" className="h-11 flex-none px-5" disabled={!canReceive} onClick={submit}>
          {receive.isPending ? "Submitting…" : "Receive"}
        </Button>
      </div>
    </div>
  );
}

function Breadcrumb({ poNumber }: { poNumber: string | null }) {
  return (
    <nav className="flex items-center gap-1 text-[12px] text-[var(--muted)]" aria-label="Breadcrumb">
      <Link href="/purchase-orders" className="font-medium hover:text-[var(--foreground)]">
        Purchase orders
      </Link>
      <ChevronRight aria-hidden className="h-3 w-3" />
      <span className="mono text-[var(--foreground)]">{poNumber ?? "—"}</span>
      <ChevronRight aria-hidden className="h-3 w-3" />
      <span>Receive</span>
    </nav>
  );
}
