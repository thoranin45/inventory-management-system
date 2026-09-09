"use client";

import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { isApiError } from "@/lib/api/errors";
import { isAdmin, type Role } from "@/lib/auth/permissions";
import { useCompleteSalesOrder } from "@/lib/query/sales";
import { COMPLETE_STARTABLE_STATUS, shipErrorCopy } from "@/lib/api/schemas/sales";

/**
 * Complete action — `POST /sales-orders/{id}/complete`, **admin only**,
 * SHIPPED → COMPLETED (terminal). No body. The frontend never skips SHIPPED:
 * the button only appears for a SHIPPED order and an admin.
 */
export function CompleteAction({
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
  const complete = useCompleteSalesOrder();
  const [open, setOpen] = React.useState(false);

  if (!isAdmin(role) || status.toUpperCase() !== COMPLETE_STARTABLE_STATUS) return null;

  const err = complete.isError && isApiError(complete.error) ? complete.error : null;
  const errCopy = err ? (shipErrorCopy(err.message) ?? err.userMessage) : null;

  const run = () =>
    complete.mutate(id, {
      onSuccess: (data) => {
        setOpen(false);
        toast.success(`${data.so_number ?? soNumber ?? "Order"} completed`);
        onDone?.();
      },
      onError: (error) => {
        const msg = isApiError(error) ? (shipErrorCopy(error.message) ?? error.userMessage) : "Could not complete this order.";
        const rid = isApiError(error) ? error.requestId : undefined;
        toast.error("Could not complete this order", { description: rid ? `${msg} · Request ${rid}` : msg });
      },
    });

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Complete order
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          title={`Complete ${soNumber ?? "this order"}?`}
          description="This marks the internal order lifecycle complete. It does not imply payment settlement or courier delivery — the system does not model those. COMPLETED is final."
        >
          {errCopy ? (
            <p role="alert" className="rounded-[var(--r-sm)] bg-[var(--danger-subtle)] p-2 text-[12px] text-[var(--danger)]">
              {errCopy}
              {err?.requestId ? (
                <span className="mt-1 block text-[11px] text-[var(--muted)]">
                  Request ID: <span className="mono select-all">{err.requestId}</span>
                </span>
              ) : null}
            </p>
          ) : null}
          <div className="mt-1 flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="ghost">Keep as shipped</Button>
            </DialogClose>
            <Button variant="primary" onClick={run} disabled={complete.isPending}>
              {complete.isPending ? "Completing…" : "Complete order"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
