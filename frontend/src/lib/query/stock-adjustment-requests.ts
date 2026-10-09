"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { bffJson } from "@/lib/api/browser";
import {
  adjustmentRequestDetailEnvelope,
  adjustmentRequestListEnvelope,
  type AdjustmentRequestDetail,
  type AdjustmentRequestListEnvelope,
  type CreateAdjustmentRequestBody,
} from "@/lib/api/schemas/stock-adjustment-requests";
import { queryKeys } from "@/lib/query/keys";

type Query = Record<string, string | number | boolean | undefined | null>;

/** Everything a decision (approve/reject/cancel) or a create can touch. */
export function useStockAdjustmentRequestInvalidation() {
  const qc = useQueryClient();
  return (productId?: number) => {
    void qc.invalidateQueries({ queryKey: queryKeys.stockAdjustmentRequests.all });
    void qc.invalidateQueries({ queryKey: queryKeys.stock.all });
    void qc.invalidateQueries({ queryKey: queryKeys.products.all });
    if (productId !== undefined) {
      void qc.invalidateQueries({ queryKey: queryKeys.products.detail(productId) });
    }
    void qc.invalidateQueries({ queryKey: queryKeys.dashboardSummary });
    void qc.invalidateQueries({ queryKey: queryKeys.attentionSummary });
    void qc.invalidateQueries({ queryKey: queryKeys.recentActivity });
    void qc.invalidateQueries({ queryKey: queryKeys.reports.all });
  };
}

export function useStockAdjustmentRequests(query: Query) {
  return useQuery<AdjustmentRequestListEnvelope["data"]>({
    queryKey: queryKeys.stockAdjustmentRequests.list(query as Record<string, unknown>),
    queryFn: async ({ signal }) => {
      const env = await bffJson("/api/bff/stock-adjustment-requests", adjustmentRequestListEnvelope, {
        query, signal,
      });
      return env.data;
    },
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  });
}

export function useStockAdjustmentRequest(id: number | string | null) {
  return useQuery<AdjustmentRequestDetail>({
    queryKey: queryKeys.stockAdjustmentRequests.detail(id ?? "none"),
    enabled: id !== null && id !== undefined,
    queryFn: async ({ signal }) => {
      const env = await bffJson(`/api/bff/stock-adjustment-requests/${id}`, adjustmentRequestDetailEnvelope, {
        signal,
      });
      return env.data;
    },
  });
}

/** CREATE — never mutates stock, but gets its own Idempotency-Key for the
 * same lost-response/reload-recovery reason Stock In/Out's Save-once
 * session has one. */
export function useCreateStockAdjustmentRequest() {
  const invalidate = useStockAdjustmentRequestInvalidation();
  return useMutation<
    AdjustmentRequestDetail,
    unknown,
    { body: CreateAdjustmentRequestBody; idempotencyKey: string }
  >({
    mutationFn: async ({ body, idempotencyKey }) => {
      const env = await bffJson("/api/bff/stock-adjustment-requests", adjustmentRequestDetailEnvelope, {
        method: "POST",
        json: body,
        headers: { "Idempotency-Key": idempotencyKey },
      });
      return env.data;
    },
    retry: false,
    onSuccess: (data) => invalidate(data.product.id),
  });
}

/** APPROVE — the one step that mutates stock; mandatory Idempotency-Key. */
export function useApproveStockAdjustmentRequest() {
  const invalidate = useStockAdjustmentRequestInvalidation();
  return useMutation<AdjustmentRequestDetail, unknown, { id: number; idempotencyKey: string }>({
    mutationFn: async ({ id, idempotencyKey }) => {
      const env = await bffJson(`/api/bff/stock-adjustment-requests/${id}/approve`, adjustmentRequestDetailEnvelope, {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
      });
      return env.data;
    },
    retry: false,
    onSuccess: (data) => invalidate(data.product.id),
  });
}

export function useRejectStockAdjustmentRequest() {
  const invalidate = useStockAdjustmentRequestInvalidation();
  return useMutation<AdjustmentRequestDetail, unknown, { id: number; rejection_reason: string }>({
    mutationFn: async ({ id, rejection_reason }) => {
      const env = await bffJson(`/api/bff/stock-adjustment-requests/${id}/reject`, adjustmentRequestDetailEnvelope, {
        method: "POST",
        json: { rejection_reason },
      });
      return env.data;
    },
    retry: false,
    onSuccess: () => invalidate(),
  });
}

export function useCancelStockAdjustmentRequest() {
  const invalidate = useStockAdjustmentRequestInvalidation();
  return useMutation<AdjustmentRequestDetail, unknown, { id: number }>({
    mutationFn: async ({ id }) => {
      const env = await bffJson(`/api/bff/stock-adjustment-requests/${id}/cancel`, adjustmentRequestDetailEnvelope, {
        method: "POST",
      });
      return env.data;
    },
    retry: false,
    onSuccess: () => invalidate(),
  });
}
