"use client";

import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { ActionError, StockEffect } from "@/components/orders/order-dialog-parts";
import { useOrderCopy } from "@/components/orders/use-order-copy";
import { isApiError } from "@/lib/api/errors";
import { isAdmin, type Role } from "@/lib/auth/permissions";
import { useT } from "@/lib/i18n/client";
import { shipErrorMessage } from "@/lib/order-copy";
import { useCompleteSalesOrder } from "@/lib/query/sales";
import { COMPLETE_STARTABLE_STATUS } from "@/lib/api/schemas/sales";

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
  const t = useT();
  const copy = useOrderCopy();
  const complete = useCompleteSalesOrder();
  const [open, setOpen] = React.useState(false);

  if (!isAdmin(role) || status.toUpperCase() !== COMPLETE_STARTABLE_STATUS) return null;

  const errorText = (message: string, userMessage: string) => {
    const m = shipErrorMessage(message);
    return m ? copy(m) : userMessage;
  };
  const err = complete.isError && isApiError(complete.error) ? complete.error : null;
  const errCopy = err ? errorText(err.message, err.userMessage) : null;

  const run = () =>
    complete.mutate(id, {
      onSuccess: (data) => {
        setOpen(false);
        toast.success(t("sales.completedToast", { order: data.so_number ?? soNumber ?? t("sales.order") }));
        onDone?.();
      },
      onError: (error) => {
        const msg = isApiError(error) ? errorText(error.message, error.userMessage) : t("sales.completeFailedFallback");
        const rid = isApiError(error) ? error.requestId : undefined;
        toast.error(t("sales.completeFailed"), { description: rid ? `${msg} · ${t("task.requestRef", { id: rid })}` : msg });
      },
    });

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        {t("sales.completeOrder")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          title={t("sales.completeTitle", { order: soNumber ?? t("sales.thisOrder") })}
          description={t("sales.completeDescription")}
        >
          <StockEffect kind="none" />
          {errCopy ? <ActionError message={errCopy} requestId={err?.requestId} className="mt-2" /> : null}
          <div className="mt-2 flex flex-wrap justify-end gap-2">
            <DialogClose asChild>
              <Button variant="ghost">{t("sales.keepShipped")}</Button>
            </DialogClose>
            <Button variant="primary" onClick={run} disabled={complete.isPending}>
              {complete.isPending ? t("sales.completing") : t("sales.completeOrder")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
