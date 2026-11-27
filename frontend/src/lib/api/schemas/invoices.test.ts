import { describe, expect, it } from "vitest";

import { discountedLinePreview } from "@/components/invoices/invoice-detail";
import { lineRemaining, netUnitPrice } from "@/components/invoices/adjustment-form";
import { businessYear } from "@/components/invoices/revenue-card";
import {
  adjustmentActions,
  adjustmentDraftInput,
  invoiceActions,
  invoiceDraftInput,
  invoiceRowSchema,
  toAdjustmentPayload,
  toInvoicePayload,
} from "./invoices";

const line = { invoice_item_id: 1, quantity: "1.500", unit_price: "10.00", description: "" };

describe("invoice schemas", () => {
  it("parses a list row with decimal strings", () => {
    const row = invoiceRowSchema.parse({
      id: 1, invoice_number: "INV-2026-0001", status: "ISSUED", is_overdue: true, sales_order_id: 4,
      customer_id: 2, credit_days: 30, grand_total: "100.00", adjusted_total: "0.00", balance: "100.00",
    });
    expect(row.is_overdue).toBe(true);
  });

  it("draft form: credit days 0..365, discount blank or money", () => {
    const ok = invoiceDraftInput.safeParse({ credit_days: 0, notes: "", items: [{ line_no: 1, discount_amount: "" }] });
    expect(ok.success).toBe(true);
    expect(invoiceDraftInput.safeParse({ credit_days: 366, items: [] }).success).toBe(false);
    expect(invoiceDraftInput.safeParse({ credit_days: Number.NaN, items: [] }).success).toBe(false);
    expect(invoiceDraftInput.safeParse({ credit_days: 30, items: [{ line_no: 1, discount_amount: "1.234" }] }).success).toBe(false);
  });

  it("invoice payload: blank discount is 0 and blank description keeps the current one", () => {
    expect(
      toInvoicePayload({ credit_days: 15, notes: "", items: [{ line_no: 2, discount_amount: "", description: "" }] }),
    ).toEqual({ credit_days: 15, notes: null, items: [{ line_no: 2, discount_amount: "0", description: null }] });
  });

  it("adjustment form needs a reason, a line, positive amounts and no duplicate lines", () => {
    const base = { invoice_id: 9, sales_return_receipt_id: null, reason: "price fix", items: [line] };
    expect(adjustmentDraftInput.safeParse(base).success).toBe(true);
    expect(adjustmentDraftInput.safeParse({ ...base, reason: " " }).success).toBe(false);
    expect(adjustmentDraftInput.safeParse({ ...base, items: [] }).success).toBe(false);
    expect(adjustmentDraftInput.safeParse({ ...base, items: [{ ...line, invoice_item_id: 0 }] }).success).toBe(false);
    expect(adjustmentDraftInput.safeParse({ ...base, items: [{ ...line, quantity: "0" }] }).success).toBe(false);
    expect(adjustmentDraftInput.safeParse({ ...base, items: [{ ...line, unit_price: "0.00" }] }).success).toBe(false);
    expect(adjustmentDraftInput.safeParse({ ...base, items: [line, line] }).success).toBe(false);
    expect(toAdjustmentPayload(base).items[0].description).toBeNull();
  });

  it("actions follow status; void is blocked while an issued adjustment exists", () => {
    expect(invoiceActions("DRAFT", false)).toMatchObject({ edit: true, issue: true, remove: true, pdf: false, void: false });
    expect(invoiceActions("ISSUED", false)).toMatchObject({ edit: false, void: true, adjust: true, pdf: true });
    expect(invoiceActions("ISSUED", true).void).toBe(false);
    expect(invoiceActions("VOID", false)).toMatchObject({ void: false, adjust: false, pdf: true });
    expect(adjustmentActions("ISSUED")).toMatchObject({ void: true, edit: false, pdf: true });
  });
});

describe("previews", () => {
  it("line after discount, half up per line", () => {
    expect(discountedLinePreview("1.125", "10.01", "")).toBe("11.260");
    expect(discountedLinePreview("2", "100", "15.50")).toBe("184.500");
    expect(discountedLinePreview("2", "100", "abc")).toBe("200.000");
  });

  it("net unit price rounds down so qty x price never exceeds the line", () => {
    expect(netUnitPrice({ quantity: "3.000", line_total: "100.00" })).toBe("33.33");
    expect(netUnitPrice({ quantity: "0", line_total: "100.00" })).toBe("");
    expect(lineRemaining({ line_total: "100.00", adjusted_amount: "33.33" })).toBe("66.67");
  });

  it("business year is Bangkok time", () => {
    expect(businessYear(new Date("2026-12-31T17:30:00Z"))).toBe(2027);
    expect(businessYear(new Date("2026-12-31T16:30:00Z"))).toBe(2026);
  });
});
