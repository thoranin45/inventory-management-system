"use client";

import { keepPreviousData, useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";

import { bffJson } from "@/lib/api/browser";
import { stockBalanceListEnvelope } from "@/lib/api/schemas/stock";
import {
  createTransferInput,
  transferDetailSchema,
  transferListEnvelope,
  transferReceiptResponseSchema,
  type CreateTransferInput,
  type TransferDetail,
  type TransferListEnvelope,
  type TransferReceiptResponse,
} from "@/lib/api/schemas/transfers";
import type { TransferReceivePayload } from "@/lib/transfer-receipt-draft";
import { queryKeys } from "./keys";

type Query = Record<string, string | number | boolean | undefined | null>;

const RETRY_ONCE_NOT_AUTH = (failureCount: number, error: unknown) => {
  const kind = (error as { kind?: string })?.kind;
  if (kind === "unauthorized" || kind === "forbidden" || kind === "validation" || kind === "conflict") return false;
  return failureCount < 1;
};

/* ---------------- queries ---------------- */

export function useTransfers(query: Query) {
  return useQuery<TransferListEnvelope["data"]>({
    queryKey: queryKeys.transfers.list(query as Record<string, unknown>),
    queryFn: async ({ signal }) => {
      const env = await bffJson("/api/bff/inventory-transfers", transferListEnvelope, { query, signal });
      return env.data;
    },
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    retry: RETRY_ONCE_NOT_AUTH,
  });
}

export function useTransfer(id: number | string | null) {
  return useQuery<TransferDetail>({
    queryKey: queryKeys.transfers.detail(id ?? "none"),
    enabled: id !== null && id !== undefined,
    queryFn: async ({ signal }) => {
      // RAW InventoryTransferResponse — not enveloped.
      return bffJson(`/api/bff/inventory-transfers/${id}`, transferDetailSchema, { signal });
    },
    staleTime: 10_000,
    retry: RETRY_ONCE_NOT_AUTH,
  });
}

/**
 * Warehouse id → name map, composed from the transfer LIST rows (there is no
 * /warehouses endpoint). Only warehouses that have appeared in a transfer get a
 * name; the rest fall back to "Warehouse #id".
 */
export function useWarehouseNames() {
  return useQuery<Record<number, string>>({
    queryKey: ["inventory-transfers", "warehouse-names"],
    queryFn: async ({ signal }) => {
      const env = await bffJson("/api/bff/inventory-transfers", transferListEnvelope, {
        query: { page: 1, page_size: 100 },
        signal,
      });
      const map: Record<number, string> = {};
      for (const r of env.data.items) {
        if (r.source_warehouse_name) map[r.source_warehouse_id] = r.source_warehouse_name;
        if (r.destination_warehouse_name) map[r.destination_warehouse_id] = r.destination_warehouse_name;
      }
      return map;
    },
    staleTime: 60_000,
    retry: RETRY_ONCE_NOT_AUTH,
  });
}

export interface BatchExpiryInfo {
  expiry_date: string | null;
  days_to_expiry: number | null;
  is_expired: boolean;
}

/**
 * batch_id → expiry info, from GET /stock-balances/product/{id} per distinct
 * product. The transfer item carries only `batch_id` (no lot / expiry), so this
 * is how the UI shows an expiry-aware transfer — including a batch that expired
 * while in transit.
 */
export function useBatchExpiryMap(productIds: number[]) {
  const ids = Array.from(new Set(productIds)).sort((a, b) => a - b);
  const results = useQueries({
    queries: ids.map((pid) => ({
      queryKey: ["stock-balances", "product", String(pid), { for: "transfer-expiry" }],
      queryFn: async () => {
        const env = await bffJson(`/api/bff/stock-balances/product/${pid}`, stockBalanceListEnvelope, {
          query: { page_size: 100 },
        });
        return env.data.items;
      },
      staleTime: 30_000,
      retry: false,
    })),
  });
  const map: Record<number, BatchExpiryInfo> = {};
  for (const r of results) {
    for (const b of r.data ?? []) {
      if (b.batch_id != null) {
        map[b.batch_id] = {
          expiry_date: b.batch_expiry_date,
          days_to_expiry: b.days_to_expiry,
          is_expired: b.is_expired,
        };
      }
    }
  }
  return { map, isLoading: results.some((r) => r.isLoading) };
}

/* ---------------- mutations ---------------- */

function useTransferInvalidation() {
  const qc = useQueryClient();
  return (id?: number | string) => {
    void qc.invalidateQueries({ queryKey: queryKeys.transfers.all });
    if (id !== undefined) void qc.invalidateQueries({ queryKey: queryKeys.transfers.detail(id) });
    void qc.invalidateQueries({ queryKey: queryKeys.stock.all });
    void qc.invalidateQueries({ queryKey: queryKeys.products.all });
    void qc.invalidateQueries({ queryKey: queryKeys.dashboardSummary });
    void qc.invalidateQueries({ queryKey: queryKeys.attentionSummary });
    void qc.invalidateQueries({ queryKey: queryKeys.recentActivity });
  };
}

export function useCreateTransfer() {
  const invalidate = useTransferInvalidation();
  return useMutation<TransferDetail, unknown, CreateTransferInput>({
    mutationFn: async (input) => {
      const json = createTransferInput.parse(input);
      return bffJson("/api/bff/inventory-transfers", transferDetailSchema, { method: "POST", json });
    },
    retry: false,
    onSuccess: (data) => invalidate(data.id),
  });
}

export function useDispatchTransfer() {
  const invalidate = useTransferInvalidation();
  return useMutation<TransferDetail, unknown, number>({
    mutationFn: async (id) => {
      return bffJson(`/api/bff/inventory-transfers/${id}/dispatch`, transferDetailSchema, { method: "POST" });
    },
    retry: false, // dispatch is all-or-nothing — never silently retried
    onSuccess: (data) => invalidate(data.id),
  });
}

export function useCancelTransfer() {
  const invalidate = useTransferInvalidation();
  return useMutation<TransferDetail, unknown, number>({
    mutationFn: async (id) => {
      // Backend contract: cancel is POST /inventory-transfers/{id}/cancel.
      return bffJson(`/api/bff/inventory-transfers/${id}/cancel`, transferDetailSchema, { method: "POST" });
    },
    retry: false,
    onSuccess: (data) => invalidate(data.id),
  });
}

export interface TransferReceiveArgs {
  id: number;
  idempotencyKey: string;
  payload: TransferReceivePayload;
}

export function useReceiveTransfer() {
  const invalidate = useTransferInvalidation();
  return useMutation<TransferReceiptResponse, unknown, TransferReceiveArgs>({
    mutationFn: async ({ id, idempotencyKey, payload }) => {
      return bffJson(`/api/bff/inventory-transfers/${id}/receive`, transferReceiptResponseSchema, {
        method: "POST",
        json: payload,
        headers: { "Idempotency-Key": idempotencyKey },
      });
    },
    retry: false, // a retry re-uses the SAME key + payload so the backend replays it
    onSuccess: (data) => invalidate(data.transfer.id),
  });
}
