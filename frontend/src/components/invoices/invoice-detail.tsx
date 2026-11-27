"use client";

import * as React from "react";
import Link from "next/link";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { MoneyDisplay, QuantityDisplay } from "@/components/ui/quantity-display";
import { Banner, ErrorState, LoadingState } from "@/components/ui/states";
import { ActionError } from "@/components/orders/order-dialog-parts";
import { formatDocDate } from "@/components/quotations/quotation-detail";
import { lineTotalPreview } from "@/components/quotations/quotation-form";
import { isApiError } from "@/lib/api/errors";
import {
  invoiceActions,
  invoiceDraftInput,
  toInvoicePayload,
  type InvoiceDetail,
  type InvoiceDraftForm,
} from "@/lib/api/schemas/invoices";
import { subtractDecimals, sumDecimals } from "@/lib/decimal";
import { useT } from "@/lib/i18n/client";
import {
  openInvoicePdf,
  useDeleteInvoiceDraft,
  useInvoice,
  useInvoiceAction,
  useSaveInvoiceDraft,
} from "@/lib/query/invoices";
import { ConfirmAction, errorText, Field, FinanceStatusBadge, inputCls, PdfButton, Row, Section } from "./doc-parts";

/** Preview of one line after its discount (server is authoritative). */
export function discountedLinePreview(quantity: string, unitPrice: string, discount: string): string {
  const gross = lineTotalPreview(quantity, unitPrice);
  const off = /^\d+(\.\d{1,2})?$/.test(discount.trim()) ? discount.trim() : "0";
  return subtractDecimals(gross, off);
}

function DraftEditor({ invoice, onDone }: { invoice: InvoiceDetail; onDone: () => void }) {
  const t = useT();
  const save = useSaveInvoiceDraft();
  const { control, register, handleSubmit, formState } = useForm<InvoiceDraftForm>({
    resolver: zodResolver(invoiceDraftInput),
    defaultValues: {
      credit_days: invoice.credit_days,
      notes: invoice.notes ?? "",
      items: invoice.items.map((i) => ({
        line_no: i.line_no,
        discount_amount: i.discount_amount === "0.00" ? "" : i.discount_amount,
        description: i.description,
      })),
    },
  });
  const { fields } = useFieldArray({ control, name: "items" });
  const watched = useWatch({ control, name: "items" }) ?? [];
  const total = sumDecimals(
    invoice.items.map((item, i) => discountedLinePreview(item.quantity, item.unit_price, watched[i]?.discount_amount ?? "")),
  );
  const errors = formState.errors;

  const onSubmit = (values: InvoiceDraftForm) =>
    save.mutate(
      { id: invoice.id, payload: toInvoicePayload(values) },
      {
        onSuccess: () => {
          toast.success(t("invoices.savedToast"));
          onDone();
        },
        onError: (error) => toast.error(t("invoices.saveFailed"), { description: errorText(error, t("sales.somethingWrong")).message }),
      },
    );
  const apiErr = save.isError && isApiError(save.error) ? save.error : null;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate aria-label={t("invoices.editTitle")}>
      {fields.map((f, i) => {
        const item = invoice.items[i];
        return (
          <fieldset key={f.id} className="flex flex-col gap-2 rounded-[var(--r-md)] border border-[var(--border)] p-3">
            <legend className="px-1 text-[12px] font-semibold text-[var(--muted)]">
              {item.line_no}. <QuantityDisplay value={item.quantity} /> × <MoneyDisplay value={item.unit_price} />
            </legend>
            <Field label={t("invoices.description")} hint={t("invoices.descriptionHint")} error={errors.items?.[i]?.description?.message} htmlFor={`inv-desc-${i}`}>
              <input id={`inv-desc-${i}`} className={inputCls} maxLength={300} {...register(`items.${i}.description`)} />
            </Field>
            <div className="grid grid-cols-2 items-end gap-3">
              <Field label={t("invoices.discount")} hint={t("invoices.discountHint")} error={errors.items?.[i]?.discount_amount?.message} htmlFor={`inv-disc-${i}`}>
                <input id={`inv-disc-${i}`} inputMode="decimal" className={inputCls} placeholder="0.00" {...register(`items.${i}.discount_amount`)} />
              </Field>
              <div className="pb-2 text-right text-[13px]">
                <MoneyDisplay value={discountedLinePreview(item.quantity, item.unit_price, watched[i]?.discount_amount ?? "")} className="font-semibold" />
              </div>
            </div>
          </fieldset>
        );
      })}

      <Field label={t("invoices.creditDays")} hint={t("invoices.creditDaysHint")} error={errors.credit_days?.message} htmlFor="inv-credit">
        <input id="inv-credit" inputMode="numeric" className={inputCls} {...register("credit_days", { valueAsNumber: true })} />
      </Field>
      <Field label={t("invoices.notes")} error={errors.notes?.message} htmlFor="inv-notes">
        <textarea id="inv-notes" className={`${inputCls} min-h-[76px] py-2`} {...register("notes")} />
      </Field>

      <section aria-label={t("invoices.totalPreview")} className="rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface-sunken)] p-3 text-[13px]">
        <div className="flex items-baseline justify-between">
          <span className="font-semibold">{t("invoices.totalPreview")}</span>
          <MoneyDisplay value={total} className="text-[15px] font-semibold" />
        </div>
        <p className="mt-1 text-[12px] text-[var(--muted)]">{t("invoices.previewNote")}</p>
      </section>

      {apiErr ? <ActionError message={apiErr.userMessage} requestId={apiErr.requestId} /> : null}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>{t("orders.cancel")}</Button>
        <Button type="submit" variant="primary" disabled={save.isPending}>
          {save.isPending ? t("masterData.saving") : t("invoices.saveDraft")}
        </Button>
      </div>
    </form>
  );
}

