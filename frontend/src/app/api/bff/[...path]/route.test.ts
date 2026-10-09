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
    expect(isAllowed("POST", "stock/adjust")).toBe(false);
    expect(isAllowed("GET", "warehouses")).toBe(false);
  });

  it("rejects a path that only starts with an allowed segment", () => {
    expect(isAllowed("POST", "stock/out-fifo/extra")).toBe(false);
    expect(isAllowed("POST", "stock/out-fifo-legacy")).toBe(false);
  });
});
