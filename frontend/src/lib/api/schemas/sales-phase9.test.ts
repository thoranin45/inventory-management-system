import { describe, expect, it } from "vitest";

import {
  COMPLETE_STARTABLE_STATUS,
  RETURNABLE_STATUSES,
  salesReturnEnvelope,
  salesReturnInput,
  salesReturnLineInput,
  SHIP_STARTABLE_STATUS,
  shipErrorCopy,
  SO_STATE_CONFLICT_RE,
} from "./sales";

describe("Phase 9 status constants", () => {
  it("match the backend transitions", () => {
    expect(SHIP_STARTABLE_STATUS).toBe("READY_TO_SHIP");
    expect(COMPLETE_STARTABLE_STATUS).toBe("SHIPPED");
    expect([...RETURNABLE_STATUSES]).toEqual(["SHIPPED", "COMPLETED"]);
  });
});

describe("salesReturnLineInput", () => {
  it("requires a positive quantity with ≤ 3 decimals", () => {
    expect(salesReturnLineInput.safeParse({ product_id: 1, quantity: "0" }).success).toBe(false);
    expect(salesReturnLineInput.safeParse({ product_id: 1, quantity: "1.2345" }).success).toBe(false);
    expect(salesReturnLineInput.safeParse({ product_id: 1, quantity: "-2.000" }).success).toBe(false);
    const ok = salesReturnLineInput.parse({ product_id: 1, quantity: "2.500" });
    expect(ok.quantity).toBe("2.500");
  });
  it("drops an empty reason and caps it at 255", () => {
    expect(salesReturnLineInput.parse({ product_id: 1, quantity: "1", reason: "  " }).reason).toBeUndefined();
    expect(salesReturnLineInput.safeParse({ product_id: 1, quantity: "1", reason: "x".repeat(256) }).success).toBe(false);
  });
  it("rejects a non-positive product_id", () => {
    expect(salesReturnLineInput.safeParse({ product_id: 0, quantity: "1" }).success).toBe(false);
  });
});

describe("salesReturnInput", () => {
  it("needs at least one line", () => {
    expect(salesReturnInput.safeParse({ items: [] }).success).toBe(false);
    expect(salesReturnInput.safeParse({ items: [{ product_id: 3, quantity: "1.000" }] }).success).toBe(true);
  });
});

describe("salesReturnEnvelope", () => {
  it("parses the backend return response (per-product returned_items)", () => {
    const parsed = salesReturnEnvelope.parse({
      success: true,
      message: "Sales return completed",
      data: {
        sales_order_id: 63,
        so_number: "SO-000063",
        returned_items: [
          { product_id: 6, returned_quantity: 1, previously_returned: 0, total_returned: 1, remaining_returnable: 1 },
        ],
      },
    });
    expect(parsed.data.returned_items[0].remaining_returnable).toBe("1");
    expect(parsed.data.returned_items[0].returned_quantity).toBe("1");
  });
});

describe("shipErrorCopy + SO_STATE_CONFLICT_RE", () => {
  it("humanises a state-conflict message", () => {
    const m = SO_STATE_CONFLICT_RE.exec("Sales Order state conflict: DRAFT; requires READY_TO_SHIP");
    expect(m?.[1]).toBe("DRAFT");
    expect(m?.[2]).toBe("READY_TO_SHIP");
    expect(shipErrorCopy("Sales Order state conflict: DRAFT; requires READY_TO_SHIP")).toMatch(/Draft.*needs it to be.*Ready to ship/i);
  });
  it("maps the insufficient-stock message", () => {
    expect(shipErrorCopy("Insufficient reserved or on-hand stock")).toMatch(/reserved quantity is no longer on hand/i);
  });
  it("shows the over-return message verbatim (it carries 'Remaining: N')", () => {
    const msg = "Return quantity exceeds remaining returnable quantity for product 6. Remaining: 2";
    expect(shipErrorCopy(msg)).toBe(msg);
  });
  it("explains an expired allocated batch", () => {
    expect(shipErrorCopy("Expired allocated batch: 7")).toMatch(/expired.*re-allocated/i);
  });
  it("returns undefined for an unknown message", () => {
    expect(shipErrorCopy("something else")).toBeUndefined();
  });
});
