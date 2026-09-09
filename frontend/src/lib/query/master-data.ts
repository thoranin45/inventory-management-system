"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { bffJson } from "@/lib/api/browser";
import {
  batchListEnvelope,
  categoryInput,
  categoryListEnvelope,
  categoryMutationEnvelope,
  customerInput,
  customerListEnvelope,
  customerMutationEnvelope,
  supplierInput,
  supplierListEnvelope,
  supplierMutationEnvelope,
  type BatchRow,
  type CategoryInput,
  type CategoryListEnvelope,
  type CategoryRow,
  type CustomerInput,
  type CustomerListEnvelope,
  type CustomerRow,
  type SupplierInput,
  type SupplierListEnvelope,
  type SupplierRow,
} from "@/lib/api/schemas/master-data";
import { queryKeys } from "./keys";

type Query = Record<string, string | number | boolean | undefined | null>;

const RETRY_ONCE_NOT_AUTH = (failureCount: number, error: unknown) => {
  const kind = (error as { kind?: string })?.kind;
  if (kind === "unauthorized" || kind === "forbidden" || kind === "validation" || kind === "conflict") return false;
  return failureCount < 1;
};

function useMasterInvalidation() {
  const qc = useQueryClient();
  return (...roots: readonly (readonly string[])[]) => {
    for (const root of roots) void qc.invalidateQueries({ queryKey: root });
    void qc.invalidateQueries({ queryKey: ["search"] });
  };
}

/* ============================================================ categories === */

export function useCategories(query: Query) {
  return useQuery<CategoryListEnvelope["data"]>({
    queryKey: queryKeys.categories.list(query as Record<string, unknown>),
    queryFn: async ({ signal }) => {
      const env = await bffJson("/api/bff/categories", categoryListEnvelope, { query, signal });
      return env.data;
    },
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    retry: RETRY_ONCE_NOT_AUTH,
  });
}

/**
 * All categories for a product form's picker. The backend caps page_size at
 * 100; a real deployment with more categories should move to an async
 * combobox (noted in the report).
 */
export function useAllCategories(enabled = true) {
  return useQuery<CategoryRow[]>({
    queryKey: queryKeys.categories.list({ all: true }),
    enabled,
    queryFn: async ({ signal }) => {
      const env = await bffJson("/api/bff/categories", categoryListEnvelope, {
        query: { page: 1, page_size: 100, sort_by: "category_name", sort_order: "asc" },
        signal,
      });
      return env.data.items;
    },
    staleTime: 60_000,
    retry: RETRY_ONCE_NOT_AUTH,
  });
}

export function useCreateCategory() {
  const invalidate = useMasterInvalidation();
  return useMutation<CategoryRow, unknown, CategoryInput>({
    mutationFn: async (input) => {
      const json = categoryInput.parse(input);
      const env = await bffJson("/api/bff/categories", categoryMutationEnvelope, { method: "POST", json });
      return env.data;
    },
    retry: false,
    onSuccess: () => invalidate(queryKeys.categories.all, queryKeys.products.all),
  });
}

export function useUpdateCategory() {
  const invalidate = useMasterInvalidation();
  return useMutation<CategoryRow, unknown, { id: number; patch: CategoryInput }>({
    mutationFn: async ({ id, patch }) => {
      const json = categoryInput.parse(patch);
      const env = await bffJson(`/api/bff/categories/${id}`, categoryMutationEnvelope, { method: "PUT", json });
      return env.data;
    },
    retry: false,
    onSuccess: () => invalidate(queryKeys.categories.all, queryKeys.products.all),
  });
}

export function useDeleteCategory() {
  const invalidate = useMasterInvalidation();
  return useMutation<CategoryRow, unknown, number>({
    mutationFn: async (id) => {
      const env = await bffJson(`/api/bff/categories/${id}`, categoryMutationEnvelope, { method: "DELETE" });
      return env.data;
    },
    retry: false,
    onSuccess: () => invalidate(queryKeys.categories.all, queryKeys.products.all),
  });
}

/* ============================================================= customers === */

export function useCustomers(query: Query) {
  return useQuery<CustomerListEnvelope["data"]>({
    queryKey: queryKeys.customers.list(query as Record<string, unknown>),
    queryFn: async ({ signal }) => {
      const env = await bffJson("/api/bff/customers", customerListEnvelope, { query, signal });
      return env.data;
    },
    placeholderData: keepPreviousData,
    staleTime: 20_000,
    retry: RETRY_ONCE_NOT_AUTH,
  });
}

