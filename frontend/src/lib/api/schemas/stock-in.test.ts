import { describe, expect, it } from "vitest";

import {
  batchInInput,
  buildStockInSaveBody,
  stockInInput,
  stockInSetupInput,
  toBatchRequestBody,
} from "./stock-in";

describe("stockInInput (non-batch)", () => {
  it("accepts a positive 3dp quantity", () => {
    expect(stockInInput.safeParse({ product_id: 1, quantity: "12.500" }).success).toBe(true);
  });
  it("rejects zero / negative / >3dp / non-numeric", () => {
    for (const q of ["0", "-1", "1.2345", "abc", ""]) {
      expect(stockInInput.safeParse({ product_id: 1, quantity: q }).success).toBe(false);
    }
  });
});

describe("batchInInput (tracking-mode date rules)", () => {
  const base = { product_id: 2, lot_no: "LOT-1", quantity: "5.000" };

  it("batch-only: lot + quantity, no dates → ok", () => {
    expect(batchInInput.safeParse({ ...base, trackExpiry: false }).success).toBe(true);
  });

  it("batch-only: one date without the other → rejected", () => {
    expect(
      batchInInput.safeParse({ ...base, trackExpiry: false, mfg_date: "2026-01-01" }).success,
    ).toBe(false);
  });

  it("batch-only: both dates, expiry after mfg → ok", () => {
    expect(
      batchInInput.safeParse({
        ...base,
        trackExpiry: false,
        mfg_date: "2026-01-01",
        expiry_date: "2026-06-01",
      }).success,
    ).toBe(true);
  });

  it("batch+expiry: missing dates → rejected", () => {
    expect(batchInInput.safeParse({ ...base, trackExpiry: true }).success).toBe(false);
  });

  it("batch+expiry: both dates present → ok", () => {
    expect(
      batchInInput.safeParse({
        ...base,
        trackExpiry: true,
        mfg_date: "2026-01-01",
        expiry_date: "2027-01-01",
      }).success,
    ).toBe(true);
  });

  it("expiry <= mfg → rejected in either mode", () => {
    for (const trackExpiry of [true, false]) {
      expect(
        batchInInput.safeParse({
          ...base,
          trackExpiry,
          mfg_date: "2026-06-01",
          expiry_date: "2026-06-01",
        }).success,
      ).toBe(false);
    }
  });

  it("empty lot → rejected", () => {
    expect(batchInInput.safeParse({ ...base, lot_no: "  ", trackExpiry: false }).success).toBe(false);
  });

  it("request body omits trackExpiry and any blank dates", () => {
    const parsed = batchInInput.parse({ ...base, trackExpiry: false });
    const body = toBatchRequestBody(parsed);
    expect(body).not.toHaveProperty("trackExpiry");
    expect(body).not.toHaveProperty("mfg_date");
    expect(body).not.toHaveProperty("expiry_date");
    expect(body).toMatchObject({ product_id: 2, lot_no: "LOT-1", quantity: "5.000" });
  });

  it("request body keeps dates when present", () => {
    const parsed = batchInInput.parse({
      ...base,
      trackExpiry: true,
      mfg_date: "2026-01-01",
      expiry_date: "2027-01-01",
    });
    expect(toBatchRequestBody(parsed)).toMatchObject({
      mfg_date: "2026-01-01",
      expiry_date: "2027-01-01",
    });
  });
});

describe("stockInSetupInput (Save-once session setup)", () => {
  it("non-batch: only a product is required", () => {
    expect(
      stockInSetupInput.safeParse({ product_id: 5, trackBatch: false, trackExpiry: false }).success,
    ).toBe(true);
  });
  it("batch: a lot number is required", () => {
    const base = { product_id: 6, trackBatch: true, trackExpiry: false };
    expect(stockInSetupInput.safeParse(base).success).toBe(false);
    expect(stockInSetupInput.safeParse({ ...base, lot_no: "LOT-A" }).success).toBe(true);
  });
  it("batch+expiry: both dates are required and expiry must be after mfg", () => {
    const base = { product_id: 1, trackBatch: true, trackExpiry: true, lot_no: "L" };
    expect(stockInSetupInput.safeParse(base).success).toBe(false);
    expect(
      stockInSetupInput.safeParse({ ...base, mfg_date: "2026-06-01", expiry_date: "2026-06-01" }).success,
    ).toBe(false);
    expect(
      stockInSetupInput.safeParse({ ...base, mfg_date: "2026-01-01", expiry_date: "2027-01-01" }).success,
    ).toBe(true);
  });
});

describe("buildStockInSaveBody (byte-stable idempotent payload)", () => {
  const nonBatch = { product_id: 5, trackBatch: false, trackExpiry: false };
  const batchExp = {
    product_id: 1,
    trackBatch: true,
    trackExpiry: true,
    lot_no: "LOT-CF",
    mfg_date: "2026-01-01",
    expiry_date: "2027-01-01",
  };

  it("is null until setup is valid and at least one item is counted", () => {
    expect(buildStockInSaveBody(nonBatch, 0)).toBeNull();
    expect(buildStockInSaveBody({ product_id: 6, trackBatch: true, trackExpiry: false }, 3)).toBeNull();
  });

  it("non-batch → /stock/in with the whole count as one quantity", () => {
    expect(buildStockInSaveBody({ ...nonBatch, remark: "opening" }, 7)).toEqual({
      endpoint: "stock/in",
      json: { product_id: 5, quantity: "7", remark: "opening" },
    });
  });

  it("batch → /batches with lot + dates and the accumulated quantity", () => {
    expect(buildStockInSaveBody(batchExp, 12)).toEqual({
      endpoint: "batches",
      json: { product_id: 1, lot_no: "LOT-CF", quantity: "12", mfg_date: "2026-01-01", expiry_date: "2027-01-01" },
    });
  });

  it("is deterministic for a given (setup, count)", () => {
    expect(JSON.stringify(buildStockInSaveBody(batchExp, 4))).toBe(
      JSON.stringify(buildStockInSaveBody(batchExp, 4)),
    );
  });
});
