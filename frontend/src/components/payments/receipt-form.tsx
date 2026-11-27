"use client";

import * as React from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import type { ComboboxItem } from "@/components/ui/combobox";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { MoneyDisplay } from "@/components/ui/quantity-display";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { ActionError } from "@/components/orders/order-dialog-parts";
import { formatDocDate } from "@/components/quotations/quotation-detail";
import { errorText, Field, inputCls } from "@/components/invoices/doc-parts";
import { isApiError } from "@/lib/api/errors";
import type { InvoiceRow } from "@/lib/api/schemas/invoices";
import {
  addMoney,
  newClientRequestId,
  PAYMENT_METHODS,
  receiptFormInput,
  toReceiptPayload,
  type ReceiptDetail,
  type ReceiptForm,
} from "@/lib/api/schemas/payments";
import { businessToday } from "@/lib/business-date";
import { sumDecimals } from "@/lib/decimal";
import { useT } from "@/lib/i18n/client";
import { useRecordPayment } from "@/lib/query/payments";
import { CustomerPicker, METHOD_LABEL, useOpenInvoices } from "./payment-parts";

export type PaymentPreset = { customerId: number; customerName: string | null; invoiceId: number | null };

const MONEY_RE = /^\d{1,12}(\.\d{1,2})?$/;
const asMoney = (v: string | undefined) => (v && MONEY_RE.test(v.trim()) ? v.trim() : "0");

function LinesForm({ customerId, invoices, focusInvoiceId, onCancel, onSaved }: {
  customerId: number;
  invoices: InvoiceRow[];
  focusInvoiceId: number | null;
  onCancel: () => void;
  onSaved: (receipt: ReceiptDetail) => void;
}) {
  const t = useT();
  const record = useRecordPayment();
  // One key per opened form: a double click or a retry after a lost response returns the same receipt.
  const [requestId] = React.useState(newClientRequestId);
  const { control, register, handleSubmit, formState } = useForm<ReceiptForm>({
    resolver: zodResolver(receiptFormInput),
    defaultValues: {
      customer_id: customerId,
      received_date: businessToday(),
      method: "TRANSFER",
      reference: "",
      notes: "",
      lines: invoices.map((inv) => ({
        invoice_id: inv.id,
        balance: inv.balance,
        amount: inv.id === focusInvoiceId ? inv.balance : "",
        wht_amount: "",
        wht_certificate_no: "",
      })),
    },
  });
  const { fields } = useFieldArray({ control, name: "lines" });
  const watched = useWatch({ control, name: "lines" }) ?? [];
  const cash = sumDecimals(watched.map((l) => asMoney(l?.amount)), 2);
  const wht = sumDecimals(watched.map((l) => asMoney(l?.wht_amount)), 2);
  const errors = formState.errors;
  const linesError = errors.lines?.message ?? errors.lines?.root?.message;

  const onSubmit = (values: ReceiptForm) =>
    record.mutate(toReceiptPayload(values, requestId), {
      onSuccess: (data) => {
        toast.success(t("payments.recordedToast", { number: data.receipt_number }));
        onSaved(data);
      },
      onError: (error) => toast.error(t("payments.recordFailed"), { description: errorText(error, t("sales.somethingWrong")).message }),
    });
  const apiErr = record.isError && isApiError(record.error) ? record.error : null;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate aria-label={t("payments.newTitle")}>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("payments.receivedDate")} error={errors.received_date?.message} htmlFor="rc-date">
          <input id="rc-date" type="date" max={businessToday()} className={inputCls} {...register("received_date")} />
        </Field>
        <Field label={t("payments.method")} htmlFor="rc-method">
          <select id="rc-method" className={inputCls} {...register("method")}>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>{t(METHOD_LABEL[m])}</option>
            ))}
          </select>
        </Field>
      </div>
      <Field label={t("payments.reference")} hint={t("payments.referenceHint")} error={errors.reference?.message} htmlFor="rc-ref">
        <input id="rc-ref" className={inputCls} maxLength={100} {...register("reference")} />
      </Field>

      <section className="flex flex-col gap-2" aria-label={t("payments.invoicesToPay")}>
        <h3 className="wc-section-label">{t("payments.invoicesToPay")}</h3>
        {fields.map((f, i) => {
          const inv = invoices[i];
          const lineErr = errors.lines?.[i];
          const hasWht = asMoney(watched[i]?.wht_amount) !== "0";
          return (
            <fieldset key={f.id} className="flex flex-col gap-2 rounded-[var(--r-md)] border border-[var(--border)] p-3">
              <legend className="px-1 text-[12px] font-semibold">
                <span className="mono">{inv.invoice_number ?? `#${inv.id}`}</span>
              </legend>
              <div className="flex flex-wrap justify-between gap-2 text-[12px] text-[var(--muted)]">
                <span>{t("payments.dueOn", { date: formatDocDate(inv.due_date) })}</span>
                <span>
                  {t("payments.balanceLabel")} <MoneyDisplay value={inv.balance} className="font-semibold text-[var(--foreground)]" />
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t("payments.amount")} error={lineErr?.amount?.message} htmlFor={`rc-amt-${i}`}>
                  <input id={`rc-amt-${i}`} inputMode="decimal" placeholder="0.00" className={inputCls} {...register(`lines.${i}.amount`)} />
                </Field>
                <Field label={t("payments.wht")} hint={t("payments.whtHint")} error={lineErr?.wht_amount?.message} htmlFor={`rc-wht-${i}`}>
                  <input id={`rc-wht-${i}`} inputMode="decimal" placeholder="0.00" className={inputCls} {...register(`lines.${i}.wht_amount`)} />
                </Field>
              </div>
              {hasWht ? (
                <Field label={t("payments.whtCertificate")} error={lineErr?.wht_certificate_no?.message} htmlFor={`rc-cert-${i}`}>
                  <input id={`rc-cert-${i}`} className={inputCls} maxLength={50} {...register(`lines.${i}.wht_certificate_no`)} />
                </Field>
              ) : null}
            </fieldset>
          );
        })}
        {linesError ? <p className="text-[12px] text-[var(--danger)]">{t("payments.enterAnAmount")}</p> : null}
      </section>

      <Field label={t("payments.notes")} error={errors.notes?.message} htmlFor="rc-notes">
        <textarea id="rc-notes" className={`${inputCls} min-h-[64px] py-2`} {...register("notes")} />
      </Field>

      <section aria-label={t("payments.totalPreview")} className="rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface-sunken)] p-3 text-[13px]">
        <div className="flex items-baseline justify-between">
          <span>{t("payments.cashReceived")}</span>
          <MoneyDisplay value={cash} className="text-[15px] font-semibold" />
        </div>
        {wht !== "0.00" ? (
          <>
            <div className="flex items-baseline justify-between text-[var(--muted)]">
              <span>{t("payments.wht")}</span>
              <MoneyDisplay value={wht} />
            </div>
            <div className="flex items-baseline justify-between">
              <span>{t("payments.settled")}</span>
              <MoneyDisplay value={addMoney(cash, wht)} className="font-semibold" />
            </div>
          </>
        ) : null}
        <p className="mt-1 text-[12px] text-[var(--muted)]">{t("payments.issuedOnSave")}</p>
      </section>

      {apiErr ? <ActionError message={apiErr.userMessage} requestId={apiErr.requestId} /> : null}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>{t("orders.cancel")}</Button>
        <Button type="submit" variant="primary" disabled={record.isPending}>
          {record.isPending ? t("masterData.saving") : t("payments.record")}
        </Button>
      </div>
    </form>
  );
}

