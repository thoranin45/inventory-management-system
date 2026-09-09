"use client";

import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { isApiError } from "@/lib/api/errors";
import { isAdmin, isWarehouse, type Role } from "@/lib/auth/permissions";
import { useShipSalesOrder } from "@/lib/query/sales";
import { shipErrorCopy, SHIP_STARTABLE_STATUS } from "@/lib/api/schemas/sales";

/**
 * Ship action for a READY_TO_SHIP order. `POST /sales-orders/{id}/ship` takes
 * no body — the backend generates the shipment number. The order is never
 * shown as shipped until the backend confirms.
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
  const ship = useShipSalesOrder();
  const [open, setOpen] = React.useState(false);

  const canRole = isAdmin(role) || isWarehouse(role);
  if (!canRole || status.toUpperCase() !== SHIP_STARTABLE_STATUS) return null;

  const err = ship.isError && isApiError(ship.error) ? ship.error : null;
  const errCopy = err ? (shipErrorCopy(err.message) ?? err.userMessage) : null;

  const run = () =>
    ship.mutate(id, {
      onSuccess: (data) => {
        setOpen(false);
        toast.success(`${data.so_number ?? soNumber ?? "Order"} shipped`, {
          description: data.shipment_number ? `Shipment ${data.shipment_number}` : "Status is now Shipped.",
        });
        onShipped?.(data.shipment_number);
      },
      onError: (error) => {
        const msg = isApiError(error) ? (shipErrorCopy(error.message) ?? error.userMessage) : "Could not ship this order.";
        const rid = isApiError(error) ? error.requestId : undefined;
        toast.error("Could not ship this order", { description: rid ? `${msg} · Request ${rid}` : msg });
      },
    });

  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        Ship order
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          title={`Ship ${soNumber ?? "this order"}?`}
          description="Every allocated line must be fully picked and packed. Shipping decrements on-hand and reserved stock and records a shipment number. It does not contact a courier or imply delivery."
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
              <Button variant="ghost">Not yet</Button>
            </DialogClose>
            <Button variant="primary" onClick={run} disabled={ship.isPending}>
              {ship.isPending ? "Shipping…" : "Ship order"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
