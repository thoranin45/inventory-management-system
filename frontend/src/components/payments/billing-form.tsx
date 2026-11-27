"use client";

import * as React from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
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
  billingFormInput,
  toBillingPayload,
  type BillingDetail,
  type BillingForm,
} from "@/lib/api/schemas/payments";
import { businessToday } from "@/lib/business-date";
import { sumDecimals } from "@/lib/decimal";
import { useT } from "@/lib/i18n/client";
import { useSaveBillingDraft } from "@/lib/query/payments";
import { CustomerPicker, useOpenInvoices } from "./payment-parts";

function InvoicesForm({ customerId, invoices, draft, onCancel, onSaved }: {
  customerId: number;
  invoices: InvoiceRow[];
  draft: BillingDetail | null;
  onCancel: () => void;
  onSaved: (note: BillingDetail) => void;
}) {
  const t = useT();
  const save = useSaveBillingDraft();
  const open = new Set(invoices.map((i) => i.id));
  const { control, register, handleSubmit, formState } = useForm<BillingForm>({
    resolver: zodResolver(billingFormInput),
    defaultValues: {
      customer_id: customerId,
      invoice_ids: draft ? draft.items.map((i) => i.invoice_id).filter((id) => open.has(id)) : invoices.map((i) => i.id),
      payment_due_date: draft?.payment_due_date ?? "",
      notes: draft?.notes ?? "",
    },
  });
  const chosen = useWatch({ control, name: "invoice_ids" }) ?? [];
  const total = sumDecimals(invoices.filter((i) => chosen.includes(i.id)).map((i) => i.balance), 2);
  const errors = formState.errors;

  const onSubmit = (values: BillingForm) =>
    save.mutate(
      { id: draft?.id ?? null, payload: toBillingPayload(values) },
      {
        onSuccess: (data) => {
          toast.success(t("billing.savedToast"));
          onSaved(data);
        },
        onError: (error) => toast.error(t("billing.saveFailed"), { description: errorText(error, t("sales.somethingWrong")).message }),
      },
    );
  const apiErr = save.isError && isApiError(save.error) ? save.error : null;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate aria-label={t("billing.formLabel")}>
      <Controller
        control={control}
        name="invoice_ids"
        render={({ field }) => (
          <fieldset className="flex flex-col gap-1">
            <legend className="wc-section-label mb-1">{t("billing.chooseInvoices")}</legend>
            {invoices.map((inv) => {
              const checked = field.value.includes(inv.id);
              return (
                <label key={inv.id} className="flex min-h-11 items-center gap-3 border-b border-[var(--border)] text-[13px] last:border-b-0">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={checked}
                    onChange={() => field.onChange(checked ? field.value.filter((v) => v !== inv.id) : [...field.value, inv.id])}
                  />
                  <span className="mono flex-1">{inv.invoice_number ?? `#${inv.id}`}</span>
                  <span className="text-[12px] text-[var(--muted)]">{t("payments.dueOn", { date: formatDocDate(inv.due_date) })}</span>
                  <MoneyDisplay value={inv.balance} className="font-medium" />
                </label>
              );
            })}
            {errors.invoice_ids ? <p className="text-[12px] text-[var(--danger)]">{t("billing.chooseOne")}</p> : null}
          </fieldset>
        )}
      />
      <Field label={t("billing.paymentDueDate")} hint={t("billing.paymentDueHint")} error={errors.payment_due_date?.message} htmlFor="bn-due">
        <input id="bn-due" type="date" min={businessToday()} className={inputCls} {...register("payment_due_date")} />
      </Field>
      <Field label={t("payments.notes")} error={errors.notes?.message} htmlFor="bn-notes">
        <textarea id="bn-notes" className={`${inputCls} min-h-[64px] py-2`} {...register("notes")} />
      </Field>

      <section aria-label={t("billing.totalPreview")} className="rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface-sunken)] p-3 text-[13px]">
        <div className="flex items-baseline justify-between">
          <span className="font-semibold">{t("billing.totalPreview")}</span>
          <MoneyDisplay value={total} className="text-[15px] font-semibold" />
        </div>
        <p className="mt-1 text-[12px] text-[var(--muted)]">{t("billing.previewNote")}</p>
      </section>

      {apiErr ? <ActionError message={apiErr.userMessage} requestId={apiErr.requestId} /> : null}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>{t("orders.cancel")}</Button>
        <Button type="submit" variant="primary" disabled={save.isPending}>
          {save.isPending ? t("masterData.saving") : t("billing.saveDraft")}
        </Button>
      </div>
    </form>
  );
}

function FormBody({ draft, onCancel, onSaved }: {
  draft: BillingDetail | null;
  onCancel: () => void;
  onSaved: (note: BillingDetail) => void;
}) {
  const t = useT();
  const [customer, setCustomer] = React.useState<ComboboxItem | null>(
    draft ? { id: draft.customer_id, label: draft.customer_name ?? `#${draft.customer_id}` } : null,
  );
  const invoices = useOpenInvoices(customer?.id ?? null);
  return (
    <div className="flex flex-col gap-4">
      {draft ? (
        <p className="text-[13px]">
          <span className="text-[var(--muted)]">{t("payments.customer")}: </span>
          <span className="font-medium">{customer?.label}</span>
        </p>
      ) : (
        <CustomerPicker id="bn-customer" value={customer} onPick={setCustomer} />
      )}
      {customer === null ? null : invoices.isLoading ? (
        <LoadingState label={t("payments.loadingOpen")} />
      ) : invoices.isError || !invoices.data ? (
        <ErrorState error={invoices.error} onRetry={() => void invoices.refetch()} />
      ) : invoices.data.items.length === 0 ? (
        <p className="text-[13px] text-[var(--muted)]">{t("payments.nothingOpen")}</p>
      ) : (
        <InvoicesForm key={customer.id} customerId={customer.id} invoices={invoices.data.items} draft={draft} onCancel={onCancel} onSaved={onSaved} />
      )}
    </div>
  );
}

/** F3b: new or edited billing-note draft. Mounted only while open. */
export function BillingFormDrawer({ open, onOpenChange, draft, onSaved }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  draft: BillingDetail | null;
  onSaved: (note: BillingDetail) => void;
}) {
  const t = useT();
  const title = draft ? t("billing.editTitle", { id: draft.id }) : t("billing.newTitle");
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent title={title}>
        {open ? <FormBody draft={draft} onCancel={() => onOpenChange(false)} onSaved={onSaved} /> : null}
      </DrawerContent>
    </Drawer>
  );
}
