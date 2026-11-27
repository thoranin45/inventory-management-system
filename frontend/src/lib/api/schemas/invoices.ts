import { z } from "zod";

import { apiEnvelope, decimalString, paginated } from "./common";

/**
 * F2b: invoices and internal adjustment notes. Mirrors app/services/invoice_service.py
 * (GET/POST/PUT/DELETE /invoices, /invoices/{id}/issue|void|pdf, /invoices/revenue-summary,
 * and the same set under /adjustment-notes). Totals always come from the server.
 */

/**
 * List filter tabs. "OVERDUE" is computed by the backend (ISSUED, unpaid and past due_date);
 * "OPEN" / "PAID" use the F3 `payment` filter instead of `status`.
 */
export const INVOICE_FILTER_TABS = ["all", "DRAFT", "ISSUED", "OPEN", "PAID", "OVERDUE", "VOID"] as const;
export type InvoiceFilterKey = (typeof INVOICE_FILTER_TABS)[number];
export const ADJUSTMENT_FILTER_TABS = ["all", "DRAFT", "ISSUED", "VOID"] as const;

const snapshotSchema = z.record(z.string(), z.union([z.string(), z.boolean(), z.number(), z.null()]));

export const invoiceRowSchema = z.object({
  id: z.number(),
  invoice_number: z.string().nullable(),
  status: z.string(),
  is_overdue: z.boolean(),
  sales_order_id: z.number(),
  sales_order_number: z.string().nullish(),
  customer_id: z.number(),
  customer_name: z.string().nullish(),
  issue_date: z.string().nullish(),
  due_date: z.string().nullish(),
  credit_days: z.number(),
  grand_total: decimalString,
  adjusted_total: decimalString,
  balance: decimalString,
  /** F3: UNPAID / PARTIAL / PAID for issued invoices, null otherwise. */
  payment_status: z.string().nullish(),
  paid_total: decimalString.optional(),
  created_at: z.string().nullish(),
  updated_at: z.string().nullish(),
});
export type InvoiceRow = z.infer<typeof invoiceRowSchema>;
export const invoiceListEnvelope = apiEnvelope(paginated(invoiceRowSchema));

export const invoiceItemSchema = z.object({
  id: z.number(),
  line_no: z.number(),
  product_id: z.number(),
  description: z.string(),
  quantity: decimalString,
  unit_price: decimalString,
  discount_amount: decimalString,
  line_total: decimalString,
  adjusted_amount: decimalString,
});
export type InvoiceItem = z.infer<typeof invoiceItemSchema>;

const returnReceiptSchema = z.object({
  id: z.number(),
  receipt_number: z.string(),
  returned_at: z.string().nullish(),
  items: z.array(
    z.object({
      invoice_item_id: z.number(),
      product_id: z.number(),
      returned_quantity: decimalString,
      adjusted_quantity: decimalString,
    }),
  ),
});
export type ReturnReceipt = z.infer<typeof returnReceiptSchema>;

export const invoiceDetailSchema = invoiceRowSchema.extend({
  quotation_id: z.number().nullish(),
  quotation_number: z.string().nullish(),
  notes: z.string().nullish(),
  customer_snapshot: snapshotSchema.nullish(),
  seller_snapshot: snapshotSchema.nullish(),
  subtotal: decimalString,
  discount_total: decimalString,
  vat_base: decimalString,
  vat_amount: decimalString,
  void_reason: z.string().nullish(),
  issued_at: z.string().nullish(),
  voided_at: z.string().nullish(),
  items: z.array(invoiceItemSchema),
  adjustments: z.array(
    z.object({
      id: z.number(),
      adjustment_number: z.string().nullable(),
      status: z.string(),
      grand_total: decimalString,
      issue_date: z.string().nullish(),
    }),
  ),
  return_receipts: z.array(returnReceiptSchema),
  payments: z
    .array(
      z.object({
        id: z.number(),
        receipt_number: z.string(),
        status: z.string(),
        received_date: z.string().nullish(),
        method: z.string(),
        amount: decimalString,
        wht_amount: decimalString,
      }),
    )
    .optional(),
  invoice_created: z.boolean().optional(),
});
export type InvoiceDetail = z.infer<typeof invoiceDetailSchema>;
export const invoiceDetailEnvelope = apiEnvelope(invoiceDetailSchema);
export const deletedEnvelope = apiEnvelope(z.object({ id: z.number(), deleted: z.boolean() }));

export const revenueSummarySchema = z.object({
  year: z.number(),
  invoiced_total: decimalString,
  adjusted_total: decimalString,
  net_revenue: decimalString,
  received_total: decimalString.optional(),
  vat_threshold: decimalString,
  threshold_percent: decimalString,
  level: z.enum(["ok", "warning", "over"]),
});
export type RevenueSummary = z.infer<typeof revenueSummarySchema>;
export const revenueSummaryEnvelope = apiEnvelope(revenueSummarySchema);

