"use client";

import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { isApiError } from "@/lib/api/errors";
import { isAdmin, isWarehouse, type Role } from "@/lib/auth/permissions";
import { useCancelSalesOrder, useConfirmSalesOrder } from "@/lib/query/sales";
import { RETURNABLE_STATUSES, SO_STATUS_LABEL } from "@/lib/api/schemas/sales";
import { ShipAction } from "./ship-action";
import { CompleteAction } from "./complete-action";
import { ReturnDrawer } from "./return-form";

const CANCELLABLE = new Set(["DRAFT", "CONFIRMED", "PICKING", "PACKING", "READY_TO_SHIP"]);
const TERMINAL = new Set(["SHIPPED", "COMPLETED", "CANCELLED"]);

function errLine(error: unknown): { message: string; requestId?: string } {
  if (isApiError(error)) return { message: error.userMessage, requestId: error.requestId };
  return { message: error instanceof Error ? error.message : "Something went wrong." };
}

/**
 * Confirm / Cancel affordances for one Sales Order. Both go through the
 * central mutation layer (TanStack `useMutation`) — never a raw fetch from a
 * click handler — and both open a confirmation Dialog first. Backend stays
 * the authority; a rejected transition surfaces its typed reason + request ID.
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

  const runConfirm = () => {
    confirm.mutate(id, {
      onSuccess: (data) => {
        setConfirmOpen(false);
        toast.success(`${data.so_number ?? soNumber ?? "Order"} confirmed`, {
          description: `Status is now ${SO_STATUS_LABEL[data.status] ?? data.status}.`,
        });
        onDone?.();
      },
      onError: (error) => {
        const e = errLine(error);
        toast.error("Could not confirm this order", {
          description: e.requestId ? `${e.message} · Request ${e.requestId}` : e.message,
        });
      },
    });
  };

  const runCancel = () => {
    cancel.mutate(id, {
      onSuccess: (data) => {
        setCancelOpen(false);
        toast.success(`${data.so_number ?? soNumber ?? "Order"} cancelled`);
        onDone?.();
      },
      onError: (error) => {
        const e = errLine(error);
        toast.error("Could not cancel this order", {
          description: e.requestId ? `${e.message} · Request ${e.requestId}` : e.message,
        });
      },
    });
  };

  const confirmErr = confirm.isError ? errLine(confirm.error) : null;
  const cancelErr = cancel.isError ? errLine(cancel.error) : null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {showShip ? (
        <ShipAction id={id} status={status} soNumber={soNumber} role={role} onShipped={() => onDone?.()} />
      ) : null}

      {showComplete ? (
        <CompleteAction id={id} status={status} soNumber={soNumber} role={role} onDone={onDone} />
      ) : null}

      {canReturn ? (
        <>
          <Button variant="secondary" onClick={() => setReturnOpen(true)}>
            Return items
          </Button>
          <ReturnDrawer id={id} soNumber={soNumber} open={returnOpen} onOpenChange={setReturnOpen} />
        </>
      ) : null}

      {showConfirm ? (
        <>
          <Button variant="primary" onClick={() => setConfirmOpen(true)}>
            Confirm order
          </Button>
          <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <DialogContent
              title={`Confirm ${soNumber ?? "sales order"}?`}
              description="The backend allocates stock against this order on confirmation. Insufficient or expired stock will block it — no allocation is chosen in the frontend."
            >
              {confirmErr ? (
                <p role="alert" className="rounded-[var(--r-sm)] bg-[var(--danger-subtle)] p-2 text-[12px] text-[var(--danger)]">
                  {confirmErr.message}
                  {confirmErr.requestId ? (
                    <span className="mt-1 block text-[11px] text-[var(--muted)]">
                      Request ID: <span className="mono select-all">{confirmErr.requestId}</span>
                    </span>
                  ) : null}
                </p>
              ) : null}
              <div className="mt-1 flex justify-end gap-2">
                <DialogClose asChild>
                  <Button variant="ghost">Keep as draft</Button>
                </DialogClose>
                <Button variant="primary" onClick={runConfirm} disabled={confirm.isPending}>
                  {confirm.isPending ? "Confirming…" : "Confirm order"}
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
                  ? `${SO_STATUS_LABEL[upper] ?? upper} orders can no longer be cancelled.`
                  : "This order can't be cancelled from its current state."
                : undefined
            }
          >
            Cancel order
          </Button>
          <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
            <DialogContent
              title={`Cancel ${soNumber ?? "sales order"}?`}
              description="Any stock the backend allocated to this order is released. This can't be undone."
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
                  <Button variant="ghost">Keep order</Button>
                </DialogClose>
                <Button variant="danger" onClick={runCancel} disabled={cancel.isPending}>
                  {cancel.isPending ? "Cancelling…" : "Cancel order"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </>
      ) : null}
    </div>
  );
}
