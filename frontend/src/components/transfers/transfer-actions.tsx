"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { isApiError } from "@/lib/api/errors";
import { useCancelTransfer, useDispatchTransfer } from "@/lib/query/transfers";
import {
  EXPIRED_BATCH_DISPATCH_RE,
  RECEIVABLE_TRANSFER_STATUSES,
  TRANSFER_ERROR_COPY,
  TRANSFER_STATUS_LABEL,
} from "@/lib/api/schemas/transfers";

function errLine(error: unknown): { message: string; requestId?: string } {
  if (isApiError(error)) {
    const raw = error.message;
    const copy = TRANSFER_ERROR_COPY[raw] ?? (EXPIRED_BATCH_DISPATCH_RE.test(raw) ? `${raw} — pick an in-date batch.` : error.userMessage);
    return { message: copy, requestId: error.requestId };
  }
  return { message: error instanceof Error ? error.message : "Something went wrong." };
}

/**
 * Dispatch / Cancel affordances for one transfer, plus a link into the
 * receiving console. There is deliberately NO "Complete" action — the retired
 * /complete endpoint is never called; COMPLETED happens when every line is
 * fully received.
 */
export function TransferActions({
  id,
  status,
  transferNumber,
  legacyCompleted,
  onDone,
}: {
  id: number;
  status: string;
  transferNumber: string;
  legacyCompleted?: boolean;
  onDone?: () => void;
}) {
  const upper = status.toUpperCase();
  const dispatch = useDispatchTransfer();
  const cancel = useCancelTransfer();

  const [dispatchOpen, setDispatchOpen] = React.useState(false);
  const [cancelOpen, setCancelOpen] = React.useState(false);

  if (legacyCompleted) return null;

  const showDispatch = upper === "DRAFT";
  const showCancel = upper === "DRAFT"; // Cancel disappears once dispatched
  const canReceive = (RECEIVABLE_TRANSFER_STATUSES as readonly string[]).includes(upper);

  if (!showDispatch && !showCancel && !canReceive) return null;

  const runDispatch = () =>
    dispatch.mutate(id, {
      onSuccess: (data) => {
        setDispatchOpen(false);
        toast.success(`${transferNumber} dispatched`, {
          description: `Status is now ${TRANSFER_STATUS_LABEL[data.status] ?? data.status} — every line moved into transit.`,
        });
        // keep the drawer open — it re-renders as IN_TRANSIT with the receiving link
      },
      onError: (error) => {
        const e = errLine(error);
        toast.error("Could not dispatch this transfer", {
          description: e.requestId ? `${e.message} · Request ${e.requestId}` : e.message,
        });
      },
    });

  const runCancel = () =>
    cancel.mutate(id, {
      onSuccess: () => {
        setCancelOpen(false);
        toast.success(`${transferNumber} cancelled`);
        onDone?.();
      },
      onError: (error) => {
        const e = errLine(error);
        toast.error("Could not cancel this transfer", {
          description: e.requestId ? `${e.message} · Request ${e.requestId}` : e.message,
        });
      },
    });

  const dispatchErr = dispatch.isError ? errLine(dispatch.error) : null;
  const cancelErr = cancel.isError ? errLine(cancel.error) : null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canReceive ? (
        <Button asChild variant="primary">
          <Link href={`/transfers/${id}/receive`}>Open receiving console</Link>
        </Button>
      ) : null}

      {showDispatch ? (
        <>
          <Button variant="primary" onClick={() => setDispatchOpen(true)}>
            Dispatch
          </Button>
          <Dialog open={dispatchOpen} onOpenChange={setDispatchOpen}>
            <DialogContent
              title={`Dispatch ${transferNumber}?`}
              description="This dispatch moves every transfer line from the source into system transit. Dispatch is all-or-nothing — you can't dispatch part of a transfer."
            >
              {dispatchErr ? (
                <p role="alert" className="rounded-[var(--r-sm)] bg-[var(--danger-subtle)] p-2 text-[12px] text-[var(--danger)]">
                  {dispatchErr.message}
                  {dispatchErr.requestId ? (
                    <span className="mt-1 block text-[11px] text-[var(--muted)]">
                      Request ID: <span className="mono select-all">{dispatchErr.requestId}</span>
                    </span>
                  ) : null}
                </p>
              ) : null}
              <div className="mt-1 flex justify-end gap-2">
                <DialogClose asChild>
                  <Button variant="ghost">Keep as draft</Button>
                </DialogClose>
                <Button variant="primary" onClick={runDispatch} disabled={dispatch.isPending}>
                  {dispatch.isPending ? "Dispatching…" : "Dispatch all lines"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </>
      ) : null}

      {showCancel ? (
        <>
          <Button variant="danger" onClick={() => setCancelOpen(true)}>
            Cancel transfer
          </Button>
          <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
            <DialogContent
              title={`Cancel ${transferNumber}?`}
              description="Only a draft transfer with nothing dispatched can be cancelled. This can't be undone."
            >
              {cancelErr ? (
                <p role="alert" className="rounded-[var(--r-sm)] bg-[var(--danger-subtle)] p-2 text-[12px] text-[var(--danger)]">
                  {cancelErr.message}
                  {cancelErr.requestId ? (
                    <span className="mt-1 block text-[11px] text-[var(--muted)]">
                      Request ID: <span className="mono select-all">{cancelErr.requestId}</span>
                    </span>
                  ) : null}
                </p>
              ) : null}
              <div className="mt-1 flex justify-end gap-2">
                <DialogClose asChild>
                  <Button variant="ghost">Keep transfer</Button>
                </DialogClose>
                <Button variant="danger" onClick={runCancel} disabled={cancel.isPending}>
                  {cancel.isPending ? "Cancelling…" : "Cancel transfer"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </>
      ) : null}
    </div>
  );
}
