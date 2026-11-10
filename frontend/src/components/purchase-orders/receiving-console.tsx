"use client";

import * as React from "react";
import Link from "next/link";
import { Camera, ScanLine, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Banner, EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { StatusBadge } from "@/components/ui/status-badge";
import { LotChip } from "@/components/ui/lot-chip";
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
import { usePurchaseOrder, useReceivePurchaseOrder } from "@/lib/query/purchase-orders";
import { useReceiptDraft } from "@/lib/receipt-draft";
import { addReceiptOnce, summarizeReceipt } from "@/lib/workflow/receipt-summary";
import { isExactKeyMismatch, KEY_MISMATCH_MESSAGE } from "@/lib/workflow/submission-errors";
import { useIdempotentSubmission } from "@/lib/workflow/use-idempotent-submission";
import {
  RECEIVABLE_STATUSES,
  RECEIVE_ERROR_COPY,
  type PurchaseOrderReceiveResult,
} from "@/lib/api/schemas/purchase-orders";
import { ReceiveLine, validateReceiveLine } from "./receive-line";
import { ReceiptHistory } from "./receipt-history";

export function ReceivingConsole({ poId }: { poId: number }) {
  const t = useT();
  const detailQ = usePurchaseOrder(poId);
  const detail = detailQ.data;
  const productIds = React.useMemo(() => detail?.items.map((i) => i.product_id) ?? [], [detail]);
  const lookupQ = useProductLookup(productIds);
  const lookup = lookupQ.data ?? {};

  const draft = useReceiptDraft(poId);
  const receive = useReceivePurchaseOrder();
  // never auto-generate a new key on a mismatch — the operator decides
  const submission = useIdempotentSubmission({ draft, mutate: receive.mutate, isMismatch: isExactKeyMismatch });
  const { mismatch } = submission;

  const [sessionReceipts, setSessionReceipts] = React.useState<PurchaseOrderReceiveResult[]>([]);
  const [highlightPid, setHighlightPid] = React.useState<number | null>(null);
  const [cameraOpen, setCameraOpen] = React.useState(false);
  // R4 review before commit: opening it sends nothing; Confirm runs `submit`
  const [reviewOpen, setReviewOpen] = React.useState(false);
  const openerRef = React.useRef<HTMLButtonElement | null>(null);

  const detailRef = React.useRef(detail);
  React.useEffect(() => {
    detailRef.current = detail;
  }, [detail]);

  /* barcode assist — read-only product resolver, never a receive mutation.
     Shared verbatim by the hardware/manual scanner AND the camera. */
  const handleAssistScan = React.useCallback(
    async (code: string) => {
      try {
        const res = await resolveBarcode(code, "stock_in");
        const item = detailRef.current?.items.find((i) => i.product_id === res.product.id);
        if (!item) {
          toast.error(t("receive.notOnPo", { name: res.product.product_name }));
          return;
        }
        if (compareDecimals(item.remaining_quantity, "0") <= 0) {
          toast.info(t("receive.fullyReceived", { name: res.product.product_name }));
          return;
        }
        setHighlightPid(item.product_id);
        const el = document.getElementById(`rl-${item.product_id}-qty`);
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
  if (!detail) return <EmptyState message={t("receive.poNotFound")} />;

  const status = detail.status.toUpperCase();
  const receivable = (RECEIVABLE_STATUSES as readonly string[]).includes(status);

  if (!receivable) {
    return (
      <div className="flex flex-col gap-4">
        <div className="rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface)] p-6">
          <div className="flex items-center gap-2">
            <StatusBadge status={status} />
            <span className="text-[13px] text-[var(--muted)]">{t("receive.poNotReceivable", { number: detail.po_number ?? "—" })}</span>
          </div>
          <Button asChild className="mt-4" variant="secondary">
            <Link href="/purchase-orders">{t("receive.backToPos")}</Link>
          </Button>
        </div>
      </div>
    );
  }

  const ordered = sumDecimals(detail.items.map((i) => i.quantity), 3);
  const receivedToDate = sumDecimals(detail.items.map((i) => i.received_quantity), 3);

  const { lineErrors, receivingNow, selectedCount } = summarizeReceipt(
    detail.items.map((it) => {
      const line = draft.lines[it.product_id] ?? {};
      return {
        quantity: (line.quantity ?? "").trim(),
        error: validateReceiveLine(lookup[it.product_id], line, it.remaining_quantity),
      };
    }),
  );

  const canReceive =
    draft.ready &&
    !!draft.payload &&
    lineErrors.length === 0 &&
    selectedCount > 0 &&
    !receive.isPending &&
    !mismatch;

  const submit = () => {
    if (!draft.payload) return;
    // success clears the key + starts a fresh draft; a mismatch raises the banner
    submission.submit(
      { id: poId, payload: draft.payload },
      {
        onSuccess: (data) => {
          setReviewOpen(false);
          // replay-safe: dedupe by receipt_number so a re-submit doesn't double-list
          setSessionReceipts((prev) => addReceiptOnce(prev, data));
          toast.success(t("receive.receiptRecorded", { ref: data.receipt_number.replace(/^POR-/, "").slice(0, 8) }), {
            description: t(data.status === "RECEIVED" ? "receive.poFull" : "receive.poPartial"),
          });
          setHighlightPid(null);
          void detailQ.refetch();
        },
        onError: (error, isMismatch) => {
          if (isMismatch) {
            setReviewOpen(false); // the recovery banner takes over
            return;
          }
          const msg = isApiError(error) ? error.message : "";
          const rid = isApiError(error) ? error.requestId : undefined;
          const copy = RECEIVE_ERROR_COPY[msg] ?? (isApiError(error) ? error.userMessage : t("receive.rejectedFallback"));
          toast.error(t("receive.rejected"), {
            description: rid ? `${copy} · ${t("task.requestRef", { id: rid })}` : copy,
          });
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
    <Banner tone="danger" title={RECEIVE_ERROR_COPY[receiveError.message] ?? receiveError.userMessage}>
      {receiveError.requestId ? (
        <span className="text-[12px] text-[var(--muted)]">
          {t("common.requestId")} <span className="mono select-all">{receiveError.requestId}</span>
        </span>
      ) : null}
    </Banner>
  ) : null;

  const included = detail.items.filter((it) => {
    const q = (draft.lines[it.product_id]?.quantity ?? "").trim();
    return q !== "" && Number(q) > 0 && !validateReceiveLine(lookup[it.product_id], draft.lines[it.product_id] ?? {}, it.remaining_quantity);
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="wc-receive-layout">
        <div className="wc-receive-main flex min-w-0 flex-col gap-3">
          <div className="wc-work-head">
            <div>
              <h1 className="mono text-[18px] font-semibold">{detail.po_number}</h1>
              <div className="text-[13px] text-[var(--muted)]">{t("receive.linesReceiving", { n: detail.items.length })}</div>
            </div>
            <div className="ml-auto">
              <ProgressRing done={receivedToDate} total={ordered} label={t("receive.receivedToDate")} />
            </div>
          </div>

          {/* barcode assist — jumps to a line, does not receive */}
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
            <h2 className="wc-section-label mb-2">{t("receive.thisReceipt")}</h2>

            {mismatch ? (
              <Banner
                tone="danger"
                title={RECEIVE_ERROR_COPY[KEY_MISMATCH_MESSAGE]}
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
                  const q = (draft.lines[it.product_id]?.quantity ?? "").trim();
                  const bad = validateReceiveLine(lookup[it.product_id], draft.lines[it.product_id] ?? {}, it.remaining_quantity);
                  if (!q || Number(q) <= 0) return null;
                  return (
                    <div key={it.id} className="flex items-baseline justify-between gap-3">
                      <span className={bad ? "text-[var(--danger)]" : ""}>{lookup[it.product_id]?.sku ?? `#${it.product_id}`}</span>
                      <span className={bad ? "text-[var(--danger)]" : "font-medium"}>
                        {bad ? t("receive.invalid") : <QuantityDisplay value={q} />}
                      </span>
                    </div>
                  );
                })
              )}
            </div>

            <div className="mt-3 flex items-center gap-3 border-t border-[var(--border)] pt-3">
              <ProgressRing done={sumDecimals([receivedToDate, receivingNow], 3)} total={ordered} size={40} label={t("receive.receivedAfter")} />
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
            <p className="mt-2 text-[12px] text-[var(--muted)]">{t("receive.partialNote")}</p>
          </div>

          <div className="wc-receive-history">
            <ReceiptHistory sessionReceipts={sessionReceipts} receiptCount={sessionReceipts.length} lookup={lookup} />
          </div>
        </aside>
      </div>

      {/* compact mobile action dock — form fields stay in normal flow above */}
      <div className="wc-receive-dock">
        <div className="text-[12px]">
          <div className="font-semibold">
            {t("receive.linesInReceipt", { n: selectedCount })} · <QuantityDisplay value={receivingNow} />
          </div>
        </div>
        <Button variant="primary" className="h-11 flex-none px-5" disabled={!canReceive} onClick={openReview}>
          {receive.isPending ? t("receive.submitting") : t("receive.review")}
        </Button>
      </div>

      <ReviewSheet
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        title={t("receive.confirmTitle", { number: detail.po_number ?? "—" })}
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
            const line = draft.lines[it.product_id] ?? {};
            const q = (line.quantity ?? "").trim();
            const product = lookup[it.product_id];
            return (
              <li key={it.id} className="flex flex-col gap-1 px-3 py-2">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate text-[13px] font-semibold">{product?.product_name ?? `#${it.product_id}`}</span>
                  <QuantityDisplay value={q} signed className="font-semibold text-[var(--success)]" />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-[var(--muted)]">
                  <span className="mono">{product?.sku ?? ""}</span>
                  {line.lot_no ? <LotChip lot={line.lot_no} /> : null}
                  <span>
                    {t("receive.remainingAfter")} <QuantityDisplay value={subtractDecimals(it.remaining_quantity, q, 3)} />
                  </span>
                </div>
                {line.mfg_date || line.expiry_date ? (
                  <div className="text-[12px] text-[var(--muted)]">
                    {t("task.mfgDate")} {line.mfg_date || "—"} · {t("task.expiryDate")} {line.expiry_date || "—"}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
        <div className="grid grid-cols-1 gap-2 min-[480px]:grid-cols-2">
          <ReviewCell label={t("receive.receivingNow")}>
            <QuantityDisplay value={receivingNow} />
          </ReviewCell>
          <ReviewCell label={t("receive.linesLabel")}>{selectedCount}</ReviewCell>
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
