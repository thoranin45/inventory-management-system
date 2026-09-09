import { describe, expect, it } from "vitest";

import { productListEnvelope, PRODUCT_SORT_FIELDS } from "./products";
import { stockBalanceListEnvelope, STOCK_SORT_FIELDS } from "./stock";
import { errorResponseSchema } from "../errors";
import {
  productListResponse,
  stockBalanceListResponse,
  errorResponse401,
} from "@/test/fixtures";

describe("Product list Zod contract", () => {
  it("parses a real backend body", () => {
    const env = productListEnvelope.parse(productListResponse);
    expect(env.data.pagination.total_items).toBe(6);
    const row = env.data.items[0];
    // quantities preserved as strings, never coerced to number
    expect(typeof row.owned_quantity).toBe("string");
    expect(row.operational_available_quantity).toBe("400.000");
    expect(row.category_id).toBeNull();
  });

  it("rejects a body with a numeric (non-string) quantity", () => {
    const bad = structuredClone(productListResponse);
    (bad.data.items[0] as { owned_quantity: unknown }).owned_quantity = 480;
    expect(() => productListEnvelope.parse(bad)).toThrow();
  });

  it("exposes the backend sort allow-list", () => {
    expect(PRODUCT_SORT_FIELDS).toEqual(["id", "product_name", "sku", "stock_qty", "created_at"]);
  });
});

describe("Stock balance list Zod contract", () => {
  it("parses a real backend body incl. null batch fields", () => {
    const env = stockBalanceListEnvelope.parse(stockBalanceListResponse);
    const [withBatch, noBatch] = env.data.items;
    expect(withBatch.days_to_expiry).toBe(18);
    expect(noBatch.batch_id).toBeNull();
    expect(noBatch.batch_expiry_date).toBeNull();
    expect(noBatch.days_to_expiry).toBeNull();
  });

  it("sort allow-list matches _BALANCE_SORTS", () => {
    expect(STOCK_SORT_FIELDS).toEqual(["id", "product_id", "on_hand_qty"]);
  });
});

describe("Error envelope", () => {
  it("parses the backend ErrorResponse with request_id", () => {
    const e = errorResponseSchema.parse(errorResponse401);
    expect(e.success).toBe(false);
    expect(e.request_id).toBe("2473728627f94c0ca7a15f24f88e2b36");
  });
});
