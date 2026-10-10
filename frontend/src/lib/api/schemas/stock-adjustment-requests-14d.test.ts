import { describe, expect, it } from "vitest";

import {
  BATCH_REASON_CODES,
  batchReasonError,
  buildCreateAdjustmentRequestBody,
  compareQty,
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
