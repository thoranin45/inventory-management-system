"use client";

import * as React from "react";

import type { AdjustmentDetail, InvoiceDetail } from "@/lib/api/schemas/invoices";
import type { BillingDetail } from "@/lib/api/schemas/payments";
import { BillingDetailDrawer } from "@/components/payments/billing-detail";
import { BillingFormDrawer } from "@/components/payments/billing-form";
import { ReceiptDetailDrawer } from "@/components/payments/receipt-detail";
import { ReceiptFormDrawer, type PaymentPreset } from "@/components/payments/receipt-form";
import { AdjustmentDetailDrawer } from "./adjustment-detail";
import { AdjustmentFormDrawer } from "./adjustment-form";
import { InvoiceDetailDrawer } from "./invoice-detail";

type Kind = "invoice" | "note" | "form" | "receipt" | "pay" | "billing" | "billingForm";

/**
 * The finance drawers (invoice, adjustment note + form, receipt + record payment,
 * billing note + form) shared by every finance list. Only one is open at a time;
 * closing one keeps its id so the closing animation still has content.
 */
export function useFinanceDrawers() {
  const [open, setOpen] = React.useState<Kind | null>(null);
  const [invoiceId, setInvoiceId] = React.useState<number | null>(null);
  const [noteId, setNoteId] = React.useState<number | null>(null);
  const [form, setForm] = React.useState<{ invoiceId: number; draft: AdjustmentDetail | null } | null>(null);
  const [receiptId, setReceiptId] = React.useState<number | null>(null);
  const [payPreset, setPayPreset] = React.useState<PaymentPreset | null>(null);
  const [billingId, setBillingId] = React.useState<number | null>(null);
  const [billingDraft, setBillingDraft] = React.useState<BillingDetail | null>(null);

  const openInvoice = React.useCallback((id: number) => {
    setInvoiceId(id);
    setOpen("invoice");
  }, []);
  const openNote = React.useCallback((id: number) => {
    setNoteId(id);
    setOpen("note");
  }, []);
  const openForm = React.useCallback((invoice: number, draft: AdjustmentDetail | null) => {
    setForm({ invoiceId: invoice, draft });
    setOpen("form");
  }, []);
  const openReceipt = React.useCallback((id: number) => {
    setReceiptId(id);
    setOpen("receipt");
  }, []);
  const openPayment = React.useCallback((preset: PaymentPreset | null) => {
    setPayPreset(preset);
    setOpen("pay");
  }, []);
  const openBilling = React.useCallback((id: number) => {
    setBillingId(id);
    setOpen("billing");
  }, []);
  const openBillingForm = React.useCallback((draft: BillingDetail | null) => {
    setBillingDraft(draft);
    setOpen("billingForm");
  }, []);
  const close = (v: boolean) => (v ? undefined : setOpen(null));

  const drawers = (
    <>
      <InvoiceDetailDrawer
        id={invoiceId}
        open={open === "invoice"}
        onOpenChange={close}
        onAdjust={(inv: InvoiceDetail) => openForm(inv.id, null)}
        onOpenAdjustment={openNote}
        onRecordPayment={(inv: InvoiceDetail) =>
          openPayment({ customerId: inv.customer_id, customerName: inv.customer_name ?? null, invoiceId: inv.id })
        }
        onOpenReceipt={openReceipt}
      />
      <AdjustmentDetailDrawer
        id={noteId}
        open={open === "note"}
        onOpenChange={close}
        onEdit={(note) => openForm(note.invoice_id, note)}
        onOpenInvoice={openInvoice}
      />
      <AdjustmentFormDrawer
        open={open === "form"}
        onOpenChange={close}
        invoiceId={form?.invoiceId ?? null}
        draft={form?.draft ?? null}
        onSaved={(note) => openNote(note.id)}
      />
      <ReceiptDetailDrawer id={receiptId} open={open === "receipt"} onOpenChange={close} onOpenInvoice={openInvoice} />
      <ReceiptFormDrawer open={open === "pay"} onOpenChange={close} preset={payPreset} onSaved={(rc) => openReceipt(rc.id)} />
      <BillingDetailDrawer
        id={billingId}
        open={open === "billing"}
        onOpenChange={close}
        onEdit={openBillingForm}
        onOpenInvoice={openInvoice}
      />
      <BillingFormDrawer
        open={open === "billingForm"}
        onOpenChange={close}
        draft={billingDraft}
        onSaved={(note) => openBilling(note.id)}
      />
    </>
  );
  return { openInvoice, openNote, openForm, openReceipt, openPayment, openBilling, openBillingForm, drawers };
}

/** Opens the document named by `?open=<id>` once (the SO "Create invoice" button links here). */
export function useOpenFromUrl(param: string | null, openFn: (id: number) => void) {
  const done = React.useRef(false);
  React.useEffect(() => {
    if (done.current || !param) return;
    const id = Number(param);
    if (Number.isInteger(id) && id > 0) {
      done.current = true;
      openFn(id);
    }
  }, [param, openFn]);
}
