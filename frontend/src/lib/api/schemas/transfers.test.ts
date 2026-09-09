import { describe, expect, it } from "vitest";

import {
  EXPIRED_BATCH_DISPATCH_RE,
  TRANSFER_FILTER_TABS,
  TRANSFER_PIPELINE,
  TRANSFER_SORT_FIELDS,
  createTransferInput,
  transferDetailSchema,
  transferListEnvelope,
  transferReceiptResponseSchema,
  transferReceiveInput,
} from "./transfers";
import { errorResponseSchema } from "../errors";
import {
  transferListResponse,
  transferDetailResponse,
  transferReceiptResponse,
  transferIdempotencyMismatchResponse,
  transferOverReceiveResponse,
  transferExpiredBatchDispatchResponse,
} from "@/test/fixtures";

describe("Transfer list Zod contract (enveloped; quantities as decimal strings)", () => {
  it("parses a real list body incl. a legacy_completed row", () => {
    const env = transferListEnvelope.parse(transferListResponse);
    const [row, legacy] = env.data.items;
    expect(typeof row.total_quantity).toBe("string");
    expect(typeof row.dispatched_quantity).toBe("string");
    expect(row.progress_pct).toBeTypeOf("number");
    expect(row.source_warehouse_name).toBe("Main Warehouse");
    expect(legacy.legacy_completed).toBe(true);
  });

  it("exposes the backend sort allow-list, pipeline and status tabs", () => {
    expect(TRANSFER_SORT_FIELDS).toEqual(["id", "created_at", "status", "transfer_number", "dispatched_at"]);
    expect(TRANSFER_PIPELINE).toEqual(["DRAFT", "IN_TRANSIT", "PARTIALLY_RECEIVED", "COMPLETED"]);
    expect(TRANSFER_FILTER_TABS.map((t) => t.key)).toEqual([
      "all",
      "DRAFT",
      "IN_TRANSIT",
      "PARTIALLY_RECEIVED",
      "COMPLETED",
      "CANCELLED",
    ]);
  });
});

describe("Transfer detail Zod contract (RAW, not enveloped; nullable line progress)", () => {
  it("parses a raw InventoryTransferResponse", () => {
    const d = transferDetailSchema.parse(transferDetailResponse);
    expect(d.legacy_completed).toBe(false);
    expect(d.items[0].dispatched_quantity).toBe("5.000");
    expect(d.items[1].batch_id).toBeNull();
    expect(d.items[0].source_stock_balance_id).toBe(1);
    expect(d.items[0].transit_stock_balance_id).toBe(34);
  });

  it("tolerates null line quantities (legacy transfers)", () => {
    const legacy = structuredClone(transferDetailResponse);
    (legacy.items[0] as { dispatched_quantity: unknown }).dispatched_quantity = null;
    (legacy.items[0] as { received_quantity: unknown }).received_quantity = null;
    (legacy.items[0] as { outstanding_quantity: unknown }).outstanding_quantity = null;
    expect(() => transferDetailSchema.parse(legacy)).not.toThrow();
  });
});

describe("Transfer receipt response + error envelopes", () => {
  it("receive result is { receipt_id, receipt_number, transfer }", () => {
    const r = transferReceiptResponseSchema.parse(transferReceiptResponse);
    expect(r.receipt_number).toMatch(/^TRR-/);
    expect(r.transfer.status).toBe("PARTIALLY_RECEIVED");
    expect(r.transfer.items[0].received_quantity).toBe("2.000");
  });

  it("mismatch / over-receive / expired-batch parse as error envelopes with request_id", () => {
    expect(errorResponseSchema.parse(transferIdempotencyMismatchResponse).message).toMatch(/different payload/i);
    expect(errorResponseSchema.parse(transferOverReceiveResponse).message).toMatch(/exceeds outstanding/i);
    const exp = errorResponseSchema.parse(transferExpiredBatchDispatchResponse);
    expect(EXPIRED_BATCH_DISPATCH_RE.test(exp.message)).toBe(true);
    expect(exp.request_id).toBeTruthy();
  });
});

describe("Create transfer request validation", () => {
  const ok = {
    source_warehouse_id: 1,
    destination_warehouse_id: 2,
    items: [{ product_id: 1, batch_id: 1, from_location_id: 1, to_location_id: 2, quantity: "5.000" }],
  };

  it("accepts a well-formed draft", () => {
    expect(createTransferInput.safeParse(ok).success).toBe(true);
  });

  it("rejects source == destination", () => {
    const r = createTransferInput.safeParse({ ...ok, destination_warehouse_id: 1 });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toMatch(/different warehouses/i);
  });

  it("rejects two lines with the same product / batch / source / destination", () => {
    const r = createTransferInput.safeParse({
      ...ok,
      items: [
        { product_id: 1, batch_id: 1, from_location_id: 1, to_location_id: 2, quantity: "1.000" },
        { product_id: 1, batch_id: 1, from_location_id: 1, to_location_id: 2, quantity: "2.000" },
      ],
    });
    expect(r.success).toBe(false);
  });

  it("rejects an empty item list / non-positive / over-precise quantity", () => {
    expect(createTransferInput.safeParse({ ...ok, items: [] }).success).toBe(false);
    expect(
      createTransferInput.safeParse({
        ...ok,
        items: [{ product_id: 1, batch_id: null, from_location_id: 1, to_location_id: 2, quantity: "0" }],
      }).success,
    ).toBe(false);
    expect(
      createTransferInput.safeParse({
        ...ok,
        items: [{ product_id: 1, batch_id: null, from_location_id: 1, to_location_id: 2, quantity: "1.2345" }],
      }).success,
    ).toBe(false);
  });
});

describe("Transfer receive request validation", () => {
  it("accepts unique lines, rejects a duplicate transfer_item_id", () => {
    expect(transferReceiveInput.safeParse({ items: [{ transfer_item_id: 1, quantity: "2.000" }] }).success).toBe(true);
    expect(
      transferReceiveInput.safeParse({
        items: [
          { transfer_item_id: 1, quantity: "1.000" },
          { transfer_item_id: 1, quantity: "2.000" },
        ],
      }).success,
    ).toBe(false);
  });
});
