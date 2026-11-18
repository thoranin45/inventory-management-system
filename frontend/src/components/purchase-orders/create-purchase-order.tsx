"use client";

import * as React from "react";
import {
  useFieldArray,
  useForm,
  useWatch,
  type Control,
  type UseFormRegister,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxItem } from "@/components/ui/combobox";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { MoneyDisplay } from "@/components/ui/quantity-display";
import { ActionError } from "@/components/orders/order-dialog-parts";
import { OrderSummary } from "@/components/orders/order-summary";
import { useOrderCopy } from "@/components/orders/use-order-copy";
import { isApiError } from "@/lib/api/errors";
import { multiplyDecimals, sumDecimals } from "@/lib/decimal";
import { useT } from "@/lib/i18n/client";
import { formMessage } from "@/lib/order-copy";
import { useGlobalSearch } from "@/lib/query/hooks";
import { useCreatePurchaseOrder, useSupplierSearch } from "@/lib/query/purchase-orders";
import {
  createPurchaseOrderInput,
  type CreatePurchaseOrderInput,
  type PurchaseOrderDetail,
} from "@/lib/api/schemas/purchase-orders";

type FormValues = CreatePurchaseOrderInput;

const EMPTY_LINE = { product_id: 0, quantity: "", unit_price: "" };

function Field({ label, error, children, htmlFor }: { label: string; error?: string; children: React.ReactNode; htmlFor?: string }) {
  const copy = useOrderCopy();
  return (
    <label className="flex flex-col gap-1" htmlFor={htmlFor}>
      <span className="text-[12px] font-semibold text-[var(--muted)]">{label}</span>
      {children}
      {error ? <span className="text-[12px] text-[var(--danger)]">{copy(formMessage(error))}</span> : null}
    </label>
  );
}

const inputCls =
  "min-h-11 rounded-[var(--r-sm)] border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-[16px] tabular-nums outline-hidden focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-[var(--focus)] min-[768px]:text-[13px]";

/* ---------------- supplier selector ---------------- */
function SupplierField({
  value,
  onPick,
  error,
}: {
  value: ComboboxItem | null;
  onPick: (item: ComboboxItem | null) => void;
  error?: string;
}) {
  const t = useT();
  const [term, setTerm] = React.useState("");
  const debounced = useDebounced(term, 250);
  const { data, isFetching } = useSupplierSearch(debounced);
  const items: ComboboxItem[] = (data ?? []).map((s) => ({
    id: s.id,
    label: s.supplier_name,
    sublabel: [s.contact_name, s.phone].filter(Boolean).join(" · ") || undefined,
  }));
  return (
    <Field label={t("po.supplier")} error={error} htmlFor="po-supplier">
      <Combobox
        id="po-supplier"
        ariaLabel={t("po.searchSuppliers")}
        value={value}
        onChange={onPick}
        onSearch={setTerm}
        items={items}
        loading={isFetching}
        placeholder={t("po.searchSuppliersPlaceholder")}
        emptyText={t("po.noSuppliers")}
      />
    </Field>
  );
}

/* ---------------- one product line ---------------- */
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
  control: Control<FormValues>;
  register: UseFormRegister<FormValues>;
  onProduct: (index: number, item: ComboboxItem | null) => void;
  onRemove: () => void;
  canRemove: boolean;
  errors: { product_id?: string; quantity?: string; unit_price?: string };
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
  const lineTotal = multiplyDecimals(String(line?.quantity || "0"), String(line?.unit_price || "0"));
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
        <Field label={t("orders.product")} error={errors.product_id} htmlFor={`po-line-${index}-product`}>
          <Combobox
            id={`po-line-${index}-product`}
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

        <div className="grid grid-cols-2 gap-3">
          <Field label={t("orders.fieldQuantity")} error={errors.quantity} htmlFor={`po-line-${index}-qty`}>
            <input
              id={`po-line-${index}-qty`}
              inputMode="decimal"
              autoComplete="off"
              className={inputCls}
              placeholder="0.000"
              {...register(`items.${index}.quantity`)}
            />
          </Field>
          <Field label={t("orders.fieldUnitPrice")} error={errors.unit_price} htmlFor={`po-line-${index}-price`}>
            <input
              id={`po-line-${index}-price`}
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
          <MoneyDisplay value={lineTotal} className="font-semibold" />
        </div>
      </div>
    </div>
  );
}

