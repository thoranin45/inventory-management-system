/**
 * Step 0 — LIVE backend contract gate.
 *
 * Opt-in: only runs with `LIVE_BACKEND=1` and a reachable FastAPI on
 * $API_BASE_URL (default http://localhost:8081). It fetches the REAL response
 * bodies and validates them with the production Zod schemas — proving the
 * frontend contracts match the running backend. Not part of `npm test`.
 *
 *   LIVE_BACKEND=1 LIVE_USER=wc_wh LIVE_PASS='Warehouse123!' npm run test:live
 */
import { describe, expect, it, beforeAll } from "vitest";

import { userMeSchema, tokenResponseSchema } from "./auth";
import {
  attentionSummaryEnvelope,
  dashboardSummaryEnvelope,
  recentTransactionsEnvelope,
} from "./dashboard";
import { searchResponseEnvelope } from "./search";
import { productListEnvelope } from "./products";
import { stockBalanceListEnvelope } from "./stock";
import {
  completeFulfillmentInput,
  customerListEnvelope,
  fulfillmentScanEnvelope,
  packingSlipDataEnvelope,
  salesMutationEnvelope,
  salesOrderDetailEnvelope,
  salesOrderListEnvelope,
  scanResolveEnvelope,
  shippingLabelDataEnvelope,
} from "./sales";
import {
  poActionEnvelope,
  purchaseOrderDetailEnvelope,
  purchaseOrderListEnvelope,
  purchaseOrderReceiveEnvelope,
  supplierListEnvelope,
} from "./purchase-orders";
import {
  transferDetailSchema,
  transferListEnvelope,
  transferReceiptResponseSchema,
} from "./transfers";
import { productDetailEnvelope } from "./products";
import {
  batchListEnvelope,
  categoryListEnvelope,
  categoryMutationEnvelope,
  customerListEnvelope as mdCustomerListEnvelope,
  customerMutationEnvelope,
  supplierListEnvelope as mdSupplierListEnvelope,
  supplierMutationEnvelope,
} from "./master-data";
import {
  chartExpirySchema,
  chartSalesSchema,
  chartStockSchema,
  expiredStockSchema,
  inTransitStockSchema,
  lowStockOperationalSchema,
  movementReportEnvelope,
  nearExpiryStockSchema,
  operationalStockEnvelope,
  purchaseOrdersReportEnvelope,
  salesReportEnvelope,
  salesSummarySchema,
  transfersReportEnvelope,
} from "./reports";
import { salesReturnEnvelope } from "./sales";
import { auditLogListSchema } from "./audit";
import { errorResponseSchema } from "../errors";

const LIVE = process.env.LIVE_BACKEND === "1";
const BASE = (process.env.API_BASE_URL ?? "http://localhost:8081").replace(/\/+$/, "");
const USER = process.env.LIVE_USER ?? "wc_wh";
const PASS = process.env.LIVE_PASS ?? "Warehouse123!";

let token = "";

