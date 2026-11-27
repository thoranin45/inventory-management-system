import { describe, expect, it } from "vitest";

import {
  addMoney,
  agingSchema,
  billingActions,
  newClientRequestId,
  receiptActions,
  receiptFormInput,
  toBillingPayload,
  toReceiptPayload,
} from "./payments";

const base = {
  customer_id: 3,
  received_date: "2026-11-27",
  method: "TRANSFER" as const,
  reference: "KBANK 1234",
  notes: "",
  lines: [
    { invoice_id: 5, balance: "761.26", amount: "500", wht_amount: "7.50", wht_certificate_no: "W-1" },
    { invoice_id: 6, balance: "100.00", amount: "", wht_amount: "", wht_certificate_no: "" },
  ],
};

describe("receipt form", () => {
  it("sends only invoices with an amount, blanks as 0 and the idempotency key", () => {
    const form = receiptFormInput.parse(base);
    expect(toReceiptPayload(form, "abcdef123456")).toEqual({
      customer_id: 3,
      received_date: "2026-11-27",
      method: "TRANSFER",
      reference: "KBANK 1234",
      notes: null,
      client_request_id: "abcdef123456",
      allocations: [{ invoice_id: 5, amount: "500", wht_amount: "7.50", wht_certificate_no: "W-1" }],
    });
  });

  it("refuses more than the balance (cash plus WHT) and an all-zero receipt", () => {
    const over = receiptFormInput.safeParse({ ...base, lines: [{ ...base.lines[0], amount: "760.00", wht_amount: "1.27" }] });
    expect(over.success).toBe(false);
    expect(over.error?.issues[0]).toMatchObject({ message: "More than the balance", path: ["lines", 0, "amount"] });
    const exact = receiptFormInput.safeParse({ ...base, lines: [{ ...base.lines[0], amount: "753.76", wht_amount: "7.50" }] });
    expect(exact.success).toBe(true);
    const none = receiptFormInput.safeParse({ ...base, lines: [{ ...base.lines[1] }] });
    expect(none.success).toBe(false);
    const bad = receiptFormInput.safeParse({ ...base, lines: [{ ...base.lines[0], amount: "1.234" }] });
    expect(bad.error?.issues[0].message).toBe("Enter an amount like 100.50");
  });

  it("adds money exactly and makes a key the backend accepts", () => {
    expect(addMoney("0.1", "0.2")).toBe("0.30");
    expect(addMoney("753.76", "7.5")).toBe("761.26");
    expect(newClientRequestId()).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
  });
});

describe("billing note and actions", () => {
  it("maps blank optional fields to null", () => {
    expect(toBillingPayload({ customer_id: 3, invoice_ids: [5, 6], payment_due_date: "", notes: "" })).toEqual({
      customer_id: 3, invoice_ids: [5, 6], payment_due_date: null, notes: null,
    });
  });

  it("only shows what each status allows", () => {
    expect(receiptActions("ISSUED")).toEqual({ void: true, pdf: true });
    expect(receiptActions("VOID").void).toBe(false);
    expect(billingActions("DRAFT")).toMatchObject({ edit: true, issue: true, remove: true, pdf: false, void: false });
    expect(billingActions("ISSUED")).toMatchObject({ edit: false, void: true, pdf: true });
  });

  it("parses the AR aging report", () => {
    const amounts = { not_due: "0.00", days_1_30: "10.00", days_31_60: "0.00", days_61_90: "0.00", days_over_90: "0.00", total: "10.00", invoice_count: 1 };
    const parsed = agingSchema.parse({
      as_of: "2026-11-27",
      buckets: ["not_due", "days_1_30", "days_31_60", "days_61_90", "days_over_90"],
      rows: [{ customer_id: 3, customer_name: "ร้านดี", oldest_due_date: "2026-11-01", ...amounts }],
      totals: amounts,
    });
    expect(parsed.rows[0].days_1_30).toBe("10.00");
  });
});
