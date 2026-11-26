"use client";

import * as React from "react";
import { useFieldArray, useForm, useWatch, type Control, type UseFormRegister } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxItem } from "@/components/ui/combobox";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { MoneyDisplay } from "@/components/ui/quantity-display";
import { ActionError } from "@/components/orders/order-dialog-parts";
import { useOrderCopy } from "@/components/orders/use-order-copy";
import { isApiError } from "@/lib/api/errors";
import { bffJson } from "@/lib/api/browser";
import { productDetailEnvelope } from "@/lib/api/schemas/products";
import {
  quotationDraftInput,
  toDraftPayload,
  type QuotationDetail,
  type QuotationDraftForm,
} from "@/lib/api/schemas/quotations";
import { multiplyDecimals, roundHalfUp, sumDecimals } from "@/lib/decimal";
import { useT } from "@/lib/i18n/client";
import { formMessage } from "@/lib/order-copy";
import { useGlobalSearch } from "@/lib/query/hooks";
import { queryKeys } from "@/lib/query/keys";
import { useSaveQuotationDraft } from "@/lib/query/quotations";
import { useCustomerSearch } from "@/lib/query/sales";

/**
 * F1b: create a quotation draft, or edit one (PUT replaces the whole draft).
 * Line and document totals here are a preview with the backend's rounding
 * (half up per line); the server computes the stored totals. No discounts in
 * F1 (Owner, 26 Nov): lower the unit price instead.
 */

const EMPTY_LINE = { product_id: 0, quantity: "", unit_price: "", description: "" };

const inputCls =
  "min-h-11 w-full rounded-[var(--r-sm)] border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-[16px] tabular-nums outline-hidden focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-[var(--focus)] min-[768px]:text-[13px]";

export function lineTotalPreview(quantity: string | undefined, unitPrice: string | undefined): string {
  return roundHalfUp(multiplyDecimals(String(quantity || "0").trim(), String(unitPrice || "0").trim()), 2);
}

