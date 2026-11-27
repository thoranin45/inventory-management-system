"use client";

import * as React from "react";

import type { AdjustmentDetail, InvoiceDetail } from "@/lib/api/schemas/invoices";
import { AdjustmentDetailDrawer } from "./adjustment-detail";
import { AdjustmentFormDrawer } from "./adjustment-form";
import { InvoiceDetailDrawer } from "./invoice-detail";

type Open = { kind: "invoice"; id: number } | { kind: "note"; id: number } | { kind: "form"; invoiceId: number; draft: AdjustmentDetail | null } | null;

/**
 * The three F2b drawers (invoice detail, adjustment detail, adjustment form)
 * shared by the invoice and adjustment-note lists. Only one is open at a time;
 * closing one keeps its id so the closing animation still has content.
 */
export function useFinanceDrawers() {
  const [open, setOpen] = React.useState<Open>(null);
  const [invoiceId, setInvoiceId] = React.useState<number | null>(null);
  const [noteId, setNoteId] = React.useState<number | null>(null);
  const [form, setForm] = React.useState<{ invoiceId: number; draft: AdjustmentDetail | null } | null>(null);

  const openInvoice = React.useCallback((id: number) => {
    setInvoiceId(id);
    setOpen({ kind: "invoice", id });
  }, []);
  const openNote = React.useCallback((id: number) => {
    setNoteId(id);
    setOpen({ kind: "note", id });
  }, []);
  const openForm = React.useCallback((invoice: number, draft: AdjustmentDetail | null) => {
    setForm({ invoiceId: invoice, draft });
    setOpen({ kind: "form", invoiceId: invoice, draft });
  }, []);
  const close = (v: boolean) => (v ? undefined : setOpen(null));

  const drawers = (
    <>
      <InvoiceDetailDrawer
        id={invoiceId}
        open={open?.kind === "invoice"}
        onOpenChange={close}
        onAdjust={(inv: InvoiceDetail) => openForm(inv.id, null)}
        onOpenAdjustment={openNote}
      />
      <AdjustmentDetailDrawer
        id={noteId}
        open={open?.kind === "note"}
        onOpenChange={close}
        onEdit={(note) => openForm(note.invoice_id, note)}
        onOpenInvoice={openInvoice}
      />
      <AdjustmentFormDrawer
        open={open?.kind === "form"}
        onOpenChange={close}
        invoiceId={form?.invoiceId ?? null}
        draft={form?.draft ?? null}
        onSaved={(note) => openNote(note.id)}
      />
    </>
  );
  return { openInvoice, openNote, openForm, drawers };
}

/** Opens the invoice named by `?open=<id>` once (the SO "Create invoice" button links here). */
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