type Pending = "issue" | "void" | "delete" | null;

function InvoiceActions({ invoice, onEdit, onAdjust, onDeleted }: {
  invoice: InvoiceDetail;
  onEdit: () => void;
  onAdjust: (invoice: InvoiceDetail) => void;
  onDeleted: () => void;
}) {
  const t = useT();
  const hasIssuedAdjustment = invoice.adjustments.some((a) => a.status === "ISSUED");
  const allowed = invoiceActions(invoice.status, hasIssuedAdjustment);
  const action = useInvoiceAction();
  const del = useDeleteInvoiceDraft();
  const [pending, setPending] = React.useState<Pending>(null);
  const ref = invoice.invoice_number ?? t("invoices.draftRef", { id: invoice.id });

  const confirm = (reason: string) => {
    if (pending === "delete") {
      del.mutate(invoice.id, {
        onSuccess: () => {
          setPending(null);
          toast.success(t("invoices.deletedToast"));
          onDeleted();
        },
      });
      return;
    }
    if (!pending) return;
    action.mutate(
      { id: invoice.id, action: pending, reason: pending === "void" ? reason : undefined },
      {
        onSuccess: (data) => {
          setPending(null);
          toast.success(t(pending === "issue" ? "invoices.issuedToast" : "invoices.voidedToast", { number: data.invoice_number ?? "" }));
        },
        onError: (error) => toast.error(t("invoices.actionFailed"), { description: errorText(error, t("sales.somethingWrong")).message }),
      },
    );
  };
  const mutationError = pending === "delete" ? del.error : action.error;
  const failed = pending === "delete" ? del.isError : action.isError;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {allowed.issue ? <Button variant="primary" onClick={() => setPending("issue")}>{t("invoices.issue")}</Button> : null}
        {allowed.edit ? <Button variant="secondary" onClick={onEdit}>{t("invoices.edit")}</Button> : null}
        {allowed.adjust ? <Button variant="secondary" onClick={() => onAdjust(invoice)}>{t("invoices.newAdjustment")}</Button> : null}
        {allowed.pdf ? <PdfButton open={() => openInvoicePdf(invoice.id)} label={t("invoices.openPdf")} failed={t("invoices.pdfFailed")} /> : null}
        {allowed.void ? <Button variant="danger" onClick={() => setPending("void")}>{t("invoices.void")}</Button> : null}
        {allowed.remove ? <Button variant="danger" onClick={() => setPending("delete")}>{t("invoices.delete")}</Button> : null}
      </div>
      {invoice.status === "ISSUED" && hasIssuedAdjustment ? (
        <p className="text-[12px] text-[var(--muted)]">{t("invoices.voidBlocked")}</p>
      ) : null}
      <ConfirmAction
        open={pending !== null}
        onOpenChange={(open) => (open ? undefined : setPending(null))}
        title={pending ? t(`invoices.${pending}Title`, { ref }) : ""}
        body={pending ? t(`invoices.${pending}Body`) : ""}
        button={pending === "issue" ? t("invoices.issue") : pending === "void" ? t("invoices.void") : t("invoices.delete")}
        danger={pending !== "issue"}
        needsReason={pending === "void"}
        reasonLabel={t("invoices.voidReason")}
        busy={action.isPending || del.isPending}
        error={failed ? errorText(mutationError, "") : null}
        onConfirm={confirm}
      />
    </div>
  );
}

