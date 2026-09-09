"use client";

import * as React from "react";
import { useFieldArray, useForm, useWatch, type Control, type UseFormRegister } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxItem } from "@/components/ui/combobox";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { QuantityDisplay } from "@/components/ui/quantity-display";
import { isApiError } from "@/lib/api/errors";
import { compareDecimals } from "@/lib/decimal";
import { useGlobalSearch, useProductStock, useStockBalances } from "@/lib/query/hooks";
import { useCreateTransfer, useWarehouseNames } from "@/lib/query/transfers";
import { createTransferInput, type CreateTransferInput, type TransferDetail } from "@/lib/api/schemas/transfers";
import type { StockBalanceRow } from "@/lib/api/schemas/stock";
import { cn } from "@/lib/utils";

type FormValues = CreateTransferInput;
const EMPTY_LINE = { product_id: 0, batch_id: null as number | null, from_location_id: 0, to_location_id: 0, quantity: "" };

const inputCls =
  "min-h-11 rounded-[var(--r-sm)] border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-[13px] tabular-nums outline-none focus-visible:outline-2 focus-visible:outline-[var(--focus)]";

function Field({ label, error, children, htmlFor }: { label: string; error?: string; children: React.ReactNode; htmlFor?: string }) {
  return (
    <label className="flex flex-col gap-1" htmlFor={htmlFor}>
      <span className="text-[12px] font-semibold text-[var(--muted)]">{label}</span>
      {children}
      {error ? <span className="text-[11px] text-[var(--danger)]">{error}</span> : null}
    </label>
  );
}

/** A `(warehouse, location)` pair — no /warehouses or /locations endpoint exists,
 *  so we compose these from non-transit stock balances. */
export interface StoragePair {
  key: string;
  warehouse_id: number;
  location_id: number;
  label: string;
}