function FormBody({ preset, onCancel, onSaved }: {
  preset: PaymentPreset | null;
  onCancel: () => void;
  onSaved: (receipt: ReceiptDetail) => void;
}) {
  const t = useT();
  const [customer, setCustomer] = React.useState<ComboboxItem | null>(
    preset ? { id: preset.customerId, label: preset.customerName ?? `#${preset.customerId}` } : null,
  );
  const invoices = useOpenInvoices(customer?.id ?? null);

  return (
    <div className="flex flex-col gap-4">
      {preset ? (
        <p className="text-[13px]">
          <span className="text-[var(--muted)]">{t("payments.customer")}: </span>
          <span className="font-medium">{customer?.label}</span>
        </p>
      ) : (
        <CustomerPicker id="rc-customer" value={customer} onPick={setCustomer} />
      )}
      {customer === null ? null : invoices.isLoading ? (
        <LoadingState label={t("payments.loadingOpen")} />
      ) : invoices.isError || !invoices.data ? (
        <ErrorState error={invoices.error} onRetry={() => void invoices.refetch()} />
      ) : invoices.data.items.length === 0 ? (
        <p className="text-[13px] text-[var(--muted)]">{t("payments.nothingOpen")}</p>
      ) : (
        <LinesForm
          key={customer.id}
          customerId={customer.id}
          invoices={invoices.data.items}
          focusInvoiceId={preset?.invoiceId ?? null}
          onCancel={onCancel}
          onSaved={onSaved}
        />
      )}
    </div>
  );
}

/** F3b: record a payment (issues a receipt immediately). Mounted only while open. */
export function ReceiptFormDrawer({ open, onOpenChange, preset, onSaved }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  preset: PaymentPreset | null;
  onSaved: (receipt: ReceiptDetail) => void;
}) {
  const t = useT();
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent title={t("payments.newTitle")}>
        {open ? <FormBody preset={preset} onCancel={() => onOpenChange(false)} onSaved={onSaved} /> : null}
      </DrawerContent>
    </Drawer>
  );
}
