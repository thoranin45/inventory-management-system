import { describe, expect, it } from "vitest";

import { isLowStock, lowStockThreshold, stockStatus } from "./stock-status";

function row(overrides: Partial<Parameters<typeof stockStatus>[0]> = {}) {
  return {
    operational_available_quantity: "100.000",
    expired_quantity: "0",
    near_expiry_quantity: "0",
    minimum_stock: "10.000",
    safety_stock: "0",
    is_active: true,
    ...overrides,
  };
}

describe("lowStockThreshold / isLowStock", () => {
  it("prefers safety_stock over minimum_stock when safety_stock is larger", () => {
    expect(lowStockThreshold({ minimum_stock: "10", safety_stock: "25" })).toBe("25");
  });

  it("falls back to minimum_stock when safety_stock is 0", () => {
    expect(lowStockThreshold({ minimum_stock: "10", safety_stock: "0" })).toBe("10");
  });

  it("a threshold of 0 (no threshold configured) never flags low stock", () => {
    expect(isLowStock(row({ minimum_stock: "0", safety_stock: "0", operational_available_quantity: "0" }))).toBe(false);
  });

  it("flags low stock when available is under the threshold", () => {
    expect(isLowStock(row({ minimum_stock: "10", operational_available_quantity: "5" }))).toBe(true);
  });

  it("does not flag low stock when available meets the threshold exactly", () => {
    expect(isLowStock(row({ minimum_stock: "10", operational_available_quantity: "10" }))).toBe(false);
  });
});

describe("stockStatus priority: Expired > Out of stock > Near expiry > Low stock > In stock", () => {
  it("In stock when nothing is wrong", () => {
    expect(stockStatus(row()).key).toBe("in_stock");
  });

  it("Low stock when available is under threshold", () => {
    expect(stockStatus(row({ operational_available_quantity: "5", minimum_stock: "10" })).key).toBe("low_stock");
  });

  it("Near expiry outranks Low stock", () => {
    expect(
      stockStatus(row({ operational_available_quantity: "5", minimum_stock: "10", near_expiry_quantity: "5" })).key,
    ).toBe("near_expiry");
  });

  it("Out of stock outranks Near expiry", () => {
    expect(
      stockStatus(row({ operational_available_quantity: "0", near_expiry_quantity: "5" })).key,
    ).toBe("out_of_stock");
  });

  it("Expired outranks everything, including Out of stock", () => {
    expect(
      stockStatus(row({ operational_available_quantity: "0", expired_quantity: "3", near_expiry_quantity: "5" })).key,
    ).toBe("expired");
  });

  it("Inactive is reported regardless of stock levels", () => {
    expect(stockStatus(row({ is_active: false, expired_quantity: "3" })).key).toBe("inactive");
  });

  it("a thin scan/resolve payload (no expired/near-expiry quantities) still classifies in/out/low correctly", () => {
    expect(stockStatus({ operational_available_quantity: "0" }).key).toBe("out_of_stock");
    expect(stockStatus({ operational_available_quantity: "50" }).key).toBe("in_stock");
  });
});
