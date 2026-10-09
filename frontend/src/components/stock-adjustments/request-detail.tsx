"use client";

import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { QuantityDisplay } from "@/components/ui/quantity-display";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { isApiError } from "@/lib/api/errors";
import { newId } from "@/lib/idempotent-draft";
import { isAdmin, type Role } from "@/lib/auth/permissions";
import {
  useApproveStockAdjustmentRequest,
  useCancelStockAdjustmentRequest,
  useRejectStockAdjustmentRequest,
  useStockAdjustmentRequest,
} from "@/lib/query/stock-adjustment-requests";
import { approveRejectErrorCopy, REASON_LABELS, type ReasonCode } from "@/lib/api/schemas/stock-adjustment-requests";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-[var(--border)] py-[7px] text-[12.5px] last:border-b-0">
      <span className="text-[var(--muted)]">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}

function errLine(error: unknown): { message: string; requestId?: string } {
  if (isApiError(error)) return { message: approveRejectErrorCopy(error.message) || error.userMessage, requestId: error.requestId };
  return { message: error instanceof Error ? error.message : "Something went wrong." };
}

/** Approve / Reject / Cancel for one request, plus the Observed → Requested
 * comparison and inline lifecycle history — no separate /audit lookup
 * needed. Approve gets its own Idempotency-Key, generated fresh per
 * attempt (a single-shot action on an already-persisted record, unlike
 * the multi-step console drafts, so it needs only the key + a
 * disabled-while-pending button, mirroring po-actions.tsx). */
