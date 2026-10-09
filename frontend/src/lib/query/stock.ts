"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { bffJson } from "@/lib/api/browser";
import { queryKeys } from "@/lib/query/keys";
import {
  batchCreateEnvelope,
  batchInInput,
  stockInInput,
  stockOperationEnvelope,
  toBatchRequestBody,
  type BatchCreateResult,
  type BatchInInput,
  type StockInInput,
  type StockInSaveBody,
  type StockOperationResult,
} from "@/lib/api/schemas/stock-in";

/**
 * Phase 12 — direct Stock In mutations.
 *
 * Routing is by `track_batch`, but the backend enforces the same invariant
 * (batch product on /stock/in -> 409, non-batch on /batches -> 409). Neither
 * endpoint is idempotent; `retry: false` + the console's button lock +
 * duplicate-submit guard are the only protection against a double submit.
 */

/** Everything a Stock-In success can touch. Mirrors product + sales invalidation. */
export function useStockInInvalidation() {
  const qc = useQueryClient();
  return (productId?: number) => {
    void qc.invalidateQueries({ queryKey: queryKeys.stock.all });
    void qc.invalidateQueries({ queryKey: queryKeys.products.all });
    if (productId !== undefined) {
      void qc.invalidateQueries({ queryKey: queryKeys.products.detail(productId) });
    }
    void qc.invalidateQueries({ queryKey: queryKeys.batches.all });
    void qc.invalidateQueries({ queryKey: queryKeys.dashboardSummary });
    void qc.invalidateQueries({ queryKey: queryKeys.attentionSummary });
    void qc.invalidateQueries({ queryKey: queryKeys.recentActivity });
    void qc.invalidateQueries({ queryKey: queryKeys.reports.all });
    void qc.invalidateQueries({ queryKey: ["search"] });
  };
}

export type StockInResult =
  | { mode: "stock-in"; data: StockOperationResult }
  | { mode: "batch"; data: BatchCreateResult };

/** Direct, non-batch quantity add. */
export function useDirectStockIn() {
  const invalidate = useStockInInvalidation();
  return useMutation<StockOperationResult, unknown, StockInInput>({
    mutationFn: async (input) => {
      const json = stockInInput.parse(input);
      const env = await bffJson("/api/bff/stock/in", stockOperationEnvelope, {
        method: "POST",
        json,
      });
      return env.data;
    },
    retry: false,
    onSuccess: (data) => invalidate(data.product_id),
  });
}

/** Batch / lot inbound (creates the lot). */
export function useBatchStockIn() {
  const invalidate = useStockInInvalidation();
  return useMutation<BatchCreateResult, unknown, BatchInInput>({
    mutationFn: async (input) => {
      const parsed = batchInInput.parse(input);
      const env = await bffJson("/api/bff/batches", batchCreateEnvelope, {
        method: "POST",
        json: toBatchRequestBody(parsed),
      });
      return env.data;
    },
    retry: false,
    onSuccess: (data) => invalidate(data.batch.product_id),
  });
}

/* --------------------------------------------- Save-once Stock-In session -- */

export interface StockInSessionResult {
  productId: number;
  productName: string;
  savedQuantity: string;
  currentStock: string;
  lotNo: string | null;
}

/**
 * Phase 12C — commit a whole Stock-In scan session as ONE backend mutation:
 * the accumulated count becomes a single quantity, sent with the session's
 * stable `Idempotency-Key`. Never retried automatically; a manual retry (or a
 * page reload) re-sends the SAME key + body, and the backend replays its
 * stored response instead of applying stock again. A `409 … different payload`
 * means the session's setup/count changed under a used key — the console then
 * forces a new session rather than issuing a fresh key silently.
 */
export function useSaveStockInSession() {
  const invalidate = useStockInInvalidation();
  return useMutation<StockInSessionResult, unknown, { body: StockInSaveBody; idempotencyKey: string }>({
    mutationFn: async ({ body, idempotencyKey }) => {
      const headers = { "Idempotency-Key": idempotencyKey };
      if (body.endpoint === "batches") {
        const env = await bffJson("/api/bff/batches", batchCreateEnvelope, {
          method: "POST",
          json: body.json,
          headers,
        });
        return {
          productId: env.data.batch.product_id,
          productName: String(env.data.batch.product_id),
          savedQuantity: env.data.batch.quantity,
          currentStock: env.data.current_stock,
          lotNo: env.data.batch.lot_no,
        };
      }
      const env = await bffJson("/api/bff/stock/in", stockOperationEnvelope, {
        method: "POST",
        json: body.json,
        headers,
      });
      return {
        productId: env.data.product_id,
        productName: env.data.product_name,
        savedQuantity: env.data.difference,
        currentStock: env.data.current_stock,
        lotNo: null,
      };
    },
    retry: false,
    onSuccess: (data) => invalidate(data.productId),
  });
}