export const adjustmentRowSchema = z.object({
  id: z.number(),
  adjustment_number: z.string().nullable(),
  status: z.string(),
  invoice_id: z.number(),
  invoice_number: z.string().nullish(),
  customer_name: z.string().nullish(),
  sales_return_receipt_id: z.number().nullish(),
  reason: z.string(),
  issue_date: z.string().nullish(),
  grand_total: decimalString,
  created_at: z.string().nullish(),
  updated_at: z.string().nullish(),
});
export type AdjustmentRow = z.infer<typeof adjustmentRowSchema>;
export const adjustmentListEnvelope = apiEnvelope(paginated(adjustmentRowSchema));

export const adjustmentDetailSchema = adjustmentRowSchema.extend({
  sales_return_receipt_number: z.string().nullish(),
  customer_snapshot: snapshotSchema.nullish(),
  seller_snapshot: snapshotSchema.nullish(),
  subtotal: decimalString,
  vat_base: decimalString,
  vat_amount: decimalString,
  void_reason: z.string().nullish(),
  issued_at: z.string().nullish(),
  voided_at: z.string().nullish(),
  items: z.array(
    z.object({
      id: z.number(),
      line_no: z.number(),
      invoice_item_id: z.number(),
      description: z.string(),
      quantity: decimalString,
      unit_price: decimalString,
      line_total: decimalString,
    }),
  ),
});
export type AdjustmentDetail = z.infer<typeof adjustmentDetailSchema>;
export const adjustmentDetailEnvelope = apiEnvelope(adjustmentDetailSchema);

/* ---------------- draft forms ---------------- */

const MONEY_RE = /^\d{1,12}(\.\d{1,2})?$/;
const QTY_RE = /^\d{1,15}(\.\d{1,3})?$/;

export const invoiceDraftInput = z.object({
  credit_days: z.number({ error: "Enter a number of days" }).int().min(0, "0 or more").max(365, "365 or fewer"),
  notes: z.string().trim().max(2000, "Notes must be 2000 characters or fewer").optional(),
  items: z.array(
    z.object({
      line_no: z.number().int().min(1),
      discount_amount: z.string().trim().refine((v) => v === "" || MONEY_RE.test(v), "Enter an amount like 10.50"),
      description: z.string().trim().max(300, "Description must be 300 characters or fewer").optional(),
    }),
  ),
});
export type InvoiceDraftForm = z.infer<typeof invoiceDraftInput>;

/** PUT body: blank discount = 0, blank description = keep the current one. */
export function toInvoicePayload(form: InvoiceDraftForm) {
  return {
    credit_days: form.credit_days,
    notes: form.notes ? form.notes : null,
    items: form.items.map((i) => ({
      line_no: i.line_no,
      discount_amount: i.discount_amount === "" ? "0" : i.discount_amount,
      description: i.description ? i.description : null,
    })),
  };
}
export type InvoiceDraftPayload = ReturnType<typeof toInvoicePayload>;

export const adjustmentDraftInput = z.object({
  invoice_id: z.number().int().positive(),
  sales_return_receipt_id: z.number().int().positive().nullable(),
  reason: z.string().trim().min(1, "Enter a reason").max(500, "Reason must be 500 characters or fewer"),
  items: z
    .array(
      z.object({
        invoice_item_id: z.number().int().positive("Choose a line"),
        quantity: z.string().trim().refine((v) => QTY_RE.test(v) && Number(v) > 0, "Enter a quantity above 0"),
        unit_price: z.string().trim().refine((v) => MONEY_RE.test(v) && Number(v) > 0, "Enter an amount above 0"),
        description: z.string().trim().max(300, "Description must be 300 characters or fewer").optional(),
      }),
    )
    .min(1, "Add at least one line")
    .refine(
      (items) => new Set(items.map((i) => i.invoice_item_id)).size === items.length,
      "The same invoice line appears more than once",
    ),
});
export type AdjustmentDraftForm = z.infer<typeof adjustmentDraftInput>;

export function toAdjustmentPayload(form: AdjustmentDraftForm) {
  return {
    invoice_id: form.invoice_id,
    sales_return_receipt_id: form.sales_return_receipt_id,
    reason: form.reason,
    items: form.items.map((i) => ({
      invoice_item_id: i.invoice_item_id,
      quantity: i.quantity,
      unit_price: i.unit_price,
      description: i.description ? i.description : null,
    })),
  };
}
export type AdjustmentDraftPayload = ReturnType<typeof toAdjustmentPayload>;

/** What each status allows (backend is authoritative; this only decides what to show). */
export function invoiceActions(status: string, hasIssuedAdjustment: boolean, hasIssuedReceipt = false, balanceLeft = true) {
  const s = status.toUpperCase();
  return {
    edit: s === "DRAFT",
    remove: s === "DRAFT",
    issue: s === "DRAFT",
    void: s === "ISSUED" && !hasIssuedAdjustment && !hasIssuedReceipt,
    adjust: s === "ISSUED" && balanceLeft,
    pay: s === "ISSUED" && balanceLeft,
    pdf: s !== "DRAFT",
  };
}

export function adjustmentActions(status: string) {
  const s = status.toUpperCase();
  return { edit: s === "DRAFT", remove: s === "DRAFT", issue: s === "DRAFT", void: s === "ISSUED", pdf: s !== "DRAFT" };
}