function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
  htmlFor?: string;
}) {
  const copy = useOrderCopy();
  return (
    <label className="flex flex-col gap-1" htmlFor={htmlFor}>
      <span className="text-[12px] font-semibold text-[var(--muted)]">{label}</span>
      {children}
      {hint && !error ? <span className="text-[11px] text-[var(--faint)]">{hint}</span> : null}
      {error ? <span className="text-[12px] text-[var(--danger)]">{copy(formMessage(error))}</span> : null}
    </label>
  );
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

function CustomerField({ value, onPick, error }: { value: ComboboxItem | null; onPick: (i: ComboboxItem | null) => void; error?: string }) {
  const t = useT();
  const [term, setTerm] = React.useState("");
  const debounced = useDebounced(term, 250);
  const { data, isFetching } = useCustomerSearch(debounced);
  const items: ComboboxItem[] = (data ?? []).map((c) => ({
    id: c.id,
    label: c.customer_name,
    sublabel: [c.phone, c.email].filter(Boolean).join(" · ") || undefined,
  }));
  return (
    <Field label={t("quotations.customer")} error={error} htmlFor="qt-customer">
      <Combobox
        id="qt-customer"
        ariaLabel={t("sales.searchCustomers")}
        value={value}
        onChange={onPick}
        onSearch={setTerm}
        items={items}
        loading={isFetching}
        placeholder={t("sales.searchCustomersPlaceholder")}
        emptyText={t("sales.noCustomers")}
      />
    </Field>
  );
}

function ProductLine({
  index,
  control,
  register,
  onProduct,
  onRemove,
  canRemove,
  errors,
  selectedLabel,
}: {
  index: number;
  control: Control<QuotationDraftForm>;
  register: UseFormRegister<QuotationDraftForm>;
  onProduct: (index: number, item: ComboboxItem | null) => void;
  onRemove: () => void;
  canRemove: boolean;
  errors: { product_id?: string; quantity?: string; unit_price?: string; description?: string };
  selectedLabel: ComboboxItem | null;
}) {
  const t = useT();
  const [term, setTerm] = React.useState("");
  const debounced = useDebounced(term, 250);
  const search = useGlobalSearch(debounced, debounced.trim().length >= 2);
  const items: ComboboxItem[] = (search.data?.results ?? [])
    .filter((r) => r.type === "product")
    .map((r) => ({ id: Number(r.id), label: r.label, sublabel: r.sublabel ?? undefined }));
  const line = useWatch({ control, name: `items.${index}` });
  const n = index + 1;

  return (
    <div className="rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[12px] font-semibold text-[var(--muted)]">{t("orders.lineN", { n })}</span>
        {canRemove ? (
          <Button size="icon" variant="ghost" aria-label={t("orders.removeLine", { n })} onClick={onRemove}>
            <Trash2 aria-hidden className="h-4 w-4" />
          </Button>
        ) : null}
      </div>
      <div className="flex flex-col gap-3">
        <Field label={t("orders.product")} error={errors.product_id} htmlFor={`qt-line-${index}-product`}>
          <Combobox
            id={`qt-line-${index}-product`}
            ariaLabel={t("orders.searchProductsForLine", { n })}
            value={selectedLabel}
            onChange={(item) => onProduct(index, item)}
            onSearch={setTerm}
            items={items}
            loading={search.isFetching}
            placeholder={t("orders.searchProductsPlaceholder")}
            emptyText={debounced.trim().length < 2 ? t("task.typeTwo") : t("task.noProducts")}
          />
        </Field>
        <Field
          label={t("quotations.description")}
          hint={t("quotations.descriptionHint")}
          error={errors.description}
          htmlFor={`qt-line-${index}-desc`}
        >
          <input id={`qt-line-${index}-desc`} autoComplete="off" className={inputCls} {...register(`items.${index}.description`)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("orders.fieldQuantity")} error={errors.quantity} htmlFor={`qt-line-${index}-qty`}>
            <input
              id={`qt-line-${index}-qty`}
              inputMode="decimal"
              autoComplete="off"
              className={inputCls}
              placeholder="0.000"
              {...register(`items.${index}.quantity`)}
            />
          </Field>
          <Field label={t("orders.fieldUnitPrice")} error={errors.unit_price} htmlFor={`qt-line-${index}-price`}>
            <input
              id={`qt-line-${index}-price`}
              inputMode="decimal"
              autoComplete="off"
              className={inputCls}
              placeholder="0.00"
              {...register(`items.${index}.unit_price`)}
            />
          </Field>
        </div>
        <div className="flex items-baseline justify-between text-[12px]">
          <span className="text-[var(--muted)]">{t("orders.lineTotal")}</span>
          <MoneyDisplay value={lineTotalPreview(line?.quantity, line?.unit_price)} className="font-semibold" />
        </div>
      </div>
    </div>
  );
}

function initialValues(draft: QuotationDetail | null): QuotationDraftForm {
  if (!draft) return { customer_id: 0, valid_until: "", notes: "", items: [{ ...EMPTY_LINE }] };
  return {
    customer_id: draft.customer_id,
    valid_until: draft.valid_until ?? "",
    notes: draft.notes ?? "",
    items: draft.items.map((i) => ({
      product_id: i.product_id,
      quantity: i.quantity,
      unit_price: i.unit_price,
      description: i.description,
    })),
  };
}

function DraftForm({
  draft,
  onClose,
  onSaved,
}: {
  draft: QuotationDetail | null;
  onClose: () => void;
  onSaved: (d: QuotationDetail) => void;
}) {
  const t = useT();
  const copy = useOrderCopy();
  const qc = useQueryClient();
  const save = useSaveQuotationDraft();
  const {
    control,
    register,
    handleSubmit,
    setValue,
    getValues,
    formState: { errors },
  } = useForm<QuotationDraftForm>({
    resolver: zodResolver(quotationDraftInput),
    defaultValues: initialValues(draft),
    mode: "onBlur",
  });
  const { fields, append, remove } = useFieldArray({ control, name: "items" });

  const [customer, setCustomer] = React.useState<ComboboxItem | null>(
    draft ? { id: draft.customer_id, label: draft.customer_name ?? `#${draft.customer_id}` } : null,
  );
  const [productLabels, setProductLabels] = React.useState<Record<number, ComboboxItem | null>>(() =>
    Object.fromEntries((draft?.items ?? []).map((i, index) => [index, { id: i.product_id, label: i.description }])),
  );

  const items = useWatch({ control, name: "items" });
  const total = sumDecimals(
    (items ?? []).map((it) => lineTotalPreview(it?.quantity, it?.unit_price)),
    2,
  );

  const pickCustomer = (item: ComboboxItem | null) => {
    setCustomer(item);
    setValue("customer_id", item?.id ?? 0, { shouldValidate: true });
  };

  const pickProduct = (index: number, item: ComboboxItem | null) => {
    setProductLabels((m) => ({ ...m, [index]: item }));
    setValue(`items.${index}.product_id`, item?.id ?? 0, { shouldValidate: true });
    if (!item || getValues(`items.${index}.unit_price`)) return;
    // Default the price from the product's list price; it stays editable.
    void qc
      .fetchQuery({
        queryKey: queryKeys.products.detail(item.id),
        queryFn: async () => (await bffJson(`/api/bff/products/${item.id}`, productDetailEnvelope)).data,
        staleTime: 60_000,
      })
      .then((p) => {
        const price = (p as { price?: string | null }).price;
        if (price && Number(price) > 0 && !getValues(`items.${index}.unit_price`)) {
          setValue(`items.${index}.unit_price`, roundHalfUp(price, 2), { shouldValidate: true });
        }
      })
      .catch(() => undefined);
  };

  const rootError = errors.items?.root?.message ?? errors.items?.message;

  const onSubmit = (values: QuotationDraftForm) => {
    save.mutate(
      { id: draft?.id ?? null, payload: toDraftPayload(values) },
      {
        onSuccess: (data) => {
          toast.success(t("quotations.savedToast"));
          onSaved(data);
        },
        onError: (error) => {
          const msg = isApiError(error) ? error.userMessage : t("sales.somethingWrong");
          toast.error(t("quotations.saveFailed"), { description: msg });
        },
      },
    );
  };

  const apiErr = save.isError && isApiError(save.error) ? save.error : null;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
      <CustomerField value={customer} onPick={pickCustomer} error={errors.customer_id?.message} />

      <div className="flex flex-col gap-3">
        {fields.map((f, i) => (
          <ProductLine
            key={f.id}
            index={i}
            control={control}
            register={register}
            onProduct={pickProduct}
            onRemove={() => {
              remove(i);
              setProductLabels((m) => {
                const next: Record<number, ComboboxItem | null> = {};
                Object.entries(m).forEach(([k, v]) => {
                  const n = Number(k);
                  if (n < i) next[n] = v;
                  else if (n > i) next[n - 1] = v;
                });
                return next;
              });
            }}
            canRemove={fields.length > 1}
            selectedLabel={productLabels[i] ?? null}
            errors={{
              product_id: errors.items?.[i]?.product_id?.message,
              quantity: errors.items?.[i]?.quantity?.message,
              unit_price: errors.items?.[i]?.unit_price?.message,
              description: errors.items?.[i]?.description?.message,
            }}
          />
        ))}
        <Button variant="secondary" onClick={() => append({ ...EMPTY_LINE })} className="self-start">
          <Plus aria-hidden className="h-4 w-4" />
          {t("orders.addLine")}
        </Button>
      </div>

      <div className="grid gap-3 min-[768px]:grid-cols-2">
        <Field label={t("quotations.validUntil")} hint={t("quotations.validUntilHint")} error={errors.valid_until?.message} htmlFor="qt-valid-until">
          <input id="qt-valid-until" type="date" className={inputCls} {...register("valid_until")} />
        </Field>
      </div>
      <Field label={t("quotations.notes")} error={errors.notes?.message} htmlFor="qt-notes">
        <textarea id="qt-notes" className={`${inputCls} min-h-[76px] py-2`} {...register("notes")} />
      </Field>

      <section
        aria-label={t("quotations.totalPreview")}
        className="rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface-sunken)] p-3 text-[13px]"
      >
        <div className="flex items-baseline justify-between">
          <span className="font-semibold">{t("quotations.totalPreview")}</span>
          <MoneyDisplay value={total} className="text-[15px] font-semibold" />
        </div>
        <p className="mt-1 text-[12px] text-[var(--muted)]">{t("quotations.previewNote")}</p>
      </section>

      {rootError ? <ActionError message={copy(formMessage(rootError))} /> : null}
      {apiErr ? (
        <ActionError
          message={[apiErr.userMessage, ...apiErr.details.map((d) => `${d.field ? `${d.field}: ` : ""}${d.message}`)].join("\n")}
          requestId={apiErr.requestId}
          className="whitespace-pre-line"
        />
      ) : null}

      <div className="sticky bottom-0 -mx-4 flex justify-end gap-2 border-t border-[var(--border)] bg-[var(--surface)] px-4 pb-[env(safe-area-inset-bottom)] pt-3">
        <Button variant="ghost" onClick={onClose}>
          {t("orders.cancel")}
        </Button>
        <Button type="submit" variant="primary" disabled={save.isPending}>
          {save.isPending ? t("masterData.saving") : t("quotations.saveDraft")}
        </Button>
      </div>
    </form>
  );
}

export function QuotationFormDrawer({
  open,
  onOpenChange,
  draft,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** null = new quotation; a DRAFT detail = edit it */
  draft: QuotationDetail | null;
  onSaved: (d: QuotationDetail) => void;
}) {
  const t = useT();
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent title={draft ? t("quotations.editTitle", { id: draft.id }) : t("quotations.newTitle")}>
        {/* keyed so reopening for another draft starts from that draft */}
        {open ? <DraftForm key={draft?.id ?? "new"} draft={draft} onClose={() => onOpenChange(false)} onSaved={onSaved} /> : null}
      </DrawerContent>
    </Drawer>
  );
}
