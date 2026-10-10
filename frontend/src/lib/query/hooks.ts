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

/** Backend MAX_PAGE_SIZE (app/core/pagination.py). */
const BALANCE_PAGE_SIZE = 100;
/** Hard stop so a misbehaving total can never loop forever (10,000 rows). */
export const MAX_BALANCE_PAGES = 100;

/**
 * Phase 14D — EVERY balance of one product, walking all pages (stable
 * `id asc` order). Never returns a silently truncated list: a failed page,
 * a short/empty page before the advertised end, a total that changes
 * mid-walk, or more pages than MAX_BALANCE_PAGES all throw instead.
 */
export async function fetchAllProductStock(
  productId: number | string,
  signal?: AbortSignal,
): Promise<StockBalanceListEnvelope["data"]> {
  const items: StockBalanceListEnvelope["data"]["items"] = [];
  const seen = new Set<number>();
  let first: StockBalanceListEnvelope["data"]["pagination"] | null = null;
  for (let page = 1; ; page++) {
    const env = await bffJson(`/api/bff/stock-balances/product/${productId}`, stockBalanceListEnvelope, {
      query: { page, page_size: BALANCE_PAGE_SIZE, sort_by: "id", sort_order: "asc" },
      signal,
    });
    const { pagination } = env.data;
    if (first === null) {
      first = pagination;
      if (first.total_pages > MAX_BALANCE_PAGES) {
        throw new Error(`This product has too many stock balances to list (${first.total_items}).`);
      }
    } else if (pagination.total_items !== first.total_items || pagination.total_pages !== first.total_pages) {
      throw new Error("This product's stock balances changed while loading. Try again.");
    }
    for (const row of env.data.items) {
      if (!seen.has(row.id)) {
        seen.add(row.id);
        items.push(row);
      }
    }
    if (page >= first.total_pages) break;
    if (env.data.items.length === 0) {
      throw new Error("This product's stock balances ended early while loading. Try again.");
    }
  }
  if (items.length !== first.total_items) {
    throw new Error("This product's stock balances changed while loading. Try again.");
  }
  return { items, pagination: { ...first, page: 1, page_size: items.length, total_pages: items.length ? 1 : 0 } };
}

export function useAllProductStock(productId: number | null) {
  return useQuery<StockBalanceListEnvelope["data"]>({
    queryKey: queryKeys.stock.byProduct(productId ?? "none", { all: true }),
    enabled: productId !== null,
    queryFn: ({ signal }) => fetchAllProductStock(productId as number, signal),
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
