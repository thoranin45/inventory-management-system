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
import { isApiError } from "@/lib/api/errors";
import { multiplyDecimals, sumDecimals } from "@/lib/decimal";
import { useGlobalSearch } from "@/lib/query/hooks";
import { useCreateSalesOrder, useCustomerSearch } from "@/lib/query/sales";
import {
  createSalesOrderInput,
  type CreateSalesOrderInput,
  type SalesMutationResult,
} from "@/lib/api/schemas/sales";

type FormValues = CreateSalesOrderInput;

const EMPTY_LINE = { product_id: 0, quantity: "", unit_price: "" };

function Field({ label, error, children, htmlFor }: { label: string; error?: string; children: React.ReactNode; htmlFor?: string }) {
  return (
    <label className="flex flex-col gap-1" htmlFor={htmlFor}>
      <span className="text-[12px] font-semibold text-[var(--muted)]">{label}</span>
      {children}
      {error ? <span className="text-[11px] text-[var(--danger)]">{error}</span> : null}
    </label>
  );
}

const inputCls =
  "min-h-11 rounded-[var(--r-sm)] border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-[13px] tabular-nums outline-none focus-visible:outline-2 focus-visible:outline-[var(--focus)]";

/* ---------------- customer selector ---------------- */
function CustomerField({
  value,
  onPick,
  error,
}: {
  value: ComboboxItem | null;
  onPick: (item: ComboboxItem | null) => void;
  error?: string;
}) {
  const [term, setTerm] = React.useState("");
  const debounced = useDebounced(term, 250);
  const { data, isFetching } = useCustomerSearch(debounced);
  const items: ComboboxItem[] = (data ?? []).map((c) => ({
    id: c.id,
    label: c.customer_name,
    sublabel: [c.phone, c.email].filter(Boolean).join(" · ") || undefined,
  }));
  return (
    <Field label="Customer" error={error} htmlFor="so-customer">
      <Combobox
        id="so-customer"
        ariaLabel="Search customers"
        value={value}
        onChange={onPick}
        onSearch={setTerm}
        items={items}
        loading={isFetching}
        placeholder="Search customers by name…"
        emptyText="No customers match"
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
  errors: {
    product_id?: string;
    quantity?: string;
    unit_price?: string;
  };
  selectedLabel: ComboboxItem | null;
}) {
  const [term, setTerm] = React.useState("");
  const debounced = useDebounced(term, 250);
  const search = useGlobalSearch(debounced, debounced.trim().length >= 2);
  const items: ComboboxItem[] = (search.data?.results ?? [])
    .filter((r) => r.type === "product")
    .map((r) => ({ id: Number(r.id), label: r.label, sublabel: r.sublabel ?? undefined }));

  const line = useWatch({ control, name: `items.${index}` });
  const lineTotal = multiplyDecimals(String(line?.quantity || "0"), String(line?.unit_price || "0"));

  return (
    <div className="rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--faint)]">
          Line {index + 1}
        </span>
        {canRemove ? (
          <Button size="icon" variant="ghost" aria-label={`Remove line ${index + 1}`} onClick={onRemove}>
            <Trash2 aria-hidden className="h-4 w-4" />
          </Button>
        ) : null}
      </div>

      <div className="flex flex-col gap-3">
        <Field label="Product" error={errors.product_id} htmlFor={`so-line-${index}-product`}>
          <Combobox
            id={`so-line-${index}-product`}
            ariaLabel={`Search products for line ${index + 1}`}
            value={selectedLabel}
            onChange={(item) => onProduct(index, item)}
            onSearch={setTerm}
            items={items}
            loading={search.isFetching}
            placeholder="Search products by SKU or name…"
            emptyText={debounced.trim().length < 2 ? "Type at least 2 characters" : "No products match"}
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Quantity" error={errors.quantity} htmlFor={`so-line-${index}-qty`}>
            <input
              id={`so-line-${index}-qty`}
              inputMode="decimal"
              autoComplete="off"
              className={inputCls}
              placeholder="0.000"
              {...register(`items.${index}.quantity`)}
            />
          </Field>
          <Field label="Unit price" error={errors.unit_price} htmlFor={`so-line-${index}-price`}>
            <input
              id={`so-line-${index}-price`}
              inputMode="decimal"
              autoComplete="off"
              className={inputCls}
              placeholder="0.00"
              {...register(`items.${index}.unit_price`)}
            />
          </Field>
        </div>

        <div className="flex items-baseline justify-between text-[12px]">
          <span className="text-[var(--muted)]">Line total</span>
          <MoneyDisplay value={lineTotal} className="font-semibold" />
        </div>
      </div>
    </div>
  );
}

