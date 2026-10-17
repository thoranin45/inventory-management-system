import { describe, expect, it } from "vitest";

import type { StockBalanceRow } from "@/lib/api/schemas/stock";
import type { Warehouse } from "@/lib/api/schemas/warehouses";
import {
  adjustmentChecks,
  defaultBalancePrefill,
  pickBalancePatch,
  verifyBatchSelection,
  type AdjustmentLine,
  type LoadState,
} from "./adjustment-request-logic";
import type { BalanceOption } from "./exact-balance-picker";

const OPTION: BalanceOption = {
  key: "5-1-11-7",
  productId: 5,
  warehouseId: 1,
  locationId: 11,
  batchId: 7,
  warehouseLabel: "Main",
  locationLabel: "Default",
  lotNo: "LOT-7",
  expiryDate: "2027-01-01",
  isExpired: false,
  onHand: "10.000",
  reserved: "3.000",
} as BalanceOption;

const BATCH_LINE: AdjustmentLine = {
  productId: 5,
  trackBatch: true,
  warehouseId: 1,
  locationId: 11,
  batchId: 7,
  batchExpired: false,
  pickedOnHand: "10.000",
  reserved: "3.000",
  observed: "10.000",
  requested: "8.000",
  reasonCode: "CYCLE_COUNT_VARIANCE",
  notes: "",
};

const loaded: LoadState = { isError: false, isFetching: false, loaded: true };

describe("verifyBatchSelection", () => {
  it("is null without a batch selection", () => {
    expect(verifyBatchSelection(undefined, [OPTION], loaded, loaded)).toBeNull();
    expect(verifyBatchSelection({ ...BATCH_LINE, trackBatch: false }, [OPTION], loaded, loaded)).toBeNull();
    expect(verifyBatchSelection({ ...BATCH_LINE, batchId: null }, [OPTION], loaded, loaded)).toBeNull();
  });

  it("an error in either load wins over everything else", () => {
    expect(verifyBatchSelection(BATCH_LINE, [OPTION], { ...loaded, isError: true }, loaded)).toEqual({ kind: "error" });
    expect(verifyBatchSelection(BATCH_LINE, [OPTION], loaded, { ...loaded, isError: true, loaded: false })).toEqual({ kind: "error" });
  });

  it("is 'checking' until both loads arrived and while either refetches", () => {
    expect(verifyBatchSelection(BATCH_LINE, [OPTION], { ...loaded, loaded: false }, loaded)).toEqual({ kind: "checking" });
    expect(verifyBatchSelection(BATCH_LINE, [OPTION], loaded, { ...loaded, isFetching: true })).toEqual({ kind: "checking" });
  });

  it("'missing' when the exact product/warehouse/location/batch is gone", () => {
    expect(verifyBatchSelection(BATCH_LINE, [{ ...OPTION, locationId: 12 }], loaded, loaded)).toEqual({ kind: "missing" });
    expect(verifyBatchSelection(BATCH_LINE, [], loaded, loaded)).toEqual({ kind: "missing" });
  });

  it("'changed' when on-hand, reserved or expiry moved, or the draft predates pickedOnHand", () => {
    for (const option of [{ ...OPTION, onHand: "9.000" }, { ...OPTION, reserved: "4" }, { ...OPTION, isExpired: true }]) {
      expect(verifyBatchSelection(BATCH_LINE, [option], loaded, loaded)).toEqual({ kind: "changed", option });
    }
    expect(verifyBatchSelection({ ...BATCH_LINE, pickedOnHand: undefined }, [OPTION], loaded, loaded)).toEqual({
      kind: "changed",
      option: OPTION,
    });
  });

  it("'ok' when the balance is unchanged (scale-insensitive comparison)", () => {
    expect(verifyBatchSelection({ ...BATCH_LINE, reserved: "3" }, [OPTION], loaded, loaded)).toEqual({ kind: "ok", option: OPTION });
  });
});

