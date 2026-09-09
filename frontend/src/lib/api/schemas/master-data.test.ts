import { describe, expect, it } from "vitest";

import {
  batchListEnvelope,
  categoryInput,
  categoryListEnvelope,
  categoryMutationEnvelope,
  customerInput,
  customerListEnvelope,
  masterDataErrorCopy,
  supplierInput,
  supplierListEnvelope,
} from "./master-data";

const listEnvelope = (items: unknown[]) => ({
  success: true,
  message: "ok",
  data: { items, pagination: { page: 1, page_size: 20, total_items: items.length, total_pages: 1 } },
});

describe("master-data list envelopes", () => {
  it("parses the category list contract", () => {
    const parsed = categoryListEnvelope.parse(listEnvelope([{ id: 3, category_name: "Beverages" }]));
    expect(parsed.data.items[0]).toEqual({ id: 3, category_name: "Beverages" });
  });

  it("parses customers with nullable optional fields", () => {
    const parsed = customerListEnvelope.parse(
      listEnvelope([{ id: 1, customer_name: "Acme", phone: null, email: null, address: null }]),
    );
    expect(parsed.data.items[0].customer_name).toBe("Acme");
  });

  it("parses suppliers including contact_name", () => {
    const parsed = supplierListEnvelope.parse(
      listEnvelope([{ id: 1, supplier_name: "GHT", contact_name: "Somchai", phone: "1", email: null, address: "BKK" }]),
    );
    expect(parsed.data.items[0].contact_name).toBe("Somchai");
  });

  it("parses the enriched batch list", () => {
    const parsed = batchListEnvelope.parse(
      listEnvelope([
        {
          id: 7,
          product_id: 1,
          lot_no: "LOT-1",
          mfg_date: "2026-01-01",
          expiry_date: "2020-01-01",
          quantity: "1.000",
          created_at: "2026-01-01T00:00:00",
          owned_quantity: "1.000",
          operational_available_quantity: "0",
          transit_quantity: "0",
          days_to_expiry: -2000,
          is_expired: true,
          is_near_expiry: false,
          as_of_date: "2026-09-09",
        },
      ]),
    );
    expect(parsed.data.items[0].is_expired).toBe(true);
  });

  it("parses a mutation envelope (single row)", () => {
    expect(categoryMutationEnvelope.parse({ success: true, message: "ok", data: { id: 9, category_name: "New" } }).data.id).toBe(9);
  });
});

describe("categoryInput", () => {
  it("requires a non-empty trimmed name", () => {
    expect(categoryInput.safeParse({ category_name: "   " }).success).toBe(false);
    const ok = categoryInput.parse({ category_name: "  Snacks  " });
    expect(ok.category_name).toBe("Snacks");
  });
  it("rejects names over 255 chars", () => {
    expect(categoryInput.safeParse({ category_name: "x".repeat(256) }).success).toBe(false);
  });
});

describe("customerInput / supplierInput", () => {
  it("drops empty optional strings so they are never POSTed", () => {
    const parsed = customerInput.parse({ customer_name: "Acme", phone: "", email: "", address: "" });
    expect(parsed).toEqual({ customer_name: "Acme" });
  });
  it("validates email only when present", () => {
    expect(customerInput.safeParse({ customer_name: "Acme", email: "not-an-email" }).success).toBe(false);
    expect(customerInput.safeParse({ customer_name: "Acme", email: "a@b.co" }).success).toBe(true);
  });
  it("keeps supplier contact_name", () => {
    const parsed = supplierInput.parse({ supplier_name: "GHT", contact_name: "Lek" });
    expect(parsed.contact_name).toBe("Lek");
  });
});

describe("masterDataErrorCopy", () => {
  it("maps known backend messages", () => {
    expect(masterDataErrorCopy("SKU already exists")).toMatch(/already used/i);
    expect(masterDataErrorCopy("Cannot delete category with active products")).toMatch(/active products/i);
    expect(masterDataErrorCopy("Database constraint error")).toMatch(/referenced by existing orders/i);
  });
  it("matches the dynamic 413 byte-limit message", () => {
    expect(masterDataErrorCopy("Image exceeds the 5242880 byte limit")).toMatch(/too large/i);
    expect(masterDataErrorCopy("Image exceeds the 9999 byte limit")).toMatch(/too large/i);
  });
  it("returns undefined for unknown messages", () => {
    expect(masterDataErrorCopy("something novel")).toBeUndefined();
  });
});
