"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { isApiError } from "@/lib/api/errors";
import { useCancelTransfer, useDispatchTransfer } from "@/lib/query/transfers";
import { RECEIVABLE_TRANSFER_STATUSES, TRANSFER_STATUS_LABEL } from "@/lib/api/schemas/transfers";
import { useT } from "@/lib/i18n/client";
import type { MessageKey, MessageVars } from "@/lib/i18n/translate";
import { statusText } from "@/lib/reports/report-copy";
import { transferErrorText } from "@/lib/transfer-copy";

function errLine(t: (k: MessageKey, v?: MessageVars) => string, error: unknown): { message: string; requestId?: string } {
  if (isApiError(error)) {
    return { message: transferErrorText(t, error.message, error.userMessage), requestId: error.requestId };
  }
  return { message: error instanceof Error ? error.message : t("common.somethingWrong") };
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
  const t = useT();
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
        toast.success(t("transfers.dispatchedToast", { number: transferNumber }), {
          description: t("transfers.dispatchedDesc", { status: statusText(t, data.status, TRANSFER_STATUS_LABEL) }),
        });
        // keep the drawer open — it re-renders as IN_TRANSIT with the receiving link
      },
      onError: (error) => {
        const e = errLine(t, error);
        toast.error(t("transfers.dispatchFailed"), {
          description: e.requestId ? t("reports.requestSuffix", { message: e.message, id: e.requestId }) : e.message,
        });
      },
    });

  const runCancel = () =>
    cancel.mutate(id, {
      onSuccess: () => {
        setCancelOpen(false);
        toast.success(t("transfers.cancelledToast", { number: transferNumber }));
        onDone?.();
      },
      onError: (error) => {
        const e = errLine(t, error);
        toast.error(t("transfers.cancelFailed"), {
          description: e.requestId ? t("reports.requestSuffix", { message: e.message, id: e.requestId }) : e.message,
        });
      },
    });

  const dispatchErr = dispatch.isError ? errLine(t, dispatch.error) : null;
  const cancelErr = cancel.isError ? errLine(t, cancel.error) : null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canReceive ? (
        <Button asChild variant="primary">
          <Link href={`/transfers/${id}/receive`}>{t("transfers.openReceiving")}</Link>
        </Button>
      ) : null}

      {showDispatch ? (
        <>
          <Button variant="primary" onClick={() => setDispatchOpen(true)}>
            {t("transfers.dispatch")}
          </Button>
          <Dialog open={dispatchOpen} onOpenChange={setDispatchOpen}>
            <DialogContent
              title={t("transfers.dispatchTitle", { number: transferNumber })}
              description={t("transfers.dispatchBody")}
            >
              {dispatchErr ? (
                <p role="alert" className="rounded-[var(--r-sm)] bg-[var(--danger-subtle)] p-2 text-[12px] text-[var(--danger)]">
                  {dispatchErr.message}
                  {dispatchErr.requestId ? (
                    <span className="mt-1 block text-[11px] text-[var(--muted)]">
                      {t("common.requestId")} <span className="mono select-all">{dispatchErr.requestId}</span>
                    </span>
                  ) : null}
                </p>
              ) : null}
              <div className="mt-1 flex justify-end gap-2">
                <DialogClose asChild>
                  <Button variant="ghost">{t("transfers.keepDraft")}</Button>
                </DialogClose>
                <Button variant="primary" onClick={runDispatch} disabled={dispatch.isPending}>
                  {dispatch.isPending ? t("transfers.dispatching") : t("transfers.dispatchAll")}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </>
      ) : null}

      {showCancel ? (
        <>
          <Button variant="danger" onClick={() => setCancelOpen(true)}>
            {t("transfers.cancelTransfer")}
          </Button>
          <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
            <DialogContent
              title={t("transfers.cancelTitle", { number: transferNumber })}
              description={t("transfers.cancelBody")}
            >
              {cancelErr ? (
                <p role="alert" className="rounded-[var(--r-sm)] bg-[var(--danger-subtle)] p-2 text-[12px] text-[var(--danger)]">
                  {cancelErr.message}
                  {cancelErr.requestId ? (
                    <span className="mt-1 block text-[11px] text-[var(--muted)]">
                      {t("common.requestId")} <span className="mono select-all">{cancelErr.requestId}</span>
                    </span>
                  ) : null}
                </p>
              ) : null}
              <div className="mt-1 flex justify-end gap-2">
                <DialogClose asChild>
                  <Button variant="ghost">{t("transfers.keepTransfer")}</Button>
                </DialogClose>
                <Button variant="danger" onClick={runCancel} disabled={cancel.isPending}>
                  {cancel.isPending ? t("transfers.cancelling") : t("transfers.cancelTransfer")}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </>
      ) : null}
    </div>
  );
}