async function api(path: string, init: RequestInit = {}) {
  return fetch(BASE + path, {
    ...init,
    headers: { accept: "application/json", authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
}

describe.skipIf(!LIVE)("live backend contract (Step 0)", () => {
  beforeAll(async () => {
    const res = await fetch(BASE + "/api/v1/auth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username: USER, password: PASS, grant_type: "password" }),
    });
    expect(res.status, "auth/token").toBe(200);
    const parsed = tokenResponseSchema.parse(await res.json());
    token = parsed.access_token;
  });

  it("1 · POST /auth/token → { access_token, token_type }", () => {
    expect(token.length).toBeGreaterThan(20);
  });

  it("2 · GET /auth/me → UserMe", async () => {
    const res = await api("/api/v1/auth/me");
    expect(res.status).toBe(200);
    const me = userMeSchema.parse(await res.json());
    expect(me.id).toBeTypeOf("number");
    expect(String(me.role).toLowerCase()).toMatch(/warehouse|admin/);
  });

  it("3 · GET /dashboard/summary → DashboardSummary (decimals as strings)", async () => {
    const res = await api("/api/v1/dashboard/summary");
    expect(res.status).toBe(200);
    const env = dashboardSummaryEnvelope.parse(await res.json());
    expect(env.data.inventory.owned_quantity).toMatch(/^-?\d+(\.\d+)?$/);
  });

  it("4 · GET /attention/summary → AttentionSummary", async () => {
    const res = await api("/api/v1/attention/summary");
    expect(res.status).toBe(200);
    attentionSummaryEnvelope.parse(await res.json());
  });

  it("5 · GET /search?q= → SearchResponse", async () => {
    const res = await api("/api/v1/search?q=arabica");
    expect(res.status).toBe(200);
    searchResponseEnvelope.parse(await res.json());
  });

  it("6 · GET /dashboard/recent-transactions → { items: [...] }", async () => {
    const res = await api("/api/v1/dashboard/recent-transactions");
    expect(res.status).toBe(200);
    recentTransactionsEnvelope.parse(await res.json());
  });

  it("7 · GET /products → ApiResponse<PaginatedData<ProductRow>>", async () => {
    const res = await api("/api/v1/products?page=1&page_size=5");
    expect(res.status).toBe(200);
    const env = productListEnvelope.parse(await res.json());
    expect(env.data.pagination.page).toBe(1);
    for (const row of env.data.items) {
      expect(row.owned_quantity).toMatch(/^-?\d+(\.\d+)?$/);
      expect(row.operational_available_quantity).toMatch(/^-?\d+(\.\d+)?$/);
    }
  });

  it("8 · GET /stock-balances (+ /in-transit) → PaginatedData<StockBalanceRow>", async () => {
    const flat = await api("/api/v1/stock-balances?page=1&page_size=5");
    expect(flat.status).toBe(200);
    stockBalanceListEnvelope.parse(await flat.json());

    const transit = await api("/api/v1/stock-balances/in-transit?page=1&page_size=5");
    expect(transit.status).toBe(200);
    const tEnv = stockBalanceListEnvelope.parse(await transit.json());
    expect(tEnv.data.items.every((r) => r.is_transit === true || tEnv.data.items.length === 0)).toBe(true);
  });

  it("9 · GET /stock-balances/product/{id} → PaginatedData<StockBalanceRow>", async () => {
    const list = await api("/api/v1/products?page=1&page_size=1");
    const { data } = productListEnvelope.parse(await list.json());
    const id = data.items[0]?.id ?? 1;
    const res = await api(`/api/v1/stock-balances/product/${id}`);
    expect(res.status).toBe(200);
    stockBalanceListEnvelope.parse(await res.json());
  });

  it("10 · error envelope carries request_id (401 + 422)", async () => {
    const noAuth = await fetch(BASE + "/api/v1/products");
    expect(noAuth.status).toBe(401);
    const e401 = errorResponseSchema.parse(await noAuth.json());
    expect(e401.request_id ?? noAuth.headers.get("x-request-id")).toBeTruthy();

    const badSort = await api("/api/v1/products?sort_by=__nope__");
    expect(badSort.status).toBe(422);
    const e422 = errorResponseSchema.parse(await badSort.json());
    expect(e422.request_id ?? badSort.headers.get("x-request-id")).toBeTruthy();
  });
});

/**
 * Phase 3 — LIVE Sales Order contract gate.
 *
 * Read checks run whenever LIVE_BACKEND=1. The state-changing checks
 * (create → confirm → cancel) only run with LIVE_SALES_MUTATE=1 and operate on
 * a brand-new throwaway draft on the local dev DB — never an existing record.
 *
 *   LIVE_BACKEND=1 LIVE_SALES_MUTATE=1 \
 *   LIVE_ADMIN_USER=wc_admin LIVE_ADMIN_PASS='Admin123!' npm run test:live
 */
const MUTATE = process.env.LIVE_SALES_MUTATE === "1";
const ADMIN_USER = process.env.LIVE_ADMIN_USER ?? "wc_admin";
const ADMIN_PASS = process.env.LIVE_ADMIN_PASS ?? "Admin123!";

describe.skipIf(!LIVE)("live Sales Order contract (Phase 3)", () => {
  let adminToken = "";

  async function adminApi(path: string, init: RequestInit = {}) {
    return fetch(BASE + path, {
      ...init,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${adminToken}`,
        ...(init.headers ?? {}),
      },
    });
  }

  beforeAll(async () => {
    const res = await fetch(BASE + "/api/v1/auth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username: ADMIN_USER, password: ADMIN_PASS, grant_type: "password" }),
    });
    if (res.status === 200) adminToken = tokenResponseSchema.parse(await res.json()).access_token;
  });

  it("S1 · GET /sales-orders/ → ApiResponse<PaginatedData<SalesOrderRow>> (decimals as strings)", async () => {
    const res = await api("/api/v1/sales-orders/?page=1&page_size=5");
    expect(res.status).toBe(200);
    const env = salesOrderListEnvelope.parse(await res.json());
    for (const row of env.data.items) {
      expect(row.total_amount).toMatch(/^-?\d+(\.\d+)?$/);
      expect(row.total_quantity).toMatch(/^-?\d+(\.\d+)?$/);
      expect(row.picked_pct).toBeTypeOf("number");
    }
  });

  it("S2 · GET /sales-orders/{id} → detail (money/qty as JSON numbers, coerced to string)", async () => {
    const list = await api("/api/v1/sales-orders/?page=1&page_size=1");
    const { data } = salesOrderListEnvelope.parse(await list.json());
    if (data.items.length === 0) return; // empty DB — nothing to fetch
    const id = data.items[0].id;
    const res = await api(`/api/v1/sales-orders/${id}`);
    expect(res.status).toBe(200);
    const env = salesOrderDetailEnvelope.parse(await res.json());
    expect(typeof env.data.total_amount).toBe("string");
    for (const it of env.data.items) {
      expect(typeof it.quantity).toBe("string");
      expect(typeof it.unit_price).toBe("string");
    }
  });

  it("S3 · GET /customers → paginated customer list", async () => {
    const res = await api("/api/v1/customers?page=1&page_size=5");
    expect(res.status).toBe(200);
    customerListEnvelope.parse(await res.json());
  });

  it("S4 · POST /sales-orders/ is admin-only (warehouse → 403)", async () => {
    const res = await api("/api/v1/sales-orders/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ customer_id: 1, items: [{ product_id: 1, quantity: "1.000", unit_price: "1.00" }] }),
    });
    expect(res.status).toBe(403);
  });

  it.skipIf(!MUTATE)("S5 · create → confirm → cancel round-trip (throwaway draft)", async () => {
    expect(adminToken.length).toBeGreaterThan(20);

    // pick a real customer + product
    const custRes = await adminApi("/api/v1/customers?page=1&page_size=1");
    const cust = customerListEnvelope.parse(await custRes.json());
    const prodRes = await adminApi("/api/v1/products?page=1&page_size=1");
    const prod = productListEnvelope.parse(await prodRes.json());
    if (cust.data.items.length === 0 || prod.data.items.length === 0) return;

    const create = await adminApi("/api/v1/sales-orders/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        customer_id: cust.data.items[0].id,
        items: [{ product_id: prod.data.items[0].id, quantity: "1.000", unit_price: "1.00" }],
      }),
    });
    expect([200, 201]).toContain(create.status); // backend returns 200
    const created = salesMutationEnvelope.parse(await create.json());
    expect(created.data.sales_order_id).toBeTypeOf("number");
    expect(created.data.status).toBe("DRAFT");
    const id = created.data.sales_order_id;

    const confirm = await adminApi(`/api/v1/sales-orders/${id}/confirm`, { method: "POST" });
    expect([200, 409]).toContain(confirm.status);
    if (confirm.status === 200) {
      salesMutationEnvelope.parse(await confirm.json());
    }

    // cancel is PUT, allowed for warehouse role too
    const cancel = await api(`/api/v1/sales-orders/${id}/cancel`, { method: "PUT" });
    expect(cancel.status).toBe(200);
    const cancelled = salesMutationEnvelope.parse(await cancel.json());
    expect(cancelled.data.status).toBe("CANCELLED");

    // cancelling again → 409 + request_id
    const again = await api(`/api/v1/sales-orders/${id}/cancel`, { method: "PUT" });
    expect(again.status).toBe(409);
    const e = errorResponseSchema.parse(await again.json());
    expect(e.request_id ?? again.headers.get("x-request-id")).toBeTruthy();
  });
});

/**
 * Phase 4 — LIVE Picking / Packing / Scanner contract gate.
 *
 * Read checks (scan/resolve) run with LIVE_BACKEND=1. The full pick→pack flow
 * runs only with LIVE_PICKPACK_MUTATE=1 on a brand-new throwaway order it
 * creates and drives all the way to READY_TO_SHIP.
 *
 *   LIVE_BACKEND=1 LIVE_PICKPACK_MUTATE=1 LIVE_ADMIN_USER=wc_admin \
 *   LIVE_ADMIN_PASS='Admin123!' npm run test:live
 */
const PP_MUTATE = process.env.LIVE_PICKPACK_MUTATE === "1";

describe.skipIf(!LIVE)("live Picking / Packing contract (Phase 4)", () => {
  let adminToken = "";
  async function adminApi(path: string, init: RequestInit = {}) {
    return fetch(BASE + path, {
      ...init,
      headers: { accept: "application/json", authorization: `Bearer ${adminToken}`, ...(init.headers ?? {}) },
    });
  }
  const jsonHeaders = { "content-type": "application/json" };

  beforeAll(async () => {
    const res = await fetch(BASE + "/api/v1/auth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username: ADMIN_USER, password: ADMIN_PASS, grant_type: "password" }),
    });
    if (res.status === 200) adminToken = tokenResponseSchema.parse(await res.json()).access_token;
  });

  it("P1 · GET /scan/resolve?context=pick → product + batch expiry metadata (strings)", async () => {
    // resolve any product barcode from the products list
    const list = await api("/api/v1/products?page=1&page_size=10");
    const { data } = productListEnvelope.parse(await list.json());
    const withBarcode = data.items.find((p) => p.barcode);
    if (!withBarcode?.barcode) return;
    const res = await api(`/api/v1/scan/resolve?barcode=${encodeURIComponent(withBarcode.barcode)}&context=pick`);
    expect(res.status).toBe(200);
    const env = scanResolveEnvelope.parse(await res.json());
    expect(env.data.product.operational_available_quantity).toMatch(/^-?\d+(\.\d+)?$/);
    for (const b of env.data.batches) {
      expect(typeof b.is_expired).toBe("boolean");
      expect(typeof b.is_near_expiry).toBe("boolean");
      expect(b.operational_available_quantity).toMatch(/^-?\d+(\.\d+)?$/);
    }
  });

  it("P2 · GET /scan/resolve unknown barcode → 404 + request_id", async () => {
    const res = await api("/api/v1/scan/resolve?barcode=__nope__&context=pick");
    expect(res.status).toBe(404);
    const e = errorResponseSchema.parse(await res.json());
    expect(e.request_id ?? res.headers.get("x-request-id")).toBeTruthy();
  });

  it.skipIf(!PP_MUTATE)("P3 · create → confirm → start-picking → scan-pick(errors) → complete-picking → scan-pack → complete-packing → READY_TO_SHIP", async () => {
    expect(adminToken.length).toBeGreaterThan(20);
    const custRes = await adminApi("/api/v1/customers?page=1&page_size=1");
    const cust = customerListEnvelope.parse(await custRes.json());
    const prodRes = await adminApi("/api/v1/products?page=1&page_size=20");
    const prods = productListEnvelope.parse(await prodRes.json());
    // Pick a barcoded product that actually has stock to allocate — the dev DB
    // accumulates zero-stock QA products from earlier phases' browser QA.
    const withBarcode = prods.data.items.filter(
      (p) => p.barcode && Number(p.operational_available_quantity) >= 2,
    );
    const otherBarcode = withBarcode.find((p) => p.id !== withBarcode[0]?.id)?.barcode;
    if (cust.data.items.length === 0 || withBarcode.length < 1) return;
    const line = withBarcode[0];

    const create = await adminApi("/api/v1/sales-orders/", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({
        customer_id: cust.data.items[0].id,
        items: [{ product_id: line.id, quantity: "2.000", unit_price: "1.00" }],
      }),
    });
    const created = salesMutationEnvelope.parse(await create.json());
    const id = created.data.sales_order_id;

    const confirm = await adminApi(`/api/v1/sales-orders/${id}/confirm`, { method: "POST" });
    expect(confirm.status).toBe(200);

    // start-picking (warehouse token also allowed; admin is fine)
    const start = await api(`/api/v1/sales-orders/${id}/start-picking`, { method: "POST" });
    expect(start.status).toBe(200);
    expect(salesMutationEnvelope.parse(await start.json()).data.status).toBe("PICKING");

    // wrong item (if we have a second barcode) → 409 PRODUCT_NOT_IN_ORDER
    if (otherBarcode) {
      const wrong = await api(`/api/v1/sales-orders/${id}/scan-pick`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ barcode: otherBarcode }),
      });
      expect(wrong.status).toBe(409);
      expect(errorResponseSchema.parse(await wrong.json()).message).toBe("PRODUCT_NOT_IN_ORDER");
    }
    // unknown barcode → 404 BARCODE_NOT_FOUND
    const unknown = await api(`/api/v1/sales-orders/${id}/scan-pick`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ barcode: "000000000000000" }),
    });
    expect(unknown.status).toBe(404);
    expect(errorResponseSchema.parse(await unknown.json()).message).toBe("BARCODE_NOT_FOUND");

    // good scan ×2 fills the line
    for (let i = 0; i < 2; i++) {
      const ok = await api(`/api/v1/sales-orders/${id}/scan-pick`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ barcode: line.barcode, quantity: "1.000" }),
      });
      expect(ok.status).toBe(200);
      fulfillmentScanEnvelope.parse(await ok.json());
    }
    // over-scan → 409 ALLOCATION_SCAN_EXCEEDS_REMAINING
    const over = await api(`/api/v1/sales-orders/${id}/scan-pick`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ barcode: line.barcode, quantity: "1.000" }),
    });
    expect(over.status).toBe(409);
    expect(errorResponseSchema.parse(await over.json()).message).toBe("ALLOCATION_SCAN_EXCEEDS_REMAINING");

    // fetch allocation ids for the completion payload
    const det = salesOrderDetailEnvelope.parse(
      await (await api(`/api/v1/sales-orders/${id}`)).json(),
    );
    const allocs = det.data.items.flatMap((it) =>
      it.fulfillment_allocations.map((a) => ({ allocation_id: a.id, quantity: a.quantity })),
    );
    completeFulfillmentInput.parse({ allocations: allocs });

    const cp = await api(`/api/v1/sales-orders/${id}/complete-picking`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ allocations: allocs }),
    });
    expect(cp.status).toBe(200);
    expect(salesMutationEnvelope.parse(await cp.json()).data.status).toBe("PACKING");

    for (const a of allocs) {
      const sp = await api(`/api/v1/sales-orders/${id}/scan-pack`, {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ barcode: line.barcode, quantity: a.quantity, allocation_id: a.allocation_id }),
      });
      expect(sp.status).toBe(200);
      fulfillmentScanEnvelope.parse(await sp.json());
    }

    const cpk = await api(`/api/v1/sales-orders/${id}/complete-packing`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ allocations: allocs }),
    });
    expect(cpk.status).toBe(200);
    expect(salesMutationEnvelope.parse(await cpk.json()).data.status).toBe("READY_TO_SHIP");

    // print previews
    const slip = await api(`/api/v1/sales-orders/${id}/packing-slip-data`);
    expect(slip.status).toBe(200);
    packingSlipDataEnvelope.parse(await slip.json());
    const label = await api(`/api/v1/sales-orders/${id}/shipping-label-data`);
    expect(label.status).toBe(200);
    shippingLabelDataEnvelope.parse(await label.json());
  });
});

/**
 * Phase 5 — LIVE Purchase Order + Receiving contract gate.
 *
 * Reads run with LIVE_BACKEND=1. The state-changing flow (create → confirm →
 * partial receive → idempotent replay → second receive → final receive; plus a
 * separate draft PO it cancels) runs only with LIVE_PO_MUTATE=1 on brand-new
 * throwaway POs it creates.
 *
 *   LIVE_BACKEND=1 LIVE_PO_MUTATE=1 LIVE_ADMIN_USER=wc_admin \
 *   LIVE_ADMIN_PASS='Admin123!' npm run test:live
 */
const PO_MUTATE = process.env.LIVE_PO_MUTATE === "1";

describe.skipIf(!LIVE)("live Purchase Order + Receiving contract (Phase 5)", () => {
  let adminToken = "";
  const jsonHeaders = { "content-type": "application/json" };
  async function adminApi(path: string, init: RequestInit = {}) {
    return fetch(BASE + path, {
      ...init,
      headers: { accept: "application/json", authorization: `Bearer ${adminToken}`, ...(init.headers ?? {}) },
    });
  }
  const uuid = () =>
    (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`);

  beforeAll(async () => {
    const res = await fetch(BASE + "/api/v1/auth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username: ADMIN_USER, password: ADMIN_PASS, grant_type: "password" }),
    });
    if (res.status === 200) adminToken = tokenResponseSchema.parse(await res.json()).access_token;
  });

  it("PO1 · GET /suppliers → paginated supplier list", async () => {
    const res = await api("/api/v1/suppliers?page=1&page_size=5");
    expect(res.status).toBe(200);
    supplierListEnvelope.parse(await res.json());
  });

  it("PO2 · GET /purchase-orders → rows with received / remaining / receiving_pct (decimals as strings)", async () => {
    const res = await api("/api/v1/purchase-orders?page=1&page_size=5");
    expect(res.status).toBe(200);
    const env = purchaseOrderListEnvelope.parse(await res.json());
    for (const row of env.data.items) {
      expect(row.ordered_quantity).toMatch(/^-?\d+(\.\d+)?$/);
      expect(row.received_quantity).toMatch(/^-?\d+(\.\d+)?$/);
      expect(row.receiving_pct).toBeTypeOf("number");
      expect(row.receipt_count).toBeTypeOf("number");
    }
  });

  it("PO3 · POST /purchase-orders is admin-only (warehouse → 403)", async () => {
    const res = await api("/api/v1/purchase-orders", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ supplier_id: 1, items: [{ product_id: 3, quantity: "1.000", unit_price: "1.00" }] }),
    });
    expect(res.status).toBe(403);
  });

  it("PO4 · receive without an Idempotency-Key → 422", async () => {
    const list = await api("/api/v1/purchase-orders?page=1&page_size=1");
    const env = purchaseOrderListEnvelope.parse(await list.json());
    const id = env.data.items[0]?.id;
    if (!id) return;
    const res = await api(`/api/v1/purchase-orders/${id}/receive`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ items: [{ product_id: 3, quantity: "1.000" }] }),
    });
    expect(res.status).toBe(422);
    errorResponseSchema.parse(await res.json());
  });

  it.skipIf(!PO_MUTATE)("PO5 · create → confirm → partial receive → idempotent replay → mismatch 409 → final receive → RECEIVED", async () => {
    expect(adminToken.length).toBeGreaterThan(20);
    const sup = supplierListEnvelope.parse(await (await adminApi("/api/v1/suppliers?page=1&page_size=1")).json());
    if (sup.data.items.length === 0) return; // no supplier seeded — skip the mutate flow
    const supplierId = sup.data.items[0].id;

    // non-batch product (id 3 = sugar in the dev seed) keeps the payload simple
    const create = await adminApi("/api/v1/purchase-orders", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ supplier_id: supplierId, items: [{ product_id: 3, quantity: "4.000", unit_price: "1.00" }] }),
    });
    expect([200, 201]).toContain(create.status);
    const created = purchaseOrderDetailEnvelope.parse(await create.json());
    const id = created.data.id;
    expect(created.data.status).toBe("DRAFT");

    const confirm = await adminApi(`/api/v1/purchase-orders/${id}/confirm`, { method: "POST" });
    expect(confirm.status).toBe(200);
    expect(poActionEnvelope.parse(await confirm.json()).data.status).toBe("CONFIRMED");

    const key = `po-rcpt-${uuid()}`;
    const body1 = JSON.stringify({ items: [{ product_id: 3, quantity: "3.000" }] });

    const r1 = await api(`/api/v1/purchase-orders/${id}/receive`, {
      method: "POST",
      headers: { ...jsonHeaders, "Idempotency-Key": key },
      body: body1,
    });
    expect(r1.status).toBe(200);
    const rcpt1 = purchaseOrderReceiveEnvelope.parse(await r1.json());
    expect(rcpt1.data.status).toBe("PARTIALLY_RECEIVED");

    // same key + same payload → replayed (identical body)
    const replay = await api(`/api/v1/purchase-orders/${id}/receive`, {
      method: "POST",
      headers: { ...jsonHeaders, "Idempotency-Key": key },
      body: body1,
    });
    expect(replay.status).toBe(200);
    const rcptReplay = purchaseOrderReceiveEnvelope.parse(await replay.json());
    expect(rcptReplay.data.receipt_number).toBe(rcpt1.data.receipt_number);

    // same key + different payload → 409, never silently accepted
    const mismatch = await api(`/api/v1/purchase-orders/${id}/receive`, {
      method: "POST",
      headers: { ...jsonHeaders, "Idempotency-Key": key },
      body: JSON.stringify({ items: [{ product_id: 3, quantity: "1.000" }] }),
    });
    expect(mismatch.status).toBe(409);
    expect(errorResponseSchema.parse(await mismatch.json()).message).toMatch(/different payload/i);

    // a fresh key finishes the PO
    const r2 = await api(`/api/v1/purchase-orders/${id}/receive`, {
      method: "POST",
      headers: { ...jsonHeaders, "Idempotency-Key": `po-rcpt-${uuid()}` },
      body: JSON.stringify({ items: [{ product_id: 3, quantity: "1.000" }] }),
    });
    expect(r2.status).toBe(200);
    expect(purchaseOrderReceiveEnvelope.parse(await r2.json()).data.status).toBe("RECEIVED");

    // over-receive on the now-complete PO → 409
    const over = await api(`/api/v1/purchase-orders/${id}/receive`, {
      method: "POST",
      headers: { ...jsonHeaders, "Idempotency-Key": `po-rcpt-${uuid()}` },
      body: JSON.stringify({ items: [{ product_id: 3, quantity: "1.000" }] }),
    });
    expect(over.status).toBe(409);
  });

  it.skipIf(!PO_MUTATE)("PO6 · a separate DRAFT PO can be cancelled (admin, POST); re-cancel → 409", async () => {
    const sup = supplierListEnvelope.parse(await (await adminApi("/api/v1/suppliers?page=1&page_size=1")).json());
    if (sup.data.items.length === 0) return;
    const create = await adminApi("/api/v1/purchase-orders", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ supplier_id: sup.data.items[0].id, items: [{ product_id: 3, quantity: "1.000", unit_price: "1.00" }] }),
    });
    const id = purchaseOrderDetailEnvelope.parse(await create.json()).data.id;
    const cancel = await adminApi(`/api/v1/purchase-orders/${id}/cancel`, { method: "POST" });
    expect(cancel.status).toBe(200);
    expect(poActionEnvelope.parse(await cancel.json()).data.status).toBe("CANCELLED");
    const again = await adminApi(`/api/v1/purchase-orders/${id}/cancel`, { method: "POST" });
    expect(again.status).toBe(409);
    const e = errorResponseSchema.parse(await again.json());
    expect(e.request_id ?? again.headers.get("x-request-id")).toBeTruthy();
  });
});

