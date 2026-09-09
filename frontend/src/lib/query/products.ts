"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { bffJson } from "@/lib/api/browser";
import { bffUpload } from "@/lib/api/binary";
import {
  productDetailEnvelope,
  type ProductCreateInput,
  type ProductDetail,
  type ProductUpdateInput,
} from "@/lib/api/schemas/products";
import { queryKeys } from "./keys";

const RETRY_ONCE_NOT_AUTH = (failureCount: number, error: unknown) => {
  const kind = (error as { kind?: string })?.kind;
  if (kind === "unauthorized" || kind === "forbidden" || kind === "validation" || kind === "conflict") return false;
  return failureCount < 1;
};

/**
 * `GET /products/{id}` → the base ProductResponse. Editing uses this as the
 * source of truth for form defaults; the derived quantities and thresholds
 * shown in the drawer come from the list row that opened it.
 */
export function useProduct(id: number | string | null) {
  return useQuery<ProductDetail>({
    queryKey: queryKeys.products.detail(id ?? "none"),
    enabled: id !== null && id !== undefined,
    queryFn: async ({ signal }) => {
      const env = await bffJson(`/api/bff/products/${id}`, productDetailEnvelope, { signal });
      return env.data;
    },
    staleTime: 10_000,
    retry: RETRY_ONCE_NOT_AUTH,
  });
}

/**
 * After any product mutation, labels / quantities / attention counts can all
 * have moved. Invalidate every read that can surface a product.
 */
export function useProductInvalidation() {
  const qc = useQueryClient();
  return (id?: number | string) => {
    void qc.invalidateQueries({ queryKey: queryKeys.products.all });
    if (id !== undefined) void qc.invalidateQueries({ queryKey: queryKeys.products.detail(id) });
    void qc.invalidateQueries({ queryKey: queryKeys.stock.all });
    void qc.invalidateQueries({ queryKey: queryKeys.categories.all });
    void qc.invalidateQueries({ queryKey: queryKeys.batches.all });
    void qc.invalidateQueries({ queryKey: queryKeys.dashboardSummary });
    void qc.invalidateQueries({ queryKey: queryKeys.attentionSummary });
    void qc.invalidateQueries({ queryKey: queryKeys.recentActivity });
    void qc.invalidateQueries({ queryKey: ["search"] });
  };
}

export function useCreateProduct() {
  const invalidate = useProductInvalidation();
  return useMutation<ProductDetail, unknown, ProductCreateInput>({
    mutationFn: async (input) => {
      const env = await bffJson("/api/bff/products", productDetailEnvelope, { method: "POST", json: input });
      return env.data;
    },
    retry: false,
    onSuccess: (data) => invalidate(data.id),
  });
}

export function useUpdateProduct() {
  const invalidate = useProductInvalidation();
  return useMutation<ProductDetail, unknown, { id: number; patch: ProductUpdateInput }>({
    mutationFn: async ({ id, patch }) => {
      const env = await bffJson(`/api/bff/products/${id}`, productDetailEnvelope, { method: "PUT", json: patch });
      return env.data;
    },
    retry: false,
    onSuccess: (data) => invalidate(data.id),
  });
}

/** Soft-delete (deactivate). The backend keeps the row; `restore` reverses it. */
export function useDeactivateProduct() {
  const invalidate = useProductInvalidation();
  return useMutation<ProductDetail, unknown, number>({
    mutationFn: async (id) => {
      const env = await bffJson(`/api/bff/products/${id}`, productDetailEnvelope, { method: "DELETE" });
      return env.data;
    },
    retry: false,
    onSuccess: (data) => invalidate(data.id),
  });
}

export function useRestoreProduct() {
  const invalidate = useProductInvalidation();
  return useMutation<ProductDetail, unknown, number>({
    mutationFn: async (id) => {
      const env = await bffJson(`/api/bff/products/${id}/restore`, productDetailEnvelope, { method: "PUT" });
      return env.data;
    },
    retry: false,
    onSuccess: (data) => invalidate(data.id),
  });
}

export function useUploadProductImage() {
  const invalidate = useProductInvalidation();
  return useMutation<ProductDetail, unknown, { id: number; file: File }>({
    mutationFn: async ({ id, file }) => {
      const form = new FormData();
      form.append("file", file, file.name);
      const env = await bffUpload(`/api/bff/products/${id}/upload-image`, form, productDetailEnvelope);
      return env.data;
    },
    retry: false,
    onSuccess: (data) => invalidate(data.id),
  });
}
