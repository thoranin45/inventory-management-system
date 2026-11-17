"use client";

import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { ActionError, StockEffect } from "@/components/orders/order-dialog-parts";
import { useStatusLabel } from "@/components/orders/lifecycle-steps";
import { isApiError } from "@/lib/api/errors";
import { isAdmin, isWarehouse, type Role } from "@/lib/auth/permissions";
import { useT } from "@/lib/i18n/client";
import { useCancelSalesOrder, useConfirmSalesOrder } from "@/lib/query/sales";
import { RETURNABLE_STATUSES } from "@/lib/api/schemas/sales";
import { ShipAction } from "./ship-action";
import { CompleteAction } from "./complete-action";
import { ReturnDrawer } from "./return-form";

const CANCELLABLE = new Set(["DRAFT", "CONFIRMED", "PICKING", "PACKING", "READY_TO_SHIP"]);
const TERMINAL = new Set(["SHIPPED", "COMPLETED", "CANCELLED"]);

function errLine(error: unknown, fallback: string): { message: string; requestId?: string } {
  if (isApiError(error)) return { message: error.userMessage, requestId: error.requestId };
  return { message: error instanceof Error ? error.message : fallback };
}

/**
 * Confirm / Cancel affordances for one Sales Order. Both go through the
 * central mutation layer (TanStack `useMutation`) — never a raw fetch from a
 * click handler — and both open a confirmation Dialog first. Backend stays
 * the authority; a rejected transition surfaces its typed reason + request ID.
 * R5: each dialog states its verified stock effect (D-R5-2).
 */
export function SalesActions({
  id,
  status,
  soNumber,
  role,
  onDone,
}: {
  id: number;
  status: string;
  soNumber: string | null;
  role: Role;
  onDone?: () => void;
}) {
  const t = useT();
  const statusLabel = useStatusLabel();
  const upper = status.toUpperCase();
  const confirm = useConfirmSalesOrder();
  const cancel = useCancelSalesOrder();

  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [returnOpen, setReturnOpen] = React.useState(false);

  const showConfirm = isAdmin(role) && upper === "DRAFT";
  const canCancelRole = isAdmin(role) || isWarehouse(role);
  const showCancel = canCancelRole && upper !== "CANCELLED";
  const cancelDisabled = !CANCELLABLE.has(upper);
  const canReturn = (isAdmin(role) || isWarehouse(role)) && (RETURNABLE_STATUSES as readonly string[]).includes(upper);
  const showShip = (isAdmin(role) || isWarehouse(role)) && upper === "READY_TO_SHIP";
  const showComplete = isAdmin(role) && upper === "SHIPPED";

  if (!showConfirm && !showCancel && !canReturn && !showShip && !showComplete) return null;

  const fallback = t("sales.somethingWrong");
  const order = (n: string | null | undefined) => n ?? soNumber ?? t("sales.order");
  const withRid = (e: { message: string; requestId?: string }) =>
    e.requestId ? `${e.message} · ${t("task.requestRef", { id: e.requestId })}` : e.message;

  const runConfirm = () => {
    confirm.mutate(id, {
      onSuccess: (data) => {
        setConfirmOpen(false);
        toast.success(t("sales.confirmedToast", { order: order(data.so_number) }), {
          description: t("sales.statusNow", { status: statusLabel(data.status) }),
        });
        onDone?.();
      },
      onError: (error) => {
        toast.error(t("sales.confirmFailed"), { description: withRid(errLine(error, fallback)) });
      },
    });
  };

  const runCancel = () => {
    cancel.mutate(id, {
      onSuccess: (data) => {
        setCancelOpen(false);
        toast.success(t("sales.cancelledToast", { order: order(data.so_number) }));
        onDone?.();
      },
      onError: (error) => {
        toast.error(t("sales.cancelFailed"), { description: withRid(errLine(error, fallback)) });
      },
    });
  };

  const confirmErr = confirm.isError ? errLine(confirm.error, fallback) : null;
  const cancelErr = cancel.isError ? errLine(cancel.error, fallback) : null;
  const target = soNumber ?? t("sales.salesOrderLower");

  return (
    <div className="flex flex-wrap items-center gap-2">
      {showShip ? (
        <ShipAction id={id} status={status} soNumber={soNumber} role={role} onShipped={() => onDone?.()} />
      ) : null}

      {showComplete ? <CompleteAction id={id} status={status} soNumber={soNumber} role={role} onDone={onDone} /> : null}

      {canReturn ? (
        <>
          <Button variant="secondary" onClick={() => setReturnOpen(true)}>
            {t("sales.returnItems")}
          </Button>
          <ReturnDrawer id={id} soNumber={soNumber} open={returnOpen} onOpenChange={setReturnOpen} />
        </>
      ) : null}

      {showConfirm ? (
        <>
          <Button variant="primary" onClick={() => setConfirmOpen(true)}>
            {t("sales.confirmOrder")}
          </Button>
          <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <DialogContent title={t("sales.confirmTitle", { order: target })} description={t("sales.confirmDescription")}>
              <StockEffect kind="reserve" />
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
            title={
              cancelDisabled
                ? TERMINAL.has(upper)
                  ? t("sales.cannotCancelTerminal", { status: statusLabel(upper) })
                  : t("sales.cannotCancelState")
                : undefined
            }
          >
            {t("sales.cancelOrder")}
          </Button>
          <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
            <DialogContent title={t("sales.cancelTitle", { order: target })} description={t("sales.cancelDescription")}>
              <StockEffect kind="release" />
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
