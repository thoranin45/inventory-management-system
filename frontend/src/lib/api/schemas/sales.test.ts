import { describe, expect, it } from "vitest";

import {
  SO_FILTER_TABS,
  SO_PIPELINE,
  SO_SORT_FIELDS,
  createSalesOrderInput,
  customerListEnvelope,
  salesMutationEnvelope,
  salesOrderDetailEnvelope,
  salesOrderListEnvelope,
} from "./sales";
import {
  salesOrderListResponse,
  salesOrderDetailResponse,
  salesOrderCreateResponse,
  salesOrderConflictResponse,
  customerListResponse,
} from "@/test/fixtures";
import { errorResponseSchema } from "../errors";
import { multiplyDecimals, sumDecimals } from "@/lib/decimal";

describe("Sales list Zod contract (Phase 8 list body — decimals as strings)", () => {
  it("parses a real backend list body and keeps money/qty as strings", () => {
    const env = salesOrderListEnvelope.parse(salesOrderListResponse);
    const row = env.data.items[0];
    expect(typeof row.total_amount).toBe("string");
    expect(typeof row.total_quantity).toBe("string");
    expect(row.so_number).toBe("SO-000002");
    expect(row.attention_reason).toBeNull();
    expect(row.picked_pct).toBeTypeOf("number");
  });

  it("exposes the backend sort allow-list and pipeline", () => {
    expect(SO_SORT_FIELDS).toEqual(["id", "created_at", "status", "so_number", "total_amount"]);
    expect(SO_PIPELINE[0]).toBe("DRAFT");
    expect(SO_PIPELINE.at(-1)).toBe("COMPLETED");
    expect(SO_PIPELINE).not.toContain("CANCELLED");
  });

  it("the Attention tab is the only client-only filter", () => {
    expect(SO_FILTER_TABS.filter((t) => t.clientOnly).map((t) => t.key)).toEqual(["attention"]);
  });
});

describe("Sales detail Zod contract (success_response — money/qty as JSON numbers)", () => {
  it("coerces numeric money/qty fields to strings without float math", () => {
    const env = salesOrderDetailEnvelope.parse(salesOrderDetailResponse);
    const d = env.data;
    expect(typeof d.total_amount).toBe("string");
    expect(d.total_amount).toBe("2330"); // 2330.0 → "2330", never a float
    const item = d.items[0];
    expect(typeof item.quantity).toBe("string");
    expect(typeof item.unit_price).toBe("string");
    expect(typeof item.total_price).toBe("string");
    expect(item.fulfillment_allocations[0].batch_id).toBe(7);
    expect(typeof item.fulfillment_allocations[0].picked_quantity).toBe("string");
  });

  it("tolerates the mixed shape (string OR number) on the same field", () => {
    const mixed = structuredClone(salesOrderDetailResponse);
    (mixed.data.items[0] as { unit_price: unknown }).unit_price = "210.00";
    const env = salesOrderDetailEnvelope.parse(mixed);
    expect(env.data.items[0].unit_price).toBe("210.00");
  });
});

describe("Sales mutation response (key is sales_order_id, not id)", () => {
  it("parses create / confirm / cancel result", () => {
    const env = salesMutationEnvelope.parse(salesOrderCreateResponse);
    expect(env.data.sales_order_id).toBe(1);
    expect(env.data.so_number).toBe("SO-000001");
    expect(env.data.status).toBe("DRAFT");
  });

  it("a 409 state-conflict body still parses as the error envelope with a request_id", () => {
    const e = errorResponseSchema.parse(salesOrderConflictResponse);
    expect(e.message).toMatch(/state conflict/i);
    expect(e.request_id).toBeTruthy();
  });
});

describe("Create Sales Order request validation", () => {
  const ok = {
    customer_id: 1,
    items: [{ product_id: 1, quantity: "5.000", unit_price: "210.00" }],
  };

  it("accepts a well-formed draft", () => {
    expect(createSalesOrderInput.safeParse(ok).success).toBe(true);
  });

  it("rejects a missing customer", () => {
    const r = createSalesOrderInput.safeParse({ ...ok, customer_id: 0 });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toMatch(/customer/i);
  });

  it("rejects an empty item list", () => {
    const r = createSalesOrderInput.safeParse({ customer_id: 1, items: [] });
    expect(r.success).toBe(false);
  });

  it("rejects a duplicate product_id across lines", () => {
    const r = createSalesOrderInput.safeParse({
      customer_id: 1,
      items: [
        { product_id: 3, quantity: "1.000", unit_price: "1.00" },
        { product_id: 3, quantity: "2.000", unit_price: "2.00" },
      ],
    });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toMatch(/more than one line/i);
  });

  it("rejects a non-positive quantity and over-precise price", () => {
    expect(createSalesOrderInput.safeParse({ ...ok, items: [{ product_id: 1, quantity: "0", unit_price: "1.00" }] }).success).toBe(false);
    expect(createSalesOrderInput.safeParse({ ...ok, items: [{ product_id: 1, quantity: "1.000", unit_price: "1.001" }] }).success).toBe(false);
  });
});

describe("customer selector contract", () => {
  it("parses a paginated customer list", () => {
    const env = customerListEnvelope.parse(customerListResponse);
    expect(env.data.items[0].customer_name).toBe("Acme Test Co");
  });
});

describe("decimal-safe line + grand totals (no JS float)", () => {
  it("multiplies quantity × unit price exactly", () => {
    expect(multiplyDecimals("5.000", "210.00")).toBe("1050.00000");
    expect(multiplyDecimals("2.000", "640.00")).toBe("1280.00000");
    // the classic float trap: 0.1 * 3
    expect(multiplyDecimals("0.1", "3")).toBe("0.3");
  });

  it("sums line totals to a 2dp grand total", () => {
    const lines = [multiplyDecimals("5.000", "210.00"), multiplyDecimals("2.000", "640.00")];
    expect(sumDecimals(lines, 2)).toBe("2330.00");
  });
});
