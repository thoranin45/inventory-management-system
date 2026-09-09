"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { bffJson } from "@/lib/api/browser";
import {
  attentionSummaryEnvelope,
  dashboardSummaryEnvelope,
  recentTransactionsEnvelope,
  type AttentionSummary,
  type DashboardSummary,
  type RecentTransaction,
} from "@/lib/api/schemas/dashboard";
import { searchResponseEnvelope, type SearchResponse } from "@/lib/api/schemas/search";
import { productListEnvelope, type ProductListEnvelope } from "@/lib/api/schemas/products";
import { stockBalanceListEnvelope, type StockBalanceListEnvelope } from "@/lib/api/schemas/stock";
import { queryKeys } from "./keys";

type Query = Record<string, string | number | boolean | undefined | null>;

const RETRY_ONCE_NOT_AUTH = (failureCount: number, error: unknown) => {
  const kind = (error as { kind?: string })?.kind;
  if (kind === "unauthorized" || kind === "forbidden" || kind === "validation") return false;
  return failureCount < 1;
};

export function useDashboardSummary() {
  return useQuery<DashboardSummary>({
    queryKey: queryKeys.dashboardSummary,
    queryFn: async ({ signal }) => {
      const env = await bffJson("/api/bff/dashboard/summary", dashboardSummaryEnvelope, { signal });
      return env.data;
    },
    staleTime: 30_000,
    retry: RETRY_ONCE_NOT_AUTH,
  });
}

export function useAttentionSummary() {
  return useQuery<AttentionSummary>({
    queryKey: queryKeys.attentionSummary,
    queryFn: async ({ signal }) => {
      const env = await bffJson("/api/bff/attention/summary", attentionSummaryEnvelope, { signal });
      return env.data;
    },
    staleTime: 30_000,
    retry: RETRY_ONCE_NOT_AUTH,
  });
}

export function useRecentActivity() {
  return useQuery<RecentTransaction[]>({
    queryKey: queryKeys.recentActivity,
    queryFn: async ({ signal }) => {
      const env = await bffJson(
        "/api/bff/dashboard/recent-transactions",
        recentTransactionsEnvelope,
        { signal },
      );
      return env.data.items;
    },
    staleTime: 30_000,
    retry: RETRY_ONCE_NOT_AUTH,
  });
}

/* ---------------- Phase 2: Products & Stock ---------------- */

export function useProducts(query: Query) {
  return useQuery<ProductListEnvelope["data"]>({
    queryKey: queryKeys.products.list(query as Record<string, unknown>),
    queryFn: async ({ signal }) => {
      const env = await bffJson("/api/bff/products", productListEnvelope, { query, signal });
      return env.data;
    },
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    retry: RETRY_ONCE_NOT_AUTH,
  });
}

export function useProductStock(productId: number | string | null, query: Query = {}) {
  return useQuery<StockBalanceListEnvelope["data"]>({
    queryKey: queryKeys.stock.byProduct(productId ?? "none", query as Record<string, unknown>),
    enabled: productId !== null && productId !== undefined,
    queryFn: async ({ signal }) => {
      const env = await bffJson(
        `/api/bff/stock-balances/product/${productId}`,
        stockBalanceListEnvelope,
        { query: { page_size: 50, ...query }, signal },
      );
      return env.data;
    },
    staleTime: 15_000,
    retry: RETRY_ONCE_NOT_AUTH,
  });
}

export function useStockBalances(query: Query) {
  return useQuery<StockBalanceListEnvelope["data"]>({
    queryKey: queryKeys.stock.list(query as Record<string, unknown>),
    queryFn: async ({ signal }) => {
      const env = await bffJson("/api/bff/stock-balances", stockBalanceListEnvelope, { query, signal });
      return env.data;
    },
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    retry: RETRY_ONCE_NOT_AUTH,
  });
}

export function useInTransitStock(query: Query) {
  return useQuery<StockBalanceListEnvelope["data"]>({
    queryKey: queryKeys.stock.inTransit(query as Record<string, unknown>),
    queryFn: async ({ signal }) => {
      const env = await bffJson("/api/bff/stock-balances/in-transit", stockBalanceListEnvelope, {
        query,
        signal,
      });
      return env.data;
    },
    placeholderData: keepPreviousData,
    staleTime: 15_000,
    retry: RETRY_ONCE_NOT_AUTH,
  });
}

export function useGlobalSearch(query: string, enabled: boolean) {
  const q = query.trim();
  return useQuery<SearchResponse>({
    queryKey: queryKeys.search(q),
    enabled: enabled && q.length >= 2,
    queryFn: async ({ signal }) => {
      const env = await bffJson("/api/bff/search", searchResponseEnvelope, {
        query: { q, limit: 20 },
        signal,
      });
      return env.data;
    },
    placeholderData: keepPreviousData,
    staleTime: 10_000,
    retry: RETRY_ONCE_NOT_AUTH,
  });
}
