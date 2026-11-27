"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { bffBinary, openBlob } from "@/lib/api/binary";
import { bffJson } from "@/lib/api/browser";
import { deletedEnvelope } from "@/lib/api/schemas/invoices";
import {
  agingEnvelope,
  billingDetailEnvelope,
  billingListEnvelope,
  receiptDetailEnvelope,
  receiptListEnvelope,
  type ArAging,
  type BillingDetail,
  type BillingPayload,
  type BillingRow,
  type ReceiptDetail,
  type ReceiptPayload,
  type ReceiptRow,
} from "@/lib/api/schemas/payments";
import { queryKeys } from "./keys";

type Query = Record<string, string | number | boolean | undefined | null>;
type Page<T> = { items: T[]; pagination: { page: number; page_size: number; total_items: number; total_pages: number } };

const RETRY_ONCE_NOT_AUTH = (failureCount: number, error: unknown) => {
  const kind = (error as { kind?: string })?.kind;
  if (kind === "unauthorized" || kind === "forbidden" || kind === "validation" || kind === "conflict") return false;
  return failureCount < 1;
};

/** Receipts and billing notes change invoice balances / AR, so refresh those too. */
function useSettle() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: queryKeys.receipts.all });
    void qc.invalidateQueries({ queryKey: queryKeys.billing.all });
    void qc.invalidateQueries({ queryKey: queryKeys.invoices.all });
    void qc.invalidateQueries({ queryKey: queryKeys.aging.all });
    void qc.invalidateQueries({ queryKey: queryKeys.audit.all });
  };
}

/* ---------------------------------------------------------------- receipts */

export function useReceipts(query: Query, enabled = true) {
  return useQuery<Page<ReceiptRow>>({
    queryKey: queryKeys.receipts.list(query as Record<string, unknown>),
    enabled,
    queryFn: async ({ signal }) => (await bffJson("/api/bff/payment-receipts", receiptListEnvelope, { query, signal })).data,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    retry: RETRY_ONCE_NOT_AUTH,
  });
}

export function useReceipt(id: number | null) {
  return useQuery<ReceiptDetail>({
    queryKey: queryKeys.receipts.detail(id ?? "none"),
    enabled: id !== null,
    queryFn: async ({ signal }) => (await bffJson(`/api/bff/payment-receipts/${id}`, receiptDetailEnvelope, { signal })).data,
    staleTime: 10_000,
    retry: RETRY_ONCE_NOT_AUTH,
  });
}

/** POST /payment-receipts. The payload carries a client_request_id, so a retry returns the same receipt. */
export function useRecordPayment() {
  const settle = useSettle();
  const qc = useQueryClient();
  return useMutation<ReceiptDetail, unknown, ReceiptPayload>({
    mutationFn: async (payload) =>
      (await bffJson("/api/bff/payment-receipts", receiptDetailEnvelope, { method: "POST", json: payload })).data,
    retry: false,
    onSuccess: (data) => {
      qc.setQueryData(queryKeys.receipts.detail(data.id), data);
      settle();
    },
  });
}

export function useVoidReceipt() {
  const settle = useSettle();
  const qc = useQueryClient();
  return useMutation<ReceiptDetail, unknown, { id: number; reason: string }>({
    mutationFn: async ({ id, reason }) =>
      (await bffJson(`/api/bff/payment-receipts/${id}/void`, receiptDetailEnvelope, { method: "POST", json: { reason } })).data,
    retry: false,
    onSuccess: (data) => {
      qc.setQueryData(queryKeys.receipts.detail(data.id), data);
      settle();
    },
  });
}

export async function openReceiptPdf(id: number): Promise<{ opened: boolean }> {
  const { blob } = await bffBinary(`/api/bff/payment-receipts/${id}/pdf`);
  return { opened: openBlob(blob) };
}

/* ---------------------------------------------------------------- billing notes */

export function useBillingNotes(query: Query, enabled = true) {
  return useQuery<Page<BillingRow>>({
    queryKey: queryKeys.billing.list(query as Record<string, unknown>),
    enabled,
    queryFn: async ({ signal }) => (await bffJson("/api/bff/billing-notes", billingListEnvelope, { query, signal })).data,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    retry: RETRY_ONCE_NOT_AUTH,
  });
}

export function useBillingNote(id: number | null) {
  return useQuery<BillingDetail>({
    queryKey: queryKeys.billing.detail(id ?? "none"),
    enabled: id !== null,
    queryFn: async ({ signal }) => (await bffJson(`/api/bff/billing-notes/${id}`, billingDetailEnvelope, { signal })).data,
    staleTime: 10_000,
    retry: RETRY_ONCE_NOT_AUTH,
  });
}

export function useSaveBillingDraft() {
  const settle = useSettle();
  const qc = useQueryClient();
  return useMutation<BillingDetail, unknown, { id: number | null; payload: BillingPayload }>({
    mutationFn: async ({ id, payload }) =>
      (
        await bffJson(id ? `/api/bff/billing-notes/${id}` : "/api/bff/billing-notes", billingDetailEnvelope, {
          method: id ? "PUT" : "POST",
          json: payload,
        })
      ).data,
    retry: false,
    onSuccess: (data) => {
      qc.setQueryData(queryKeys.billing.detail(data.id), data);
      settle();
    },
  });
}

export function useDeleteBillingDraft() {
  const settle = useSettle();
  const qc = useQueryClient();
  return useMutation<{ id: number }, unknown, number>({
    mutationFn: async (id) => (await bffJson(`/api/bff/billing-notes/${id}`, deletedEnvelope, { method: "DELETE" })).data,
    retry: false,
    onSuccess: ({ id }) => {
      qc.removeQueries({ queryKey: queryKeys.billing.detail(id) });
      settle();
    },
  });
}

export function useBillingAction() {
  const settle = useSettle();
  const qc = useQueryClient();
  return useMutation<BillingDetail, unknown, { id: number; action: "issue" | "void"; reason?: string }>({
    mutationFn: async ({ id, action, reason }) =>
      (
        await bffJson(`/api/bff/billing-notes/${id}/${action}`, billingDetailEnvelope, {
          method: "POST",
          ...(action === "void" ? { json: { reason } } : {}),
        })
      ).data,
    retry: false,
    onSuccess: (data) => {
      qc.setQueryData(queryKeys.billing.detail(data.id), data);
      settle();
    },
  });
}

export async function openBillingPdf(id: number): Promise<{ opened: boolean }> {
  const { blob } = await bffBinary(`/api/bff/billing-notes/${id}/pdf`);
  return { opened: openBlob(blob) };
}

/* ---------------------------------------------------------------- AR aging */

export function useArAging(asOf: string, enabled = true) {
  return useQuery<ArAging>({
    queryKey: queryKeys.aging.report(asOf),
    enabled,
    queryFn: async ({ signal }) =>
      (await bffJson("/api/bff/invoices/ar-aging", agingEnvelope, { query: { as_of: asOf || undefined }, signal })).data,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    retry: RETRY_ONCE_NOT_AUTH,
  });
}