describe("adjustmentChecks", () => {
  const ok = { kind: "ok" as const, option: OPTION };

  it("a valid batch decrease", () => {
    expect(adjustmentChecks(BATCH_LINE, ok)).toEqual({
      ruleError: null,
      belowReserved: false,
      observedError: null,
      requestedError: null,
      valid: true,
    });
  });

  it("a batch request below the reserved floor is blocked", () => {
    const c = adjustmentChecks({ ...BATCH_LINE, requested: "2" }, ok);
    expect(c.belowReserved).toBe(true);
    expect(c.valid).toBe(false);
  });

  it("a non-batch request below reserved only warns", () => {
    const c = adjustmentChecks({ ...BATCH_LINE, trackBatch: false, batchId: null, requested: "2" }, null);
    expect(c.belowReserved).toBe(true);
    expect(c.valid).toBe(true);
  });

  it("a batch DAMAGE increase breaks the decrease-only rule", () => {
    const c = adjustmentChecks({ ...BATCH_LINE, reasonCode: "DAMAGE", requested: "12" }, ok);
    expect(c.ruleError).toBeTruthy();
    expect(c.valid).toBe(false);
  });

  it("a batch request is invalid unless its selection is verified 'ok'", () => {
    expect(adjustmentChecks(BATCH_LINE, { kind: "checking" }).valid).toBe(false);
    expect(adjustmentChecks(BATCH_LINE, { kind: "changed", option: OPTION }).valid).toBe(false);
  });

  it("OTHER needs a note; bad quantity text is reported", () => {
    expect(adjustmentChecks({ ...BATCH_LINE, reasonCode: "OTHER" }, ok).valid).toBe(false);
    expect(adjustmentChecks({ ...BATCH_LINE, reasonCode: "OTHER", notes: "why" }, ok).valid).toBe(true);
    expect(adjustmentChecks({ ...BATCH_LINE, requested: "abc" }, ok).requestedError).toBeTruthy();
  });

  it("no line: nothing to submit", () => {
    expect(adjustmentChecks(undefined, null)).toEqual({
      ruleError: null,
      belowReserved: false,
      observedError: null,
      requestedError: null,
      valid: false,
    });
  });
});

describe("defaultBalancePrefill", () => {
  const directory = [
    { id: 1, warehouse_code: "MAIN", locations: [{ id: 11, location_code: "DEFAULT" }] },
  ] as unknown as Warehouse[];
  const row = (over: Partial<StockBalanceRow>) =>
    ({ batch_id: null, warehouse_id: 1, location_id: 11, on_hand_qty: "10.000", reserved_qty: "3.000", ...over }) as StockBalanceRow;

  it("reads ON-HAND (not available) of the unbatched MAIN/DEFAULT balance", () => {
    expect(defaultBalancePrefill([row({ batch_id: 9, on_hand_qty: "99" }), row({})], directory)).toEqual({
      observed: "10.000",
      reserved: "3.000",
    });
  });

  it("an absent balance reads as 0.000 with nothing reserved", () => {
    expect(defaultBalancePrefill([], directory)).toEqual({ observed: "0.000", reserved: "0" });
  });
});

describe("pickBalancePatch", () => {
  it("pins the exact balance and prefills observed from its on-hand", () => {
    expect(pickBalancePatch(OPTION, "DAMAGE")).toEqual({
      warehouseId: 1,
      locationId: 11,
      batchId: 7,
      batchExpired: false,
      pickedOnHand: "10.000",
      reserved: "3.000",
      observed: "10.000",
      reasonCode: "DAMAGE",
    });
  });

  it("drops an expiry write-off for a non-expired lot, keeps it for an expired one", () => {
    expect(pickBalancePatch(OPTION, "EXPIRY_WRITE_OFF").reasonCode).toBe("CYCLE_COUNT_VARIANCE");
    expect(pickBalancePatch({ ...OPTION, isExpired: true }, "EXPIRY_WRITE_OFF").reasonCode).toBe("EXPIRY_WRITE_OFF");
  });
});