export function useCreateCustomer() {
  const invalidate = useMasterInvalidation();
  return useMutation<CustomerRow, unknown, CustomerInput>({
    mutationFn: async (input) => {
      const json = customerInput.parse(input);
      const env = await bffJson("/api/bff/customers", customerMutationEnvelope, { method: "POST", json });
      return env.data;
    },
    retry: false,
    onSuccess: () => invalidate(queryKeys.customers.all),
  });
}

export function useUpdateCustomer() {
  const invalidate = useMasterInvalidation();
  return useMutation<CustomerRow, unknown, { id: number; patch: CustomerInput }>({
    mutationFn: async ({ id, patch }) => {
      const json = customerInput.parse(patch);
      const env = await bffJson(`/api/bff/customers/${id}`, customerMutationEnvelope, { method: "PUT", json });
      return env.data;
    },
    retry: false,
    onSuccess: () => invalidate(queryKeys.customers.all, queryKeys.sales.all),
  });
}

export function useDeleteCustomer() {
  const invalidate = useMasterInvalidation();
  return useMutation<CustomerRow, unknown, number>({
    mutationFn: async (id) => {
      const env = await bffJson(`/api/bff/customers/${id}`, customerMutationEnvelope, { method: "DELETE" });
      return env.data;
    },
    retry: false,
    onSuccess: () => invalidate(queryKeys.customers.all),
  });
}

/* ============================================================= suppliers === */

export function useSuppliers(query: Query) {
  return useQuery<SupplierListEnvelope["data"]>({
    queryKey: queryKeys.suppliers.list(query as Record<string, unknown>),
    queryFn: async ({ signal }) => {
      const env = await bffJson("/api/bff/suppliers", supplierListEnvelope, { query, signal });
      return env.data;
    },
    placeholderData: keepPreviousData,
    staleTime: 20_000,
    retry: RETRY_ONCE_NOT_AUTH,
  });
}

export function useCreateSupplier() {
  const invalidate = useMasterInvalidation();
  return useMutation<SupplierRow, unknown, SupplierInput>({
    mutationFn: async (input) => {
      const json = supplierInput.parse(input);
      const env = await bffJson("/api/bff/suppliers", supplierMutationEnvelope, { method: "POST", json });
      return env.data;
    },
    retry: false,
    onSuccess: () => invalidate(queryKeys.suppliers.all),
  });
}

export function useUpdateSupplier() {
  const invalidate = useMasterInvalidation();
  return useMutation<SupplierRow, unknown, { id: number; patch: SupplierInput }>({
    mutationFn: async ({ id, patch }) => {
      const json = supplierInput.parse(patch);
      const env = await bffJson(`/api/bff/suppliers/${id}`, supplierMutationEnvelope, { method: "PUT", json });
      return env.data;
    },
    retry: false,
    onSuccess: () => invalidate(queryKeys.suppliers.all, queryKeys.purchaseOrders.all),
  });
}

export function useDeleteSupplier() {
  const invalidate = useMasterInvalidation();
  return useMutation<SupplierRow, unknown, number>({
    mutationFn: async (id) => {
      const env = await bffJson(`/api/bff/suppliers/${id}`, supplierMutationEnvelope, { method: "DELETE" });
      return env.data;
    },
    retry: false,
    onSuccess: () => invalidate(queryKeys.suppliers.all),
  });
}

/* =============================================================== batches === */

/**
 * `GET /batches` — read-only. Batch creation is not part of Product CRUD in
 * V1 (no operator workflow depends on it here); per-product batch visibility
 * comes from `useProductStock` instead.
 */
export function useBatches(query: Query, enabled = true) {
  return useQuery<{ items: BatchRow[]; pagination: { page: number; page_size: number; total_items: number; total_pages: number } }>({
    queryKey: queryKeys.batches.list(query as Record<string, unknown>),
    enabled,
    queryFn: async ({ signal }) => {
      const env = await bffJson("/api/bff/batches", batchListEnvelope, { query, signal });
      return env.data;
    },
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    retry: RETRY_ONCE_NOT_AUTH,
  });
}