/**
 * Phase 6 — LIVE Inventory Transfer contract gate.
 *
 * Reads run with LIVE_BACKEND=1. The state-changing flow runs only with
 * LIVE_TRANSFER_MUTATE=1 on throwaway transfers it creates. Needs a second
 * operational warehouse+location with stock at the destination (dev seed
 * `scratchpad/qa/seed_transfer_dest.py`).
 *
 *   LIVE_BACKEND=1 LIVE_TRANSFER_MUTATE=1 npm run test:live
 */
const TR_MUTATE = process.env.LIVE_TRANSFER_MUTATE === "1";
const trUuid = () =>
  (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`);

describe.skipIf(!LIVE)("live Inventory Transfer contract (Phase 6)", () => {
  const jsonHeaders = { "content-type": "application/json" };

  beforeAll(async () => {
    if (token) return;
    const res = await fetch(BASE + "/api/v1/auth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username: USER, password: PASS, grant_type: "password" }),
    });
    if (res.status === 200) token = tokenResponseSchema.parse(await res.json()).access_token;
  });

  it("T1 · GET /inventory-transfers → enveloped rows (quantities as strings, legacy_completed bool)", async () => {
    const res = await api("/api/v1/inventory-transfers?page=1&page_size=5");
    expect(res.status).toBe(200);
    const env = transferListEnvelope.parse(await res.json());
    for (const r of env.data.items) {
      expect(r.total_quantity).toMatch(/^-?\d+(\.\d+)?$/);
      expect(r.dispatched_quantity).toMatch(/^-?\d+(\.\d+)?$/);
      expect(typeof r.legacy_completed).toBe("boolean");
      expect(typeof r.progress_pct).toBe("number");
    }
  });

  it("T2 · retired /complete: existing -> 409 retirement, missing -> 404", async () => {
    const list = await api("/api/v1/inventory-transfers?page=1&page_size=1");
    const env = transferListEnvelope.parse(await list.json());
    if (env.data.items[0]) {
      const existing = await api(`/api/v1/inventory-transfers/${env.data.items[0].id}/complete`, { method: "POST" });
      expect(existing.status).toBe(409);
      expect(errorResponseSchema.parse(await existing.json()).message).toMatch(/retired/i);
    }
    const missing = await api("/api/v1/inventory-transfers/99999999/complete", { method: "POST" });
    expect(missing.status).toBe(404);
  });

  it("T3 · receive without an Idempotency-Key -> 422", async () => {
    const res = await api("/api/v1/inventory-transfers/1/receive", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ items: [{ transfer_item_id: 1, quantity: "1.000" }] }),
    });
    expect(res.status).toBe(422);
    errorResponseSchema.parse(await res.json());
  });

  it.skipIf(!TR_MUTATE)("T4 · create -> dispatch -> partial -> replay -> mismatch 409 -> over-receive 409 -> final -> COMPLETED", async () => {
    const bal = stockBalanceListEnvelope.parse(await (await api("/api/v1/stock-balances?page=1&page_size=100")).json());
    // Pick a non-transit, non-batch source balance that actually has >= 4
    // available — the shared dev DB drains specific products over time, so a
    // hard-coded product_id can no longer be dispatched.
    const src = bal.data.items.find(
      (b) => !b.is_transit && b.batch_id == null && b.warehouse_id != null && b.location_id != null && Number(b.available_qty) >= 4,
    );
    const dst = bal.data.items.find(
      (b) => !b.is_transit && b.warehouse_id != null && b.warehouse_id !== src?.warehouse_id && b.location_id != null,
    );
    if (!src || !dst) return;

    const create = await api("/api/v1/inventory-transfers", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({
        source_warehouse_id: src.warehouse_id,
        destination_warehouse_id: dst.warehouse_id,
        items: [
          { product_id: src.product_id, from_location_id: src.location_id, to_location_id: dst.location_id, quantity: "4.000" },
        ],
      }),
    });
    const createBody = await create.json();
    expect(create.status, JSON.stringify(createBody)).toBe(201);
    const created = transferDetailSchema.parse(createBody);
    const id = created.id;
    expect(created.status).toBe("DRAFT");
    const itemId = created.items[0].id;

    const dispatch = await api(`/api/v1/inventory-transfers/${id}/dispatch`, { method: "POST" });
    expect(dispatch.status).toBe(200);
    expect(transferDetailSchema.parse(await dispatch.json()).status).toBe("IN_TRANSIT");

    const dup = await api(`/api/v1/inventory-transfers/${id}/dispatch`, { method: "POST" });
    expect(dup.status).toBe(409);

    const badCancel = await api(`/api/v1/inventory-transfers/${id}/cancel`, { method: "POST" });
    expect(badCancel.status).toBe(409);

    const key = `tr-rcpt-${trUuid()}`;
    const body1 = JSON.stringify({ items: [{ transfer_item_id: itemId, quantity: "3.000" }] });

    const r1 = await api(`/api/v1/inventory-transfers/${id}/receive`, {
      method: "POST",
      headers: { ...jsonHeaders, "Idempotency-Key": key },
      body: body1,
    });
    expect(r1.status).toBe(200);
    const rcpt1 = transferReceiptResponseSchema.parse(await r1.json());
    expect(rcpt1.transfer.status).toBe("PARTIALLY_RECEIVED");

    const replay = await api(`/api/v1/inventory-transfers/${id}/receive`, {
      method: "POST",
      headers: { ...jsonHeaders, "Idempotency-Key": key },
      body: body1,
    });
    expect(replay.status).toBe(200);
    expect(transferReceiptResponseSchema.parse(await replay.json()).receipt_number).toBe(rcpt1.receipt_number);

    const mismatch = await api(`/api/v1/inventory-transfers/${id}/receive`, {
      method: "POST",
      headers: { ...jsonHeaders, "Idempotency-Key": key },
      body: JSON.stringify({ items: [{ transfer_item_id: itemId, quantity: "1.000" }] }),
    });
    expect(mismatch.status).toBe(409);
    expect(errorResponseSchema.parse(await mismatch.json()).message).toMatch(/different payload/i);

    const over = await api(`/api/v1/inventory-transfers/${id}/receive`, {
      method: "POST",
      headers: { ...jsonHeaders, "Idempotency-Key": `tr-rcpt-${trUuid()}` },
      body: JSON.stringify({ items: [{ transfer_item_id: itemId, quantity: "99.000" }] }),
    });
    expect(over.status).toBe(409);
    expect(errorResponseSchema.parse(await over.json()).message).toMatch(/exceeds outstanding/i);

    const r2 = await api(`/api/v1/inventory-transfers/${id}/receive`, {
      method: "POST",
      headers: { ...jsonHeaders, "Idempotency-Key": `tr-rcpt-${trUuid()}` },
      body: JSON.stringify({ items: [{ transfer_item_id: itemId, quantity: "1.000" }] }),
    });
    expect(r2.status).toBe(200);
    expect(transferReceiptResponseSchema.parse(await r2.json()).transfer.status).toBe("COMPLETED");
  });

  it.skipIf(!TR_MUTATE)("T5 · separate DRAFT cancels; expired-batch transfer cannot dispatch", async () => {
    const bal = stockBalanceListEnvelope.parse(await (await api("/api/v1/stock-balances?page=1&page_size=100")).json());
    const src = bal.data.items.find((b) => !b.is_transit && b.warehouse_id != null);
    const dst = bal.data.items.find(
      (b) => !b.is_transit && b.warehouse_id != null && b.warehouse_id !== src?.warehouse_id,
    );
    const expired = bal.data.items.find((b) => b.is_expired && b.batch_id != null && !b.is_transit);
    if (!src || !dst) return;

    const c1 = await api("/api/v1/inventory-transfers", {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({
        source_warehouse_id: src.warehouse_id,
        destination_warehouse_id: dst.warehouse_id,
        items: [{ product_id: 3, from_location_id: src.location_id, to_location_id: dst.location_id, quantity: "1.000" }],
      }),
    });
    const draft = transferDetailSchema.parse(await c1.json());
    const cancel = await api(`/api/v1/inventory-transfers/${draft.id}/cancel`, { method: "POST" });
    expect(cancel.status).toBe(200);
    expect(transferDetailSchema.parse(await cancel.json()).status).toBe("CANCELLED");
    const reCancel = await api(`/api/v1/inventory-transfers/${draft.id}/cancel`, { method: "POST" });
    expect(reCancel.status).toBe(409);

    if (expired && expired.batch_id != null) {
      const c2 = await api("/api/v1/inventory-transfers", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({
          source_warehouse_id: expired.warehouse_id,
          destination_warehouse_id: dst.warehouse_id,
          items: [
            {
              product_id: expired.product_id,
              batch_id: expired.batch_id,
              from_location_id: expired.location_id,
              to_location_id: dst.location_id,
              quantity: "1.000",
            },
          ],
        }),
      });
      if (c2.status === 201) {
        const xf = transferDetailSchema.parse(await c2.json());
        const disp = await api(`/api/v1/inventory-transfers/${xf.id}/dispatch`, { method: "POST" });
        expect(disp.status).toBe(409);
        expect(errorResponseSchema.parse(await disp.json()).message).toMatch(/expired batch/i);
      }
    }
  });
});

/* ============================================================================
 * Phase 7 — Product & Master-Data CRUD.
 *
 * Reads run with LIVE_BACKEND=1. The state-changing flow runs only with
 * LIVE_MASTER_MUTATE=1, using QA-P7-<uuid> throwaway records it cleans up
 * (products soft-delete; category/customer/supplier hard-delete).
 *
 *   LIVE_BACKEND=1 LIVE_MASTER_MUTATE=1 npm run test:live
 * ==========================================================================*/
const MD_MUTATE = process.env.LIVE_MASTER_MUTATE === "1";

// 1x1 transparent PNG.
const TINY_PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0),
);

/**
 * Build a multipart/form-data body by hand — the jsdom `FormData` and undici
 * `fetch` in the vitest env don't interop for file parts, so we frame it
 * ourselves and set the boundary explicitly. The browser QA exercises the
 * real FormData path through the BFF.
 */
function multipartFile(filename: string, type: string, bytes: Uint8Array): { body: ArrayBuffer; contentType: string } {
  const boundary = "----QAP7" + Math.random().toString(36).slice(2);
  const enc = new TextEncoder();
  const head = enc.encode(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`,
  );
  const tail = enc.encode(`\r\n--${boundary}--\r\n`);
  const buf = new Uint8Array(head.length + bytes.length + tail.length);
  buf.set(head, 0);
  buf.set(bytes, head.length);
  buf.set(tail, head.length + bytes.length);
  return { body: buf.buffer, contentType: `multipart/form-data; boundary=${boundary}` };
}

