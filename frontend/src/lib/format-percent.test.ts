import { describe, expect, it } from "vitest";

import { formatProgressPercent, poReceivingComplete, soPackingComplete, soPickingComplete } from "./format-percent";

describe("formatProgressPercent — honest progress (D-R5-4)", () => {
  it("zero is 0%", () => {
    expect(formatProgressPercent(0, false)).toBe("0%");
  });

  it("genuine positive progress below 1% is <1%, never a misleading 0%", () => {
    expect(formatProgressPercent(0.1, false)).toBe("<1%");
    expect(formatProgressPercent(0.9, false)).toBe("<1%");
  });

  it("the backend's 0–100 scale is used as-is: 1.0 is 1%, not 100%", () => {
    expect(formatProgressPercent(1, false)).toBe("1%");
    expect(formatProgressPercent(33.3, false)).toBe("33%");
  });

  it("never shows 100% for incomplete work, even when the backend rounded up", () => {
    expect(formatProgressPercent(99.6, false)).toBe("99%");
    expect(formatProgressPercent(100, false)).toBe("99%"); // 0.1-quantized 99.96 arrives as 100.0
  });

  it("100% only when completion is established", () => {
    expect(formatProgressPercent(100, true)).toBe("100%");
    expect(formatProgressPercent(99.6, true)).toBe("100%");
  });

  it("non-finite input is 0%", () => {
    expect(formatProgressPercent(Number.NaN, false)).toBe("0%");
    expect(formatProgressPercent(Number.POSITIVE_INFINITY, false)).toBe("0%");
  });
});

describe("completion from the authoritative lifecycle", () => {
  it("picking is complete once the order has moved past PICKING (complete-picking requires exact counts)", () => {
    for (const s of ["PACKING", "READY_TO_SHIP", "SHIPPED", "COMPLETED"]) expect(soPickingComplete(s)).toBe(true);
    for (const s of ["DRAFT", "CONFIRMED", "PICKING", "CANCELLED", "picking"]) expect(soPickingComplete(s)).toBe(false);
  });

  it("packing is complete from READY_TO_SHIP on", () => {
    for (const s of ["READY_TO_SHIP", "SHIPPED", "COMPLETED", "ready_to_ship"]) expect(soPackingComplete(s)).toBe(true);
    for (const s of ["PICKING", "PACKING", "CANCELLED"]) expect(soPackingComplete(s)).toBe(false);
  });

  it("a PO is fully received only when RECEIVED", () => {
    expect(poReceivingComplete("RECEIVED")).toBe(true);
    expect(poReceivingComplete("PARTIALLY_RECEIVED")).toBe(false);
  });
});
