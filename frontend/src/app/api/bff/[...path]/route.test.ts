import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { applyCachePolicy, isAllowed } from "./route";

/**
 * Phase 14A — the BFF allow-list is the second gate (after backend role
 * checks) that scopes exactly which FastAPI routes the browser can reach.
 * No dedicated test existed for this mechanism before; this covers the new
 * Stock-Out entries plus a couple of pre-existing ones as a regression
 * anchor, and confirms the obvious negative cases (wrong method, unlisted
 * path, a path that merely starts with an allowed prefix) still 404.
 */
describe("BFF allow-list", () => {
  it("allows POST stock/out-fifo and stock/out-fefo", () => {
    expect(isAllowed("POST", "stock/out-fifo")).toBe(true);
    expect(isAllowed("POST", "stock/out-fefo")).toBe(true);
  });

  it("still allows the pre-existing Stock-In routes (regression)", () => {
    expect(isAllowed("POST", "stock/in")).toBe(true);
    expect(isAllowed("POST", "batches")).toBe(true);
  });

  it("rejects the wrong HTTP method on an otherwise-allowed path", () => {
    expect(isAllowed("GET", "stock/out-fifo")).toBe(false);
    expect(isAllowed("DELETE", "stock/out-fefo")).toBe(false);
  });

  it("rejects an unlisted stock path", () => {
    // Phase 14B retired /stock/adjust at the backend (always 409); the BFF
    // never allowed it either, before or after — this stays false.
    expect(isAllowed("POST", "stock/adjust")).toBe(false);
  });

  it("rejects a path that only starts with an allowed segment", () => {
    expect(isAllowed("POST", "stock/out-fifo/extra")).toBe(false);
    expect(isAllowed("POST", "stock/out-fifo-legacy")).toBe(false);
  });

  it("allows GET warehouses (Phase 14B directory)", () => {
    expect(isAllowed("GET", "warehouses")).toBe(true);
  });

  it("allows the Stock Adjustment Request create/list/detail/cancel routes", () => {
    expect(isAllowed("POST", "stock-adjustment-requests")).toBe(true);
    expect(isAllowed("GET", "stock-adjustment-requests")).toBe(true);
    expect(isAllowed("GET", "stock-adjustment-requests/42")).toBe(true);
    expect(isAllowed("POST", "stock-adjustment-requests/42/cancel")).toBe(true);
  });

  it("allows approve/reject (admin-gated at the backend, not here)", () => {
    expect(isAllowed("POST", "stock-adjustment-requests/42/approve")).toBe(true);
    expect(isAllowed("POST", "stock-adjustment-requests/42/reject")).toBe(true);
  });

  it("rejects method/path confusion on the new routes", () => {
    expect(isAllowed("DELETE", "stock-adjustment-requests/42")).toBe(false);
    expect(isAllowed("GET", "stock-adjustment-requests/42/approve")).toBe(false);
    expect(isAllowed("POST", "stock-adjustment-requests/abc/approve")).toBe(false);
    expect(isAllowed("POST", "stock-adjustment-requests/42/approve/extra")).toBe(false);
  });

  it("Phase 14C: exposes only the paginated ledger collection", () => {
    expect(isAllowed("GET", "inventory-movements")).toBe(true);
    // Unbounded bare-array sub-routes stay unreachable from the browser.
    expect(isAllowed("GET", "inventory-movements/product/1")).toBe(false);
    expect(isAllowed("GET", "inventory-movements/reference/STOCK_ADJUSTMENT_REQUEST/1")).toBe(false);
    expect(isAllowed("POST", "inventory-movements")).toBe(false);
    // Not exposed before 14C either: unbounded stock history.
    expect(isAllowed("GET", "stock/history")).toBe(false);
  });
});

describe("BFF cache policy (Phase 14C, D9)", () => {
  it("marks every proxied API response private, no-store", () => {
    for (const path of ["inventory-movements", "dashboard/recent-transactions", "stock-adjustment-requests/1"]) {
      const res = applyCachePolicy(path, new Response("{}", { headers: { "cache-control": "max-age=60" } }));
      expect(res.headers.get("cache-control")).toBe("private, no-store");
    }
  });

  it("leaves shared product images cacheable", () => {
    const res = applyCachePolicy("uploads/products/a.png", new Response("x"));
    expect(res.headers.get("cache-control")).toBeNull();
  });
});
