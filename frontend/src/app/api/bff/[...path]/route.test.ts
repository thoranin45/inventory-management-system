import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { isAllowed } from "./route";

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
});
