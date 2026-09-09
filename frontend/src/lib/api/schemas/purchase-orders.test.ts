import { describe, expect, it } from "vitest";

import {
  PO_FILTER_TABS,
  PO_PIPELINE,
  PO_SORT_FIELDS,
  createPurchaseOrderInput,
  poActionEnvelope,
  purchaseOrderDetailEnvelope,
  purchaseOrderListEnvelope,
  purchaseOrderReceiveEnvelope,
  supplierListEnvelope,
} from "./purchase-orders";
import { errorResponseSchema } from "../errors";
import {
  purchaseOrderListResponse,
  purchaseOrderDetailResponse,
  purchaseOrderConfirmResponse,
  purchaseOrderReceiveResponse,
  purchaseOrderIdempotencyMismatchResponse,
  purchaseOrderOverReceiveResponse,
  supplierListResponse,
} from "@/test/fixtures";
import { padScale, subtractDecimals } from "@/lib/decimal";

describe("PO list Zod contract (all quantities / money are decimal strings)", () => {
  it("parses a real list body and keeps values as strings", () => {
    const env = purchaseOrderListEnvelope.parse(purchaseOrderListResponse);
    const row = env.data.items[0];
    expect(typeof row.ordered_quantity).toBe("string");
    expect(typeof row.received_quantity).toBe("string");
    expect(typeof row.total_amount).toBe("string");
    expect(row.receiving_pct).toBeTypeOf("number");
    expect(row.receipt_count).toBe(1);
    expect(row.supplier_name).toBe("Golden Harvest Trading");
  });

  it("exposes the backend sort allow-list, pipeline and status tabs", () => {
    expect(PO_SORT_FIELDS).toEqual(["id", "created_at", "status", "po_number"]);
    expect(PO_PIPELINE).toEqual(["DRAFT", "CONFIRMED", "PARTIALLY_RECEIVED", "RECEIVED"]);
    expect(PO_FILTER_TABS.map((t) => t.key)).toEqual([
      "all",
      "DRAFT",
      "CONFIRMED",
      "PARTIALLY_RECEIVED",
      "RECEIVED",
      "CANCELLED",
    ]);
  });
});

describe("PO detail Zod contract", () => {
  it("parses items with ordered / received / remaining as strings", () => {
    const env = purchaseOrderDetailEnvelope.parse(purchaseOrderDetailResponse);
    const it = env.data.items[0];
    expect(it.quantity).toBe("10.000");
    expect(it.received_quantity).toBe("3.000");
    expect(it.remaining_quantity).toBe("7.000");
    expect(typeof it.total_price).toBe("string");
    expect(env.data.total_amount).toBe("14220.00000");
  });
});

describe("PO action + receive responses", () => {
  it("confirm/cancel result is { id, po_number, status }", () => {
    const env = poActionEnvelope.parse(purchaseOrderConfirmResponse);
    expect(env.data).toEqual({ id: 1, po_number: "PO-000001", status: "CONFIRMED" });
  });

  it("receive result carries received_batches / received_items / receipt_number", () => {
    const env = purchaseOrderReceiveEnvelope.parse(purchaseOrderReceiveResponse);
    expect(env.data.receipt_number).toMatch(/^POR-/);
    expect(env.data.received_items).toHaveLength(2);
    expect(env.data.received_items[1].batch_id).toBeNull();
    expect(env.data.received_batches[0].lot_no).toBe("LOT-CF-A");
  });

  it("idempotency mismatch + over-receive parse as error envelopes with request_id", () => {
    const mm = errorResponseSchema.parse(purchaseOrderIdempotencyMismatchResponse);
    expect(mm.message).toMatch(/different payload/i);
    expect(mm.request_id).toBeTruthy();
    const or = errorResponseSchema.parse(purchaseOrderOverReceiveResponse);
    expect(or.message).toMatch(/exceeds remaining/i);
  });
});

describe("Create PO request validation", () => {
  const ok = { supplier_id: 1, items: [{ product_id: 1, quantity: "10.000", unit_price: "180.00" }] };

  it("accepts a well-formed draft (unit_price 0 is allowed)", () => {
    expect(createPurchaseOrderInput.safeParse(ok).success).toBe(true);
    expect(
      createPurchaseOrderInput.safeParse({ ...ok, items: [{ product_id: 1, quantity: "1.000", unit_price: "0" }] })
        .success,
    ).toBe(true);
  });

  it("rejects a missing supplier / empty items / duplicate product / negative price / >3dp qty", () => {
    expect(createPurchaseOrderInput.safeParse({ ...ok, supplier_id: 0 }).success).toBe(false);
    expect(createPurchaseOrderInput.safeParse({ supplier_id: 1, items: [] }).success).toBe(false);
    expect(
      createPurchaseOrderInput.safeParse({
        supplier_id: 1,
        items: [
          { product_id: 3, quantity: "1.000", unit_price: "1.00" },
          { product_id: 3, quantity: "2.000", unit_price: "1.00" },
        ],
      }).success,
    ).toBe(false);
    expect(
      createPurchaseOrderInput.safeParse({ ...ok, items: [{ product_id: 1, quantity: "1.000", unit_price: "-1" }] })
        .success,
    ).toBe(false);
    expect(
      createPurchaseOrderInput.safeParse({ ...ok, items: [{ product_id: 1, quantity: "1.1234", unit_price: "1.00" }] })
        .success,
    ).toBe(false);
  });
});

describe("supplier selector contract", () => {
  it("parses a paginated supplier list", () => {
    const env = supplierListEnvelope.parse(supplierListResponse);
    expect(env.data.items[0].supplier_name).toBe("Golden Harvest Trading");
  });
});

describe("decimal helpers for receiving", () => {
  it("padScale pads to exactly N fractional digits (byte-stable for the idempotency fingerprint)", () => {
    expect(padScale("5", 3)).toBe("5.000");
    expect(padScale("5.1", 3)).toBe("5.100");
    expect(padScale("12.500", 3)).toBe("12.500");
  });
  it("subtractDecimals is exact", () => {
    expect(subtractDecimals("7.000", "3.000", 3)).toBe("4.000");
    expect(subtractDecimals("10.000", "10.000", 3)).toBe("0.000");
    expect(subtractDecimals("6.000", "6.500", 3)).toBe("-0.500");
  });
});