describe.skipIf(!LIVE)("live Product / Master-Data contract (Phase 7)", () => {
  let adminToken = "";
  const p7 = () => `QA-P7-${Math.random().toString(36).slice(2, 10)}`;

  beforeAll(async () => {
    if (!token) {
      const res = await fetch(`${BASE}/api/v1/auth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ username: USER, password: PASS, grant_type: "password" }),
      });
      token = tokenResponseSchema.parse(await res.json()).access_token;
    }
    const res = await fetch(`${BASE}/api/v1/auth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username: ADMIN_USER, password: ADMIN_PASS, grant_type: "password" }),
    });
    if (res.status === 200) adminToken = tokenResponseSchema.parse(await res.json()).access_token;
  });

  const admin = (path: string, init: RequestInit = {}) =>
    fetch(BASE + path, {
      ...init,
      headers: { accept: "application/json", authorization: `Bearer ${adminToken}`, ...(init.headers ?? {}) },
    });
  const jsonH = { "content-type": "application/json" };

  it("P7-1: list contracts (products / categories / customers / suppliers / batches) parse", async () => {
    productListEnvelope.parse(await (await api("/api/v1/products?page=1&page_size=5")).json());
    categoryListEnvelope.parse(await (await api("/api/v1/categories?page=1&page_size=5")).json());
    mdCustomerListEnvelope.parse(await (await api("/api/v1/customers?page=1&page_size=5")).json());
    mdSupplierListEnvelope.parse(await (await api("/api/v1/suppliers?page=1&page_size=5")).json());
    batchListEnvelope.parse(await (await api("/api/v1/batches?page=1&page_size=5")).json());
  });

  it("P7-2: product detail is the bare ProductResponse (no derived qty / thresholds)", async () => {
    const list = productListEnvelope.parse(await (await api("/api/v1/products?page=1&page_size=1")).json());
    const id = list.data.items[0].id;
    const detail = productDetailEnvelope.parse(await (await api(`/api/v1/products/${id}`)).json());
    expect(detail.data).not.toHaveProperty("operational_available_quantity");
    expect(detail.data).not.toHaveProperty("minimum_stock");
  });

  it("P7-3: /products/search returns a bare array; /products?status=inactive is accepted", async () => {
    const s = await api("/api/v1/products/search?keyword=a");
    expect(s.status).toBe(200);
    expect(Array.isArray((await s.json()).data)).toBe(true);
    expect((await api("/api/v1/products?status=inactive&page_size=5")).status).toBe(200);
  });

  it("P7-4: there is no GET /batches/{id}", async () => {
    const r = await api("/api/v1/batches/1");
    expect([404, 405]).toContain(r.status);
  });

  it("P7-5: codes + label return the right binary content types", async () => {
    const list = productListEnvelope.parse(await (await api("/api/v1/products?page=1&page_size=20")).json());
    const withBarcode = list.data.items.find((p) => p.barcode);
    if (withBarcode) {
      const bc = await api(`/api/v1/codes/products/${withBarcode.id}/barcode`);
      expect(bc.status).toBe(200);
      expect(bc.headers.get("content-type")).toMatch(/image\/png/);
    }
    const anyId = list.data.items[0].id;
    const qr = await api(`/api/v1/codes/products/${anyId}/qrcode`);
    expect(qr.headers.get("content-type")).toMatch(/image\/png/);
    const label = await api(`/api/v1/labels/product/${anyId}`);
    expect(label.headers.get("content-type")).toMatch(/application\/pdf/);
  });

  it("P7-6: warehouse users are refused every master-data mutation (403)", async () => {
    for (const path of ["/api/v1/products", "/api/v1/categories", "/api/v1/customers", "/api/v1/suppliers"]) {
      const r = await api(path, { method: "POST", headers: jsonH, body: JSON.stringify({ x: 1 }) });
      expect(r.status).toBe(403);
      expect(errorResponseSchema.parse(await r.json()).message).toMatch(/admin/i);
    }
  });

  it.skipIf(!MD_MUTATE)("P7-7: admin category CRUD + duplicate 409", async () => {
    const name = p7();
    const c = await admin("/api/v1/categories", { method: "POST", headers: jsonH, body: JSON.stringify({ category_name: name }) });
    expect(c.status).toBe(201);
    const row = categoryMutationEnvelope.parse(await c.json());
    const dup = await admin("/api/v1/categories", { method: "POST", headers: jsonH, body: JSON.stringify({ category_name: name }) });
    expect(dup.status).toBe(409);
    const u = await admin(`/api/v1/categories/${row.data.id}`, { method: "PUT", headers: jsonH, body: JSON.stringify({ category_name: `${name}-x` }) });
    expect(u.status).toBe(200);
    const d = await admin(`/api/v1/categories/${row.data.id}`, { method: "DELETE" });
    expect(d.status).toBe(200);
  });

  it.skipIf(!MD_MUTATE)("P7-8: admin customer + supplier CRUD", async () => {
    const cn = p7();
    const cc = await admin("/api/v1/customers", { method: "POST", headers: jsonH, body: JSON.stringify({ customer_name: cn, phone: "0000", email: "a@b.co" }) });
    expect(cc.status).toBe(201);
    const crow = customerMutationEnvelope.parse(await cc.json());
    expect((await admin(`/api/v1/customers/${crow.data.id}`, { method: "PUT", headers: jsonH, body: JSON.stringify({ address: "Bangkok" }) })).status).toBe(200);
    expect((await admin(`/api/v1/customers/${crow.data.id}`, { method: "DELETE" })).status).toBe(200);

    const sn = p7();
    const sc = await admin("/api/v1/suppliers", { method: "POST", headers: jsonH, body: JSON.stringify({ supplier_name: sn, contact_name: "Lek" }) });
    expect(sc.status).toBe(201);
    const srow = supplierMutationEnvelope.parse(await sc.json());
    expect((await admin(`/api/v1/suppliers/${srow.data.id}`, { method: "PUT", headers: jsonH, body: JSON.stringify({ phone: "12345" }) })).status).toBe(200);
    expect((await admin(`/api/v1/suppliers/${srow.data.id}`, { method: "DELETE" })).status).toBe(200);
  });

  it.skipIf(!MD_MUTATE)("P7-9: admin product create → dup 409 → update → soft-delete → restore", async () => {
    const sku = p7();
    const c = await admin("/api/v1/products", {
      method: "POST",
      headers: jsonH,
      body: JSON.stringify({ sku, product_name: "QA P7 Product", price: "12.50", track_batch: false, track_expiry: false }),
    });
    expect(c.status).toBe(201);
    const id = productDetailEnvelope.parse(await c.json()).data.id;

    const dup = await admin("/api/v1/products", {
      method: "POST",
      headers: jsonH,
      body: JSON.stringify({ sku, product_name: "dup", price: "1.00" }),
    });
    expect(dup.status).toBe(409);
    expect(errorResponseSchema.parse(await dup.json()).message).toMatch(/sku already exists/i);

    const u = await admin(`/api/v1/products/${id}`, { method: "PUT", headers: jsonH, body: JSON.stringify({ product_name: "QA P7 Renamed" }) });
    expect(u.status).toBe(200);
    expect(productDetailEnvelope.parse(await u.json()).data.product_name).toBe("QA P7 Renamed");

    const badTrack = await admin(`/api/v1/products/${id}`, { method: "PUT", headers: jsonH, body: JSON.stringify({ track_expiry: true }) });
    expect(badTrack.status).toBe(400);

    const del = await admin(`/api/v1/products/${id}`, { method: "DELETE" });
    expect(del.status).toBe(200);
    expect(productDetailEnvelope.parse(await del.json()).data.is_active).toBe(false);

    const restore = await admin(`/api/v1/products/${id}/restore`, { method: "PUT" });
    expect(restore.status).toBe(200);
    expect(productDetailEnvelope.parse(await restore.json()).data.is_active).toBe(true);

    await admin(`/api/v1/products/${id}`, { method: "DELETE" });
  });

  it.skipIf(!MD_MUTATE)("P7-10: image upload — valid 200, oversized 413, invalid 400", async () => {
    const sku = p7();
    const c = await admin("/api/v1/products", {
      method: "POST",
      headers: jsonH,
      body: JSON.stringify({ sku, product_name: "QA P7 Image", price: "1.00" }),
    });
    const id = productDetailEnvelope.parse(await c.json()).data.id;

    const okMp = multipartFile("x.png", "image/png", TINY_PNG);
    const ok = await admin(`/api/v1/products/${id}/upload-image`, {
      method: "POST",
      headers: { "content-type": okMp.contentType },
      body: okMp.body,
    });
    expect(ok.status).toBe(200);
    expect(productDetailEnvelope.parse(await ok.json()).data.image_url).toMatch(/uploads\/products\/product_/);

    const bigMp = multipartFile("big.png", "image/png", new Uint8Array(5 * 1024 * 1024 + 1));
    const big = await admin(`/api/v1/products/${id}/upload-image`, {
      method: "POST",
      headers: { "content-type": bigMp.contentType },
      body: bigMp.body,
    });
    expect(big.status).toBe(413);

    const badMp = multipartFile("bad.png", "image/png", new TextEncoder().encode("not really a png"));
    const bad = await admin(`/api/v1/products/${id}/upload-image`, {
      method: "POST",
      headers: { "content-type": badMp.contentType },
      body: badMp.body,
    });
    expect(bad.status).toBe(400);
    expect(errorResponseSchema.parse(await bad.json()).message).toMatch(/not a valid image/i);

    await admin(`/api/v1/products/${id}`, { method: "DELETE" });
  });
});

