import { describe, expect, it, vi, beforeEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";

/**
 * Integration-level check that a successful approve/reject actually
 * invalidates the query cache — a mocked-hook test can't observe this
 * (mocking the hook removes the exact code path), so this one deliberately
 * uses the REAL hooks and a REAL QueryClient, mocking only the network
 * boundary (bffJson).
 */
const bffJson = vi.fn();
vi.mock("@/lib/api/browser", () => ({ bffJson: (...a: unknown[]) => bffJson(...a) }));

import {
  useApproveStockAdjustmentRequest,
  useRejectStockAdjustmentRequest,
} from "./stock-adjustment-requests";

function wrapper(qc: QueryClient) {
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  }
  return Wrapper;
}

const DETAIL = {
  id: 42, reference_number: "ADJ-000042", status: "APPROVED",
  product: { id: 5, sku: "WH-COFFEE", product_name: "Coffee 1kg" },
  warehouse: { id: 1, warehouse_code: "MAIN", warehouse_name: "Main Warehouse" },
  location: { id: 1, location_code: "DEFAULT", location_name: "Default Location" },
  observed_quantity: "10.000", requested_quantity: "8.000",
  reason_code: "CYCLE_COUNT_VARIANCE", notes: null,
  requested_by: { id: 2, username: "warehouse1" }, reviewed_by: { id: 1, username: "admin1" },
  rejection_reason: null, created_at: "2026-01-01T10:00:00Z",
  reviewed_at: "2026-01-01T11:00:00Z", completed_at: "2026-01-01T11:00:00Z",
  history: [],
};

beforeEach(() => {
  bffJson.mockReset();
});

describe("Stock Adjustment Request cache invalidation (real hooks, mocked network only)", () => {
  it("useApproveStockAdjustmentRequest invalidates stock-adjustment-requests, stock and product queries on success", async () => {
    bffJson.mockResolvedValue({ success: true, message: "ok", data: DETAIL });
    const qc = new QueryClient();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useApproveStockAdjustmentRequest(), { wrapper: wrapper(qc) });

    result.current.mutate({ id: 42, idempotencyKey: "adjreq-approve-test" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const invalidatedKeys = invalidateSpy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey[0]);
    expect(invalidatedKeys).toContain("stock-adjustment-requests");
    expect(invalidatedKeys).toContain("stock-balances");
    expect(invalidatedKeys).toContain("products");
  });

  it("useRejectStockAdjustmentRequest invalidates stock-adjustment-requests on success", async () => {
    bffJson.mockResolvedValue({ success: true, message: "ok", data: { ...DETAIL, status: "REJECTED" } });
    const qc = new QueryClient();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useRejectStockAdjustmentRequest(), { wrapper: wrapper(qc) });

    result.current.mutate({ id: 42, rejection_reason: "Count was correct" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const invalidatedKeys = invalidateSpy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] }).queryKey[0]);
    expect(invalidatedKeys).toContain("stock-adjustment-requests");
  });

  it("does not invalidate anything on a failed approve", async () => {
    bffJson.mockRejectedValue(new Error("network down"));
    const qc = new QueryClient();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useApproveStockAdjustmentRequest(), { wrapper: wrapper(qc) });

    result.current.mutate({ id: 42, idempotencyKey: "adjreq-approve-test-2" });
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
