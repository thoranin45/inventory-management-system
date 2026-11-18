import { describe, expect, it } from "vitest";

import {
  MASTER_DATA_ERROR_COPY,
  categoryInput,
  customerInput,
  masterDataErrorCopy,
  supplierInput,
} from "@/lib/api/schemas/master-data";
import { PRODUCT_FILTERS, productCreateInput, productUpdateInput, validateImageFile } from "@/lib/api/schemas/products";
import { DICTIONARIES, translate, type MessageKey, type MessageVars } from "@/lib/i18n/translate";
import { MASTER_DATA_ERROR_KEY, formMessageText, masterDataErrorKey, masterDataErrorText } from "./master-data-copy";

/*
 * P6: every master-data copy entry has a dictionary key, and the ENGLISH
 * dictionary reproduces the existing English copy exactly, so tests and
 * operators that relied on the English text see no change.
 */

const en = (k: MessageKey, v?: MessageVars) => translate(DICTIONARIES.en, k, v);
const th = (k: MessageKey, v?: MessageVars) => translate(DICTIONARIES.th, k, v);

function zodMessages(schema: { safeParse: (v: unknown) => { success: boolean; error?: { issues: { message: string }[] } } }, value: unknown) {
  const r = schema.safeParse(value);
  return r.success ? [] : r.error!.issues.map((i) => i.message);
}

describe("master-data-copy: every entry is keyed and English is unchanged", () => {
  it("backend error map: same entries, English text equal", () => {
    expect(Object.keys(MASTER_DATA_ERROR_KEY)).toEqual(Object.keys(MASTER_DATA_ERROR_COPY));
    for (const [message, copy] of Object.entries(MASTER_DATA_ERROR_COPY)) {
      expect(en(masterDataErrorKey(message)!), message).toBe(copy);
    }
  });

  it("the image byte-limit pattern resolves like masterDataErrorCopy", () => {
    const msg = "Image exceeds the 1048576 byte limit";
    expect(en(masterDataErrorKey(msg)!)).toBe(masterDataErrorCopy(msg));
  });

  it("unknown backend messages fall back to the API text", () => {
    expect(masterDataErrorKey("Too spicy")).toBeUndefined();
    expect(masterDataErrorText(en, "Too spicy", "fallback")).toBe("fallback");
  });

  it("zod messages of the master-data and product schemas render unchanged in English", () => {
    const long = "x".repeat(600);
    const messages = [
      ...zodMessages(categoryInput, { category_name: "" }),
      ...zodMessages(categoryInput, { category_name: long }),
      ...zodMessages(customerInput, { customer_name: "", phone: long, email: "nope", address: long }),
      ...zodMessages(supplierInput, { supplier_name: long, contact_name: long, email: `${long}@x.io` }),
      ...zodMessages(productCreateInput, {
        sku: "",
        barcode: "bad code!",
        product_name: "",
        price: "",
        stock_qty: "1.2345",
        track_batch: false,
        track_expiry: true,
      }),
      ...zodMessages(productCreateInput, { sku: "a b", product_name: "x", price: "1.234" }),
      ...zodMessages(productCreateInput, { sku: long, barcode: long, product_name: long, price: "1" }),
      ...zodMessages(productUpdateInput, { sku: "", product_name: "", barcode: "?", track_batch: false, track_expiry: true }),
    ];
    expect(messages.length).toBeGreaterThan(15);
    for (const m of messages) {
      expect(formMessageText(en, m), m).toBe(m);
      // every one is translated: the Thai text differs from the English
      expect(formMessageText(th, m), m).not.toBe(m);
    }
  });

  it("image file checks render unchanged in English and translated in Thai", () => {
    const files = [
      new File(["x"], "a.gif", { type: "image/gif" }),
      new File([], "a.png", { type: "image/png" }),
      new File([new Uint8Array(5 * 1024 * 1024 + 1)], "big.png", { type: "image/png" }),
    ];
    for (const f of files) {
      const m = validateImageFile(f)!;
      expect(m).toBeTruthy();
      expect(formMessageText(en, m)).toBe(m);
      expect(formMessageText(th, m)).not.toBe(m);
    }
  });

  it("Thai required/too-long messages translate the field label too", () => {
    expect(formMessageText(th, "Category name is required")).toBe(th("masterData.errRequired", { field: th("masterData.categoryName") }));
    expect(formMessageText(th, "Email must be 255 characters or fewer")).not.toMatch(/Email/);
  });

  it("unknown messages (e.g. backend 422 details) are shown as sent", () => {
    expect(formMessageText(th, "too spicy")).toBe("too spicy");
  });

  it("product filter labels: English equals PRODUCT_FILTERS", () => {
    const keys: Record<string, MessageKey> = {
      all: "product.filterAll",
      low: "product.filterLow",
      expired: "product.filterExpired",
      near: "product.filterNear",
      transit: "product.filterTransit",
      inactive: "product.filterInactive",
    };
    for (const f of PRODUCT_FILTERS) expect(en(keys[f.key]), f.key).toBe(f.label);
  });
});
