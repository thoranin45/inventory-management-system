"use client";

import * as React from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { MoneyDisplay } from "@/components/ui/quantity-display";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { ActionError } from "@/components/orders/order-dialog-parts";
import { formatDocDate } from "@/components/quotations/quotation-detail";
import { lineTotalPreview } from "@/components/quotations/quotation-form";
import { isApiError } from "@/lib/api/errors";
import {
  adjustmentDraftInput,
  toAdjustmentPayload,
  type AdjustmentDetail,
  type AdjustmentDraftForm,
  type InvoiceDetail,
  type InvoiceItem,
} from "@/lib/api/schemas/invoices";
import { compareDecimals, subtractDecimals, sumDecimals } from "@/lib/decimal";
import { formatMoney, formatQty } from "@/lib/format";
import { useT } from "@/lib/i18n/client";
import { useInvoice, useSaveAdjustmentDraft } from "@/lib/query/invoices";
import { errorText, Field, inputCls } from "./doc-parts";

/**
 * F2b: internal adjustment note draft (reduces an issued invoice). Either from a
 * return receipt (quantities prefilled from what was returned and not yet
 * adjusted) or a manual price reduction. Limits shown here are hints; the
 * server re-checks every limit on save and again at issue.
 */

type Line = AdjustmentDraftForm["items"][number];

/** Per-unit amount after the line discount, rounded down to 2dp (a default only). */
export function netUnitPrice(item: Pick<InvoiceItem, "quantity" | "line_total">): string {
  const qty = Number(item.quantity);
  if (!(qty > 0)) return "";
  const cents = Math.floor((Number(item.line_total) / qty) * 100 + 1e-9);
  return cents > 0 ? (cents / 100).toFixed(2) : "";
}

/** Amount still available to reduce on one invoice line. */
export function lineRemaining(item: Pick<InvoiceItem, "line_total" | "adjusted_amount">): string {
  return subtractDecimals(item.line_total, item.adjusted_amount, 2);
}

function returnLines(invoice: InvoiceDetail, receiptId: number): Line[] {
  const receipt = invoice.return_receipts.find((r) => r.id === receiptId);
  if (!receipt) return [];
  return receipt.items
    .map((ri): Line | null => {
      const left = subtractDecimals(ri.returned_quantity, ri.adjusted_quantity);
      const item = invoice.items.find((i) => i.id === ri.invoice_item_id);
      if (!item || compareDecimals(left, "0") <= 0) return null;
      return { invoice_item_id: item.id, quantity: left, unit_price: netUnitPrice(item), description: "" };
    })
    .filter((l): l is Line => l !== null);
}

