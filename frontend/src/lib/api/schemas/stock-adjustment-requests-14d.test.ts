import { describe, expect, it } from "vitest";

import {
  BATCH_REASON_CODES,
  batchReasonError,
  buildCreateAdjustmentRequestBody,
  compareQty,
  isQty,
  qtyInputError,
  REASON_CODES,
  type ReasonCode,
} from "./stock-adjustment-requests";

const DIRECTIONS = { up: "13.000", down: "7.000", zero: "10.000" } as const;
const DECREASE_ONLY: ReasonCode[] = ["DAMAGE", "LOSS_THEFT", "EXPIRY_WRITE_OFF"];

describe("batchReasonError — mirrors the backend's batch-only rules (D4/D5)", () => {
  for (const reason of BATCH_REASON_CODES) {
    for (const [direction, requested] of Object.entries(DIRECTIONS)) {
      const allowed = !DECREASE_ONLY.includes(reason) || direction === "down";
      it(`${reason} ${direction} -> ${allowed ? "allowed" : "rejected"}`, () => {
        const error = batchReasonError({ reasonCode: reason, observed: "10.000", requested, isExpired: true });
        expect(error === null).toBe(allowed);
      });
    }
  }

  it("rejects expiry write-off for a lot that is not expired", () => {
    expect(batchReasonError({ reasonCode: "EXPIRY_WRITE_OFF", observed: "5", requested: "0", isExpired: false }))
      .toMatch(/expiry date is before today/);
  });

  it("non-batch reasons never include expiry write-off", () => {
    expect(REASON_CODES).not.toContain("EXPIRY_WRITE_OFF");
  });
});

describe("compareQty — exact 3-dp comparison without floats", () => {
  it.each([
    ["1.000", "1", 0], ["0.001", "0", 1], ["9.999", "10.000", -1], ["1000000000000.001", "1000000000000.000", 1],
  ])("%s vs %s = %i", (a, b, expected) => {
    expect(compareQty(a, b)).toBe(expected);
  });
});

describe("invalid or half-typed quantity text never throws", () => {
  const INVALID = ["abc", "", " ", ".", "5.", ".5", "-1", "1.2345", "1e3", "1,000", "0x10", "1.2.3"];

  it.each(INVALID)("isQty(%j) is false", (v) => {
    expect(isQty(v)).toBe(false);
  });

  it.each(["0", "7", "7.5", "7.50", "007.125", " 10.000 "])("isQty(%j) is true", (v) => {
    expect(isQty(v)).toBe(true);
  });

  it.each(INVALID)("compareQty with %j is NaN on either side (no BigInt throw)", (v) => {
    expect(compareQty(v, "1.000")).toBeNaN();
    expect(compareQty("1.000", v)).toBeNaN();
  });

  for (const reason of BATCH_REASON_CODES) {
    it.each(INVALID)(`batchReasonError(${reason}) with %j on either side returns no direction error`, (v) => {
      expect(batchReasonError({ reasonCode: reason, observed: "10.000", requested: v, isExpired: true })).toBeNull();
      expect(batchReasonError({ reasonCode: reason, observed: v, requested: "5.000", isExpired: true })).toBeNull();
    });
  }

  it("still reports a non-expired expiry write-off even when the quantity is invalid", () => {
    expect(batchReasonError({ reasonCode: "EXPIRY_WRITE_OFF", observed: "x", requested: "y", isExpired: false }))
      .toMatch(/expiry date is before today/);
  });

  it.each([
    ["", null],
    ["   ", null],
    ["12.000", null],
    ["0", null],
    ["abc", "Quantity must be a number"],
    ["5.", "Quantity must be a number"],
    ["-3", "Quantity must be a number"],
    ["1.2345", "At most 3 decimal places"],
  ])("qtyInputError(%j) = %j", (v, expected) => {
    expect(qtyInputError(v)).toBe(expected);
  });

  it("keeps exact 3-dp precision at the boundary", () => {
    expect(compareQty("0.001", "0.000")).toBe(1);
    expect(compareQty("99999999999999.999", "100000000000000")).toBe(-1);
    expect(batchReasonError({ reasonCode: "DAMAGE", observed: "10.000", requested: "9.999", isExpired: false })).toBeNull();
    expect(batchReasonError({ reasonCode: "DAMAGE", observed: "10", requested: "10.000", isExpired: false }))
      .toMatch(/must lower the quantity/);
  });

  it("buildCreateAdjustmentRequestBody rejects invalid quantity text", () => {
    for (const v of ["abc", "5.", "-1", "1.2345"]) {
      expect(buildCreateAdjustmentRequestBody({
        product_id: 1, observed_quantity: "1", requested_quantity: v, reason_code: "CYCLE_COUNT_VARIANCE",
      })).toBeNull();
    }
  });
});

describe("buildCreateAdjustmentRequestBody", () => {
  it("omits storage and batch keys for a non-batch body (legacy fingerprint)", () => {
    expect(buildCreateAdjustmentRequestBody({
      product_id: 1, observed_quantity: "1", requested_quantity: "2", reason_code: "DAMAGE",
    })).toEqual({ product_id: 1, observed_quantity: "1", requested_quantity: "2", reason_code: "DAMAGE" });
  });

  it("requires a batch for an expiry write-off", () => {
    expect(buildCreateAdjustmentRequestBody({
      product_id: 1, observed_quantity: "5", requested_quantity: "0", reason_code: "EXPIRY_WRITE_OFF",
    })).toBeNull();
  });
});