/* ---------------- form ---------------- */
function CreateForm({ onClose, onCreated }: { onClose: () => void; onCreated: (r: SalesMutationResult) => void }) {
  const {
    control,
    register,
    handleSubmit,
    setValue,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(createSalesOrderInput),
    defaultValues: { customer_id: 0, items: [{ ...EMPTY_LINE }] },
    mode: "onBlur",
  });
  const { fields, append, remove } = useFieldArray({ control, name: "items" });
  const create = useCreateSalesOrder();

  const [customer, setCustomer] = React.useState<ComboboxItem | null>(null);
  const [productLabels, setProductLabels] = React.useState<Record<number, ComboboxItem | null>>({});

  const items = useWatch({ control, name: "items" });
  const grandTotal = sumDecimals(
    (items ?? []).map((it) => multiplyDecimals(String(it?.quantity || "0"), String(it?.unit_price || "0"))),
    2,
  );

  const pickCustomer = (item: ComboboxItem | null) => {
    setCustomer(item);
    setValue("customer_id", item?.id ?? 0, { shouldValidate: true });
  };
  const pickProduct = (index: number, item: ComboboxItem | null) => {
    setProductLabels((m) => ({ ...m, [index]: item }));
    setValue(`items.${index}.product_id`, item?.id ?? 0, { shouldValidate: true });
  };

  const rootError = errors.items?.root?.message ?? errors.items?.message;

  const onSubmit = (values: FormValues) => {
    create.mutate(values, {
      onSuccess: (data) => {
        toast.success(`${data.so_number ?? "Draft"} created`, { description: "Saved as a draft — confirm it to allocate stock." });
        reset({ customer_id: 0, items: [{ ...EMPTY_LINE }] });
        setCustomer(null);
        setProductLabels({});
        onCreated(data);
      },
      onError: (error) => {
        const msg = isApiError(error) ? error.userMessage : "Could not create the order.";
        const rid = isApiError(error) ? error.requestId : undefined;
        toast.error("Create failed", { description: rid ? `${msg} · Request ${rid}` : msg });
      },
    });
  };

  const apiErr = create.isError && isApiError(create.error) ? create.error : null;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
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
            }}
          />
        ))}
        <Button variant="secondary" onClick={() => append({ ...EMPTY_LINE })} className="self-start">
          <Plus aria-hidden className="h-4 w-4" />
          Add product line
        </Button>
      </div>

      <div className="flex items-baseline justify-between border-t border-[var(--border)] pt-3 text-[13px]">
        <span className="font-semibold">Grand total</span>
        <MoneyDisplay value={grandTotal} className="text-[15px] font-semibold" />
      </div>

      {rootError ? (
        <p role="alert" className="rounded-[var(--r-sm)] bg-[var(--danger-subtle)] p-2 text-[12px] text-[var(--danger)]">
          {rootError}
        </p>
      ) : null}
      {apiErr ? (
        <p role="alert" className="rounded-[var(--r-sm)] bg-[var(--danger-subtle)] p-2 text-[12px] text-[var(--danger)]">
          {apiErr.userMessage}
          {apiErr.details.length > 0 ? (
            <span className="mt-1 block">
              {apiErr.details.map((d, i) => (
                <span key={i} className="block">
                  {d.field ? `${d.field}: ` : ""}
                  {d.message}
                </span>
              ))}
            </span>
          ) : null}
          {apiErr.requestId ? (
            <span className="mt-1 block text-[11px] text-[var(--muted)]">
              Request ID: <span className="mono select-all">{apiErr.requestId}</span>
            </span>
          ) : null}
        </p>
      ) : null}

      <div className="sticky bottom-0 -mx-4 flex justify-end gap-2 border-t border-[var(--border)] bg-[var(--surface)] px-4 pt-3">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={create.isPending}>
          {create.isPending ? "Creating…" : "Create draft order"}
        </Button>
      </div>
    </form>
  );
}

export function CreateSalesOrderDrawer({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: (r: SalesMutationResult) => void;
}) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent title="New sales order">
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
