import { describe, expect, it } from "vitest";

import { formatQty, formatQtyDelta, formatMoney, formatCount, agoFromIso, qtyScaleAnomaly } from "./format";
import { sumDecimals, compareDecimals, isZero, ratio } from "./decimal";

describe("formatQty — Concept B fixed 3-decimal inventory quantity, exact (D-R4-1)", () => {
  it.each([
    ["0", "0.000"],
    ["10", "10.000"],
    ["10.000", "10.000"],
    ["5", "5.000"],
    ["0.001", "0.001"], // a small nonzero quantity never shows as zero
    ["1.234", "1.234"],
    ["1.13", "1.130"],
    ["1.125", "1.125"], // never rounded
    ["1673", "1,673.000"],
    ["6702.000", "6,702.000"],
    ["1234567.5", "1,234,567.500"],
    ["-42.5", "−42.500"], // real minus sign
    ["-0.000", "0.000"], // no signed zero
  ])("formatQty(%s) -> %s", (input, expected) => {
    expect(formatQty(input)).toBe(expected);
  });

  it("never rounds or truncates a value beyond 3 decimals, and flags it", () => {
    expect(formatQty("0.0009")).toBe("0.0009");
    expect(formatQty("1.23456")).toBe("1.23456");
    expect(qtyScaleAnomaly("0.0009")).toBe(true);
    expect(qtyScaleAnomaly("1.234")).toBe(false);
    expect(qtyScaleAnomaly(null)).toBe(false);
  });

  it("keeps huge values exact (no Number precision loss)", () => {
    expect(formatQty("90071992547409910.000")).toBe("90,071,992,547,409,910.000");
  });

  it("null/empty -> em dash; non-numeric text is shown as-is, never as a number", () => {
    expect(formatQty(null)).toBe("—");
    expect(formatQty(undefined)).toBe("—");
    expect(formatQty("")).toBe("—");
    expect(formatQty("abc")).toBe("abc");
    expect(formatQty("1.")).toBe("1.");
  });
});

describe("formatQtyDelta — signed quantity changes", () => {
  it.each([
    ["12", "+12.000"],
    ["-0.005", "−0.005"],
    ["0", "0.000"],
    ["-0.000", "0.000"],
    ["1234.5", "+1,234.500"],
  ])("formatQtyDelta(%s) -> %s", (input, expected) => {
    expect(formatQtyDelta(input)).toBe(expected);
  });
  it("empty and invalid", () => {
    expect(formatQtyDelta(null)).toBe("—");
    expect(formatQtyDelta("x")).toBe("x");
  });
});

describe("formatMoney / formatCount", () => {
  it("money keeps 2 decimals, half-up, with the symbol (unchanged by the quantity policy)", () => {
    expect(formatMoney("78.00")).toBe("฿78.00");
    expect(formatMoney("78")).toBe("฿78.00");
    expect(formatMoney("1.125")).toBe("฿1.13");
    expect(formatMoney("1.124")).toBe("฿1.12");
    expect(formatMoney("1234567.5")).toBe("฿1,234,567.50");
    expect(formatMoney("-42.5")).toBe("฿-42.50");
    expect(formatMoney("-0.004")).toBe("฿0.00");
    expect(formatMoney(null)).toBe("—");
  });
  it("count groups thousands, never decimals", () => {
    expect(formatCount(1234567)).toBe("1,234,567");
    expect(formatCount(0)).toBe("0");
  });
});

describe("Decimal-safe helpers (scaled BigInt, no parseFloat)", () => {
  it("sumDecimals is exact", () => {
    expect(sumDecimals(["6172.000", "580.000", "140.000", "0"])).toBe("6892.000");
  });
  it("compareDecimals", () => {
    expect(compareDecimals("6892.000", "7132.000")).toBe(-1);
    expect(compareDecimals("100.00", "100.000")).toBe(0);
    expect(compareDecimals("2", "1.999")).toBe(1);
  });
  it("isZero", () => {
    expect(isZero("0")).toBe(true);
    expect(isZero("0.000")).toBe(true);
    expect(isZero("0.001")).toBe(false);
  });
  it("ratio for a bar width, clamped end conversion", () => {
    expect(ratio("6172.000", "6892.000")).toBeCloseTo(0.8955, 3);
    expect(ratio("5", "0")).toBe(0);
  });
});

describe("agoFromIso", () => {
  it("relative day labels", () => {
    const now = "2026-09-08T12:00:00Z";
    expect(agoFromIso("2026-09-08T02:00:00Z", now)).toBe("today");
    expect(agoFromIso("2026-09-07T12:00:00Z", now)).toBe("1d ago");
    expect(agoFromIso("2026-09-04T12:00:00Z", now)).toBe("4d ago");
  });
});
