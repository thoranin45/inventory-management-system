import { describe, expect, it } from "vitest";

import { formatQty, formatMoney, formatCount, agoFromIso } from "./format";
import { sumDecimals, compareDecimals, isZero, ratio } from "./decimal";

describe("formatQty — 2-decimal display, no float", () => {
  it.each([
    ["0", "0.00"],
    ["10", "10.00"],
    ["10.000", "10.00"],
    ["1.13", "1.13"],
    ["1.125", "1.13"], // half-up on the 3rd digit
    ["1.124", "1.12"],
    ["1673", "1,673.00"],
    ["6702.000", "6,702.00"],
    ["1234567.5", "1,234,567.50"],
    ["-42.5", "-42.50"],
  ])("formatQty(%s) -> %s", (input, expected) => {
    expect(formatQty(input)).toBe(expected);
  });

  it("keeps huge values exact (no Number precision loss)", () => {
    expect(formatQty("90071992547409910.000")).toBe("90,071,992,547,409,910.00");
  });

  it("null/empty -> em dash", () => {
    expect(formatQty(null)).toBe("—");
    expect(formatQty(undefined)).toBe("—");
    expect(formatQty("")).toBe("—");
  });
});

describe("formatMoney / formatCount", () => {
  it("money prefixes the symbol", () => {
    expect(formatMoney("78.00")).toBe("฿78.00");
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
