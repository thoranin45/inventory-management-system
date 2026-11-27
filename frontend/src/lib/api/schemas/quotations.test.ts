import { describe, expect, it } from "vitest";

import { roundHalfUp } from "@/lib/decimal";
import { quotationActions, quotationDetailSchema, quotationDraftInput, toDraftPayload } from "./quotations";

describe("roundHalfUp (backend ROUND_HALF_UP for money)", () => {
  it.each([
    ["11.26125", "11.26"],
    ["0.005", "0.01"],
    ["0.004", "0.00"],
    ["2.675", "2.68"],
    ["750", "750.00"],
    ["1.5", "1.50"],
    ["-1.005", "-1.01"],
    ["abc", "0.00"],
  ])("%s -> %s", (input, expected) => {
    expect(roundHalfUp(input, 2)).toBe(expected);
  });
});

describe("quotation draft form", () => {
  const base = {
    customer_id: 3,
    valid_until: "",
    notes: "  ",
    items: [{ product_id: 7, quantity: "1.125", unit_price: "10.01", description: "" }],
  };

  it("sends blanks as null and never sends totals", () => {
    const parsed = quotationDraftInput.parse(base);
    expect(toDraftPayload(parsed)).toEqual({
      customer_id: 3,
      valid_until: null,
      notes: null,
      items: [{ product_id: 7, quantity: "1.125", unit_price: "10.01", description: null }],
    });
  });

  it.each([
    [{ ...base, customer_id: 0 }, "Choose a customer"],
    [{ ...base, items: [] }, "Add at least one product line"],
    [{ ...base, items: [base.items[0], base.items[0]] }, "The same product appears on more than one line"],
    [{ ...base, valid_until: "27/11/2026" }, "Enter a date"],
    [{ ...base, items: [{ ...base.items[0], unit_price: "0" }] }, "Unit price must be greater than 0"],
    [{ ...base, items: [{ ...base.items[0], quantity: "1.0001" }] }, "Quantity allows at most 3 decimal places"],
  ])("rejects %#", (input, message) => {
    const result = quotationDraftInput.safeParse(input);
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.message)).toContain(message);
  });
});

describe("quotationActions", () => {
  it("offers only what the backend allows for each status", () => {
    expect(quotationActions("DRAFT", false)).toMatchObject({ edit: true, issue: true, remove: true, pdf: false, convert: false });
    expect(quotationActions("ISSUED", false)).toMatchObject({ accept: true, reject: true, void: true, revise: true, pdf: true, edit: false });
    expect(quotationActions("ISSUED", true)).toMatchObject({ accept: false, reject: true, revise: true });
    expect(quotationActions("ACCEPTED", false)).toMatchObject({ convert: true, void: true, revise: true, accept: false });
    expect(quotationActions("REJECTED", false)).toMatchObject({ revise: true, void: false, convert: false });
    const none = { edit: false, remove: false, issue: false, accept: false, reject: false, void: false, revise: false, convert: false };
    expect(quotationActions("VOID", false)).toEqual({ ...none, pdf: true });
    expect(quotationActions("CONVERTED", false)).toEqual({ ...none, pdf: true });
  });
});

describe("quotationDetailSchema", () => {
  it("parses the backend detail payload", () => {
    const detail = quotationDetailSchema.parse({
      id: 1, quotation_number: "QT-2026-0001", status: "ISSUED", is_expired: false, customer_id: 3,
      customer_name: "ลูกค้า", issue_date: "2026-11-27", valid_until: "2026-12-27", grand_total: "761.26",
      sales_order_id: null, created_at: "2026-11-27T01:00:00+00:00", updated_at: "2026-11-27T01:00:00+00:00",
      notes: null, customer_snapshot: { name: "ลูกค้า", tax_id: null }, seller_snapshot: { vat_registered: false, vat_rate: "7.00" },
      subtotal: "761.26", vat_base: "761.26", vat_amount: "0.00", sales_order_number: null, revision_of_id: null,
      revised_by_id: null, void_reason: null, issued_at: null, decided_at: null, voided_at: null, converted_at: null,
      items: [{ id: 1, line_no: 1, product_id: 7, description: "น้ำดื่ม", quantity: "1.125", unit_price: "10.01", line_total: "11.26" }],
    });
    expect(detail.items[0].line_total).toBe("11.26");
  });
});
