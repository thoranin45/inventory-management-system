"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { bffBinary, openBlob } from "@/lib/api/binary";
import { bffJson } from "@/lib/api/browser";
import {
  adjustmentDetailEnvelope,
  adjustmentListEnvelope,
  deletedEnvelope,
  invoiceDetailEnvelope,
  invoiceListEnvelope,
  revenueSummaryEnvelope,
  type AdjustmentDetail,
  type AdjustmentDraftPayload,
  type AdjustmentRow,
  type InvoiceDetail,
  type InvoiceDraftPayload,
  type InvoiceRow,
  type RevenueSummary,
} from "@/lib/api/schemas/invoices";
import { queryKeys } from "./keys";

type Query = Record<string, string | number | boolean | undefined | null>;
type Page<T> = { items: T[]; pagination: { page: number; page_size: number; total_items: number; total_pages: number } };

const RETRY_ONCE_NOT_AUTH = (failureCount: number, error: unknown) => {
  const kind = (error as { kind?: string })?.kind;
  if (kind === "unauthorized" || kind === "forbidden" || kind === "validation" || kind === "conflict") return false;
  return failureCount < 1;
};

/* ---------------------------------------------------------------- invoices */

export function useInvoices(query: Query, enabled = true) {
  return useQuery<Page<InvoiceRow>>({
    queryKey: queryKeys.invoices.list(query as Record<string, unknown>),
    enabled,
    queryFn: async ({ signal }) => (await bffJson("/api/bff/invoices", invoiceListEnvelope, { query, signal })).data,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    retry: RETRY_ONCE_NOT_AUTH,
  });
}

export function useInvoice(id: number | null) {
  return useQuery<InvoiceDetail>({
    queryKey: queryKeys.invoices.detail(id ?? "none"),
    enabled: id !== null,
    queryFn: async ({ signal }) => (await bffJson(`/api/bff/invoices/${id}`, invoiceDetailEnvelope, { signal })).data,
    staleTime: 10_000,
    retry: RETRY_ONCE_NOT_AUTH,
  });
}

export function useRevenueSummary(year: number, enabled = true) {
  return useQuery<RevenueSummary>({
    queryKey: queryKeys.invoices.revenue(year),
    enabled,
    queryFn: async ({ signal }) =>
      (await bffJson("/api/bff/invoices/revenue-summary", revenueSummaryEnvelope, { query: { year }, signal })).data,
    staleTime: 60_000,
    retry: RETRY_ONCE_NOT_AUTH,
  });
}

function useSettle() {
  const qc = useQueryClient();
  return (invoice?: InvoiceDetail) => {
    if (invoice) qc.setQueryData(queryKeys.invoices.detail(invoice.id), invoice);
    void qc.invalidateQueries({ queryKey: queryKeys.invoices.all });
    void qc.invalidateQueries({ queryKey: queryKeys.adjustments.all });
    void qc.invalidateQueries({ queryKey: queryKeys.audit.all });
  };
}

/** POST /invoices {sales_order_id}: a DRAFT, or the order's existing invoice. */
export function useCreateInvoiceFromOrder() {
  const settle = useSettle();
  return useMutation<InvoiceDetail, unknown, number>({
    mutationFn: async (salesOrderId) =>
      (await bffJson("/api/bff/invoices", invoiceDetailEnvelope, { method: "POST", json: { sales_order_id: salesOrderId } }))
        .data,
    retry: false,
    onSuccess: (data) => settle(data),
  });
}

export function useSaveInvoiceDraft() {
  const settle = useSettle();
  return useMutation<InvoiceDetail, unknown, { id: number; payload: InvoiceDraftPayload }>({
    mutationFn: async ({ id, payload }) =>
      (await bffJson(`/api/bff/invoices/${id}`, invoiceDetailEnvelope, { method: "PUT", json: payload })).data,
    retry: false,
    onSuccess: (data) => settle(data),
  });
}

export function useDeleteInvoiceDraft() {
  const settle = useSettle();
  const qc = useQueryClient();
  return useMutation<{ id: number }, unknown, number>({
    mutationFn: async (id) => (await bffJson(`/api/bff/invoices/${id}`, deletedEnvelope, { method: "DELETE" })).data,
    retry: false,
    onSuccess: ({ id }) => {
      qc.removeQueries({ queryKey: queryKeys.invoices.detail(id) });
      settle();
    },
  });
}

