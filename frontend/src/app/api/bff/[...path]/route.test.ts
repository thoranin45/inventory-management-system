import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
// P0-A5: the upstream FastAPI client, mocked so a test sees exactly what the proxy forwards.
vi.mock("@/lib/api/server", () => ({ getSessionToken: vi.fn(), rawRequest: vi.fn() }));

import { rawRequest } from "@/lib/api/server";
import { applyCachePolicy, GET, isAllowed, POST } from "./route";

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

/**
 * P0-A5 — the Sales Return route through the real BFF handler, with only the
 * upstream client mocked. The drawer's replay safety depends on FastAPI seeing
 * the browser's Idempotency-Key unchanged on every send of the same intent.
 */
describe("BFF sales return — Idempotency-Key forwarding (P0-A5)", () => {
  const returnPath = ["sales-orders", "63", "return"];
  const ctx = (path: string[]) => ({ params: Promise.resolve({ path }) }) as Parameters<typeof POST>[1];
  const body = { items: [{ product_id: 3, quantity: "2" }, { product_id: 6, quantity: "1.25", reason: "torn" }] };
  const postReturn = (headers: Record<string, string>) =>
    new Request("http://localhost/api/bff/sales-orders/63/return", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  const upstream = (status: number, text: string, requestId: string) =>
    new Response(text, { status, headers: { "content-type": "application/json", "x-request-id": requestId } });
  const replyText = JSON.stringify({
    success: true,
    message: "Sales return completed",
    data: { sales_order_id: 63, so_number: "SO-000063", returned_items: [] },
  });

  beforeEach(() => {
    vi.mocked(rawRequest).mockReset();
  });

  it.each([
    "so-ret-0b5e2c1a-7d1f-4b7e-9a51-3f7c2a9d8e10", // the drawer's format
    "so-ret-A.b_c:D-9", // every character class the backend accepts
  ])("forwards the Idempotency-Key %s unchanged, with the body, and passes the reply through", async (key) => {
    vi.mocked(rawRequest).mockResolvedValue(upstream(200, replyText, "req-ret-1"));
    const res = await POST(postReturn({ "Idempotency-Key": key }), ctx(returnPath));
    expect(rawRequest).toHaveBeenCalledTimes(1);
    const [path, init] = vi.mocked(rawRequest).mock.calls[0];
    expect(path).toBe("/sales-orders/63/return");
    expect(init).toEqual(expect.objectContaining({ method: "POST", json: body, headers: { "idempotency-key": key } }));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(replyText);
    expect(res.headers.get("x-request-id")).toBe("req-ret-1");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("forwards the same key unchanged on every retry of the same intent", async () => {
    vi.mocked(rawRequest).mockImplementation(async () => upstream(503, JSON.stringify({ success: false, message: "Service unavailable", errors: [] }), "req-503"));
    const key = "so-ret-retry-1";
    for (let i = 0; i < 3; i++) await POST(postReturn({ "Idempotency-Key": key }), ctx(returnPath));
    expect(rawRequest).toHaveBeenCalledTimes(3);
    for (const [, init] of vi.mocked(rawRequest).mock.calls) {
      expect(init?.headers).toEqual({ "idempotency-key": key });
      expect(init?.json).toEqual(body);
    }
  });

  it("never invents a key when the browser sent none", async () => {
    vi.mocked(rawRequest).mockResolvedValue(upstream(422, JSON.stringify({ success: false, message: "Validation error", errors: [] }), "req-422"));
    await POST(postReturn({}), ctx(returnPath));
    expect(rawRequest).toHaveBeenCalledWith("/sales-orders/63/return", expect.objectContaining({ headers: {} }));
  });

  it("returns an upstream 409 error envelope unchanged, so the drawer can classify its full message", async () => {
    const envelope = JSON.stringify({
      success: false,
      message: "Return quantity exceeds remaining returnable quantity for product 6. Remaining: 1.000",
      errors: [],
      request_id: "req-409",
    });
    vi.mocked(rawRequest).mockResolvedValue(upstream(409, envelope, "req-409"));
    const res = await POST(postReturn({ "Idempotency-Key": "so-ret-x" }), ctx(returnPath));
    expect(res.status).toBe(409);
    expect(await res.text()).toBe(envelope);
    expect(res.headers.get("x-request-id")).toBe("req-409");
  });

  it("refuses GET on the return path without calling upstream", async () => {
    const res = await GET(new Request("http://localhost/api/bff/sales-orders/63/return"), ctx(returnPath));
    expect(res.status).toBe(404);
    expect(rawRequest).not.toHaveBeenCalled();
  });
});
