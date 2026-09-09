"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { bffJson } from "@/lib/api/browser";
import { bffBinary, openBlob } from "@/lib/api/binary";
import {
  completeFulfillmentInput,
  createSalesOrderInput,
  customerListEnvelope,
  fulfillmentScanEnvelope,
  packingSlipDataEnvelope,
  salesMutationEnvelope,
  salesOrderDetailEnvelope,
  salesOrderListEnvelope,
  salesReturnEnvelope,
  salesReturnInput,
  scanResolveEnvelope,
  shippingLabelDataEnvelope,
  type CompleteFulfillmentInput,
  type CreateSalesOrderInput,
  type CustomerRow,
  type FulfillmentScanResult,
  type PackingSlipData,
  type SalesMutationResult,
  type SalesOrderDetail,
  type SalesOrderListEnvelope,
  type SalesReturnInput,
  type SalesReturnResult,
  type ScanResolve,
  type ShippingLabelData,
} from "@/lib/api/schemas/sales";
import { productListEnvelope } from "@/lib/api/schemas/products";
import { queryKeys } from "./keys";

type Query = Record<string, string | number | boolean | undefined | null>;

const RETRY_ONCE_NOT_AUTH = (failureCount: number, error: unknown) => {
  const kind = (error as { kind?: string })?.kind;
  if (kind === "unauthorized" || kind === "forbidden" || kind === "validation" || kind === "conflict") return false;
  return failureCount < 1;
};

/* ---------------- queries ---------------- */

export function useSalesOrders(query: Query) {
  return useQuery<SalesOrderListEnvelope["data"]>({
    queryKey: queryKeys.sales.list(query as Record<string, unknown>),
    queryFn: async ({ signal }) => {
      const env = await bffJson("/api/bff/sales-orders", salesOrderListEnvelope, { query, signal });
      return env.data;
    },
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    retry: RETRY_ONCE_NOT_AUTH,
  });
}

export function useSalesOrder(id: number | string | null) {
  return useQuery<SalesOrderDetail>({
    queryKey: queryKeys.sales.detail(id ?? "none"),
    enabled: id !== null && id !== undefined,
    queryFn: async ({ signal }) => {
      const env = await bffJson(`/api/bff/sales-orders/${id}`, salesOrderDetailEnvelope, { signal });
      return env.data;
    },
    staleTime: 10_000,
    retry: RETRY_ONCE_NOT_AUTH,
  });
}

