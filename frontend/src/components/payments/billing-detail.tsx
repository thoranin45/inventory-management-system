"use client";

import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { MoneyDisplay } from "@/components/ui/quantity-display";
import { Banner, ErrorState, LoadingState } from "@/components/ui/states";
import { formatDocDate } from "@/components/quotations/quotation-detail";
import { ConfirmAction, errorText, FinanceStatusBadge, PdfButton, Row, Section } from "@/components/invoices/doc-parts";
import { billingActions, type BillingDetail } from "@/lib/api/schemas/payments";
import { useT } from "@/lib/i18n/client";
import { openBillingPdf, useBillingAction, useBillingNote, useDeleteBillingDraft } from "@/lib/query/payments";

type Pending = "issue" | "void" | "delete" | null;

function BillingActions({ note, onEdit, onDeleted }: { note: BillingDetail; onEdit: (note: BillingDetail) => void; onDeleted: () => void }) {
  const t = useT();
  const allowed = billingActions(note.status);
  const action = useBillingAction();
  const del = useDeleteBillingDraft();
  const [pending, setPending] = React.useState<Pending>(null);
  const ref = note.billing_number ?? t("billing.draftRef", { id: note.id });

  const confirm = (reason: string) => {
    if (pending === "delete") {
      del.mutate(note.id, {
        onSuccess: () => {
          setPending(null);
          toast.success(t("billing.deletedToast"));
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
          toast.success(t(pending === "issue" ? "billing.issuedToast" : "billing.voidedToast", { number: data.billing_number ?? "" }));
        },
        onError: (error) => toast.error(t("billing.actionFailed"), { description: errorText(error, t("sales.somethingWrong")).message }),
      },
    );
  };
  const mutationError = pending === "delete" ? del.error : action.error;
  const failed = pending === "delete" ? del.isError : action.isError;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {allowed.issue ? <Button variant="primary" onClick={() => setPending("issue")}>{t("billing.issue")}</Button> : null}
      {allowed.edit ? <Button variant="secondary" onClick={() => onEdit(note)}>{t("billing.edit")}</Button> : null}
      {allowed.pdf ? <PdfButton open={() => openBillingPdf(note.id)} label={t("billing.openPdf")} failed={t("billing.pdfFailed")} /> : null}
      {allowed.void ? <Button variant="danger" onClick={() => setPending("void")}>{t("billing.void")}</Button> : null}
      {allowed.remove ? <Button variant="danger" onClick={() => setPending("delete")}>{t("billing.delete")}</Button> : null}
      <ConfirmAction
        open={pending !== null}
        onOpenChange={(open) => (open ? undefined : setPending(null))}
        title={pending ? t(`billing.${pending}Title`, { ref }) : ""}
        body={pending ? t(`billing.${pending}Body`) : ""}
        button={pending === "issue" ? t("billing.issue") : pending === "void" ? t("billing.void") : t("billing.delete")}
        danger={pending !== "issue"}
        needsReason={pending === "void"}
        reasonLabel={t("billing.voidReason")}
        busy={action.isPending || del.isPending}
        error={failed ? errorText(mutationError, "") : null}
        onConfirm={confirm}
      />
    </div>
  );
}

function DetailBody({ id, onEdit, onOpenInvoice, onDeleted }: {
  id: number;
  onEdit: (note: BillingDetail) => void;
  onOpenInvoice: (invoiceId: number) => void;
  onDeleted: () => void;
}) {
  const t = useT();
  const query = useBillingNote(id);
  if (query.isLoading) return <LoadingState label={t("billing.loading")} />;
  if (query.isError || !query.data) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  const note = query.data;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mono text-[16px] font-semibold">{note.billing_number ?? t("billing.draftRef", { id: note.id })}</div>
          <div className="text-[13px] text-[var(--muted)]">{note.customer_name ?? "—"}</div>
        </div>
        <FinanceStatusBadge status={note.status} />
      </div>
      {note.status === "VOID" && note.void_reason ? <Banner tone="info" title={t("billing.voidedBecause", { reason: note.void_reason })} /> : null}

      <BillingActions note={note} onEdit={onEdit} onDeleted={onDeleted} />

      <Section title={t("sales.summary")}>
        <Row label={t("invoices.issueDate")}>{formatDocDate(note.issue_date)}</Row>
        <Row label={t("billing.paymentDueDate")}>{formatDocDate(note.payment_due_date)}</Row>
      </Section>

      <Section title={t("billing.invoices")}>
        {note.items.map((item) => (
          <div key={item.id} className="border-b border-[var(--border)] py-2 text-[13px] last:border-b-0">
            <div className="flex items-baseline justify-between gap-3">
              <button type="button" className="mono underline" onClick={() => onOpenInvoice(item.invoice_id)}>
                {item.invoice_number ?? `#${item.invoice_id}`}
              </button>
              <MoneyDisplay value={item.amount} className="font-semibold" />
            </div>
            <div className="flex items-baseline justify-between gap-3 text-[12px] text-[var(--muted)]">
              <span>{t("payments.dueOn", { date: formatDocDate(item.due_date) })}</span>
              {item.current_balance != null && item.current_balance !== item.amount ? (
                <span>{t("billing.balanceNow")} <MoneyDisplay value={item.current_balance} /></span>
              ) : null}
            </div>
          </div>
        ))}
      </Section>

      <Section title={t("invoices.totals")}>
        <Row label={t("billing.total")}><MoneyDisplay value={note.total_amount} className="font-semibold" /></Row>
      </Section>
      {note.notes ? (
        <Section title={t("payments.notes")}>
          <p className="whitespace-pre-line py-2 text-[13px]">{note.notes}</p>
        </Section>
      ) : null}
      <p className="text-[12px] text-[var(--muted)]">{t("billing.infoOnly")}</p>
    </div>
  );
}

export function BillingDetailDrawer({ id, open, onOpenChange, onEdit, onOpenInvoice }: {
  id: number | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onEdit: (note: BillingDetail) => void;
  onOpenInvoice: (invoiceId: number) => void;
}) {
  const t = useT();
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent title={t("billing.detailTitle")}>
        {id !== null ? (
          <DetailBody key={id} id={id} onEdit={onEdit} onOpenInvoice={onOpenInvoice} onDeleted={() => onOpenChange(false)} />
        ) : null}
      </DrawerContent>
    </Drawer>
  );
}
