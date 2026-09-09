"use client";

import * as React from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { ErrorState, LoadingState } from "@/components/ui/states";
import { isApiError } from "@/lib/api/errors";
import {
  productUpdateInput,
  productErrorCopy,
  type ProductDetail,
  type ProductUpdateInput,
} from "@/lib/api/schemas/products";
import { useProduct, useUpdateProduct } from "@/lib/query/products";
import { CategoryPicker, ProductField, TrackingFields, productInputCls } from "./product-form-fields";

type FormValues = {
  sku: string;
  barcode: string;
  product_name: string;
  price: string;
  category_id: number | null;
  track_batch: boolean;
  track_expiry: boolean;
};

function toForm(p: ProductDetail): FormValues {
  return {
    sku: p.sku,
    barcode: p.barcode ?? "",
    product_name: p.product_name,
    price: p.price ?? "",
    category_id: p.category_id,
    track_batch: p.track_batch,
    track_expiry: p.track_expiry,
  };
}

/** Only the fields that actually changed are sent (PUT merges via exclude_unset). */
function diff(before: FormValues, after: FormValues): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (after.sku !== before.sku) patch.sku = after.sku;
  if (after.barcode !== before.barcode) patch.barcode = after.barcode;
  if (after.product_name !== before.product_name) patch.product_name = after.product_name;
  if (after.price !== before.price) patch.price = after.price;
  if (after.category_id !== before.category_id) patch.category_id = after.category_id;
  if (after.track_batch !== before.track_batch) patch.track_batch = after.track_batch;
  if (after.track_expiry !== before.track_expiry) patch.track_expiry = after.track_expiry;
  return patch;
}

export function ProductEditForm({ product, onClose, onSaved }: { product: ProductDetail; onClose: () => void; onSaved: () => void }) {
  const initial = React.useMemo(() => toForm(product), [product]);
  const {
    control,
    register,
    handleSubmit,
    setValue,
    setError,
    formState: { errors },
  } = useForm<FormValues>({ defaultValues: initial, mode: "onBlur" });
  const update = useUpdateProduct();
  const [formError, setFormError] = React.useState<{ message: string; requestId?: string } | null>(null);

  const trackBatch = useWatch({ control, name: "track_batch" });
  const trackExpiry = useWatch({ control, name: "track_expiry" });
  const categoryId = useWatch({ control, name: "category_id" });

  const hadInventoryHistory = product.stock_qty !== "0" && product.stock_qty !== "0.000";

  const submit = (values: FormValues) => {
    setFormError(null);
    const patch = diff(initial, values);
    if (Object.keys(patch).length === 0) {
      toast.message("No changes to save");
      onClose();
      return;
    }
    const parsed = productUpdateInput.safeParse(patch);
    if (!parsed.success) {
      for (const issue of (parsed.error as z.ZodError).issues) {
        const key = String(issue.path[0] ?? "") as keyof FormValues;
        if (key) setError(key, { message: issue.message });
      }
      return;
    }
    update.mutate(
      { id: product.id, patch: parsed.data as ProductUpdateInput },
      {
        onSuccess: (data) => {
          toast.success(`${data.sku} updated`);
          onSaved();
          onClose();
        },
        onError: (error) => {
          if (isApiError(error) && error.kind === "validation" && error.details.length) {
            for (const d of error.details) {
              if (d.field && d.field in initial) setError(d.field as keyof FormValues, { message: d.message });
            }
            return;
          }
          if (isApiError(error)) {
            setFormError({ message: productErrorCopy(error.message) ?? error.userMessage, requestId: error.requestId });
          } else {
            setFormError({ message: "Could not update the product." });
          }
        },
      },
    );
  };

  return (
    <form onSubmit={handleSubmit(submit)} className="flex flex-col gap-4" noValidate>
      <ProductField label="SKU" htmlFor="pe-sku" required error={errors.sku?.message}>
        <input id="pe-sku" className={productInputCls} autoComplete="off" {...register("sku")} />
      </ProductField>

      <ProductField label="Product name" htmlFor="pe-name" required error={errors.product_name?.message}>
        <input id="pe-name" className={productInputCls} autoComplete="off" {...register("product_name")} />
      </ProductField>

      <ProductField label="Barcode" htmlFor="pe-barcode" hint="Clear to remove the barcode." error={errors.barcode?.message}>
        <input id="pe-barcode" className={productInputCls} autoComplete="off" {...register("barcode")} />
      </ProductField>

      <ProductField label="Unit price" htmlFor="pe-price" required error={errors.price?.message}>
        <input id="pe-price" inputMode="decimal" className={productInputCls} placeholder="0.00" {...register("price")} />
      </ProductField>

      <CategoryPicker
        value={categoryId}
        onChange={(id) => setValue("category_id", id, { shouldValidate: true })}
        error={errors.category_id?.message}
      />

      <TrackingFields
        trackBatch={trackBatch}
        trackExpiry={trackExpiry}
        disabled={hadInventoryHistory}
        disabledReason="Batch tracking is locked because this product already has stock or movement history (backend rule)."
        onChange={(next) => {
          setValue("track_batch", next.track_batch);
          setValue("track_expiry", next.track_expiry);
        }}
        error={errors.track_expiry?.message}
      />

      {formError ? (
        <p role="alert" className="rounded-[var(--r-sm)] bg-[var(--danger-subtle)] p-2 text-[12px] text-[var(--danger)]">
          {formError.message}
          {formError.requestId ? (
            <span className="mt-1 block text-[11px] text-[var(--muted)]">
              Request ID: <span className="mono select-all">{formError.requestId}</span>
            </span>
          ) : null}
        </p>
      ) : null}

      <div className="sticky bottom-0 -mx-4 flex justify-end gap-2 border-t border-[var(--border)] bg-[var(--surface)] px-4 pt-3">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={update.isPending}>
          {update.isPending ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}

export function EditProductDrawer({
  productId,
  open,
  onOpenChange,
  onSaved,
}: {
  productId: number | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}) {
  const { data, isLoading, isError, error, refetch } = useProduct(open ? productId : null);
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent title="Edit product">
        {isLoading ? (
          <LoadingState label="Loading product…" />
        ) : isError ? (
          <ErrorState error={error} onRetry={() => void refetch()} />
        ) : data ? (
          <ProductEditForm product={data} onClose={() => onOpenChange(false)} onSaved={onSaved} />
        ) : null}
      </DrawerContent>
    </Drawer>
  );
}
