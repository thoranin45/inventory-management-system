"use client";

import * as React from "react";
import { FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { PrintPreview } from "@/components/work/print-preview";
import { isApiError } from "@/lib/api/errors";
import { openInvoice } from "@/lib/query/sales";

/**
 * Shipping document block: the backend's packing-slip + shipping-label JSON
 * (read-only preview) and the invoice PDF. No template engine, no Print
 * Centre — everything comes from existing endpoints via the shared binary
 * helper. On mobile this sits below the primary Ship action.
 */
export function SalesDocuments({ orderId, enabled = true }: { orderId: number; enabled?: boolean }) {
  const [busy, setBusy] = React.useState(false);

  const invoice = async () => {
    setBusy(true);
    try {
      const { opened } = await openInvoice(orderId);
      if (!opened) toast.message("Pop-up blocked", { description: "Allow pop-ups for this site to preview the invoice PDF." });
    } catch (error) {
      const msg = isApiError(error) ? error.userMessage : "Could not generate the invoice.";
      const rid = isApiError(error) ? error.requestId : undefined;
      toast.error("Invoice failed", { description: rid ? `${msg} · Request ${rid}` : msg });
    } finally {
      setBusy(false);
    }
  };

  if (!enabled) return null;

  return (
    <div className="flex flex-col gap-3">
      <Button variant="secondary" className="self-start" onClick={invoice} disabled={busy}>
        {busy ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : <FileText aria-hidden className="h-4 w-4" />}
        {busy ? "Preparing…" : "Open invoice (PDF)"}
      </Button>
      <PrintPreview orderId={orderId} enabled={enabled} />
    </div>
  );
}
