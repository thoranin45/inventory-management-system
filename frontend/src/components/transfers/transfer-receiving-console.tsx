"use client";

import * as React from "react";
import Link from "next/link";
import { Camera, ScanLine, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Banner, EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { StatusBadge } from "@/components/ui/status-badge";
import { ExpiryBadge } from "@/components/ui/expiry-badge";
import { QuantityDisplay } from "@/components/ui/quantity-display";
import { ReviewCell, ReviewSheet } from "@/components/ui/review-sheet";
import { ProgressRing } from "@/components/work/progress-ring";
import { CameraBarcodeScanner } from "@/components/work/camera-barcode-scanner";
import { useScanner } from "@/components/work/use-scanner";
import { isApiError } from "@/lib/api/errors";
import { compareDecimals, subtractDecimals, sumDecimals } from "@/lib/decimal";
import { formatQtyDelta } from "@/lib/format";
import { useT } from "@/lib/i18n/client";
import { resolveBarcode, useProductLookup } from "@/lib/query/sales";
import { useBatchExpiryMap, useReceiveTransfer, useTransfer, useWarehouseNames } from "@/lib/query/transfers";
import { useTransferReceiptDraft } from "@/lib/transfer-receipt-draft";
import { addReceiptOnce, summarizeReceipt } from "@/lib/workflow/receipt-summary";
import { isExactKeyMismatch, KEY_MISMATCH_MESSAGE } from "@/lib/workflow/submission-errors";
import { useIdempotentSubmission } from "@/lib/workflow/use-idempotent-submission";
import {
  RECEIVABLE_TRANSFER_STATUSES,
  TRANSFER_ERROR_COPY,
  type TransferReceiptResponse,
} from "@/lib/api/schemas/transfers";
import { TransferRoute } from "./transfer-route";
import { TransferReceiveLine, validateTransferReceiveLine } from "./transfer-receive-line";

export function TransferReceivingConsole({ transferId }: { transferId: number }) {
  const t = useT();
  const detailQ = useTransfer(transferId);
  const detail = detailQ.data;

  const productIds = React.useMemo(() => detail?.items.map((i) => i.product_id) ?? [], [detail]);
  const lookup = useProductLookup(productIds).data ?? {};
  const { map: batchExpiry } = useBatchExpiryMap(productIds);
  const whNames = useWarehouseNames().data ?? {};

  const draft = useTransferReceiptDraft(transferId);
  const receive = useReceiveTransfer();
  // never auto-generate a new key on a mismatch — the operator decides
  const submission = useIdempotentSubmission({ draft, mutate: receive.mutate, isMismatch: isExactKeyMismatch });
  const { mismatch } = submission;

  const [sessionReceipts, setSessionReceipts] = React.useState<TransferReceiptResponse[]>([]);
  const [highlightItemId, setHighlightItemId] = React.useState<number | null>(null);
  const [cameraOpen, setCameraOpen] = React.useState(false);
  // R4 review before commit: opening it sends nothing; Confirm runs `submit`
  const [reviewOpen, setReviewOpen] = React.useState(false);
  const openerRef = React.useRef<HTMLButtonElement | null>(null);

  const detailRef = React.useRef(detail);
  React.useEffect(() => {
    detailRef.current = detail;
  }, [detail]);

  /* barcode assist — read-only line identification, never a receive mutation.
     Shared verbatim by the hardware/manual scanner AND the camera. */
  const handleAssistScan = React.useCallback(
    async (code: string) => {
      try {
        const res = await resolveBarcode(code, "stock_in");
        const matches = (detailRef.current?.items ?? []).filter((i) => i.product_id === res.product.id);
        if (matches.length === 0) {
          toast.error(t("receive.notOnTransfer", { name: res.product.product_name }));
          return;
        }
        const open = matches.find(
          (i) => compareDecimals(subtractDecimals(i.dispatched_quantity ?? "0", i.received_quantity ?? "0", 3), "0") > 0,
        );
        if (!open) {
          toast.info(t("receive.fullyReceived", { name: res.product.product_name }));
          return;
        }
        if (matches.length > 1) toast.info(t("receive.manyLines", { name: res.product.product_name, n: matches.length }));
        setHighlightItemId(open.id);
        const el = document.getElementById(`trl-${open.id}-qty`);
        el?.scrollIntoView({ block: "center", behavior: "smooth" });
        (el as HTMLInputElement | null)?.focus();
      } catch (e) {
        toast.error(isApiError(e) && e.status === 404 ? t("receive.unknownBarcode", { code }) : t("receive.resolveFailed"));
      }
    },
    [t],
  );

  // the assist scanner is off while the review is open
  const scanner = useScanner({ onScan: handleAssistScan, disabled: reviewOpen });

  if (detailQ.isLoading) return <LoadingState label={t("receive.loading")} />;
  if (detailQ.isError) return <ErrorState error={detailQ.error} onRetry={() => void detailQ.refetch()} />;
  if (!detail) return <EmptyState message={t("receive.transferNotFound")} />;

  const status = detail.status.toUpperCase();
  const receivable = (RECEIVABLE_TRANSFER_STATUSES as readonly string[]).includes(status) && !detail.legacy_completed;
  const wh = (id: number) => whNames[id] ?? t("receive.warehouseFallback", { id });

  if (!receivable) {
    return (
      <div className="flex flex-col gap-4">
        <div className="rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface)] p-6">
          <div className="flex items-center gap-2">
            <StatusBadge status={status} />
            <span className="text-[13px] text-[var(--muted)]">{t("receive.transferNotReceivable", { number: detail.transfer_number })}</span>
          </div>
          <Button asChild className="mt-4" variant="secondary">
            <Link href="/transfers">{t("receive.backToTransfers")}</Link>
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

  const { lineErrors, receivingNow, selectedCount } = summarizeReceipt(
    detail.items.map((it) => {
      const quantity = (draft.lines[it.id]?.quantity ?? "").trim();
      return { quantity, error: validateTransferReceiveLine(quantity, figs(it).outstanding) };
    }),
  );

  const canReceive = draft.ready && !!draft.payload && lineErrors.length === 0 && selectedCount > 0 && !receive.isPending && !mismatch;

  const submit = () => {
    if (!draft.payload) return;
    // success clears the key + starts a fresh draft; a mismatch raises the banner
    submission.submit(
      { id: transferId, payload: draft.payload },
      {
        onSuccess: (data) => {
          setReviewOpen(false);
          setSessionReceipts((prev) => addReceiptOnce(prev, data));
          toast.success(t("receive.receiptRecorded", { ref: data.receipt_number.replace(/^TRR-/, "").slice(0, 8) }), {
            description: t(data.transfer.status === "COMPLETED" ? "receive.transferFull" : "receive.transferPartial"),
          });
          setHighlightItemId(null);
          void detailQ.refetch();
        },
        onError: (error, isMismatch) => {
          if (isMismatch) {
            setReviewOpen(false); // the recovery banner takes over
            return;
          }
          const msg = isApiError(error) ? error.message : "";
          const rid = isApiError(error) ? error.requestId : undefined;
          const copy = TRANSFER_ERROR_COPY[msg] ?? (isApiError(error) ? error.userMessage : t("receive.rejectedFallback"));
          toast.error(t("receive.rejected"), { description: rid ? `${copy} · ${t("task.requestRef", { id: rid })}` : copy });
        },
      },
    );
  };

  const openReview = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!canReceive) return;
    openerRef.current = e.currentTarget;
    receive.reset?.();
    setReviewOpen(true);
  };

  const receiveError =
    receive.isError && isApiError(receive.error) && receive.error.message !== KEY_MISMATCH_MESSAGE ? receive.error : null;
  const errorBlock = receiveError ? (
    <Banner tone="danger" title={TRANSFER_ERROR_COPY[receiveError.message] ?? receiveError.userMessage}>
      {receiveError.requestId ? (
        <span className="text-[12px] text-[var(--muted)]">
          {t("common.requestId")} <span className="mono select-all">{receiveError.requestId}</span>
        </span>
      ) : null}
    </Banner>
  ) : null;

  const included = detail.items.filter((it) => {
    const q = (draft.lines[it.id]?.quantity ?? "").trim();
    return q !== "" && Number(q) > 0 && !validateTransferReceiveLine(q, figs(it).outstanding);
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="wc-receive-layout">
        <div className="wc-receive-main flex min-w-0 flex-col gap-3">
          <div className="wc-work-head">
            <div>
              <h1 className="mono text-[18px] font-semibold">{detail.transfer_number}</h1>
              <div className="text-[13px] text-[var(--muted)]">
                {wh(detail.source_warehouse_id)} → {wh(detail.destination_warehouse_id)} · {t("receive.linesCount", { n: detail.items.length })}
              </div>
            </div>
            <div className="ml-auto">
              <ProgressRing done={totals.received} total={totals.total} label={t("receive.receivedToDate")} />
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

          <div className="flex items-center gap-2 rounded-[var(--r-sm)] border border-[var(--border-strong)] bg-[var(--surface)] px-3 focus-within:border-[var(--accent)] focus-within:outline-2 focus-within:outline-[var(--focus)]">
            <ScanLine aria-hidden className="h-4 w-4 flex-none text-[var(--muted)]" />
            <input
              {...scanner.inputProps}
              placeholder={t("receive.assistPlaceholder")}
              aria-label={t("receive.assistLabel")}
              className="min-h-11 w-full min-w-0 bg-transparent text-[16px] outline-none min-[768px]:text-[13px]"
            />
            <Button
              type="button"
              variant="secondary"
              size="icon"
              aria-label={t("task.scanWithCamera")}
              title={t("task.scanWithCameraTitle")}
              onClick={() => {
                if (typeof document !== "undefined") (document.activeElement as HTMLElement | null)?.blur();
                setCameraOpen(true);
              }}
            >
              <Camera aria-hidden className="h-4 w-4" />
            </Button>
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
            <h2 className="wc-section-label mb-2">{t("receive.thisReceipt")}</h2>

            {mismatch ? (
              <Banner
                tone="danger"
                title={TRANSFER_ERROR_COPY[KEY_MISMATCH_MESSAGE]}
                className="mb-3"
                actions={
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      draft.startNewDraft();
                      submission.clearMismatch();
                    }}
                  >
                    {t("receive.startNew")}
                  </Button>
                }
              />
            ) : null}

            <div className="flex flex-col gap-1 text-[12px]">
              {selectedCount === 0 ? (
                <p className="text-[var(--muted)]">{t("receive.enterQty")}</p>
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
                        {bad ? t("receive.invalid") : <QuantityDisplay value={q} />}
                      </span>
                    </div>
                  );
                })
              )}
            </div>

            <div className="mt-3 flex items-center gap-3 border-t border-[var(--border)] pt-3">
              <ProgressRing done={sumDecimals([totals.received, receivingNow], 3)} total={totals.total} size={40} label={t("receive.receivedAfter")} />
              <div className="text-[12px]">
                <div>
                  {t("receive.receivingNow")} <QuantityDisplay value={receivingNow} className="font-semibold" />
                </div>
                <div className="text-[var(--muted)]">{t("receive.linesInReceipt", { n: selectedCount })}</div>
              </div>
            </div>

            {receiveError && !reviewOpen ? <div className="mt-3">{errorBlock}</div> : null}

            <Button variant="primary" className="mt-3 h-11 w-full" disabled={!canReceive} onClick={openReview}>
              <ShieldCheck aria-hidden className="h-4 w-4" />
              {receive.isPending ? t("receive.submitting") : t("receive.reviewReceipt")}
            </Button>
            <p className="mt-2 text-[12px] text-[var(--muted)]">{t("receive.transferPartialNote")}</p>
          </div>

          <div className="wc-receive-history">
            <section>
              <h3 className="wc-section-label mb-2">{t("receive.historyTitle")}</h3>
              <div className="rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface)] p-3">
                {sessionReceipts.length === 0 ? (
                  <p className="text-[12px] text-[var(--muted)]">{t("receive.historyEmpty")}</p>
                ) : (
                  <ul className="flex flex-col divide-y divide-[var(--border)]">
                    {sessionReceipts.map((r) => (
                      <li key={r.receipt_number} className="py-[9px] text-[12px] first:pt-0 last:pb-0">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <span className="mono font-medium">{r.receipt_number}</span>
                          <StatusBadge status={r.transfer.status} />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-2 border-t border-[var(--border)] pt-2 text-[12px] text-[var(--faint)]">{t("receive.transferHistoryNote")}</p>
              </div>
            </section>
          </div>
        </aside>
      </div>

      <div className="wc-receive-dock">
        <div className="text-[12px] font-semibold">
          {t("receive.linesInReceipt", { n: selectedCount })} · <QuantityDisplay value={receivingNow} />
        </div>
        <Button variant="primary" className="h-11 flex-none px-5" disabled={!canReceive} onClick={openReview}>
          {receive.isPending ? t("receive.submitting") : t("receive.review")}
        </Button>
      </div>

      <ReviewSheet
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        title={t("receive.confirmTitle", { number: detail.transfer_number })}
        description={t("review.checkBefore")}
        confirmLabel={t("receive.confirmReceipt", { q: formatQtyDelta(receivingNow) })}
        onConfirm={submit}
        pending={receive.isPending}
        confirmDisabled={!draft.payload || mismatch}
        error={errorBlock ? <>{errorBlock}<p className="mt-1 text-[12px] text-[var(--muted)]">{t("review.failedKept")}</p></> : undefined}
        returnFocusRef={openerRef}
      >
        <ul className="flex flex-col divide-y divide-[var(--border)] rounded-[var(--r-sm)] border border-[var(--border)]">
          {included.map((it) => {
            const q = (draft.lines[it.id]?.quantity ?? "").trim();
            const product = lookup[it.product_id];
            const info = it.batch_id != null ? batchExpiry[it.batch_id] : undefined;
            return (
              <li key={it.id} className="flex flex-col gap-1 px-3 py-2">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate text-[13px] font-semibold">{product?.product_name ?? `#${it.product_id}`}</span>
                  <QuantityDisplay value={q} signed className="font-semibold text-[var(--success)]" />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-[var(--muted)]">
                  <span className="mono">
                    {[product?.sku, it.batch_id != null ? t("receive.batchFallback", { id: it.batch_id }) : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  {info ? <ExpiryBadge days={info.days_to_expiry} isoDate={info.expiry_date} /> : null}
                  <span>
                    {t("receive.inTransitAfter")} <QuantityDisplay value={subtractDecimals(figs(it).outstanding, q, 3)} />
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
        <div className="grid grid-cols-1 gap-2 min-[480px]:grid-cols-2">
          <ReviewCell label={t("receive.receivingNow")}>
            <QuantityDisplay value={receivingNow} />
          </ReviewCell>
          <ReviewCell label={t("receive.destination")}>{wh(detail.destination_warehouse_id)}</ReviewCell>
        </div>
        <p className="text-[12px] text-[var(--muted)]">{t("receive.serverChecks")}</p>
      </ReviewSheet>

      <CameraBarcodeScanner
        open={cameraOpen}
        onOpenChange={(v) => {
          setCameraOpen(v);
          if (!v) scanner.focus();
        }}
        title={t("receive.scanABarcode")}
        onDecode={(value) => {
          setCameraOpen(false);
          void handleAssistScan(value);
        }}
      />
    </div>
  );
}
