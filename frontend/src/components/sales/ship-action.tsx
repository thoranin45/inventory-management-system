"use client";

import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { ActionError, StockEffect } from "@/components/orders/order-dialog-parts";
import { useOrderCopy } from "@/components/orders/use-order-copy";
import { isApiError } from "@/lib/api/errors";
import { isAdmin, isWarehouse, type Role } from "@/lib/auth/permissions";
import { useT } from "@/lib/i18n/client";
import { shipErrorMessage } from "@/lib/order-copy";
import { useShipSalesOrder } from "@/lib/query/sales";
import { SHIP_STARTABLE_STATUS } from "@/lib/api/schemas/sales";

/**
 * Ship action for a READY_TO_SHIP order. `POST /sales-orders/{id}/ship` takes
 * no body — the backend generates the shipment number. The order is never
 * shown as shipped until the backend confirms. R5: the dialog states the
 * verified stock effect (on hand and reservation both deducted).
 */
export function ShipAction({
  id,
  status,
  soNumber,
  role,
  onShipped,
  variant = "primary",
}: {
  id: number;
  status: string;
  soNumber: string | null;
  role: Role;
  onShipped?: (shipmentNumber: string | null | undefined) => void;
  variant?: "primary" | "accent";
}) {
  const t = useT();
  const copy = useOrderCopy();
  const ship = useShipSalesOrder();
  const [open, setOpen] = React.useState(false);

  const canRole = isAdmin(role) || isWarehouse(role);
  if (!canRole || status.toUpperCase() !== SHIP_STARTABLE_STATUS) return null;

  const errorText = (message: string, userMessage: string) => {
    const m = shipErrorMessage(message);
    return m ? copy(m) : userMessage;
  };
  const err = ship.isError && isApiError(ship.error) ? ship.error : null;
  const errCopy = err ? errorText(err.message, err.userMessage) : null;

  const run = () =>
    ship.mutate(id, {
      onSuccess: (data) => {
        setOpen(false);
        toast.success(t("sales.shippedToast", { order: data.so_number ?? soNumber ?? t("sales.order") }), {
          description: data.shipment_number ? t("sales.shipmentRef", { number: data.shipment_number }) : t("sales.statusShipped"),
        });
        onShipped?.(data.shipment_number);
      },
      onError: (error) => {
        const msg = isApiError(error) ? errorText(error.message, error.userMessage) : t("sales.shipFailedFallback");
        const rid = isApiError(error) ? error.requestId : undefined;
        toast.error(t("sales.shipFailed"), { description: rid ? `${msg} · ${t("task.requestRef", { id: rid })}` : msg });
      },
    });

  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        {t("sales.shipOrder")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={t("sales.shipTitle", { order: soNumber ?? t("sales.thisOrder") })} description={t("sales.shipDescription")}>
          <StockEffect kind="deduct" />
          {errCopy ? <ActionError message={errCopy} requestId={err?.requestId} className="mt-2" /> : null}
          <div className="mt-2 flex flex-wrap justify-end gap-2">
            <DialogClose asChild>
              <Button variant="ghost">{t("sales.notYet")}</Button>
            </DialogClose>
            <Button variant="primary" onClick={run} disabled={ship.isPending}>
              {ship.isPending ? t("sales.shipping") : t("sales.shipOrder")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