export function useCustomerSearch(search: string, enabled = true) {
  const q = search.trim();
  return useQuery<CustomerRow[]>({
    queryKey: queryKeys.customers.list({ search: q }),
    enabled,
    queryFn: async ({ signal }) => {
      const env = await bffJson("/api/bff/customers", customerListEnvelope, {
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

/** Refetch everything a sales-order state change (confirm…ship…complete…return) can move. */
function useSalesInvalidation() {
  const qc = useQueryClient();
  return (id?: number | string) => {
    void qc.invalidateQueries({ queryKey: queryKeys.sales.all });
    if (id !== undefined) void qc.invalidateQueries({ queryKey: queryKeys.sales.detail(id) });
    void qc.invalidateQueries({ queryKey: queryKeys.dashboardSummary });
    void qc.invalidateQueries({ queryKey: queryKeys.attentionSummary });
    void qc.invalidateQueries({ queryKey: queryKeys.recentActivity });
    // ship/return move on-hand + reserved stock → refresh stock + report views.
    void qc.invalidateQueries({ queryKey: queryKeys.stock.all });
    void qc.invalidateQueries({ queryKey: queryKeys.reports.all });
    void qc.invalidateQueries({ queryKey: ["search"] });
  };
}

export function useCreateSalesOrder() {
  const invalidate = useSalesInvalidation();
  return useMutation<SalesMutationResult, unknown, CreateSalesOrderInput>({
    mutationFn: async (input) => {
      const json = createSalesOrderInput.parse(input);
      const env = await bffJson("/api/bff/sales-orders", salesMutationEnvelope, { method: "POST", json });
      return env.data;
    },
    retry: false,
    onSuccess: (data) => invalidate(data.sales_order_id),
  });
}

export function useConfirmSalesOrder() {
  const invalidate = useSalesInvalidation();
  return useMutation<SalesMutationResult, unknown, number>({
    mutationFn: async (id) => {
      const env = await bffJson(`/api/bff/sales-orders/${id}/confirm`, salesMutationEnvelope, {
        method: "POST",
      });
      return env.data;
    },
    retry: false,
    onSuccess: (data) => invalidate(data.sales_order_id),
  });
}

export function useCancelSalesOrder() {
  const invalidate = useSalesInvalidation();
  return useMutation<SalesMutationResult, unknown, number>({
    mutationFn: async (id) => {
      // Backend contract: cancel is PUT /sales-orders/{id}/cancel (not POST).
      const env = await bffJson(`/api/bff/sales-orders/${id}/cancel`, salesMutationEnvelope, {
        method: "PUT",
      });
      return env.data;
    },
    retry: false,
    onSuccess: (data) => invalidate(data.sales_order_id),
  });
}

/* ================= Phase 9 — Ship / Complete / Return ================= */

/** POST /sales-orders/{id}/ship — READY_TO_SHIP → SHIPPED. No body. */
export function useShipSalesOrder() {
  const invalidate = useSalesInvalidation();
  return useMutation<SalesMutationResult, unknown, number>({
    mutationFn: async (id) => {
      const env = await bffJson(`/api/bff/sales-orders/${id}/ship`, salesMutationEnvelope, { method: "POST" });
      return env.data;
    },
    retry: false,
    onSuccess: (data) => invalidate(data.sales_order_id),
  });
}

/** POST /sales-orders/{id}/complete — admin only, SHIPPED → COMPLETED. No body. */
export function useCompleteSalesOrder() {
  const invalidate = useSalesInvalidation();
  return useMutation<SalesMutationResult, unknown, number>({
    mutationFn: async (id) => {
      const env = await bffJson(`/api/bff/sales-orders/${id}/complete`, salesMutationEnvelope, { method: "POST" });
      return env.data;
    },
    retry: false,
    onSuccess: (data) => invalidate(data.sales_order_id),
  });
}

/**
 * POST /sales-orders/{id}/return — SHIPPED|COMPLETED only. Per-product (no
 * batch id); the order status is NOT changed. `retry: false` — a retry would
 * add stock again (no idempotency support).
 */
export function useReturnSalesOrder() {
  const invalidate = useSalesInvalidation();
  return useMutation<SalesReturnResult, unknown, { id: number; input: SalesReturnInput }>({
    mutationFn: async ({ id, input }) => {
      const json = salesReturnInput.parse(input);
      const env = await bffJson(`/api/bff/sales-orders/${id}/return`, salesReturnEnvelope, { method: "POST", json });
      return env.data;
    },
    retry: false,
    onSuccess: (data) => invalidate(data.sales_order_id),
  });
}

/** GET /sales-orders/{id}/invoice → PDF. Opens in a new tab (returns false if popup-blocked). */
export async function openInvoice(id: number | string): Promise<{ opened: boolean }> {
  const { blob } = await bffBinary(`/api/bff/sales-orders/${id}/invoice`);
  return { opened: openBlob(blob) };
}

/* ================= Phase 4 — Picking / Packing / Scanner ================= */

/** Resolve a barcode to its product + batch expiry metadata (read-only). */
export async function resolveBarcode(
  barcode: string,
  context: "lookup" | "pick" | "pack" | "stock_in" = "lookup",
  signal?: AbortSignal,
): Promise<ScanResolve> {
  const env = await bffJson("/api/bff/scan/resolve", scanResolveEnvelope, {
    query: { barcode, context },
    signal,
  });
  return env.data;
}

/** Cached resolve for the console's "current product" panel + FEFO metadata. */
export function useScanResolve(barcode: string | null, context: "pick" | "pack") {
  const b = (barcode ?? "").trim();
  return useQuery<ScanResolve>({
    queryKey: queryKeys.scanResolve(b, context),
    enabled: b.length > 0,
    queryFn: ({ signal }) => resolveBarcode(b, context, signal),
    staleTime: 30_000,
    retry: RETRY_ONCE_NOT_AUTH,
  });
}

export function useStartPicking() {
  const invalidate = useSalesInvalidation();
  return useMutation<SalesMutationResult, unknown, number>({
    mutationFn: async (id) => {
      const env = await bffJson(`/api/bff/sales-orders/${id}/start-picking`, salesMutationEnvelope, {
        method: "POST",
      });
      return env.data;
    },
    retry: false, // never silently retry a state-changing action
    onSuccess: (data) => invalidate(data.sales_order_id),
  });
}

type ScanArgs = { id: number; barcode: string; quantity?: string; allocation_id?: number };

function useFulfillmentScan(kind: "scan-pick" | "scan-pack") {
  const invalidate = useSalesInvalidation();
  return useMutation<FulfillmentScanResult, unknown, ScanArgs>({
    mutationFn: async ({ id, barcode, quantity, allocation_id }) => {
      const json: Record<string, unknown> = { barcode };
      if (quantity !== undefined) json.quantity = quantity;
      if (allocation_id !== undefined) json.allocation_id = allocation_id;
      const env = await bffJson(`/api/bff/sales-orders/${id}/${kind}`, fulfillmentScanEnvelope, {
        method: "POST",
        json,
      });
      return env.data;
    },
    // Never retried, never optimistic: one physical scan → one backend call →
    // then a local patch from the confirmed response (scanner safety).
    retry: false,
    onSuccess: (data) => invalidate(data.sales_order_id),
  });
}

export const useScanPick = () => useFulfillmentScan("scan-pick");
export const useScanPack = () => useFulfillmentScan("scan-pack");

type CompleteArgs = { id: number } & CompleteFulfillmentInput;

function useCompleteFulfillment(kind: "complete-picking" | "complete-packing") {
  const invalidate = useSalesInvalidation();
  return useMutation<SalesMutationResult, unknown, CompleteArgs>({
    mutationFn: async ({ id, allocations }) => {
      const json = completeFulfillmentInput.parse({ allocations });
      const env = await bffJson(`/api/bff/sales-orders/${id}/${kind}`, salesMutationEnvelope, {
        method: "POST",
        json,
      });
      return env.data;
    },
    retry: false, // never silently retry a state-changing action
    onSuccess: (data) => invalidate(data.sales_order_id),
  });
}

export const useCompletePicking = () => useCompleteFulfillment("complete-picking");
export const useCompletePacking = () => useCompleteFulfillment("complete-packing");

export function usePackingSlipData(id: number | string | null, enabled = true) {
  return useQuery<PackingSlipData>({
    queryKey: queryKeys.sales.packingSlip(id ?? "none"),
    enabled: enabled && id !== null && id !== undefined,
    queryFn: async ({ signal }) => {
      const env = await bffJson(
        `/api/bff/sales-orders/${id}/packing-slip-data`,
        packingSlipDataEnvelope,
        { signal },
      );
      return env.data;
    },
    staleTime: 10_000,
    retry: RETRY_ONCE_NOT_AUTH,
  });
}

export function useShippingLabelData(id: number | string | null, enabled = true) {
  return useQuery<ShippingLabelData>({
    queryKey: queryKeys.sales.shippingLabel(id ?? "none"),
    enabled: enabled && id !== null && id !== undefined,
    queryFn: async ({ signal }) => {
      const env = await bffJson(
        `/api/bff/sales-orders/${id}/shipping-label-data`,
        shippingLabelDataEnvelope,
        { signal },
      );
      return env.data;
    },
    staleTime: 10_000,
    retry: RETRY_ONCE_NOT_AUTH,
  });
}

export interface ProductLite {
  id: number;
  sku: string;
  product_name: string;
  barcode: string | null;
  track_batch: boolean;
  track_expiry: boolean;
}

/**
 * id → { sku, product_name, barcode } for the console lines. One page of the
 * products list (never a per-id fan-out); the console's line count is small.
 */
export function useProductLookup(productIds: number[]) {
  const ids = Array.from(new Set(productIds)).sort((a, b) => a - b);
  return useQuery<Record<number, ProductLite>>({
    queryKey: ["products", "lookup", ids],
    enabled: ids.length > 0,
    queryFn: async ({ signal }) => {
      const env = await bffJson("/api/bff/products", productListEnvelope, {
        query: { page: 1, page_size: 100 },
        signal,
      });
      const map: Record<number, ProductLite> = {};
      for (const p of env.data.items) {
        map[p.id] = {
          id: p.id,
          sku: p.sku,
          product_name: p.product_name,
          barcode: p.barcode ?? null,
          track_batch: p.track_batch,
          track_expiry: p.track_expiry,
        };
      }
      return map;
    },
    staleTime: 60_000,
    retry: RETRY_ONCE_NOT_AUTH,
  });
}
