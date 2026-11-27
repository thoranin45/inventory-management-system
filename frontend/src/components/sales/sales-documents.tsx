"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, ReceiptText } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { PrintPreview } from "@/components/work/print-preview";
import { isApiError } from "@/lib/api/errors";
import { useT } from "@/lib/i18n/client";
import { useCreateInvoiceFromOrder } from "@/lib/query/invoices";

/**
 * Shipping document block: the backend's packing-slip + shipping-label data
 * (read-only preview). F2b: the old on-the-fly SO invoice PDF is replaced by a
 * real invoice document: "Create invoice" (Admin, SHIPPED/COMPLETED) creates a
 * DRAFT, or returns the order's existing invoice, and opens it.
 */
export function SalesDocuments({
  orderId,
  status = "",
  canInvoice = false,
  enabled = true,
}: {
  orderId: number;
  status?: string;
  canInvoice?: boolean;
  enabled?: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const create = useCreateInvoiceFromOrder();
  const invoiceable = canInvoice && ["SHIPPED", "COMPLETED"].includes(status.toUpperCase());

  const run = () =>
    create.mutate(orderId, {
      onSuccess: (invoice) => {
        toast.success(invoice.invoice_created === false ? t("invoices.existsToast") : t("invoices.createdToast"));
        router.push(`/invoices?open=${invoice.id}`);
      },
      onError: (error) => {
        const msg = isApiError(error) ? error.userMessage : t("sales.somethingWrong");
        const rid = isApiError(error) ? error.requestId : undefined;
        toast.error(t("invoices.createFailed"), { description: rid ? `${msg} · ${t("task.requestRef", { id: rid })}` : msg });
      },
    });

  if (!enabled) return null;

  return (
    <div className="flex flex-col gap-3">
      {invoiceable ? (
        <Button variant="secondary" className="self-start" onClick={run} disabled={create.isPending}>
          {create.isPending ? (
            <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
          ) : (
            <ReceiptText aria-hidden className="h-4 w-4" />
          )}
          {create.isPending ? t("sales.preparing") : t("invoices.createFromOrder")}
        </Button>
      ) : null}
      <PrintPreview orderId={orderId} enabled={enabled} />
    </div>
  );
}
