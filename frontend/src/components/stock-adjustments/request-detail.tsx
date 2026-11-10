"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { QuantityChange, QuantityDisplay } from "@/components/ui/quantity-display";
import { StatusBadge } from "@/components/ui/status-badge";
import { StockTriad } from "@/components/ui/stock-triad";
import { LocalDate } from "@/components/ui/local-date";
import { Banner, EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { isApiError } from "@/lib/api/errors";
import { compareDecimals, subtractDecimals } from "@/lib/decimal";
import { formatBusinessDateTime, formatQtyDelta, formatStoredWallClock } from "@/lib/format";
import { useI18n } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/translate";
import { usePersistedIdempotencyKey } from "@/lib/workflow/persisted-key";
import { isAdmin, type Role } from "@/lib/auth/permissions";
import {
  useApproveStockAdjustmentRequest,
  useCancelStockAdjustmentRequest,
  useRejectStockAdjustmentRequest,
  useStockAdjustmentRequest,
} from "@/lib/query/stock-adjustment-requests";
import { approveRejectErrorCopy, REASON_LABELS, type ReasonCode } from "@/lib/api/schemas/stock-adjustment-requests";
import { cn } from "@/lib/utils";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-[var(--border)] py-[7px] text-[13px] last:border-b-0">
      <span className="flex-none text-[var(--muted)]">{label}</span>
      <span className="min-w-0 text-right">{children}</span>
    </div>
  );
}

function errLine(error: unknown, fallback: string): { message: string; requestId?: string } {
  if (isApiError(error)) return { message: approveRejectErrorCopy(error.message) || error.userMessage, requestId: error.requestId };
  return { message: error instanceof Error ? error.message : fallback };
}

/** The reason in the UI language (frozen labels from the schema; unknown codes shown raw). */
export function useReasonLabel(): (code: string) => string {
  const { locale } = useI18n();
  return (code) => {
    const r = REASON_LABELS[code as ReasonCode];
    return r ? (locale === "th" ? r.labelTh : r.label) : code;
  };
}

const HISTORY_ACTION_KEY: Record<string, MessageKey> = {
  CREATE_ADJUSTMENT_REQUEST: "adjust.histCreate",
  APPROVE_ADJUSTMENT_REQUEST: "adjust.histApprove",
  REJECT_ADJUSTMENT_REQUEST: "adjust.histReject",
  CANCEL_ADJUSTMENT_REQUEST: "adjust.histCancel",
};

/** A history instant: converted to Bangkok business time only when it carries a
 *  zone; a naive stored value is shown as recorded and labelled, never guessed. */
function HistoryTime({ at }: { at: string }) {
  const { t } = useI18n();
  const zoned = /(Z|[+-]\d{2}:?\d{2})$/.test(at);
  if (zoned) return <span className="mono">{formatBusinessDateTime(at)}</span>;
  return (
    <span className="mono" title={t("adjust.storedTimeTitle")}>
      {formatStoredWallClock(at)} <span className="text-[var(--warning)]">{t("adjust.storedTime")}</span>
    </span>
  );
}

/**
 * Approve's Idempotency-Key, persisted per request id — NOT a fresh key
 * per click. A dropped network response or a page reload after clicking
 * Approve must retry with the SAME key, so an uncertain attempt either
 * replays its stored success or safely proceeds, never applies twice and
 * never confuses a genuine retry with a second independent attempt.
 * Cleared only once the request leaves PENDING (approve succeeded, or the
 * admin saw a terminal "already decided" and moved on).
 */
function useApprovalIdempotencyKey(requestId: number): { key: string; clear: () => void } {
  return usePersistedIdempotencyKey(`adjreq-approve-key:${requestId}`, "adjreq-approve-");
}

/** Approve / Reject / Cancel for one request, plus the Observed → Requested
 * comparison and inline lifecycle history — no separate /audit lookup
 * needed. Approve's Idempotency-Key is persisted per request id (see
 * useApprovalIdempotencyKey) so a dropped response or a page reload
 * before the admin knows the outcome retries with the SAME key instead
 * of a fresh one — a single-shot action on an already-persisted record,
 * so it needs only that key plus a disabled-while-pending button,
 * mirroring po-actions.tsx otherwise.
 *
 * R4 (D-R4-6): `currentUserId` only drives a display hint — an admin's own
 * request shows no Approve button. The backend still refuses self-approval. */
