"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { bffJson } from "@/lib/api/browser";
import {
  createPurchaseOrderInput,
  poActionEnvelope,
  purchaseOrderDetailEnvelope,
  purchaseOrderListEnvelope,
  purchaseOrderReceiveEnvelope,
  supplierListEnvelope,
  type CreatePurchaseOrderInput,
  type PoActionResult,
  type PurchaseOrderDetail,
  type PurchaseOrderListEnvelope,
  type PurchaseOrderReceiveResult,
  type SupplierRow,
} from "@/lib/api/schemas/purchase-orders";
import type { ReceivePayload } from "@/lib/receipt-draft";
import { queryKeys } from "./keys";

type Query = Record<string, string | number | boolean | undefined | null>;

const RETRY_ONCE_NOT_AUTH = (failureCount: number, error: unknown) => {
  const kind = (error as { kind?: string })?.kind;
  if (kind === "unauthorized" || kind === "forbidden" || kind === "validation" || kind === "conflict") return false;
  return failureCount < 1;
};

/* ---------------- queries ---------------- */

export function usePurchaseOrders(query: Query) {
  return useQuery<PurchaseOrderListEnvelope["data"]>({
    queryKey: queryKeys.purchaseOrders.list(query as Record<string, unknown>),
    queryFn: async ({ signal }) => {
      const env = await bffJson("/api/bff/purchase-orders", purchaseOrderListEnvelope, { query, signal });
      return env.data;
    },
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    retry: RETRY_ONCE_NOT_AUTH,
  });
}

export function usePurchaseOrder(id: number | string | null) {
  return useQuery<PurchaseOrderDetail>({
    queryKey: queryKeys.purchaseOrders.detail(id ?? "none"),
    enabled: id !== null && id !== undefined,
    queryFn: async ({ signal }) => {
      const env = await bffJson(`/api/bff/purchase-orders/${id}`, purchaseOrderDetailEnvelope, { signal });
      return env.data;
    },
    staleTime: 10_000,
    retry: RETRY_ONCE_NOT_AUTH,
  });
}

export function useSupplierSearch(search: string, enabled = true) {
  const q = search.trim();
  return useQuery<SupplierRow[]>({
    queryKey: queryKeys.suppliers.list({ search: q }),
    enabled,
    queryFn: async ({ signal }) => {
      const env = await bffJson("/api/bff/suppliers", supplierListEnvelope, {
        query: { page: 1, page_size: 20, search: q || undefined },
        signal,
      });
      return env.data.items;
    },
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    retry: RETRY_ONCE_NOT_AUTH,
  });
}

/* ---------------- mutations ---------------- */

function usePoInvalidation() {
  const qc = useQueryClient();
  return (id?: number | string) => {
    void qc.invalidateQueries({ queryKey: queryKeys.purchaseOrders.all });
    if (id !== undefined) void qc.invalidateQueries({ queryKey: queryKeys.purchaseOrders.detail(id) });
    void qc.invalidateQueries({ queryKey: queryKeys.dashboardSummary });
    void qc.invalidateQueries({ queryKey: queryKeys.attentionSummary });
    void qc.invalidateQueries({ queryKey: queryKeys.recentActivity });
  };
}

export function useCreatePurchaseOrder() {
  const invalidate = usePoInvalidation();
  return useMutation<PurchaseOrderDetail, unknown, CreatePurchaseOrderInput>({
    mutationFn: async (input) => {
      const json = createPurchaseOrderInput.parse(input);
      const env = await bffJson("/api/bff/purchase-orders", purchaseOrderDetailEnvelope, { method: "POST", json });
      return env.data;
    },
    retry: false,
    onSuccess: (data) => invalidate(data.id),
  });
}

export function useConfirmPurchaseOrder() {
  const invalidate = usePoInvalidation();
  return useMutation<PoActionResult, unknown, number>({
    mutationFn: async (id) => {
      const env = await bffJson(`/api/bff/purchase-orders/${id}/confirm`, poActionEnvelope, { method: "POST" });
      return env.data;
    },
    retry: false,
    onSuccess: (data) => invalidate(data.id),
  });
}

export function useCancelPurchaseOrder() {
  const invalidate = usePoInvalidation();
  return useMutation<PoActionResult, unknown, number>({
    mutationFn: async (id) => {
      // Backend contract: cancel is POST /purchase-orders/{id}/cancel.
      const env = await bffJson(`/api/bff/purchase-orders/${id}/cancel`, poActionEnvelope, { method: "POST" });
      return env.data;
    },
    retry: false,
    onSuccess: (data) => invalidate(data.id),
  });
}

export interface ReceiveArgs {
  id: number;
  /** persisted per-draft key — reused verbatim on every retry of the same payload */
  idempotencyKey: string;
  payload: ReceivePayload;
}

/**
 * POST /purchase-orders/{id}/receive with the persisted `Idempotency-Key`.
 * `retry: false` — a retry must NOT create a new request identity; the caller
 * re-invokes with the SAME key + SAME payload so the backend replays it.
 */
export function useReceivePurchaseOrder() {
  const invalidate = usePoInvalidation();
  return useMutation<PurchaseOrderReceiveResult, unknown, ReceiveArgs>({
    mutationFn: async ({ id, idempotencyKey, payload }) => {
      const env = await bffJson(`/api/bff/purchase-orders/${id}/receive`, purchaseOrderReceiveEnvelope, {
        method: "POST",
        json: payload,
        headers: { "Idempotency-Key": idempotencyKey },
      });
      return env.data;
    },
    retry: false,
    onSuccess: (data) => invalidate(data.id),
  });
}
