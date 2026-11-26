"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { bffBinary, openBlob } from "@/lib/api/binary";
import { bffJson } from "@/lib/api/browser";
import {
  quotationDeletedEnvelope,
  quotationDetailEnvelope,
  quotationListEnvelope,
  type QuotationDetail,
  type QuotationDraftPayload,
  type QuotationRow,
} from "@/lib/api/schemas/quotations";
import { queryKeys } from "./keys";

type Query = Record<string, string | number | boolean | undefined | null>;
type QuotationPage = { items: QuotationRow[]; pagination: { page: number; page_size: number; total_items: number; total_pages: number } };

const RETRY_ONCE_NOT_AUTH = (failureCount: number, error: unknown) => {
  const kind = (error as { kind?: string })?.kind;
  if (kind === "unauthorized" || kind === "forbidden" || kind === "validation" || kind === "conflict") return false;
  return failureCount < 1;
};

/** F1b: quotation list (Admin only). */
export function useQuotations(query: Query, enabled = true) {
  return useQuery<QuotationPage>({
    queryKey: queryKeys.quotations.list(query as Record<string, unknown>),
    enabled,
    queryFn: async ({ signal }) => {
      const env = await bffJson("/api/bff/quotations", quotationListEnvelope, { query, signal });
      return env.data;
    },
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    retry: RETRY_ONCE_NOT_AUTH,
  });
}

export function useQuotation(id: number | null) {
  return useQuery<QuotationDetail>({
    queryKey: queryKeys.quotations.detail(id ?? "none"),
    enabled: id !== null,
    queryFn: async ({ signal }) => {
      const env = await bffJson(`/api/bff/quotations/${id}`, quotationDetailEnvelope, { signal });
      return env.data;
    },
    staleTime: 10_000,
    retry: RETRY_ONCE_NOT_AUTH,
  });
}

/** Refresh the list and store the fresh detail after any change. */
function useSettle() {
  const qc = useQueryClient();
  return (data?: QuotationDetail) => {
    if (data) qc.setQueryData(queryKeys.quotations.detail(data.id), data);
    void qc.invalidateQueries({ queryKey: queryKeys.quotations.all });
    void qc.invalidateQueries({ queryKey: queryKeys.audit.all });
  };
}

export function useSaveQuotationDraft() {
  const settle = useSettle();
  return useMutation<QuotationDetail, unknown, { id: number | null; payload: QuotationDraftPayload }>({
    mutationFn: async ({ id, payload }) => {
      const env = await bffJson(id ? `/api/bff/quotations/${id}` : "/api/bff/quotations", quotationDetailEnvelope, {
        method: id ? "PUT" : "POST",
        json: payload,
      });
      return env.data;
    },
    retry: false,
    onSuccess: (data) => settle(data),
  });
}

export function useDeleteQuotationDraft() {
  const settle = useSettle();
  const qc = useQueryClient();
  return useMutation<{ id: number }, unknown, number>({
    mutationFn: async (id) => {
      const env = await bffJson(`/api/bff/quotations/${id}`, quotationDeletedEnvelope, { method: "DELETE" });
      return env.data;
    },
    retry: false,
    onSuccess: ({ id }) => {
      qc.removeQueries({ queryKey: queryKeys.quotations.detail(id) });
      settle();
    },
  });
}

export type QuotationAction = "issue" | "accept" | "reject" | "void" | "revise" | "convert";

/** Issue / accept / reject / void / revise / convert. Revise returns the NEW draft. */
export function useQuotationAction() {
  const settle = useSettle();
  const qc = useQueryClient();
  return useMutation<QuotationDetail, unknown, { id: number; action: QuotationAction; reason?: string }>({
    mutationFn: async ({ id, action, reason }) => {
      const env = await bffJson(`/api/bff/quotations/${id}/${action}`, quotationDetailEnvelope, {
        method: "POST",
        ...(action === "void" ? { json: { reason } } : {}),
      });
      return env.data;
    },
    retry: false,
    onSuccess: (data, { id, action }) => {
      if (action === "revise") void qc.invalidateQueries({ queryKey: queryKeys.quotations.detail(id) });
      if (action === "convert") void qc.invalidateQueries({ queryKey: queryKeys.sales.all });
      settle(data);
    },
  });
}

/** Open the quotation PDF in a new tab. Returns false when the popup was blocked. */
export async function openQuotationPdf(id: number): Promise<{ opened: boolean }> {
  const { blob } = await bffBinary(`/api/bff/quotations/${id}/pdf`);
  return { opened: openBlob(blob) };
}