function pairsFromBalances(balances: StockBalanceRow[], names: Record<number, string>): StoragePair[] {
  const seen = new Map<string, StoragePair>();
  for (const b of balances) {
    if (b.is_transit || b.warehouse_id == null || b.location_id == null) continue;
    const wid = b.warehouse_id;
    const lid = b.location_id;
    const key = `${wid}:${lid}`;
    if (!seen.has(key)) {
      seen.set(key, {
        key,
        warehouse_id: wid,
        location_id: lid,
        label: `${names[wid] ?? `Warehouse #${wid}`} · Location #${lid}`,
      });
    }
  }
  return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/* ---------------- one transfer line ---------------- */
function TransferLine({
  index,
  control,
  register,
  onProduct,
  onBatch,
  onRemove,
  canRemove,
  errors,
  selectedProduct,
  sourcePair,
}: {
  index: number;
  control: Control<FormValues>;
  register: UseFormRegister<FormValues>;
  onProduct: (index: number, item: ComboboxItem | null) => void;
  onBatch: (index: number, batchId: number | null) => void;
  onRemove: () => void;
  canRemove: boolean;
  errors: { product_id?: string; batch_id?: string; quantity?: string; from_location_id?: string };
  selectedProduct: ComboboxItem | null;
  sourcePair: StoragePair | null;
}) {
  const [term, setTerm] = React.useState("");
  const debounced = useDebounced(term, 250);
  const search = useGlobalSearch(debounced, debounced.trim().length >= 2);
  const productItems: ComboboxItem[] = (search.data?.results ?? [])
    .filter((r) => r.type === "product")
    .map((r) => ({ id: Number(r.id), label: r.label, sublabel: r.sublabel ?? undefined }));

  const line = useWatch({ control, name: `items.${index}` });
  const productId = line?.product_id ?? 0;
  const batchId = line?.batch_id ?? null;

  // batch / balance options for the chosen product at the chosen source pair
  const stockQ = useProductStock(productId > 0 ? productId : null);
  const atSource = (stockQ.data?.items ?? []).filter(
    (b) =>
      !b.is_transit &&
      sourcePair != null &&
      b.warehouse_id === sourcePair.warehouse_id &&
      b.location_id === sourcePair.location_id,
  );
  const usable = atSource.filter((b) => compareDecimals(b.available_qty, "0") > 0 || b.is_expired);
  const isBatchTracked = atSource.some((b) => b.batch_id != null);
  const chosen = batchId != null ? atSource.find((b) => b.batch_id === batchId) : atSource.find((b) => b.batch_id == null);
  const avail = chosen?.available_qty ?? "0";

  const qtyStr = String(line?.quantity ?? "").trim();
  const overAvail = qtyStr && chosen && !chosen.is_expired && compareDecimals(qtyStr, avail) > 0;

  return (
    <div className="rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--faint)]">Line {index + 1}</span>
        {canRemove ? (
          <Button size="icon" variant="ghost" aria-label={`Remove line ${index + 1}`} onClick={onRemove}>
            <Trash2 aria-hidden className="h-4 w-4" />
          </Button>
        ) : null}
      </div>

      <div className="flex flex-col gap-3">
        <Field label="Product" error={errors.product_id} htmlFor={`tr-line-${index}-product`}>
          <Combobox
            id={`tr-line-${index}-product`}
            ariaLabel={`Search products for line ${index + 1}`}
            value={selectedProduct}
            onChange={(item) => onProduct(index, item)}
            onSearch={setTerm}
            items={productItems}
            loading={search.isFetching}
            placeholder="Search products by SKU or name…"
            emptyText={debounced.trim().length < 2 ? "Type at least 2 characters" : "No products match"}
          />
        </Field>

        {productId > 0 && sourcePair ? (
          isBatchTracked ? (
            <Field label="Source batch" error={errors.batch_id} htmlFor={`tr-line-${index}-batch`}>
              <select
                id={`tr-line-${index}-batch`}
                className={inputCls}
                value={batchId ?? ""}
                onChange={(e) => onBatch(index, e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">Choose a batch…</option>
                {usable.map((b) => (
                  <option key={b.id} value={b.batch_id ?? ""} disabled={b.is_expired}>
                    batch #{b.batch_id}
                    {b.batch_expiry_date ? ` · exp ${b.batch_expiry_date}` : ""}
                    {b.is_expired ? " · EXPIRED — cannot dispatch" : ` · avail ${b.available_qty}`}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <p className="text-[11.5px] text-[var(--muted)]">
              Non-batch product · {avail === "0" ? "no stock at the source" : <>available <QuantityDisplay value={avail} /></>}
            </p>
          )
        ) : null}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Quantity" error={errors.quantity} htmlFor={`tr-line-${index}-qty`}>
            <input
              id={`tr-line-${index}-qty`}
              inputMode="decimal"
              autoComplete="off"
              className={cn(inputCls, overAvail && "border-[var(--danger)]")}
              placeholder="0.000"
              {...register(`items.${index}.quantity`)}
            />
          </Field>
          <div className="flex flex-col justify-end text-[11.5px] text-[var(--muted)]">
            {chosen ? (
              chosen.is_expired ? (
                <span className="text-[var(--danger)]">Expired batch — pick another</span>
              ) : (
                <span>
                  available at source: <QuantityDisplay value={avail} className="font-semibold text-[var(--foreground)]" />
                </span>
              )
            ) : (
              <span>Pick a source with stock</span>
            )}
          </div>
        </div>
        {overAvail ? <p className="text-[11px] text-[var(--danger)]">Only {avail} available at the source</p> : null}
      </div>
    </div>
  );
}

/* ---------------- form ---------------- */
function CreateForm({ onClose, onCreated }: { onClose: () => void; onCreated: (d: TransferDetail) => void }) {
  const balancesQ = useStockBalances({ page: 1, page_size: 100 });
  const namesQ = useWarehouseNames();
  const pairs = React.useMemo(
    () => pairsFromBalances(balancesQ.data?.items ?? [], namesQ.data ?? {}),
    [balancesQ.data, namesQ.data],
  );

  const [source, setSource] = React.useState<StoragePair | null>(null);
  const [dest, setDest] = React.useState<StoragePair | null>(null);
  const destOptions = pairs.filter((p) => !source || p.warehouse_id !== source.warehouse_id);

  const {
    control,
    register,
    handleSubmit,
    setValue,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(createTransferInput),
    defaultValues: { source_warehouse_id: 0, destination_warehouse_id: 0, items: [{ ...EMPTY_LINE }] },
    mode: "onBlur",
  });
  const { fields, append, remove } = useFieldArray({ control, name: "items" });
  const create = useCreateTransfer();
  const [productLabels, setProductLabels] = React.useState<Record<number, ComboboxItem | null>>({});

  const applySource = (p: StoragePair | null) => {
    setSource(p);
    if (dest && p && dest.warehouse_id === p.warehouse_id) setDest(null);
    setValue("source_warehouse_id", p?.warehouse_id ?? 0, { shouldValidate: true });
    fields.forEach((_, i) => setValue(`items.${i}.from_location_id`, p?.location_id ?? 0));
  };
  const applyDest = (p: StoragePair | null) => {
    setDest(p);
    setValue("destination_warehouse_id", p?.warehouse_id ?? 0, { shouldValidate: true });
    fields.forEach((_, i) => setValue(`items.${i}.to_location_id`, p?.location_id ?? 0));
  };
  const pickProduct = (index: number, item: ComboboxItem | null) => {
    setProductLabels((m) => ({ ...m, [index]: item }));
    setValue(`items.${index}.product_id`, item?.id ?? 0, { shouldValidate: true });
    setValue(`items.${index}.batch_id`, null);
    setValue(`items.${index}.from_location_id`, source?.location_id ?? 0);
    setValue(`items.${index}.to_location_id`, dest?.location_id ?? 0);
  };
  const pickBatch = (index: number, batchId: number | null) => {
    setValue(`items.${index}.batch_id`, batchId, { shouldValidate: true });
  };

  const rootItemsError = errors.items?.root?.message ?? errors.items?.message;

  const onSubmit = (values: FormValues) => {
    create.mutate(values, {
      onSuccess: (data) => {
        toast.success(`${data.transfer_number} created`, { description: "Saved as a draft — dispatch it to move stock into transit." });
        reset({ source_warehouse_id: 0, destination_warehouse_id: 0, items: [{ ...EMPTY_LINE }] });
        setSource(null);
        setDest(null);
        setProductLabels({});
        onCreated(data);
      },
      onError: (error) => {
        const msg = isApiError(error) ? error.userMessage : "Could not create the transfer.";
        const rid = isApiError(error) ? error.requestId : undefined;
        toast.error("Create failed", { description: rid ? `${msg} · Request ${rid}` : msg });
      },
    });
  };

  const apiErr = create.isError && isApiError(create.error) ? create.error : null;
  const selectCls = inputCls;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <p className="rounded-[var(--r-sm)] bg-[var(--surface-sunken)] p-2 text-[11px] text-[var(--muted)]">
        Source and destination are chosen from operational locations that currently hold inventory (there is no
        warehouse / location directory API). System transit is never listed.
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Source (warehouse · location)" error={errors.source_warehouse_id?.message} htmlFor="tr-source">
          <select
            id="tr-source"
            className={selectCls}
            value={source?.key ?? ""}
            onChange={(e) => applySource(pairs.find((p) => p.key === e.target.value) ?? null)}
          >
            <option value="">Choose a source…</option>
            {pairs.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Destination (warehouse · location)" error={errors.destination_warehouse_id?.message} htmlFor="tr-dest">
          <select
            id="tr-dest"
            className={selectCls}
            value={dest?.key ?? ""}
            disabled={!source}
            onChange={(e) => applyDest(destOptions.find((p) => p.key === e.target.value) ?? null)}
          >
            <option value="">{source ? "Choose a destination…" : "Choose a source first"}</option>
            {destOptions.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Remark (optional)" htmlFor="tr-remark">
        <input id="tr-remark" className={inputCls} maxLength={500} autoComplete="off" {...register("remark")} />
      </Field>

      <div className="flex flex-col gap-3">
        {fields.map((f, i) => (
          <TransferLine
            key={f.id}
            index={i}
            control={control}
            register={register}
            onProduct={pickProduct}
            onBatch={pickBatch}
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
            selectedProduct={productLabels[i] ?? null}
            sourcePair={source}
            errors={{
              product_id: errors.items?.[i]?.product_id?.message,
              batch_id: errors.items?.[i]?.batch_id?.message,
              quantity: errors.items?.[i]?.quantity?.message,
              from_location_id: errors.items?.[i]?.from_location_id?.message,
            }}
          />
        ))}
        <Button
          variant="secondary"
          onClick={() =>
            append({ ...EMPTY_LINE, from_location_id: source?.location_id ?? 0, to_location_id: dest?.location_id ?? 0 })
          }
          className="self-start"
        >
          <Plus aria-hidden className="h-4 w-4" />
          Add line
        </Button>
      </div>

      {rootItemsError ? (
        <p role="alert" className="rounded-[var(--r-sm)] bg-[var(--danger-subtle)] p-2 text-[12px] text-[var(--danger)]">
          {rootItemsError}
        </p>
      ) : null}
      {apiErr ? (
        <p role="alert" className="rounded-[var(--r-sm)] bg-[var(--danger-subtle)] p-2 text-[12px] text-[var(--danger)]">
          {apiErr.userMessage}
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
          {create.isPending ? "Creating…" : "Create draft transfer"}
        </Button>
      </div>
    </form>
  );
}

export function CreateTransferDrawer({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: (d: TransferDetail) => void;
}) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent title="New inventory transfer">
        <CreateForm onClose={() => onOpenChange(false)} onCreated={onCreated} />
      </DrawerContent>
    </Drawer>
  );
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
