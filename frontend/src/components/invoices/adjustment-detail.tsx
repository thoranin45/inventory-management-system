"use client";

import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { MoneyDisplay, QuantityDisplay } from "@/components/ui/quantity-display";
import { Banner, ErrorState, LoadingState } from "@/components/ui/states";
import { formatDocDate } from "@/components/quotations/quotation-detail";
import { adjustmentActions, type AdjustmentDetail } from "@/lib/api/schemas/invoices";
import { useT } from "@/lib/i18n/client";
import { openAdjustmentPdf, useAdjustment, useAdjustmentAction, useDeleteAdjustmentDraft } from "@/lib/query/invoices";
import { ConfirmAction, errorText, FinanceStatusBadge, PdfButton, Row, Section } from "./doc-parts";

type Pending = "issue" | "void" | "delete" | null;

function NoteActions({ note, onEdit, onDeleted }: { note: AdjustmentDetail; onEdit: (note: AdjustmentDetail) => void; onDeleted: () => void }) {
  const t = useT();
  const allowed = adjustmentActions(note.status);
  const action = useAdjustmentAction();
  const del = useDeleteAdjustmentDraft();
  const [pending, setPending] = React.useState<Pending>(null);
  const ref = note.adjustment_number ?? t("adjustments.draftRef", { id: note.id });

  const confirm = (reason: string) => {
    if (pending === "delete") {
      del.mutate(note.id, {
        onSuccess: () => {
          setPending(null);
          toast.success(t("adjustments.deletedToast"));
          onDeleted();
        },
      });
      return;
    }
    if (!pending) return;
    action.mutate(
      { id: note.id, action: pending, reason: pending === "void" ? reason : undefined },
      {
        onSuccess: (data) => {
          setPending(null);
          toast.success(
            t(pending === "issue" ? "adjustments.issuedToast" : "adjustments.voidedToast", { number: data.adjustment_number ?? "" }),
          );
        },
        onError: (error) => toast.error(t("adjustments.actionFailed"), { description: errorText(error, t("sales.somethingWrong")).message }),
      },
    );
  };
  const mutationError = pending === "delete" ? del.error : action.error;
  const failed = pending === "delete" ? del.isError : action.isError;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {allowed.issue ? <Button variant="primary" onClick={() => setPending("issue")}>{t("adjustments.issue")}</Button> : null}
      {allowed.edit ? <Button variant="secondary" onClick={() => onEdit(note)}>{t("adjustments.edit")}</Button> : null}
      {allowed.pdf ? (
        <PdfButton open={() => openAdjustmentPdf(note.id)} label={t("adjustments.openPdf")} failed={t("adjustments.pdfFailed")} />
      ) : null}
      {allowed.void ? <Button variant="danger" onClick={() => setPending("void")}>{t("adjustments.void")}</Button> : null}
      {allowed.remove ? <Button variant="danger" onClick={() => setPending("delete")}>{t("adjustments.delete")}</Button> : null}
      <ConfirmAction
        open={pending !== null}
        onOpenChange={(open) => (open ? undefined : setPending(null))}
        title={pending ? t(`adjustments.${pending}Title`, { ref }) : ""}
        body={pending ? t(`adjustments.${pending}Body`) : ""}
        button={pending === "issue" ? t("adjustments.issue") : pending === "void" ? t("adjustments.void") : t("adjustments.delete")}
        danger={pending !== "issue"}
        needsReason={pending === "void"}
        reasonLabel={t("adjustments.voidReason")}
        busy={action.isPending || del.isPending}
        error={failed ? errorText(mutationError, "") : null}
        onConfirm={confirm}
      />
    </div>
  );
}

function DetailBody({ id, onEdit, onOpenInvoice, onDeleted }: {
  id: number;
  onEdit: (note: AdjustmentDetail) => void;
  onOpenInvoice: (invoiceId: number) => void;
  onDeleted: () => void;
}) {
  const t = useT();
  const query = useAdjustment(id);
  if (query.isLoading) return <LoadingState label={t("adjustments.loading")} />;
  if (query.isError || !query.data) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  const note = query.data;
  const vatOn = (note.seller_snapshot ?? {}).vat_registered === true;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mono text-[16px] font-semibold">{note.adjustment_number ?? t("adjustments.draftRef", { id: note.id })}</div>
          <div className="text-[13px] text-[var(--muted)]">{note.customer_name ?? "—"}</div>
        </div>
        <FinanceStatusBadge status={note.status} />
      </div>
      {note.status === "VOID" && note.void_reason ? (
        <Banner tone="info" title={t("adjustments.voidedBecause", { reason: note.void_reason })} />
      ) : null}

      <NoteActions note={note} onEdit={onEdit} onDeleted={onDeleted} />

      <Section title={t("sales.summary")}>
        <Row label={t("adjustments.invoice")}>
          <button type="button" className="mono underline" onClick={() => onOpenInvoice(note.invoice_id)}>
            {note.invoice_number ?? `#${note.invoice_id}`}
          </button>
        </Row>
        <Row label={t("invoices.issueDate")}>{formatDocDate(note.issue_date)}</Row>
        {note.sales_return_receipt_number ? (
          <Row label={t("adjustments.returnReceipt")}>
            <span className="mono">{note.sales_return_receipt_number}</span>
          </Row>
        ) : null}
        <Row label={t("adjustments.reason")}>{note.reason}</Row>
      </Section>

      <Section title={t("adjustments.lines")}>
        {note.items.map((item) => (
          <div key={item.id} className="border-b border-[var(--border)] py-2 text-[13px] last:border-b-0">
            <div className="font-medium">{item.description}</div>
            <div className="flex items-baseline justify-between gap-3 text-[var(--muted)]">
              <span>
                <QuantityDisplay value={item.quantity} /> × <MoneyDisplay value={item.unit_price} />
              </span>
              <MoneyDisplay value={item.line_total} className="font-semibold text-[var(--foreground)]" />
            </div>
          </div>
        ))}
      </Section>

      <Section title={t("invoices.totals")}>
        <Row label={t("invoices.subtotal")}><MoneyDisplay value={note.subtotal} /></Row>
        {vatOn ? <Row label={t("invoices.vat")}><MoneyDisplay value={note.vat_amount} /></Row> : null}
        <Row label={t("adjustments.total")}><MoneyDisplay value={note.grand_total} className="font-semibold" /></Row>
      </Section>
      <p className="text-[12px] text-[var(--muted)]">{t("adjustments.internalNote")}</p>
    </div>
  );
}

export function AdjustmentDetailDrawer({ id, open, onOpenChange, onEdit, onOpenInvoice }: {
  id: number | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onEdit: (note: AdjustmentDetail) => void;
  onOpenInvoice: (invoiceId: number) => void;
}) {
  const t = useT();
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent title={t("adjustments.detailTitle")}>
        {id !== null ? (
          <DetailBody key={id} id={id} onEdit={onEdit} onOpenInvoice={onOpenInvoice} onDeleted={() => onOpenChange(false)} />
        ) : null}
      </DrawerContent>
    </Drawer>
  );
}