/* ============================================================================
 * Phase 8 — Reports. Read-only; no mutation needed. Runs with LIVE_BACKEND=1.
 *   LIVE_BACKEND=1 npm run test:live
 * ==========================================================================*/
describe.skipIf(!LIVE)("live Reports contract (Phase 8)", () => {
  beforeAll(async () => {
    if (token) return;
    const res = await fetch(`${BASE}/api/v1/auth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username: USER, password: PASS, grant_type: "password" }),
    });
    token = tokenResponseSchema.parse(await res.json()).access_token;
  });

  it("R8-1: paginated report envelopes parse (operational-stock, stock-movement, sales, PO, transfers)", async () => {
    operationalStockEnvelope.parse(await (await api("/api/v1/reports/operational-stock?page=1&page_size=5")).json());
    movementReportEnvelope.parse(await (await api("/api/v1/reports/stock-movement?page=1&page_size=5")).json());
    salesReportEnvelope.parse(await (await api("/api/v1/reports/sales?page=1&page_size=5")).json());
    purchaseOrdersReportEnvelope.parse(await (await api("/api/v1/reports/purchase-orders?page=1&page_size=5")).json());
    transfersReportEnvelope.parse(await (await api("/api/v1/reports/transfers?page=1&page_size=5")).json());
  });

  it("R8-2: unpaginated { items } reports parse (expired / near-expiry / in-transit / low-stock-operational)", async () => {
    expiredStockSchema.parse(await (await api("/api/v1/reports/expired-stock")).json());
    nearExpiryStockSchema.parse(await (await api("/api/v1/reports/near-expiry-stock?days=120")).json());
    nearExpiryStockSchema.parse(await (await api("/api/v1/reports/near-expiry-stock")).json());
    inTransitStockSchema.parse(await (await api("/api/v1/reports/in-transit-stock")).json());
    lowStockOperationalSchema.parse(await (await api("/api/v1/reports/low-stock-operational")).json());
  });

  it("R8-3: charts + sales-summary parse (encode_quantities: number|string)", async () => {
    salesSummarySchema.parse(await (await api("/api/v1/reports/sales-summary")).json());
    chartSalesSchema.parse(await (await api("/api/v1/reports/chart/sales")).json());
    chartStockSchema.parse(await (await api("/api/v1/reports/chart/stock?limit=5")).json());
    chartExpirySchema.parse(await (await api("/api/v1/reports/chart/expiry?limit=10")).json());
  });

  it("R8-4: the four XLSX exports return the spreadsheet content-type + an attachment filename", async () => {
    for (const [path, name] of [
      ["/api/v1/reports/export/stock", "stock_report.xlsx"],
      ["/api/v1/reports/export/sales", "sales_report.xlsx"],
      ["/api/v1/reports/export/low-stock?threshold=10", "low_stock_report.xlsx"],
      ["/api/v1/reports/export/expiring?days=90", "expiring_report.xlsx"],
    ] as const) {
      const r = await api(path);
      expect(r.status).toBe(200);
      expect(r.headers.get("content-type")).toMatch(/spreadsheetml\.sheet/);
      expect(r.headers.get("content-disposition") ?? "").toMatch(new RegExp(`filename="?${name}"?`));
      expect(r.headers.get("x-request-id")).toBeTruthy();
    }
  });

  it("R8-5: invalid filters → 422 with a field, unknown sort → 422 message", async () => {
    const days0 = await api("/api/v1/reports/near-expiry-stock?days=0");
    expect(days0.status).toBe(422);
    expect(errorResponseSchema.parse(await days0.json()).errors[0].field).toBe("days");

    const badThreshold = await api("/api/v1/reports/export/low-stock?threshold=abc");
    expect(badThreshold.status).toBe(422);
    expect(errorResponseSchema.parse(await badThreshold.json()).errors[0].field).toBe("threshold");

    const badSort = await api("/api/v1/reports/operational-stock?sort_by=bogus");
    expect(badSort.status).toBe(422);
    expect(errorResponseSchema.parse(await badSort.json()).message).toMatch(/unknown sort field/i);
  });

  it("R8-6: reports are require_warehouse — the warehouse token reads them; no token → 401", async () => {
    expect((await api("/api/v1/reports/operational-stock?page_size=1")).status).toBe(200);
    expect((await fetch(`${BASE}/api/v1/reports/sales`)).status).toBe(401);
  });
});

/* ============================================================================
 * Phase 9 — Shipping / Complete / Return / Audit.
 *
 * Reads run with LIVE_BACKEND=1. The full create -> ... -> ship -> return ->
 * complete flow runs only with LIVE_SHIP_MUTATE=1 on a brand-new throwaway QA
 * order and is net-stock-neutral (ships qty N, returns qty N).
 *
 *   LIVE_BACKEND=1 LIVE_SHIP_MUTATE=1 npm run test:live
 * ==========================================================================*/
const SHIP_MUTATE = process.env.LIVE_SHIP_MUTATE === "1";

describe.skipIf(!LIVE)("live Shipping / Return / Complete / Audit contract (Phase 9)", () => {
  let adminToken = "";
  const jh = { "content-type": "application/json" };

  beforeAll(async () => {
    if (!token) {
      const res = await fetch(`${BASE}/api/v1/auth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ username: USER, password: PASS, grant_type: "password" }),
      });
      token = tokenResponseSchema.parse(await res.json()).access_token;
    }
    const res = await fetch(`${BASE}/api/v1/auth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username: ADMIN_USER, password: ADMIN_PASS, grant_type: "password" }),
    });
    if (res.status === 200) adminToken = tokenResponseSchema.parse(await res.json()).access_token;
  });

  const admin = (path: string, init: RequestInit = {}) =>
    fetch(BASE + path, { ...init, headers: { accept: "application/json", authorization: `Bearer ${adminToken}`, ...(init.headers ?? {}) } });

  it("P9-1: GET /audit-logs/ is a BARE ARRAY for an admin; a warehouse user is 403", async () => {
    const a = await admin("/api/v1/audit-logs/");
    expect(a.status).toBe(200);
    const rows = auditLogListSchema.parse(await a.json());
    expect(Array.isArray(rows)).toBe(true);
    if (rows.length > 1) {
      expect(new Date(rows[0].created_at ?? 0).getTime()).toBeGreaterThanOrEqual(new Date(rows[1].created_at ?? 0).getTime());
    }
    for (const r of rows.slice(0, 5)) {
      for (const k of Object.keys(r)) expect(k).not.toMatch(/pass|hash|token|jwt|authorization|secret/i);
    }
    const w = await api("/api/v1/audit-logs/");
    expect(w.status).toBe(403);
    expect(errorResponseSchema.parse(await w.json()).message).toMatch(/admin/i);
  });

  it("P9-2: ship/complete/return reject a non-eligible order with the right code", async () => {
    const list = salesReportEnvelope.parse(await (await api("/api/v1/sales-orders?page=1&page_size=50")).json());
    const draft = list.data.items.find((r) => r.status === "DRAFT");
    if (!draft) return;
    const s = await api(`/api/v1/sales-orders/${draft.id}/ship`, { method: "POST" });
    expect(s.status).toBe(409);
    expect(errorResponseSchema.parse(await s.json()).message).toMatch(/state conflict.*requires READY_TO_SHIP/i);

    const cW = await api(`/api/v1/sales-orders/${draft.id}/complete`, { method: "POST" });
    expect(cW.status).toBe(403);
    const cA = await admin(`/api/v1/sales-orders/${draft.id}/complete`, { method: "POST" });
    expect(cA.status).toBe(409);
    expect(errorResponseSchema.parse(await cA.json()).message).toMatch(/state conflict.*requires SHIPPED/i);

    const r = await api(`/api/v1/sales-orders/${draft.id}/return`, { method: "POST", headers: jh, body: JSON.stringify({ items: [{ product_id: 1, quantity: "1.000" }] }) });
    expect(r.status).toBe(409);
    expect(errorResponseSchema.parse(await r.json()).message).toMatch(/only completed sales order can be returned/i);
  });

  it("P9-3: return body validation — empty items is rejected", async () => {
    const list = salesReportEnvelope.parse(await (await api("/api/v1/sales-orders?page=1&page_size=50")).json());
    const any = list.data.items[0];
    if (!any) return;
    const r = await api(`/api/v1/sales-orders/${any.id}/return`, { method: "POST", headers: jh, body: JSON.stringify({ items: [] }) });
    expect([409, 422]).toContain(r.status);
  });

  it.skipIf(!SHIP_MUTATE)("P9-4: create -> ready -> ship -> return(full) -> complete (net stock neutral)", async () => {
    const cust = customerListEnvelope.parse(await (await admin("/api/v1/customers?page=1&page_size=1")).json());
    const prods = productListEnvelope.parse(await (await admin("/api/v1/products?page=1&page_size=30")).json());
    const line = prods.data.items.find((p) => p.barcode && Number(p.operational_available_quantity) >= 2);
    if (cust.data.items.length === 0 || !line) return;

    const create = await admin("/api/v1/sales-orders/", {
      method: "POST", headers: jh,
      body: JSON.stringify({ customer_id: cust.data.items[0].id, items: [{ product_id: line.id, quantity: "2.000", unit_price: "1.00" }] }),
    });
    expect([200, 201]).toContain(create.status);
    const id = salesMutationEnvelope.parse(await create.json()).data.sales_order_id;

    expect((await admin(`/api/v1/sales-orders/${id}/confirm`, { method: "POST" })).status).toBe(200);
    expect((await api(`/api/v1/sales-orders/${id}/start-picking`, { method: "POST" })).status).toBe(200);
    for (let i = 0; i < 2; i++) {
      expect((await api(`/api/v1/sales-orders/${id}/scan-pick`, { method: "POST", headers: jh, body: JSON.stringify({ barcode: line.barcode, quantity: "1.000" }) })).status).toBe(200);
    }
    const det = salesOrderDetailEnvelope.parse(await (await api(`/api/v1/sales-orders/${id}`)).json());
    const allocs = det.data.items.flatMap((it) => it.fulfillment_allocations.map((a) => ({ allocation_id: a.id, quantity: a.quantity })));
    completeFulfillmentInput.parse({ allocations: allocs });
    expect((await api(`/api/v1/sales-orders/${id}/complete-picking`, { method: "POST", headers: jh, body: JSON.stringify({ allocations: allocs }) })).status).toBe(200);
    for (const a of allocs) {
      expect((await api(`/api/v1/sales-orders/${id}/scan-pack`, { method: "POST", headers: jh, body: JSON.stringify({ barcode: line.barcode, quantity: a.quantity, allocation_id: a.allocation_id }) })).status).toBe(200);
    }
    expect((await api(`/api/v1/sales-orders/${id}/complete-packing`, { method: "POST", headers: jh, body: JSON.stringify({ allocations: allocs }) })).status).toBe(200);

    const ship = await api(`/api/v1/sales-orders/${id}/ship`, { method: "POST" });
    expect(ship.status).toBe(200);
    const shipped = salesMutationEnvelope.parse(await ship.json());
    expect(shipped.data.status).toBe("SHIPPED");
    expect(shipped.data.shipment_number).toBe(`SHIP-${String(id).padStart(6, "0")}`);

    expect((await api(`/api/v1/sales-orders/${id}/ship`, { method: "POST" })).status).toBe(409);

    const inv = await api(`/api/v1/sales-orders/${id}/invoice`);
    expect(inv.status).toBe(200);
    expect(inv.headers.get("content-type")).toMatch(/application\/pdf/);

    const ret = await api(`/api/v1/sales-orders/${id}/return`, { method: "POST", headers: jh, body: JSON.stringify({ items: [{ product_id: line.id, quantity: "2.000", reason: "QA net-neutral" }] }) });
    expect(ret.status).toBe(200);
    const rr = salesReturnEnvelope.parse(await ret.json());
    expect(Number(rr.data.returned_items[0].total_returned)).toBe(2);
    expect(Number(rr.data.returned_items[0].remaining_returnable)).toBe(0);

    const over = await api(`/api/v1/sales-orders/${id}/return`, { method: "POST", headers: jh, body: JSON.stringify({ items: [{ product_id: line.id, quantity: "1.000" }] }) });
    expect(over.status).toBe(409);
    expect(errorResponseSchema.parse(await over.json()).message).toMatch(/exceeds remaining returnable.*Remaining: 0/i);

    expect((await api(`/api/v1/sales-orders/${id}/complete`, { method: "POST" })).status).toBe(403);
    const comp = await admin(`/api/v1/sales-orders/${id}/complete`, { method: "POST" });
    expect(comp.status).toBe(200);
    expect(salesMutationEnvelope.parse(await comp.json()).data.status).toBe("COMPLETED");
  });
});