export type InvoiceAction = "issue" | "void";

export function useInvoiceAction() {
  const settle = useSettle();
  return useMutation<InvoiceDetail, unknown, { id: number; action: InvoiceAction; reason?: string }>({
    mutationFn: async ({ id, action, reason }) =>
      (
        await bffJson(`/api/bff/invoices/${id}/${action}`, invoiceDetailEnvelope, {
          method: "POST",
          ...(action === "void" ? { json: { reason } } : {}),
        })
      ).data,
    retry: false,
    onSuccess: (data) => settle(data),
  });
}

export async function openInvoicePdf(id: number): Promise<{ opened: boolean }> {
  const { blob } = await bffBinary(`/api/bff/invoices/${id}/pdf`);
  return { opened: openBlob(blob) };
}

/* ---------------------------------------------------------------- adjustment notes */

export function useAdjustments(query: Query, enabled = true) {
  return useQuery<Page<AdjustmentRow>>({
    queryKey: queryKeys.adjustments.list(query as Record<string, unknown>),
    enabled,
    queryFn: async ({ signal }) =>
      (await bffJson("/api/bff/adjustment-notes", adjustmentListEnvelope, { query, signal })).data,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    retry: RETRY_ONCE_NOT_AUTH,
  });
}

export function useAdjustment(id: number | null) {
  return useQuery<AdjustmentDetail>({
    queryKey: queryKeys.adjustments.detail(id ?? "none"),
    enabled: id !== null,
    queryFn: async ({ signal }) =>
      (await bffJson(`/api/bff/adjustment-notes/${id}`, adjustmentDetailEnvelope, { signal })).data,
    staleTime: 10_000,
    retry: RETRY_ONCE_NOT_AUTH,
  });
}

function useSettleAdjustment() {
  const qc = useQueryClient();
  return (note?: AdjustmentDetail) => {
    if (note) qc.setQueryData(queryKeys.adjustments.detail(note.id), note);
    void qc.invalidateQueries({ queryKey: queryKeys.adjustments.all });
    void qc.invalidateQueries({ queryKey: queryKeys.invoices.all }); // balances change
    void qc.invalidateQueries({ queryKey: queryKeys.audit.all });
  };
}

export function useSaveAdjustmentDraft() {
  const settle = useSettleAdjustment();
  return useMutation<AdjustmentDetail, unknown, { id: number | null; payload: AdjustmentDraftPayload }>({
    mutationFn: async ({ id, payload }) =>
      (
        await bffJson(id ? `/api/bff/adjustment-notes/${id}` : "/api/bff/adjustment-notes", adjustmentDetailEnvelope, {
          method: id ? "PUT" : "POST",
          json: payload,
        })
      ).data,
    retry: false,
    onSuccess: (data) => settle(data),
  });
}

export function useDeleteAdjustmentDraft() {
  const settle = useSettleAdjustment();
  const qc = useQueryClient();
  return useMutation<{ id: number }, unknown, number>({
    mutationFn: async (id) =>
      (await bffJson(`/api/bff/adjustment-notes/${id}`, deletedEnvelope, { method: "DELETE" })).data,
    retry: false,
    onSuccess: ({ id }) => {
      qc.removeQueries({ queryKey: queryKeys.adjustments.detail(id) });
      settle();
    },
  });
}

export function useAdjustmentAction() {
  const settle = useSettleAdjustment();
  return useMutation<AdjustmentDetail, unknown, { id: number; action: InvoiceAction; reason?: string }>({
    mutationFn: async ({ id, action, reason }) =>
      (
        await bffJson(`/api/bff/adjustment-notes/${id}/${action}`, adjustmentDetailEnvelope, {
          method: "POST",
          ...(action === "void" ? { json: { reason } } : {}),
        })
      ).data,
    retry: false,
    onSuccess: (data) => settle(data),
  });
}

export async function openAdjustmentPdf(id: number): Promise<{ opened: boolean }> {
  const { blob } = await bffBinary(`/api/bff/adjustment-notes/${id}/pdf`);
  return { opened: openBlob(blob) };
}