export function StockAdjustmentRequestDetailBody({
  id,
  role,
  currentUserId,
  onDone,
}: {
  id: number;
  role: Role;
  currentUserId?: number;
  onDone?: () => void;
}) {
  const { t } = useI18n();
  const reasonLabel = useReasonLabel();
  const { data: request, isLoading, isError, error, refetch } = useStockAdjustmentRequest(id);
  const approve = useApproveStockAdjustmentRequest();
  const reject = useRejectStockAdjustmentRequest();
  const cancel = useCancelStockAdjustmentRequest();
  const approvalKey = useApprovalIdempotencyKey(id);

  const [approveOpen, setApproveOpen] = React.useState(false);
  const [rejectOpen, setRejectOpen] = React.useState(false);
  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [rejectReason, setRejectReason] = React.useState("");

  if (isLoading) return <LoadingState label={t("adjust.loadingRequest")} />;
  if (isError) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (!request) return <EmptyState message={t("adjust.noneSelected")} />;

  const fallback = t("adjust.genericError");
  const admin = isAdmin(role);
  const ownRequest = currentUserId != null && request.requested_by.id === currentUserId;
  const canDecide = admin && request.status === "PENDING";
  const canApprove = canDecide && !ownRequest;
  // The detail fetch itself is already scoped server-side (owner-or-admin
  // only), so anyone who can see this view is allowed to see the Cancel
  // button; the service re-checks ownership again on the actual call.
  const canCancel = request.status === "PENDING";
  const ref = request.reference_number ?? t("adjust.thisRequest");

  const approveErr = approve.isError ? errLine(approve.error, fallback) : null;
  const rejectErr = reject.isError ? errLine(reject.error, fallback) : null;
  const cancelErr = cancel.isError ? errLine(cancel.error, fallback) : null;
  const withRid = (line: { message: string; requestId?: string }) =>
    line.requestId ? `${line.message} · ${t("task.requestRef", { id: line.requestId })}` : line.message;

  const runApprove = () =>
    approve.mutate(
      { id: request.id, idempotencyKey: approvalKey.key },
      {
        onSuccess: (data) => {
          setApproveOpen(false);
          approvalKey.clear(); // decided — this key is spent, a future request gets its own
          toast.success(t("adjust.approvedToast", { ref: data.reference_number ?? t("adjust.request") }), {
            description: `${data.product.product_name}: ${data.observed_quantity} → ${data.requested_quantity}.`,
          });
        },
        onError: (e) => {
          // "Already decided" is terminal for this key too — someone else
          // (or this admin, in an earlier tab/attempt) resolved it; retrying
          // with the same key would only replay that same terminal 409.
          // Any other error (stale quantity, network, batch guard) keeps
          // the key so a genuine retry still safely reuses it.
          if (isApiError(e) && e.status === 409 && /already decided/i.test(e.message)) {
            approvalKey.clear();
          }
          toast.error(t("adjust.approveFailed"), { description: withRid(errLine(e, fallback)) });
        },
      },
    );

  const runReject = () =>
    reject.mutate(
      { id: request.id, rejection_reason: rejectReason },
      {
        onSuccess: () => {
          setRejectOpen(false);
          toast.success(t("adjust.rejectedToast", { ref: request.reference_number ?? t("adjust.request") }));
        },
        onError: (e) => {
          toast.error(t("adjust.rejectFailed"), { description: withRid(errLine(e, fallback)) });
        },
      },
    );

  const runCancel = () =>
    cancel.mutate(
      { id: request.id },
      {
        onSuccess: () => {
          setCancelOpen(false);
          toast.success(t("adjust.cancelledToast", { ref: request.reference_number ?? t("adjust.request") }));
          onDone?.();
        },
        onError: (e) => {
          toast.error(t("adjust.cancelFailed"), { description: withRid(errLine(e, fallback)) });
        },
      },
    );

  // exact decimal difference — never a float
  const diff = subtractDecimals(request.requested_quantity, request.observed_quantity, 3);
  const diffSign = compareDecimals(diff, "0");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <StatusBadge status={request.status} />
        {request.reference_number ? <span className="mono text-[12px] text-[var(--muted)]">{request.reference_number}</span> : null}
      </div>

      <div
        className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--r-sm)] border border-[var(--border)] bg-[var(--surface-sunken)] px-3 py-2 text-[13px]"
        role="status"
      >
        <span className="text-[var(--muted)]">{t("adjust.observedToRequested")}</span>
        <span className="font-semibold tabular-nums">
          <QuantityChange before={request.observed_quantity} after={request.requested_quantity} />
          <span className={cn("ml-2", diffSign < 0 ? "text-[var(--danger)]" : diffSign > 0 ? "text-[var(--success)]" : "text-[var(--muted)]")}>
            ({formatQtyDelta(diff)})
          </span>
        </span>
      </div>

      <section>
        <Row label={t("adjust.product")}>
          {request.product.product_name} <span className="mono text-[var(--muted)]">{request.product.sku}</span>
        </Row>
        <Row label={t("adjust.warehouseLocation")}>
          <span className="mono">
            {request.warehouse.warehouse_code} / {request.location.location_code}
          </span>
        </Row>
        {request.batch ? (
          <Row label={t("adjust.lot")}>
            <span className="mono">{request.batch.lot_no ?? t("receive.batchFallback", { id: request.batch.id })}</span>
            {request.batch.expiry_date ? (
              <span className="text-[var(--muted)]">
                {" "}
                · {t("adjust.exp")} <LocalDate iso={request.batch.expiry_date} isoInEnglish />
              </span>
            ) : null}
            {request.batch.is_expired ? (
              <span className="ml-2 rounded-[var(--r-full)] bg-[var(--danger-subtle)] px-2 py-[1px] text-[12px] font-semibold text-[var(--danger)]">
                {t("adjust.expired")}
              </span>
            ) : null}
          </Row>
        ) : null}
        {request.current_balance ? (
          <div className="border-b border-[var(--border)] py-[7px] text-[13px]">
            <span className="text-[var(--muted)]">{t("adjust.currentBalance")}</span>
            <StockTriad
              className="mt-1"
              compact
              onHand={request.current_balance.on_hand}
              reserved={request.current_balance.reserved}
              available={request.current_balance.available}
            />
          </div>
        ) : null}
        <Row label={t("adjust.reason")}>{reasonLabel(request.reason_code)}</Row>
        {request.notes ? <Row label={t("adjust.note")}>{request.notes}</Row> : null}
        <Row label={t("adjust.requestedBy")}>{request.requested_by.username}</Row>
        {request.reviewed_by ? <Row label={t("adjust.reviewedBy")}>{request.reviewed_by.username}</Row> : null}
        {request.rejection_reason ? <Row label={t("adjust.rejectionReason")}>{request.rejection_reason}</Row> : null}
      </section>

      {request.status === "APPROVED" && request.reference_number ? (
        <Link
          href={`/inventory/ledger?reference_number=${encodeURIComponent(request.reference_number)}`}
          className="self-start text-[13px] font-medium text-[var(--accent)] underline-offset-2 hover:underline"
        >
          {t("review.viewInLedger")}
        </Link>
      ) : null}

      {canDecide && ownRequest ? <Banner tone="info" title={t("adjust.selfApprovalHint")} /> : null}

      {canDecide ? (
        <div className="flex flex-wrap items-center gap-2">
          {canApprove ? (
            <Button variant="primary" onClick={() => setApproveOpen(true)} disabled={approve.isPending || reject.isPending}>
              {t("adjust.approve")}
            </Button>
          ) : null}
          <Button variant="danger" onClick={() => setRejectOpen(true)} disabled={approve.isPending || reject.isPending}>
            {t("adjust.reject")}
          </Button>
        </div>
      ) : null}
      {canCancel ? (
        <Button variant="ghost" className="self-start" onClick={() => setCancelOpen(true)} disabled={cancel.isPending}>
          {t("adjust.cancelRequest")}
        </Button>
      ) : null}

      <section>
        <h3 className="wc-section-label mb-1">{t("adjust.history")}</h3>
        <ul className="flex flex-col gap-[6px] text-[12px]">
          {request.history.map((h, i) => (
            <li key={i} className="flex flex-col gap-[1px] border-l-2 border-[var(--border-strong)] pl-2">
              <span className="font-medium">
                {HISTORY_ACTION_KEY[h.action] ? t(HISTORY_ACTION_KEY[h.action]) : h.action.replaceAll("_", " ")}
              </span>
              <span className="text-[var(--muted)]">
                {h.actor} · <HistoryTime at={h.at} />
              </span>
            </li>
          ))}
        </ul>
      </section>

      <Dialog open={approveOpen} onOpenChange={setApproveOpen}>
        <DialogContent title={t("adjust.approveTitle", { ref })} description={t("adjust.approveDescription")}>
          <div className="flex flex-col gap-2 rounded-[var(--r-sm)] border border-[var(--border)] p-3 text-[13px]">
            <span>
              {request.product.product_name} <span className="mono text-[var(--muted)]">{request.product.sku}</span>
            </span>
            <span className="font-semibold">
              <QuantityChange before={request.observed_quantity} after={request.requested_quantity} />{" "}
              <QuantityDisplay value={diff} signed className="text-[var(--muted)]" />
            </span>
          </div>
          {approveErr ? (
            <p role="alert" className="mt-2 rounded-[var(--r-sm)] bg-[var(--danger-subtle)] p-2 text-[12px] text-[var(--danger)]">
              {approveErr.message}
              {approveErr.requestId ? (
                <span className="mt-1 block text-[12px] text-[var(--muted)]">
                  {t("common.requestId")} <span className="mono select-all">{approveErr.requestId}</span>
                </span>
              ) : null}
            </p>
          ) : null}
          <div className="mt-2 flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="ghost">{t("adjust.keepPending")}</Button>
            </DialogClose>
            <Button variant="primary" onClick={runApprove} disabled={approve.isPending}>
              {approve.isPending ? t("adjust.approving") : t("adjust.approve")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent title={t("adjust.rejectTitle", { ref })} description={t("adjust.rejectDescription")}>
          <label className="flex flex-col gap-1 text-[12px] text-[var(--muted)]">
            {t("adjust.rejectionReason")}
            <textarea
              className="min-h-20 w-full rounded-[var(--r-sm)] border border-[var(--border-strong)] bg-[var(--surface)] p-2 text-[16px] outline-hidden focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-[var(--focus)] min-[768px]:text-[13px]"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              maxLength={500}
            />
          </label>
          {rejectErr ? (
            <p role="alert" className="mt-2 rounded-[var(--r-sm)] bg-[var(--danger-subtle)] p-2 text-[12px] text-[var(--danger)]">
              {rejectErr.message}
            </p>
          ) : null}
          <div className="mt-2 flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="ghost">{t("adjust.keepPending")}</Button>
            </DialogClose>
            <Button variant="danger" onClick={runReject} disabled={reject.isPending || !rejectReason.trim()}>
              {reject.isPending ? t("adjust.rejecting") : t("adjust.reject")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent title={t("adjust.cancelTitle", { ref })} description={t("adjust.cancelDescription")}>
          {cancelErr ? (
            <p role="alert" className="rounded-[var(--r-sm)] bg-[var(--danger-subtle)] p-2 text-[12px] text-[var(--danger)]">
              {cancelErr.message}
            </p>
          ) : null}
          <div className="mt-1 flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="ghost">{t("adjust.keepRequest")}</Button>
            </DialogClose>
            <Button variant="danger" onClick={runCancel} disabled={cancel.isPending}>
              {cancel.isPending ? t("adjust.cancelling") : t("adjust.cancelRequest")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
