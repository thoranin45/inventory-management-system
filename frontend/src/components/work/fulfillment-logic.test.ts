import { describe, expect, it } from "vitest";

import type { SalesOrderDetail } from "@/lib/api/schemas/sales";
import {
  allocationsWithLocal,
  buildAmbiguityCandidates,
  buildCompletePayload,
  everyAllocationDone,
  findItemByAllocation,
  mergeScanResult,
} from "./fulfillment-logic";

const alloc = (id: number, batch_id: number | null, quantity: string, picked = "0.000", packed = "0.000") => ({
  id,
  batch_id,
  stock_balance_id: id,
  quantity,
  picked_quantity: picked,
  packed_quantity: packed,
});

const DETAIL = {
  id: 7,
  items: [
    { id: 8, product_id: 1, quantity: "4.000", fulfillment_allocations: [alloc(7, 1, "3.000"), alloc(71, 5, "1.000")] },
    { id: 9, product_id: 3, quantity: "2.000", fulfillment_allocations: [alloc(8, null, "2.000", "2.000")] },
  ],
} as unknown as SalesOrderDetail;

describe("allocationsWithLocal / mergeScanResult", () => {
  it("flattens allocations in item order and overlays only what the backend returned", () => {
    const local = mergeScanResult({}, { allocation_id: 71, picked_quantity: "1.000", packed_quantity: "0.000" });
    const rows = allocationsWithLocal(DETAIL, local);
    expect(rows.map((r) => [r.id, r.product_id, r.item_quantity, r.picked_quantity])).toEqual([
      [7, 1, "4.000", "0.000"],
      [71, 1, "4.000", "1.000"],
      [8, 3, "2.000", "2.000"],
    ]);
  });

  it("mergeScanResult replaces an allocation's figures and keeps the others", () => {
    const a = mergeScanResult({}, { allocation_id: 7, picked_quantity: "1.000", packed_quantity: "0.000" });
    const b = mergeScanResult(a, { allocation_id: 8, picked_quantity: "2.000", packed_quantity: "1.000" });
    const c = mergeScanResult(b, { allocation_id: 7, picked_quantity: "2.000", packed_quantity: "0.000" });
    expect(c).toEqual({
      7: { picked_quantity: "2.000", packed_quantity: "0.000" },
      8: { picked_quantity: "2.000", packed_quantity: "1.000" },
    });
    expect(a).toEqual({ 7: { picked_quantity: "1.000", packed_quantity: "0.000" } }); // not mutated
  });
});

describe("everyAllocationDone", () => {
  it("compares exactly, per mode field", () => {
    const rows = allocationsWithLocal(DETAIL, {});
    expect(everyAllocationDone(rows, "picked_quantity")).toBe(false);
    const done = allocationsWithLocal(
      DETAIL,
      mergeScanResult(mergeScanResult({}, { allocation_id: 7, picked_quantity: "3", packed_quantity: "0" }), {
        allocation_id: 71,
        picked_quantity: "1.000",
        packed_quantity: "0",
      }),
    );
    expect(everyAllocationDone(done, "picked_quantity")).toBe(true);
    expect(everyAllocationDone(done, "packed_quantity")).toBe(false);
  });

  it("is true for an empty list (the console adds its own non-empty check)", () => {
    expect(everyAllocationDone([], "picked_quantity")).toBe(true);
  });
});

describe("findItemByAllocation / buildCompletePayload", () => {
  it("finds the owning line", () => {
    expect(findItemByAllocation(DETAIL, 71)?.id).toBe(8);
    expect(findItemByAllocation(DETAIL, 999)).toBeUndefined();
  });

  it("completes every allocation with its full quantity, in order", () => {
    expect(buildCompletePayload(allocationsWithLocal(DETAIL, {}))).toEqual([
      { allocation_id: 7, quantity: "3.000" },
      { allocation_id: 71, quantity: "1.000" },
      { allocation_id: 8, quantity: "2.000" },
    ]);
  });
});

describe("buildAmbiguityCandidates", () => {
  const resolved = {
    batches: [
      { id: 1, lot_no: "LOT-A", expiry_date: "2026-10-19", days_to_expiry: 41, is_expired: false, is_near_expiry: true },
      { id: 5, lot_no: "LOT-B", expiry_date: "2026-09-30", days_to_expiry: 22, is_expired: false, is_near_expiry: true },
    ],
  };

  it("pairs each allocation with its lot metadata and current progress (local wins)", () => {
    const local = mergeScanResult({}, { allocation_id: 71, picked_quantity: "1.000", packed_quantity: "0.000" });
    const candidates = buildAmbiguityCandidates(DETAIL.items[0].fulfillment_allocations, resolved, local, "picked_quantity");
    expect(candidates).toEqual([
      { allocation_id: 7, batch_id: 1, quantity: "3.000", done: "0.000", lot_no: "LOT-A", expiry_date: "2026-10-19", days_to_expiry: 41, is_expired: false, is_near_expiry: true },
      { allocation_id: 71, batch_id: 5, quantity: "1.000", done: "1.000", lot_no: "LOT-B", expiry_date: "2026-09-30", days_to_expiry: 22, is_expired: false, is_near_expiry: true },
    ]);
  });

  it("without lot metadata (resolution failed) the candidates still list, with empty lot fields", () => {
    const [c] = buildAmbiguityCandidates(DETAIL.items[0].fulfillment_allocations, null, {}, "packed_quantity");
    expect(c).toEqual({
      allocation_id: 7, batch_id: 1, quantity: "3.000", done: "0.000",
      lot_no: null, expiry_date: null, days_to_expiry: null, is_expired: undefined, is_near_expiry: undefined,
    });
  });
});
