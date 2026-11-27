import { z } from "zod";

import { compareDecimals } from "@/lib/decimal";
import { apiEnvelope, decimalString, paginated } from "./common";

/**
 * F3b: payment receipts, billing notes and AR aging. Mirrors app/services/payment_service.py
 * (/payment-receipts, /billing-notes, /invoices/ar-aging). Totals and balances always come
 * from the server; the forms only send amounts per invoice.
 */

export const PAYMENT_METHODS = ["CASH", "TRANSFER", "CHEQUE", "OTHER"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const RECEIPT_FILTER_TABS = ["all", "ISSUED", "VOID"] as const;
export const BILLING_FILTER_TABS = ["all", "DRAFT", "ISSUED", "VOID"] as const;
export const AGING_BUCKETS = ["not_due", "days_1_30", "days_31_60", "days_61_90", "days_over_90"] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

const snapshotSchema = z.record(z.string(), z.union([z.string(), z.boolean(), z.number(), z.null()]));

/* ---------------- receipts ---------------- */

export const receiptRowSchema = z.object({
  id: z.number(),
  receipt_number: z.string(),
  status: z.string(),
  customer_id: z.number(),
  customer_name: z.string().nullish(),
  received_date: z.string().nullish(),
  method: z.string(),
  reference: z.string().nullish(),
  amount_total: decimalString,
  wht_total: decimalString,
  settled_total: decimalString,
  created_at: z.string().nullish(),
});
export type ReceiptRow = z.infer<typeof receiptRowSchema>;
export const receiptListEnvelope = apiEnvelope(paginated(receiptRowSchema));

export const receiptDetailSchema = receiptRowSchema.extend({
  notes: z.string().nullish(),
  customer_snapshot: snapshotSchema.nullish(),
  seller_snapshot: snapshotSchema.nullish(),
  void_reason: z.string().nullish(),
  voided_at: z.string().nullish(),
  allocations: z.array(
    z.object({
      id: z.number(),
      line_no: z.number(),
      invoice_id: z.number(),
      invoice_number: z.string().nullish(),
      invoice_issue_date: z.string().nullish(),
      invoice_total: decimalString.nullish(),
      amount: decimalString,
      wht_amount: decimalString,
      wht_certificate_no: z.string().nullish(),
    }),
  ),
  receipt_created: z.boolean().optional(),
});
export type ReceiptDetail = z.infer<typeof receiptDetailSchema>;
export const receiptDetailEnvelope = apiEnvelope(receiptDetailSchema);

/* ---------------- billing notes ---------------- */

export const billingRowSchema = z.object({
  id: z.number(),
  billing_number: z.string().nullable(),
  status: z.string(),
  customer_id: z.number(),
  customer_name: z.string().nullish(),
  issue_date: z.string().nullish(),
  payment_due_date: z.string().nullish(),
  total_amount: decimalString,
  invoice_count: z.number(),
  created_at: z.string().nullish(),
  updated_at: z.string().nullish(),
});
export type BillingRow = z.infer<typeof billingRowSchema>;
export const billingListEnvelope = apiEnvelope(paginated(billingRowSchema));

export const billingDetailSchema = billingRowSchema.extend({
  notes: z.string().nullish(),
  customer_snapshot: snapshotSchema.nullish(),
  seller_snapshot: snapshotSchema.nullish(),
  void_reason: z.string().nullish(),
  issued_at: z.string().nullish(),
  voided_at: z.string().nullish(),
  items: z.array(
    z.object({
      id: z.number(),
      line_no: z.number(),
      invoice_id: z.number(),
      invoice_number: z.string().nullish(),
      invoice_status: z.string().nullish(),
      issue_date: z.string().nullish(),
      due_date: z.string().nullish(),
      invoice_total: decimalString.nullish(),
      amount: decimalString,
      current_balance: decimalString.nullish(),
    }),
  ),
});
export type BillingDetail = z.infer<typeof billingDetailSchema>;
export const billingDetailEnvelope = apiEnvelope(billingDetailSchema);

/* ---------------- AR aging ---------------- */

const agingAmounts = {
  not_due: decimalString,
  days_1_30: decimalString,
  days_31_60: decimalString,
  days_61_90: decimalString,
  days_over_90: decimalString,
  total: decimalString,
  invoice_count: z.number(),
};
export const agingSchema = z.object({
  as_of: z.string(),
  buckets: z.array(z.string()),
  rows: z.array(
    z.object({
      customer_id: z.number(),
      customer_name: z.string().nullish(),
      oldest_due_date: z.string().nullish(),
      ...agingAmounts,
    }),
  ),
  totals: z.object(agingAmounts),
});
export type ArAging = z.infer<typeof agingSchema>;
export const agingEnvelope = apiEnvelope(agingSchema);

/* ---------------- forms ---------------- */

const MONEY_RE = /^\d{1,12}(\.\d{1,2})?$/;
const money = (v: string) => (v.trim() === "" ? "0" : v.trim());
const validMoney = (v: string) => v.trim() === "" || MONEY_RE.test(v.trim());

/**
 * Record-payment form. Each open invoice of the customer is a row; rows left at 0 are
 * dropped from the payload. `balance` is the server's figure, used only to warn early.
 */
export const receiptFormInput = z
  .object({
    customer_id: z.number().int().positive("Choose a customer"),
    received_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a date"),
    method: z.enum(PAYMENT_METHODS),
    reference: z.string().trim().max(100, "Reference must be 100 characters or fewer").optional(),
    notes: z.string().trim().max(2000, "Notes must be 2000 characters or fewer").optional(),
    lines: z.array(
      z
        .object({
          invoice_id: z.number().int().positive(),
          balance: z.string(),
          amount: z.string().refine(validMoney, "Enter an amount like 100.50"),
          wht_amount: z.string().refine(validMoney, "Enter an amount like 100.50"),
          wht_certificate_no: z.string().trim().max(50, "Certificate number must be 50 characters or fewer").optional(),
        })
        .refine(
          (l) =>
            !validMoney(l.amount) ||
            !validMoney(l.wht_amount) ||
            compareDecimals(addMoney(money(l.amount), money(l.wht_amount)), l.balance) <= 0,
          { message: "More than the balance", path: ["amount"] },
        ),
    ),
  })
  .refine((f) => f.lines.some((l) => validMoney(l.amount) && validMoney(l.wht_amount) && Number(money(l.amount)) + Number(money(l.wht_amount)) > 0), {
    message: "Enter an amount for at least one invoice",
    path: ["lines"],
  });
export type ReceiptForm = z.infer<typeof receiptFormInput>;

/** Exact 2-dp addition without floats. */
export function addMoney(a: string, b: string): string {
  const cents = (v: string) => {
    const [i, f = ""] = v.split(".");
    return BigInt(i || "0") * 100n + BigInt((f + "00").slice(0, 2));
  };
  const c = cents(a) + cents(b);
  return `${c / 100n}.${String(c % 100n).padStart(2, "0")}`;
}

export function toReceiptPayload(form: ReceiptForm, clientRequestId: string) {
  return {
    customer_id: form.customer_id,
    received_date: form.received_date,
    method: form.method,
    reference: form.reference ? form.reference : null,
    notes: form.notes ? form.notes : null,
    client_request_id: clientRequestId,
    allocations: form.lines
      .filter((l) => Number(money(l.amount)) + Number(money(l.wht_amount)) > 0)
      .map((l) => ({
        invoice_id: l.invoice_id,
        amount: money(l.amount),
        wht_amount: money(l.wht_amount),
        wht_certificate_no: l.wht_certificate_no ? l.wht_certificate_no : null,
      })),
  };
}
export type ReceiptPayload = ReturnType<typeof toReceiptPayload>;

export const billingFormInput = z.object({
  customer_id: z.number().int().positive("Choose a customer"),
  invoice_ids: z.array(z.number().int().positive()).min(1, "Choose at least one invoice"),
  payment_due_date: z.string().refine((v) => v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v), "Enter a date").optional(),
  notes: z.string().trim().max(2000, "Notes must be 2000 characters or fewer").optional(),
});
export type BillingForm = z.infer<typeof billingFormInput>;

export function toBillingPayload(form: BillingForm) {
  return {
    customer_id: form.customer_id,
    invoice_ids: form.invoice_ids,
    payment_due_date: form.payment_due_date ? form.payment_due_date : null,
    notes: form.notes ? form.notes : null,
  };
}
export type BillingPayload = ReturnType<typeof toBillingPayload>;

/** What each status allows (backend is authoritative; this only decides what to show). */
export function receiptActions(status: string) {
  return { void: status.toUpperCase() === "ISSUED", pdf: true };
}

export function billingActions(status: string) {
  const s = status.toUpperCase();
  return { edit: s === "DRAFT", remove: s === "DRAFT", issue: s === "DRAFT", void: s === "ISSUED", pdf: s !== "DRAFT" };
}

/** A fresh idempotency key for one record-payment form. */
export function newClientRequestId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID().replace(/-/g, "");
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}
