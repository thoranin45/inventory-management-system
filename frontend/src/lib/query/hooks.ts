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

function balancesInconsistent(detail: string): Error {
  return new Error(`This product's stock balances changed while loading (${detail}). Try again.`);
}

/**
 * Phase 14D — EVERY balance of one product, walking all pages in `id asc`
 * order. Each page is verified independently: its page number, page_size
 * and total_pages must match the request and total_items, it must hold
 * exactly the expected row count, and ids must be valid and strictly
 * ascending within and across pages (so repeated, overlapping, shifted or
 * out-of-order pages are rejected). Any inconsistency, a failed page, a
 * changed total or more than MAX_BALANCE_PAGES throws -- never a partial
 * or silently truncated list.
 */
export async function fetchAllProductStock(
  productId: number | string,
  signal?: AbortSignal,
): Promise<StockBalanceListEnvelope["data"]> {
  const items: StockBalanceListEnvelope["data"]["items"] = [];
  let lastId = 0;
  let total: number | null = null;
  for (let page = 1; ; page++) {
    const env = await bffJson(`/api/bff/stock-balances/product/${productId}`, stockBalanceListEnvelope, {
      query: { page, page_size: BALANCE_PAGE_SIZE, sort_by: "id", sort_order: "asc" },
      signal,
    });
    const { items: rows, pagination } = env.data;
    if (pagination.page !== page) throw balancesInconsistent(`asked for page ${page}, got ${pagination.page}`);
    if (pagination.page_size !== BALANCE_PAGE_SIZE) throw balancesInconsistent(`unexpected page size ${pagination.page_size}`);
    if (!Number.isSafeInteger(pagination.total_items) || pagination.total_items < 0) {
      throw balancesInconsistent("invalid total");
    }
    if (pagination.total_pages !== Math.ceil(pagination.total_items / BALANCE_PAGE_SIZE)) {
      throw balancesInconsistent("page count does not match the total");
    }
    if (total === null) {
      total = pagination.total_items;
      if (pagination.total_pages > MAX_BALANCE_PAGES) {
        throw new Error(`This product has too many stock balances to list (${total}).`);
      }
    } else if (pagination.total_items !== total) {
      throw balancesInconsistent("total changed");
    }
    const expected = Math.min(BALANCE_PAGE_SIZE, Math.max(0, total - (page - 1) * BALANCE_PAGE_SIZE));
    if (rows.length === 0 && expected > 0) {
      throw new Error("This product's stock balances ended early while loading. Try again.");
    }
    if (rows.length !== expected) throw balancesInconsistent(`page ${page} has ${rows.length} of ${expected} rows`);
    for (const row of rows) {
      if (!Number.isSafeInteger(row.id) || row.id <= 0) throw balancesInconsistent("invalid balance id");
      if (row.id <= lastId) throw balancesInconsistent("duplicate or out-of-order balance");
      lastId = row.id;
      items.push(row);
    }
    if (page >= pagination.total_pages) break;
  }
  return { items, pagination: { page: 1, page_size: items.length, total_items: total, total_pages: items.length ? 1 : 0 } };
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