function DetailBody({ id, onAdjust, onOpenAdjustment, onDeleted }: {
  id: number;
  onAdjust: (invoice: InvoiceDetail) => void;
  onOpenAdjustment: (id: number) => void;
  onDeleted: () => void;
}) {
  const t = useT();
  const query = useInvoice(id);
  const [editing, setEditing] = React.useState(false);
  if (query.isLoading) return <LoadingState label={t("invoices.loading")} />;
  if (query.isError || !query.data) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  const inv = query.data;
  const customer = inv.customer_snapshot ?? {};
  const vatOn = (inv.seller_snapshot ?? {}).vat_registered === true;
  const terms = inv.credit_days === 0 ? t("invoices.cashTerms") : t("invoices.daysTerms", { n: inv.credit_days });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mono text-[16px] font-semibold">{inv.invoice_number ?? t("invoices.draftRef", { id: inv.id })}</div>
          <div className="text-[13px] text-[var(--muted)]">{String(customer.name ?? inv.customer_name ?? "—")}</div>
        </div>
        <FinanceStatusBadge status={inv.status} overdue={inv.is_overdue} />
      </div>

      {inv.is_overdue ? <Banner tone="warning" title={t("invoices.overdueNote", { date: formatDocDate(inv.due_date) })} /> : null}
      {inv.status === "VOID" && inv.void_reason ? <Banner tone="info" title={t("invoices.voidedBecause", { reason: inv.void_reason })} /> : null}

      {editing && inv.status === "DRAFT" ? (
        <DraftEditor invoice={inv} onDone={() => setEditing(false)} />
      ) : (
        <>
          <InvoiceActions invoice={inv} onEdit={() => setEditing(true)} onAdjust={onAdjust} onDeleted={onDeleted} />

          <Section title={t("sales.summary")}>
            <Row label={t("invoices.issueDate")}>{formatDocDate(inv.issue_date)}</Row>
            <Row label={t("invoices.dueDate")}>{inv.due_date ? `${formatDocDate(inv.due_date)} (${terms})` : terms}</Row>
            <Row label={t("invoices.customer")}>{String(customer.name ?? inv.customer_name ?? "—")}</Row>
            <Row label={t("invoices.salesOrder")}>
              <Link className="mono underline" href={`/sales?search=${encodeURIComponent(inv.sales_order_number ?? "")}`}>
                {inv.sales_order_number ?? `#${inv.sales_order_id}`}
              </Link>
            </Row>
            {inv.quotation_number ? (
              <Row label={t("invoices.quotation")}>
                <Link className="mono underline" href={`/quotations?search=${encodeURIComponent(inv.quotation_number)}`}>
                  {inv.quotation_number}
                </Link>
              </Row>
            ) : null}
          </Section>

          <Section title={t("invoices.lines")}>
            {inv.items.map((item) => (
              <div key={item.id} className="border-b border-[var(--border)] py-2 text-[13px] last:border-b-0">
                <div className="font-medium">{item.description}</div>
                <div className="flex items-baseline justify-between gap-3 text-[var(--muted)]">
                  <span>
                    <QuantityDisplay value={item.quantity} /> × <MoneyDisplay value={item.unit_price} />
                    {item.discount_amount !== "0.00" ? (
                      <> − <MoneyDisplay value={item.discount_amount} /></>
                    ) : null}
                  </span>
                  <MoneyDisplay value={item.line_total} className="font-semibold text-[var(--foreground)]" />
                </div>
              </div>
            ))}
          </Section>

          <Section title={t("invoices.totals")}>
            <Row label={t("invoices.subtotal")}><MoneyDisplay value={inv.subtotal} /></Row>
            {inv.discount_total !== "0.00" ? <Row label={t("invoices.discount")}><MoneyDisplay value={inv.discount_total} /></Row> : null}
            {vatOn ? <Row label={t("invoices.vat")}><MoneyDisplay value={inv.vat_amount} /></Row> : null}
            <Row label={t("invoices.grandTotal")}><MoneyDisplay value={inv.grand_total} className="font-semibold" /></Row>
            {inv.adjusted_total !== "0.00" ? (
              <>
                <Row label={t("invoices.adjusted")}><MoneyDisplay value={inv.adjusted_total} /></Row>
                <Row label={t("invoices.balance")}><MoneyDisplay value={inv.balance} className="font-semibold" /></Row>
              </>
            ) : null}
          </Section>
          {!vatOn ? <p className="text-[12px] text-[var(--muted)]">{t("invoices.notTaxInvoice")}</p> : null}

          {inv.status !== "DRAFT" ? (
            <Section title={t("invoices.adjustments")}>
              {inv.adjustments.length === 0 ? (
                <p className="py-2 text-[13px] text-[var(--muted)]">{t("invoices.noAdjustments")}</p>
              ) : (
                inv.adjustments.map((a) => (
                  <Row key={a.id} label={a.adjustment_number ?? t("adjustments.draftRef", { id: a.id })}>
                    <button type="button" className="inline-flex items-center gap-2 underline" onClick={() => onOpenAdjustment(a.id)}>
                      <MoneyDisplay value={a.grand_total} />
                      <FinanceStatusBadge status={a.status} />
                    </button>
                  </Row>
                ))
              )}
            </Section>
          ) : null}

          {inv.notes ? (
            <Section title={t("invoices.notes")}>
              <p className="whitespace-pre-line py-2 text-[13px]">{inv.notes}</p>
            </Section>
          ) : null}
        </>
      )}
    </div>
  );
}

export function InvoiceDetailDrawer({ id, open, onOpenChange, onAdjust, onOpenAdjustment }: {
  id: number | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onAdjust: (invoice: InvoiceDetail) => void;
  onOpenAdjustment: (id: number) => void;
}) {
  const t = useT();
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent title={t("invoices.detailTitle")}>
        {id !== null ? (
          <DetailBody key={id} id={id} onAdjust={onAdjust} onOpenAdjustment={onOpenAdjustment} onDeleted={() => onOpenChange(false)} />
        ) : null}
      </DrawerContent>
    </Drawer>
  );
}