/* ---------------- form ---------------- */
function CreateForm({ onClose, onCreated }: { onClose: () => void; onCreated: (d: PurchaseOrderDetail) => void }) {
  const t = useT();
  const copy = useOrderCopy();
  const {
    control,
    register,
    handleSubmit,
    setValue,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(createPurchaseOrderInput),
    defaultValues: { supplier_id: 0, items: [{ ...EMPTY_LINE }] },
    mode: "onBlur",
  });
  const { fields, append, remove } = useFieldArray({ control, name: "items" });
  const create = useCreatePurchaseOrder();

  const [supplier, setSupplier] = React.useState<ComboboxItem | null>(null);
  const [productLabels, setProductLabels] = React.useState<Record<number, ComboboxItem | null>>({});

  const items = useWatch({ control, name: "items" });
  const grandTotal = sumDecimals(
    (items ?? []).map((it) => multiplyDecimals(String(it?.quantity || "0"), String(it?.unit_price || "0"))),
    2,
  );

  const pickSupplier = (item: ComboboxItem | null) => {
    setSupplier(item);
    setValue("supplier_id", item?.id ?? 0, { shouldValidate: true });
  };
  const pickProduct = (index: number, item: ComboboxItem | null) => {
    setProductLabels((m) => ({ ...m, [index]: item }));
    setValue(`items.${index}.product_id`, item?.id ?? 0, { shouldValidate: true });
  };

  const rootError = errors.items?.root?.message ?? errors.items?.message;

  // the request is unchanged: one submit → one un-keyed POST /purchase-orders, never retried
  const onSubmit = (values: FormValues) => {
    create.mutate(values, {
      onSuccess: (data) => {
        toast.success(t("sales.createdToast", { order: data.po_number ?? t("po.draftPo") }), { description: t("po.createdHint") });
        reset({ supplier_id: 0, items: [{ ...EMPTY_LINE }] });
        setSupplier(null);
        setProductLabels({});
        onCreated(data);
      },
      onError: (error) => {
        const msg = isApiError(error) ? error.userMessage : t("po.createFailedFallback");
        const rid = isApiError(error) ? error.requestId : undefined;
        toast.error(t("orders.createFailed"), { description: rid ? `${msg} · ${t("task.requestRef", { id: rid })}` : msg });
      },
    });
  };

  const apiErr = create.isError && isApiError(create.error) ? create.error : null;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <SupplierField value={supplier} onPick={pickSupplier} error={errors.supplier_id?.message} />

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
            }}
          />
        ))}
        <Button variant="secondary" onClick={() => append({ ...EMPTY_LINE })} className="self-start">
          <Plus aria-hidden className="h-4 w-4" />
          {t("orders.addLine")}
        </Button>
      </div>

      {/* D-R5-1: an inline summary, not a review step */}
      <OrderSummary partyLabel={t("po.supplier")} partyName={supplier?.label ?? null} lines={items ?? []} grandTotal={grandTotal} note={t("po.draftNote")} />

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
        <Button type="submit" variant="primary" disabled={create.isPending}>
          {create.isPending ? t("orders.creating") : t("po.createDraft")}
        </Button>
      </div>
    </form>
  );
}

export function CreatePurchaseOrderDrawer({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: (d: PurchaseOrderDetail) => void;
}) {
  const t = useT();
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent title={t("po.newOrderTitle")}>
        <CreateForm onClose={() => onOpenChange(false)} onCreated={onCreated} />
      </DrawerContent>
    </Drawer>
  );
}

/* ---------------- tiny debounce ---------------- */
function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