function AdjustmentForm({
  invoice,
  draft,
  onClose,
  onSaved,
}: {
  invoice: InvoiceDetail;
  draft: AdjustmentDetail | null;
  onClose: () => void;
  onSaved: (note: AdjustmentDetail) => void;
}) {
  const t = useT();
  const save = useSaveAdjustmentDraft();
  const hasReturns = invoice.return_receipts.length > 0;
  const firstReceipt = hasReturns ? invoice.return_receipts[0].id : null;

  const { control, register, handleSubmit, formState, setValue, getValues } = useForm<AdjustmentDraftForm>({
    resolver: zodResolver(adjustmentDraftInput),
    defaultValues: draft
      ? {
          invoice_id: invoice.id,
          sales_return_receipt_id: draft.sales_return_receipt_id ?? null,
          reason: draft.reason,
          items: draft.items.map((i) => ({
            invoice_item_id: i.invoice_item_id,
            quantity: i.quantity,
            unit_price: i.unit_price,
            description: i.description,
          })),
        }
      : {
          invoice_id: invoice.id,
          sales_return_receipt_id: firstReceipt,
          reason: "",
          items:
            firstReceipt !== null
              ? returnLines(invoice, firstReceipt)
              : [{ invoice_item_id: 0, quantity: "", unit_price: "", description: "" }],
        },
  });
  const { fields, append, remove, replace } = useFieldArray({ control, name: "items" });
  const receiptId = useWatch({ control, name: "sales_return_receipt_id" });
  const watched = useWatch({ control, name: "items" }) ?? [];
  const fromReturn = receiptId !== null && receiptId !== undefined;
  const receipt = fromReturn ? invoice.return_receipts.find((r) => r.id === receiptId) : undefined;
  const errors = formState.errors;
  const itemsError = (errors.items as { message?: string; root?: { message?: string } } | undefined)?.root?.message
    ?? (errors.items as { message?: string } | undefined)?.message;

  const setMode = (mode: "return" | "manual") => {
    if (mode === "return" && firstReceipt !== null) {
      setValue("sales_return_receipt_id", firstReceipt);
      replace(returnLines(invoice, firstReceipt));
    } else {
      setValue("sales_return_receipt_id", null);
      replace([{ invoice_item_id: 0, quantity: "", unit_price: "", description: "" }]);
    }
  };
  const pickReceipt = (id: number) => {
    setValue("sales_return_receipt_id", id);
    replace(returnLines(invoice, id));
  };
  const pickLine = (index: number, itemId: number) => {
    const item = invoice.items.find((i) => i.id === itemId);
    setValue(`items.${index}.invoice_item_id`, itemId, { shouldValidate: formState.isSubmitted });
    if (item && getValues(`items.${index}.unit_price`) === "") setValue(`items.${index}.unit_price`, netUnitPrice(item));
  };

  const total = sumDecimals(watched.map((l) => lineTotalPreview(l?.quantity, l?.unit_price)), 2);

  const onSubmit = (values: AdjustmentDraftForm) =>
    save.mutate(
      { id: draft?.id ?? null, payload: toAdjustmentPayload(values) },
      {
        onSuccess: (note) => {
          toast.success(t("adjustments.savedToast"));
          onSaved(note);
        },
        onError: (error) =>
          toast.error(t("adjustments.saveFailed"), { description: errorText(error, t("sales.somethingWrong")).message }),
      },
    );
  const apiErr = save.isError && isApiError(save.error) ? save.error : null;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate aria-label={t("adjustments.newTitle")}>
      <div className="text-[13px]">
        <span className="text-[var(--muted)]">{t("adjustments.invoice")}: </span>
        <span className="mono font-medium">{invoice.invoice_number ?? `#${invoice.id}`}</span>
        <span className="text-[var(--muted)]"> · {t("invoices.balance")} </span>
        <MoneyDisplay value={invoice.balance} className="font-medium" />
      </div>

      {hasReturns ? (
        <div role="radiogroup" aria-label={t("adjustments.returnReceipt")} className="flex flex-wrap gap-2">
          <Button type="button" variant={fromReturn ? "primary" : "secondary"} aria-pressed={fromReturn} onClick={() => setMode("return")}>
            {t("adjustments.fromReturn")}
          </Button>
          <Button type="button" variant={!fromReturn ? "primary" : "secondary"} aria-pressed={!fromReturn} onClick={() => setMode("manual")}>
            {t("adjustments.manual")}
          </Button>
        </div>
      ) : (
        <p className="text-[12px] text-[var(--muted)]">{t("adjustments.noReturns")}</p>
      )}

      {fromReturn ? (
        <Field label={t("adjustments.returnReceipt")} htmlFor="adj-receipt">
          <select
            id="adj-receipt"
            className={inputCls}
            value={String(receiptId)}
            onChange={(e) => pickReceipt(Number(e.currentTarget.value))}
          >
            {invoice.return_receipts.map((r) => (
              <option key={r.id} value={r.id}>
                {r.receipt_number}
                {r.returned_at ? ` · ${formatDocDate(r.returned_at.slice(0, 10))}` : ""}
              </option>
            ))}
          </select>
        </Field>
      ) : null}

      <Field label={t("adjustments.reason")} error={errors.reason?.message} htmlFor="adj-reason">
        <input id="adj-reason" className={inputCls} maxLength={500} {...register("reason")} />
      </Field>

      <section className="flex flex-col gap-3" aria-label={t("adjustments.lines")}>
        {fields.map((f, i) => {
          const item = invoice.items.find((x) => x.id === watched[i]?.invoice_item_id);
          const returned = receipt?.items.find((ri) => ri.invoice_item_id === watched[i]?.invoice_item_id);
          const rowErr = errors.items?.[i];
          return (
            <fieldset key={f.id} className="flex flex-col gap-2 rounded-[var(--r-md)] border border-[var(--border)] p-3">
              <div className="flex items-end gap-2">
                <div className="min-w-0 flex-1">
                  <Field label={t("adjustments.line")} error={rowErr?.invoice_item_id?.message} htmlFor={`adj-line-${i}`}>
                    <select
                      id={`adj-line-${i}`}
                      className={inputCls}
                      value={String(watched[i]?.invoice_item_id ?? 0)}
                      onChange={(e) => pickLine(i, Number(e.currentTarget.value))}
                    >
                      <option value="0">{t("adjustments.chooseLine")}</option>
                      {invoice.items.map((it) => (
                        <option key={it.id} value={it.id}>
                          {it.line_no}. {it.description}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                {fields.length > 1 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    aria-label={t("adjustments.removeLine", { n: i + 1 })}
                    onClick={() => remove(i)}
                  >
                    <Trash2 aria-hidden className="h-4 w-4" />
                  </Button>
                ) : null}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t("adjustments.quantity")} error={rowErr?.quantity?.message} htmlFor={`adj-qty-${i}`}>
                  <input id={`adj-qty-${i}`} inputMode="decimal" className={inputCls} {...register(`items.${i}.quantity`)} />
                </Field>
                <Field label={t("adjustments.reduction")} error={rowErr?.unit_price?.message} htmlFor={`adj-price-${i}`}>
                  <input id={`adj-price-${i}`} inputMode="decimal" className={inputCls} {...register(`items.${i}.unit_price`)} />
                </Field>
              </div>
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-[12px] text-[var(--muted)]">
                <span className="flex flex-col">
                  {item ? <span>{t("adjustments.leftOnLine", { amount: formatMoney(lineRemaining(item)) })}</span> : null}
                  {returned ? (
                    <span>
                      {t("adjustments.returnedLeft", {
                        qty: formatQty(subtractDecimals(returned.returned_quantity, returned.adjusted_quantity)),
                      })}
                    </span>
                  ) : null}
                </span>
                <MoneyDisplay
                  value={lineTotalPreview(watched[i]?.quantity, watched[i]?.unit_price)}
                  className="text-[13px] font-semibold text-[var(--foreground)]"
                />
              </div>
            </fieldset>
          );
        })}
        {itemsError ? <p className="text-[12px] text-[var(--danger)]">{itemsError}</p> : null}
        {!fromReturn ? (
          <div>
            <Button
              type="button"
              variant="secondary"
              onClick={() => append({ invoice_item_id: 0, quantity: "", unit_price: "", description: "" })}
            >
              <Plus aria-hidden className="h-4 w-4" />
              {t("adjustments.addLine")}
            </Button>
          </div>
        ) : null}
      </section>

      <section
        aria-label={t("adjustments.totalPreview")}
        className="rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface-sunken)] p-3 text-[13px]"
      >
        <div className="flex items-baseline justify-between">
          <span className="font-semibold">{t("adjustments.totalPreview")}</span>
          <MoneyDisplay value={total} className="text-[15px] font-semibold" />
        </div>
        <p className="mt-1 text-[12px] text-[var(--muted)]">{t("adjustments.internalNote")}</p>
      </section>

      {apiErr ? <ActionError message={apiErr.userMessage} requestId={apiErr.requestId} /> : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          {t("orders.cancel")}
        </Button>
        <Button type="submit" variant="primary" disabled={save.isPending}>
          {save.isPending ? t("masterData.saving") : t("adjustments.saveDraft")}
        </Button>
      </div>
    </form>
  );
}

function FormBody(props: {
  invoiceId: number;
  draft: AdjustmentDetail | null;
  onClose: () => void;
  onSaved: (note: AdjustmentDetail) => void;
}) {
  const t = useT();
  const query = useInvoice(props.invoiceId);
  if (query.isLoading) return <LoadingState label={t("invoices.loading")} />;
  if (query.isError || !query.data) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  return <AdjustmentForm invoice={query.data} {...props} />;
}

export function AdjustmentFormDrawer({
  open,
  onOpenChange,
  invoiceId,
  draft,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** The issued invoice being reduced. */
  invoiceId: number | null;
  /** null = new note; a DRAFT detail = edit it */
  draft: AdjustmentDetail | null;
  onSaved: (note: AdjustmentDetail) => void;
}) {
  const t = useT();
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent title={draft ? t("adjustments.editTitle", { id: draft.id }) : t("adjustments.newTitle")}>
        {open && invoiceId !== null ? (
          <FormBody
            key={`${invoiceId}-${draft?.id ?? "new"}`}
            invoiceId={invoiceId}
            draft={draft}
            onClose={() => onOpenChange(false)}
            onSaved={onSaved}
          />
        ) : null}
      </DrawerContent>
    </Drawer>
  );
}