export function StockAdjustmentRequestDetailBody({ id, role, onDone }: { id: number; role: Role; onDone?: () => void }) {
  const { data: request, isLoading, isError, error, refetch } = useStockAdjustmentRequest(id);
  const approve = useApproveStockAdjustmentRequest();
  const reject = useRejectStockAdjustmentRequest();
  const cancel = useCancelStockAdjustmentRequest();

  const [approveOpen, setApproveOpen] = React.useState(false);
  const [rejectOpen, setRejectOpen] = React.useState(false);
  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [rejectReason, setRejectReason] = React.useState("");

  if (isLoading) return <LoadingState label="Loading request…" />;
  if (isError) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (!request) return <EmptyState message="No request selected." />;

  const admin = isAdmin(role);
  const canDecide = admin && request.status === "PENDING";
  // The detail fetch itself is already scoped server-side (owner-or-admin
  // only), so anyone who can see this view is allowed to see the Cancel
  // button; the service re-checks ownership again on the actual call.
  const canCancel = request.status === "PENDING";

  const approveErr = approve.isError ? errLine(approve.error) : null;
  const rejectErr = reject.isError ? errLine(reject.error) : null;
  const cancelErr = cancel.isError ? errLine(cancel.error) : null;

  const runApprove = () =>
    approve.mutate(
      { id: request.id, idempotencyKey: `adjreq-approve-${newId()}` },
      {
        onSuccess: (data) => {
          setApproveOpen(false);
          toast.success(`${data.reference_number ?? "Request"} approved`, {
            description: `${data.product.product_name}: ${data.observed_quantity} → ${data.requested_quantity}.`,
          });
        },
        onError: (e) => {
          const line = errLine(e);
          toast.error("Could not approve this request", {
            description: line.requestId ? `${line.message} · Request ${line.requestId}` : line.message,
          });
        },
      },
    );

  const runReject = () =>
    reject.mutate(
      { id: request.id, rejection_reason: rejectReason },
      {
        onSuccess: () => {
          setRejectOpen(false);
          toast.success(`${request.reference_number ?? "Request"} rejected`);
        },
        onError: (e) => {
          const line = errLine(e);
          toast.error("Could not reject this request", {
            description: line.requestId ? `${line.message} · Request ${line.requestId}` : line.message,
          });
        },
      },
    );

  const runCancel = () =>
    cancel.mutate(
      { id: request.id },
      {
        onSuccess: () => {
          setCancelOpen(false);
          toast.success(`${request.reference_number ?? "Request"} cancelled`);
          onDone?.();
        },
        onError: (e) => {
          const line = errLine(e);
          toast.error("Could not cancel this request", {
            description: line.requestId ? `${line.message} · Request ${line.requestId}` : line.message,
          });
        },
      },
    );

  const diff = Number(request.requested_quantity) - Number(request.observed_quantity);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <StatusBadge status={request.status} />
        {request.reference_number ? <span className="mono text-[12px] text-[var(--muted)]">{request.reference_number}</span> : null}
      </div>

      <div
        className="flex items-center justify-between rounded-[var(--r-sm)] border border-[var(--border)] bg-[var(--sunken)] px-3 py-2 text-[13px]"
        role="status"
      >
        <span className="text-[var(--muted)]">Observed → Requested</span>
        <span className="font-semibold tabular-nums">
          <QuantityDisplay value={request.observed_quantity} />
          {" → "}
          <QuantityDisplay value={request.requested_quantity} />
          <span className={diff < 0 ? "ml-2 text-[var(--danger)]" : "ml-2 text-[var(--success)]"}>
            ({diff > 0 ? "+" : ""}
            {diff.toFixed(3)})
          </span>
        </span>
      </div>

      <section>
        <Row label="Product">
          {request.product.product_name} <span className="mono text-[var(--muted)]">{request.product.sku}</span>
        </Row>
        <Row label="Warehouse / location">
          {request.warehouse.warehouse_code} / {request.location.location_code}
        </Row>
        <Row label="Reason">{REASON_LABELS[request.reason_code as ReasonCode]?.label ?? request.reason_code}</Row>
        {request.notes ? <Row label="Note">{request.notes}</Row> : null}
        <Row label="Requested by">{request.requested_by.username}</Row>
        {request.reviewed_by ? <Row label="Reviewed by">{request.reviewed_by.username}</Row> : null}
        {request.rejection_reason ? <Row label="Rejection reason">{request.rejection_reason}</Row> : null}
      </section>

      {canDecide ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" onClick={() => setApproveOpen(true)}>
            Approve
          </Button>
          <Button variant="danger" onClick={() => setRejectOpen(true)}>
            Reject
          </Button>
        </div>
      ) : null}
      {canCancel ? (
        <Button variant="ghost" className="self-start" onClick={() => setCancelOpen(true)}>
          Cancel request
        </Button>
      ) : null}

      <section>
        <h3 className="wc-section-label mb-1">History</h3>
        <ul className="flex flex-col gap-[6px] text-[12px]">
          {request.history.map((h, i) => (
            <li key={i} className="flex flex-col gap-[1px] border-l-2 border-[var(--border-strong)] pl-2">
              <span className="font-medium">{h.action.replaceAll("_", " ")}</span>
              <span className="text-[var(--muted)]">
                {h.actor} · {new Date(h.at).toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <Dialog open={approveOpen} onOpenChange={setApproveOpen}>
        <DialogContent
          title={`Approve ${request.reference_number ?? "this request"}?`}
          description="This immediately changes the balance for this product. It can't be undone."
        >
          {approveErr ? (
            <p role="alert" className="rounded-[var(--r-sm)] bg-[var(--danger-subtle)] p-2 text-[12px] text-[var(--danger)]">
              {approveErr.message}
              {approveErr.requestId ? (
                <span className="mt-1 block text-[11px] text-[var(--muted)]">
                  Request ID: <span className="mono select-all">{approveErr.requestId}</span>
                </span>
              ) : null}
            </p>
          ) : null}
          <div className="mt-1 flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="ghost">Keep pending</Button>
            </DialogClose>
            <Button variant="primary" onClick={runApprove} disabled={approve.isPending}>
              {approve.isPending ? "Approving…" : "Approve"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent title={`Reject ${request.reference_number ?? "this request"}?`} description="Explain why — this is recorded on the request.">
          <label className="flex flex-col gap-1 text-[12px] text-[var(--muted)]">
            Rejection reason
            <textarea
              className="min-h-20 w-full rounded-[var(--r-sm)] border border-[var(--border-strong)] bg-[var(--surface)] p-2 text-[13px] outline-none focus-visible:outline-2 focus-visible:outline-[var(--focus)]"
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
              <Button variant="ghost">Keep pending</Button>
            </DialogClose>
            <Button variant="danger" onClick={runReject} disabled={reject.isPending || !rejectReason.trim()}>
              {reject.isPending ? "Rejecting…" : "Reject"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent title={`Cancel ${request.reference_number ?? "this request"}?`} description="This can't be undone.">
          {cancelErr ? (
            <p role="alert" className="rounded-[var(--r-sm)] bg-[var(--danger-subtle)] p-2 text-[12px] text-[var(--danger)]">
              {cancelErr.message}
            </p>
          ) : null}
          <div className="mt-1 flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="ghost">Keep request</Button>
            </DialogClose>
            <Button variant="danger" onClick={runCancel} disabled={cancel.isPending}>
              {cancel.isPending ? "Cancelling…" : "Cancel request"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
