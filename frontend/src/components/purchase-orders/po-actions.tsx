"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { ActionError, StockEffect } from "@/components/orders/order-dialog-parts";
import { useStatusLabel } from "@/components/orders/lifecycle-steps";
import { isApiError } from "@/lib/api/errors";
import { isAdmin, isWarehouse, type Role } from "@/lib/auth/permissions";
import { useT } from "@/lib/i18n/client";
import { useCancelPurchaseOrder, useConfirmPurchaseOrder } from "@/lib/query/purchase-orders";

const RECEIVABLE = new Set(["CONFIRMED", "PARTIALLY_RECEIVED"]);
const CANCELLABLE = new Set(["DRAFT", "CONFIRMED"]);
const TERMINAL = new Set(["RECEIVED", "CANCELLED"]);

function errLine(error: unknown, fallback: string): { message: string; requestId?: string } {
  if (isApiError(error)) return { message: error.userMessage, requestId: error.requestId };
  return { message: error instanceof Error ? error.message : fallback };
}

/**
 * Confirm / Cancel affordances for one Purchase Order, plus a link into the
 * receiving console. Confirm and Cancel are admin-only on the backend
 * (`require_admin`); receiving is warehouse+admin. Neither changes stock.
 */
export function PurchaseOrderActions({
  id,
  status,
  poNumber,
  role,
  onDone,
}: {
  id: number;
  status: string;
  poNumber: string | null;
  role: Role;
  onDone?: () => void;
}) {
  const t = useT();
  const statusLabel = useStatusLabel();
  const upper = status.toUpperCase();
  const confirm = useConfirmPurchaseOrder();
  const cancel = useCancelPurchaseOrder();

  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [cancelOpen, setCancelOpen] = React.useState(false);

  const admin = isAdmin(role);
  const canReceive = (admin || isWarehouse(role)) && RECEIVABLE.has(upper);
  const showConfirm = admin && upper === "DRAFT";
  const showCancel = admin && upper !== "CANCELLED" && !TERMINAL.has(upper) && !(upper === "PARTIALLY_RECEIVED");
  const cancelDisabled = !CANCELLABLE.has(upper);

  const fallback = t("sales.somethingWrong");
  const order = (n: string | null | undefined) => n ?? poNumber ?? t("po.po");
  const withRid = (e: { message: string; requestId?: string }) =>
    e.requestId ? `${e.message} · ${t("task.requestRef", { id: e.requestId })}` : e.message;

  const runConfirm = () =>
    confirm.mutate(id, {
      onSuccess: (data) => {
        setConfirmOpen(false);
        toast.success(t("po.confirmedToast", { order: order(data.po_number) }), {
          description: t("sales.statusNow", { status: statusLabel(data.status) }),
        });
        // keep the drawer open — it re-renders as CONFIRMED with the receiving link
      },
      onError: (error) => {
        toast.error(t("po.confirmFailed"), { description: withRid(errLine(error, fallback)) });
      },
    });

  const runCancel = () =>
    cancel.mutate(id, {
      onSuccess: (data) => {
        setCancelOpen(false);
        toast.success(t("po.cancelledToast", { order: order(data.po_number) }));
        onDone?.();
      },
      onError: (error) => {
        toast.error(t("po.cancelFailed"), { description: withRid(errLine(error, fallback)) });
      },
    });

  const confirmErr = confirm.isError ? errLine(confirm.error, fallback) : null;
  const cancelErr = cancel.isError ? errLine(cancel.error, fallback) : null;
  const target = poNumber ?? t("po.purchaseOrderLower");

  if (!showConfirm && !showCancel && !canReceive) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canReceive ? (
        <Button asChild variant="primary">
          <Link href={`/purchase-orders/${id}/receive`}>{t("po.openReceiving")}</Link>
        </Button>
      ) : null}

      {showConfirm ? (
        <>
          <Button variant={canReceive ? "secondary" : "primary"} onClick={() => setConfirmOpen(true)}>
            {t("sales.confirmOrder")}
          </Button>
          <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <DialogContent title={t("sales.confirmTitle", { order: target })} description={t("po.confirmDescription")}>
              <StockEffect kind="none" />
              {confirmErr ? <ActionError message={confirmErr.message} requestId={confirmErr.requestId} className="mt-2" /> : null}
              <div className="mt-2 flex flex-wrap justify-end gap-2">
                <DialogClose asChild>
                  <Button variant="ghost">{t("sales.keepDraft")}</Button>
                </DialogClose>
                <Button variant="primary" onClick={runConfirm} disabled={confirm.isPending}>
                  {confirm.isPending ? t("sales.confirming") : t("sales.confirmOrder")}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </>
      ) : null}

      {showCancel ? (
        <>
          <Button
            variant="danger"
            onClick={() => setCancelOpen(true)}
            disabled={cancelDisabled}
            title={cancelDisabled ? t("sales.cannotCancelState") : undefined}
          >
            {t("sales.cancelOrder")}
          </Button>
          <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
            <DialogContent title={t("sales.cancelTitle", { order: target })} description={t("po.cancelDescription")}>
              <StockEffect kind="none" />
              {cancelErr ? <ActionError message={cancelErr.message} requestId={cancelErr.requestId} className="mt-2" /> : null}
              <div className="mt-2 flex flex-wrap justify-end gap-2">
                <DialogClose asChild>
                  <Button variant="ghost">{t("sales.keepOrder")}</Button>
                </DialogClose>
                <Button variant="danger" onClick={runCancel} disabled={cancel.isPending}>
                  {cancel.isPending ? t("sales.cancelling") : t("sales.cancelOrder")}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </>
      ) : null}
    </div>
  );
}
