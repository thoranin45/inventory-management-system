"use client";

import * as React from "react";
import { FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { PrintPreview } from "@/components/work/print-preview";
import { isApiError } from "@/lib/api/errors";
import { useT } from "@/lib/i18n/client";
import { openInvoice } from "@/lib/query/sales";

/**
 * Shipping document block: the backend's packing-slip + shipping-label data
 * (read-only preview) and the invoice PDF (unchanged binary download). No
 * template engine, no print centre — everything comes from existing endpoints.
 */
export function SalesDocuments({ orderId, enabled = true }: { orderId: number; enabled?: boolean }) {
  const t = useT();
  const [busy, setBusy] = React.useState(false);

  const invoice = async () => {
    setBusy(true);
    try {
      const { opened } = await openInvoice(orderId);
      if (!opened) toast.message(t("sales.popupBlocked"), { description: t("sales.popupBlockedHint") });
    } catch (error) {
      const msg = isApiError(error) ? error.userMessage : t("sales.invoiceGenerateFailed");
      const rid = isApiError(error) ? error.requestId : undefined;
      toast.error(t("sales.invoiceFailed"), { description: rid ? `${msg} · ${t("task.requestRef", { id: rid })}` : msg });
    } finally {
      setBusy(false);
    }
  };

  if (!enabled) return null;

  return (
    <div className="flex flex-col gap-3">
      <Button variant="secondary" className="self-start" onClick={invoice} disabled={busy}>
        {busy ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : <FileText aria-hidden className="h-4 w-4" />}
        {busy ? t("sales.preparing") : t("sales.openInvoice")}
      </Button>
      <PrintPreview orderId={orderId} enabled={enabled} />
    </div>
  );
}
