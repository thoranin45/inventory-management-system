import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";

import { useOrderCopy } from "@/components/orders/use-order-copy";
import {
  SALES_SHIP_ERROR_COPY,
  SCAN_ERROR_COPY,
  SO_ATTENTION_LABEL,
  SO_FILTER_TABS,
  SO_STATUS_LABEL,
  createSalesOrderInput,
  salesReturnLineInput,
  shipErrorCopy,
} from "@/lib/api/schemas/sales";
import { PO_FILTER_TABS, PO_STATUS_LABEL, createPurchaseOrderInput } from "@/lib/api/schemas/purchase-orders";
import { DICTIONARIES, translate } from "@/lib/i18n/translate";
import { attentionMessage, filterTabKey, formMessage, scanErrorKey, shipErrorMessage } from "./order-copy";

/*
 * D-R5-10: every copy-map entry has a dictionary key, and the ENGLISH
 * dictionary reproduces the existing English copy exactly — so the meaning a
 * characterization test or an operator relied on is unchanged.
 */

const en = (k: Parameters<typeof translate>[1], v?: Parameters<typeof translate>[2]) => translate(DICTIONARIES.en, k, v);
// outside a LanguageProvider the UI language is English
const render = renderHook(() => useOrderCopy()).result.current;

describe("order-copy — every entry is keyed and English is unchanged", () => {
  it("status labels: the status dictionary matches SO_STATUS_LABEL / PO_STATUS_LABEL", () => {
    for (const [code, text] of [...Object.entries(SO_STATUS_LABEL), ...Object.entries(PO_STATUS_LABEL)]) {
      expect(code in DICTIONARIES.en.status, code).toBe(true);
      expect(en(`status.${code}` as never), code).toBe(text);
    }
  });

  it("filter tabs", () => {
    for (const tab of [...SO_FILTER_TABS, ...PO_FILTER_TABS]) expect(en(filterTabKey(tab.key)), tab.key).toBe(tab.label);
  });

  it("attention reasons", () => {
    for (const [reason, text] of Object.entries(SO_ATTENTION_LABEL)) expect(render(attentionMessage(reason))).toBe(text);
    expect(render(attentionMessage("stock_short"))).toBe("Needs attention: stock short.");
  });

  it("scan error codes", () => {
    for (const [code, text] of Object.entries(SCAN_ERROR_COPY)) {
      const k = scanErrorKey(code);
      expect(k, code).not.toBeNull();
      expect(en(k!), code).toBe(text);
    }
    expect(scanErrorKey("SOMETHING_ELSE")).toBeNull();
  });

  it("ship / complete / return errors mirror shipErrorCopy for every branch", () => {
    const samples = [
      ...Object.keys(SALES_SHIP_ERROR_COPY),
      "Sales Order state conflict: SHIPPED; requires READY_TO_SHIP",
      "Sales Order state conflict: DRAFT; requires SHIPPED",
      "Allocation not completely picked and packed: 8",
      "Expired allocated batch: LOT-1",
      "Return quantity exceeds remaining returnable quantity for product 5. Remaining: 1.000",
      "Product 9 not found in this sales order",
    ];
    for (const message of samples) {
      const m = shipErrorMessage(message);
      expect(m, message).toBeDefined();
      expect(render(m!), message).toBe(shipErrorCopy(message));
    }
    expect(shipErrorMessage("Something unrelated")).toBeUndefined();
    expect(shipErrorCopy("Something unrelated")).toBeUndefined();
    expect(shipErrorMessage(undefined)).toBeUndefined();
  });

  it("every create-order and return-line validation message is keyed with unchanged English", () => {
    const messages = new Set<string>();
    const collect = (schema: { safeParse: (v: unknown) => { success: boolean; error?: { issues: { message: string }[] } } }, value: unknown) => {
      const r = schema.safeParse(value);
      for (const i of r.error?.issues ?? []) messages.add(i.message);
    };
    const line = (q: string, p: string) => ({ product_id: 0, quantity: q, unit_price: p });
    for (const [q, p] of [["", ""], ["abc", "x"], ["0", "0"], ["1.2345", "1.234"], ["-1", "-1"]]) {
      collect(createSalesOrderInput, { customer_id: 0, items: [line(q, p)] });
      collect(createPurchaseOrderInput, { supplier_id: 0, items: [line(q, p)] });
    }
    collect(createSalesOrderInput, { customer_id: 1, items: [] });
    collect(createSalesOrderInput, { customer_id: 1, items: [{ product_id: 1, quantity: "1", unit_price: "1" }, { product_id: 1, quantity: "1", unit_price: "1" }] });
    for (const q of ["abc", "0", "1.2345"]) collect(salesReturnLineInput, { product_id: 1, quantity: q });
    collect(salesReturnLineInput, { product_id: 1, quantity: "1", reason: "x".repeat(300) });
    expect(messages.size).toBeGreaterThan(12);
    for (const message of messages) {
      const m = formMessage(message);
      expect("key" in m, `unkeyed: ${message}`).toBe(true);
      expect(render(m), message).toBe(message);
    }
  });
});
