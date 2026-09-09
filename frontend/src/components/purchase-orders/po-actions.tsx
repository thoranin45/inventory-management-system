"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { isApiError } from "@/lib/api/errors";
import { isAdmin, isWarehouse, type Role } from "@/lib/auth/permissions";
import { useCancelPurchaseOrder, useConfirmPurchaseOrder } from "@/lib/query/purchase-orders";
import { PO_STATUS_LABEL } from "@/lib/api/schemas/purchase-orders";

const RECEIVABLE = new Set(["CONFIRMED", "PARTIALLY_RECEIVED"]);
const CANCELLABLE = new Set(["DRAFT", "CONFIRMED"]);
const TERMINAL = new Set(["RECEIVED", "CANCELLED"]);

function errLine(error: unknown): { message: string; requestId?: string } {
  if (isApiError(error)) return { message: error.userMessage, requestId: error.requestId };
  return { message: error instanceof Error ? error.message : "Something went wrong." };
}

/**
 * Confirm / Cancel affordances for one Purchase Order, plus a link into the
 * receiving console. Confirm and Cancel are admin-only on the backend
 * (`require_admin`); receiving is warehouse+admin.
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

  const runConfirm = () =>
    confirm.mutate(id, {
      onSuccess: (data) => {
        setConfirmOpen(false);
        toast.success(`${data.po_number ?? poNumber ?? "PO"} confirmed`, {
          description: `Status is now ${PO_STATUS_LABEL[data.status] ?? data.status}.`,
        });
        // keep the drawer open — it re-renders as CONFIRMED with the receiving link
      },
      onError: (error) => {
        const e = errLine(error);
        toast.error("Could not confirm this purchase order", {
          description: e.requestId ? `${e.message} · Request ${e.requestId}` : e.message,
        });
      },
    });

  const runCancel = () =>
    cancel.mutate(id, {
      onSuccess: (data) => {
        setCancelOpen(false);
        toast.success(`${data.po_number ?? poNumber ?? "PO"} cancelled`);
        onDone?.();
      },
      onError: (error) => {
        const e = errLine(error);
        toast.error("Could not cancel this purchase order", {
          description: e.requestId ? `${e.message} · Request ${e.requestId}` : e.message,
        });
      },
    });

  const confirmErr = confirm.isError ? errLine(confirm.error) : null;
  const cancelErr = cancel.isError ? errLine(cancel.error) : null;

  if (!showConfirm && !showCancel && !canReceive) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canReceive ? (
        <Button asChild variant="primary">
          <Link href={`/purchase-orders/${id}/receive`}>Open receiving console</Link>
        </Button>
      ) : null}

      {showConfirm ? (
        <>
          <Button variant={canReceive ? "secondary" : "primary"} onClick={() => setConfirmOpen(true)}>
            Confirm order
          </Button>
          <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <DialogContent
              title={`Confirm ${poNumber ?? "purchase order"}?`}
              description="Confirming makes the order receivable. Line quantities and prices are locked in."
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
            title={cancelDisabled ? "This order can't be cancelled from its current state." : undefined}
          >
            Cancel order
          </Button>
          <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
            <DialogContent
              title={`Cancel ${poNumber ?? "purchase order"}?`}
              description="Only draft or confirmed orders with nothing received can be cancelled. This can't be undone."
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
