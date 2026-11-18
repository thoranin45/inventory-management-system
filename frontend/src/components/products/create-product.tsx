"use client";

import * as React from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { isApiError } from "@/lib/api/errors";
import { productCreateInput, type ProductDetail } from "@/lib/api/schemas/products";
import { useT } from "@/lib/i18n/client";
import { formMessageText, masterDataErrorText } from "@/lib/master-data-copy";
import { useCreateProduct } from "@/lib/query/products";
import { CategoryPicker, ProductField, TrackingFields, productInputCls } from "./product-form-fields";

type FormValues = {
  sku: string;
  barcode: string;
  product_name: string;
  price: string;
  stock_qty: string;
  category_id: number | null;
  track_batch: boolean;
  track_expiry: boolean;
};

const EMPTY: FormValues = {
  sku: "",
  barcode: "",
  product_name: "",
  price: "",
  stock_qty: "",
  category_id: null,
  track_batch: false,
  track_expiry: false,
};

/**
 * RHF owns field state; the real `ProductCreate` Zod schema (incl. the
 * track_expiry ⇒ track_batch rule and the transforms that drop empty
 * optionals) is the authoritative gate on submit.
 */
function CreateForm({
  initialBarcode,
  onClose,
  onCreated,
}: {
  /** Pre-fills the Barcode field — the "New product" onboarding entry point
   *  from a scanned barcode Product Master could not find. Still editable;
   *  we never assume the scanned code is otherwise correct. */
  initialBarcode?: string;
  onClose: () => void;
  onCreated: (p: ProductDetail) => void;
}) {
  const t = useT();
  const fm = (m: string | undefined) => formMessageText(t, m);
  const defaults = initialBarcode ? { ...EMPTY, barcode: initialBarcode } : EMPTY;
  const {
    control,
    register,
    handleSubmit,
    setValue,
    reset,
    setError,
    formState: { errors },
  } = useForm<FormValues>({ defaultValues: defaults, mode: "onBlur" });
  const create = useCreateProduct();
  const [formError, setFormError] = React.useState<{ message: string; requestId?: string } | null>(null);

  const trackBatch = useWatch({ control, name: "track_batch" });
  const trackExpiry = useWatch({ control, name: "track_expiry" });
  const categoryId = useWatch({ control, name: "category_id" });

  const submit = (values: FormValues) => {
    setFormError(null);
    const parsed = productCreateInput.safeParse(values);
    if (!parsed.success) {
      for (const issue of (parsed.error as z.ZodError).issues) {
        const key = String(issue.path[0] ?? "") as keyof FormValues;
        if (key) setError(key, { message: issue.message });
      }
      return;
    }
    create.mutate(parsed.data, {
      onSuccess: (data) => {
        toast.success(t("product.created", { sku: data.sku }), { description: data.product_name });
        reset(EMPTY);
        onCreated(data);
        onClose();
      },
      onError: (error) => {
        if (isApiError(error) && error.kind === "validation" && error.details.length) {
          for (const d of error.details) {
            if (d.field && d.field in EMPTY) setError(d.field as keyof FormValues, { message: d.message });
          }
          return;
        }
        if (isApiError(error)) {
          setFormError({ message: masterDataErrorText(t, error.message, error.userMessage), requestId: error.requestId });
        } else {
          setFormError({ message: t("product.couldNotCreate") });
        }
      },
    });
  };

  return (
    <form onSubmit={handleSubmit(submit)} className="flex flex-col gap-4" noValidate>
      <ProductField label={t("product.sku")} htmlFor="pf-sku" required error={fm(errors.sku?.message)}>
        <input id="pf-sku" className={productInputCls} autoComplete="off" placeholder={t("product.skuPlaceholder")} {...register("sku")} />
      </ProductField>

      <ProductField label={t("product.productName")} htmlFor="pf-name" required error={fm(errors.product_name?.message)}>
        <input id="pf-name" className={productInputCls} autoComplete="off" {...register("product_name")} />
      </ProductField>

      <ProductField
        label={t("product.barcode")}
        htmlFor="pf-barcode"
        hint={t("product.barcodeHintCreate")}
        error={fm(errors.barcode?.message)}
      >
        <input id="pf-barcode" className={productInputCls} autoComplete="off" {...register("barcode")} />
      </ProductField>

      <div className="grid grid-cols-2 gap-3">
        <ProductField label={t("product.unitPrice")} htmlFor="pf-price" required error={fm(errors.price?.message)}>
          <input id="pf-price" inputMode="decimal" className={productInputCls} placeholder="0.00" {...register("price")} />
        </ProductField>
        <ProductField
          label={t("product.openingStock")}
          htmlFor="pf-stock"
          hint={t("product.openingStockHint")}
          error={fm(errors.stock_qty?.message)}
        >
          <input id="pf-stock" inputMode="decimal" className={productInputCls} placeholder="0.000" {...register("stock_qty")} />
        </ProductField>
      </div>

      <CategoryPicker
        value={categoryId}
        onChange={(id) => setValue("category_id", id, { shouldValidate: true })}
        error={fm(errors.category_id?.message)}
      />

      <TrackingFields
        trackBatch={trackBatch}
        trackExpiry={trackExpiry}
        onChange={(next) => {
          setValue("track_batch", next.track_batch);
          setValue("track_expiry", next.track_expiry);
        }}
        error={fm(errors.track_expiry?.message)}
      />

      {formError ? (
        <p role="alert" className="rounded-[var(--r-sm)] bg-[var(--danger-subtle)] p-2 text-[12px] text-[var(--danger)]">
          {formError.message}
          {formError.requestId ? (
            <span className="mt-1 block text-[11px] text-[var(--muted)]">
              {t("common.requestId")} <span className="mono select-all">{formError.requestId}</span>
            </span>
          ) : null}
        </p>
      ) : null}

      <div className="sticky bottom-0 -mx-4 flex justify-end gap-2 border-t border-[var(--border)] bg-[var(--surface)] px-4 pt-3">
        <Button variant="ghost" onClick={onClose}>
          {t("product.cancel")}
        </Button>
        <Button type="submit" variant="primary" disabled={create.isPending}>
          {create.isPending ? t("product.creating") : t("product.createProduct")}
        </Button>
      </div>
    </form>
  );
}

export function CreateProductDrawer({
  open,
  onOpenChange,
  onCreated,
  initialBarcode,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: (p: ProductDetail) => void;
  /** Pre-fills Barcode — used by the "scan an unknown barcode" onboarding flow. */
  initialBarcode?: string;
}) {
  const t = useT();
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent title={t("product.newProduct")}>
        {open ? (
          <CreateForm initialBarcode={initialBarcode} onClose={() => onOpenChange(false)} onCreated={onCreated} />
        ) : null}
      </DrawerContent>
    </Drawer>
  );
}
