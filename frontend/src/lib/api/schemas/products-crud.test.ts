import { describe, expect, it } from "vitest";

import {
  IMAGE_MAX_BYTES,
  productCreateInput,
  productDetailEnvelope,
  productUpdateInput,
  validateImageFile,
} from "./products";

describe("productDetailSchema", () => {
  it("parses ApiResponse<ProductResponse> with string decimals + nullable image", () => {
    const parsed = productDetailEnvelope.parse({
      success: true,
      message: "ok",
      data: {
        id: 1,
        sku: "WH-COFFEE-1KG",
        barcode: "885000000001",
        product_name: "Arabica",
        price: "210.00",
        stock_qty: "1624.000",
        category_id: null,
        image_url: null,
        is_active: true,
        created_at: "2026-09-08T11:32:38",
        track_batch: true,
        track_expiry: true,
      },
    });
    expect(parsed.data.price).toBe("210.00");
    expect(parsed.data.image_url).toBeNull();
  });
});

describe("productCreateInput", () => {
  const base = { sku: "WH-X", product_name: "X", price: "9.99" };

  it("accepts the minimal real contract and drops empty optionals", () => {
    const parsed = productCreateInput.parse({ ...base, barcode: "", stock_qty: "" });
    expect(parsed).toMatchObject({ sku: "WH-X", product_name: "X", price: "9.99", track_batch: false, track_expiry: false });
    expect("barcode" in parsed && parsed.barcode).toBeFalsy();
  });

  it("rejects a bad SKU character set", () => {
    expect(productCreateInput.safeParse({ ...base, sku: "no spaces" }).success).toBe(false);
  });

  it("rejects price with >2 decimals or non-numeric", () => {
    expect(productCreateInput.safeParse({ ...base, price: "1.999" }).success).toBe(false);
    expect(productCreateInput.safeParse({ ...base, price: "abc" }).success).toBe(false);
  });

  it("enforces track_expiry ⇒ track_batch on the track_expiry path", () => {
    const bad = productCreateInput.safeParse({ ...base, track_batch: false, track_expiry: true });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.error.issues[0].path).toContain("track_expiry");
    expect(productCreateInput.safeParse({ ...base, track_batch: true, track_expiry: true }).success).toBe(true);
  });

  it("rejects stock_qty with >3 decimals", () => {
    expect(productCreateInput.safeParse({ ...base, stock_qty: "1.2345" }).success).toBe(false);
  });
});

describe("productUpdateInput", () => {
  it("is fully partial", () => {
    expect(productUpdateInput.safeParse({}).success).toBe(true);
    expect(productUpdateInput.parse({ product_name: "New name" })).toEqual({ product_name: "New name" });
  });
  it("turns a cleared barcode into null (explicit removal)", () => {
    expect(productUpdateInput.parse({ barcode: "" }).barcode).toBeNull();
  });
  it("still enforces the tracking relationship", () => {
    expect(productUpdateInput.safeParse({ track_batch: false, track_expiry: true }).success).toBe(false);
  });
});

describe("validateImageFile", () => {
  const mk = (type: string, size: number) => ({ type, size, name: "x" }) as unknown as File;
  it("accepts a small jpeg", () => {
    expect(validateImageFile(mk("image/jpeg", 1024))).toBeNull();
  });
  it("rejects an unsupported type", () => {
    expect(validateImageFile(mk("image/gif", 1024))).toMatch(/JPEG, PNG or WebP/i);
  });
  it("rejects a file over 5 MiB", () => {
    expect(validateImageFile(mk("image/png", IMAGE_MAX_BYTES + 1))).toMatch(/too large/i);
  });
  it("rejects an empty file", () => {
    expect(validateImageFile(mk("image/webp", 0))).toMatch(/empty/i);
  });
});
