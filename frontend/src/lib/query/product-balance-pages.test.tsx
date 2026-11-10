import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * R4.2 (D-R4-7) — the product detail's balances load one verified page at a
 * time; more only on request. Real hook, mocked network only.
 */
const bffJson = vi.fn();
vi.mock("@/lib/api/browser", () => ({ bffJson: (...a: unknown[]) => bffJson(...a) }));

import { PRODUCT_BALANCE_PAGE_SIZE, useProductBalancePages } from "./hooks";

const row = (id: number) => ({
  id, product_id: 9, warehouse_id: 1, location_id: 11, batch_id: 500 + id, batch_lot_no: `LOT-${id}`,
  on_hand_qty: "1.000", reserved_qty: "0.000", available_qty: "1.000", is_transit: false,
  batch_expiry_date: null, days_to_expiry: null, is_expired: false, as_of_date: "2026-06-15",
});

function serve(total: number, tamper?: (page: number, data: { items: unknown[]; pagination: Record<string, number> }) => void) {
  const all = Array.from({ length: total }, (_, i) => row(i + 1));
  bffJson.mockImplementation(async (_p: string, _s: unknown, opts: { query: { page: number; page_size: number } }) => {
    const { page, page_size } = opts.query;
    const data = {
      items: all.slice((page - 1) * page_size, page * page_size),
      pagination: { page, page_size, total_items: total, total_pages: Math.ceil(total / page_size) },
    };
    tamper?.(page, data);
    return { success: true, message: "ok", data };
  });
}

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  bffJson.mockReset();
});

describe("useProductBalancePages", () => {
  it("loads only the first page (50, id asc) until more is requested", async () => {
    serve(120);
    const { result } = renderHook(() => useProductBalancePages(9), { wrapper });
    await waitFor(() => expect(result.current.balances).not.toBeNull());
    expect(PRODUCT_BALANCE_PAGE_SIZE).toBe(50);
    expect(result.current.balances).toMatchObject({ total: 120, inconsistent: false });
    expect(result.current.balances!.rows).toHaveLength(50);
    expect(bffJson).toHaveBeenCalledTimes(1);
    expect(bffJson.mock.calls[0][2].query).toMatchObject({ page: 1, page_size: 50, sort_by: "id", sort_order: "asc" });
    expect(result.current.hasNextPage).toBe(true);
  });

  it("each Load more fetches exactly the next page", async () => {
    serve(120);
    const { result } = renderHook(() => useProductBalancePages(9), { wrapper });
    await waitFor(() => expect(result.current.balances).not.toBeNull());
    await act(async () => void (await result.current.fetchNextPage()));
    await waitFor(() => expect(result.current.balances!.rows).toHaveLength(100));
    await act(async () => void (await result.current.fetchNextPage()));
    await waitFor(() => expect(result.current.balances!.rows).toHaveLength(120));
    expect(result.current.hasNextPage).toBe(false);
    expect(bffJson.mock.calls.map((c) => c[2].query.page)).toEqual([1, 2, 3]);
  });

  it("a page that does not match the request is an error, not a partial list", async () => {
    serve(30, (_page, data) => {
      data.items = data.items.slice(1); // one row missing
    });
    const { result } = renderHook(() => useProductBalancePages(9), { wrapper });
    // the hook keeps the shared retry-once policy, so the error lands after one retry
    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 5000 });
    expect(result.current.balances).toBeNull();
  });

  it("a total that changes between pages marks the list inconsistent", async () => {
    serve(120, (page, data) => {
      if (page === 2) data.pagination.total_items = 121;
      if (page === 2) data.pagination.total_pages = 3;
    });
    const { result } = renderHook(() => useProductBalancePages(9), { wrapper });
    await waitFor(() => expect(result.current.balances).not.toBeNull());
    await act(async () => void (await result.current.fetchNextPage()));
    await waitFor(() => expect(result.current.balances!.inconsistent).toBe(true));
  });

  it("does nothing without a product", () => {
    const { result } = renderHook(() => useProductBalancePages(null), { wrapper });
    expect(result.current.balances).toBeNull();
    expect(bffJson).not.toHaveBeenCalled();
  });
});
