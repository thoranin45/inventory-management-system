import { z } from "zod";

import { apiEnvelope, decimalString, paginated } from "./common";
import { salesOrderLineInput } from "./sales";

/**
 * F1b: quotations (GET/POST/PUT/DELETE /quotations, POST /quotations/{id}/<action>,
 * GET /quotations/{id}/pdf). Mirrors app/services/quotation_service.py.
 * Totals always come from the server; the form only previews them.
 */

export const QUOTATION_STATUSES = ["DRAFT", "ISSUED", "ACCEPTED", "REJECTED", "VOID", "CONVERTED"] as const;
export type QuotationStatus = (typeof QUOTATION_STATUSES)[number];

/** List filter tabs. "EXPIRED" is computed by the backend (ISSUED and past valid_until). */
export const QUOTATION_FILTER_TABS = ["all", "DRAFT", "ISSUED", "EXPIRED", "ACCEPTED", "CONVERTED", "REJECTED", "VOID"] as const;
export type QuotationFilterKey = (typeof QUOTATION_FILTER_TABS)[number];

export const quotationRowSchema = z.object({
  id: z.number(),
  quotation_number: z.string().nullable(),
  status: z.string(),
  is_expired: z.boolean(),
  customer_id: z.number(),
  customer_name: z.string().nullish(),
  issue_date: z.string().nullish(),
  valid_until: z.string().nullish(),
  grand_total: decimalString,
  sales_order_id: z.number().nullish(),
  created_at: z.string().nullish(),
  updated_at: z.string().nullish(),
});
export type QuotationRow = z.infer<typeof quotationRowSchema>;
export const quotationListEnvelope = apiEnvelope(paginated(quotationRowSchema));

const snapshotSchema = z.record(z.string(), z.union([z.string(), z.boolean(), z.number(), z.null()]));

export const quotationItemSchema = z.object({
  id: z.number(),
  line_no: z.number(),
  product_id: z.number(),
  description: z.string(),
  quantity: decimalString,
  unit_price: decimalString,
  line_total: decimalString,
});
export type QuotationItem = z.infer<typeof quotationItemSchema>;

export const quotationDetailSchema = quotationRowSchema.extend({
  notes: z.string().nullish(),
  customer_snapshot: snapshotSchema.nullish(),
  seller_snapshot: snapshotSchema.nullish(),
  subtotal: decimalString,
  vat_base: decimalString,
  vat_amount: decimalString,
  sales_order_number: z.string().nullish(),
  revision_of_id: z.number().nullish(),
  revised_by_id: z.number().nullish(),
  void_reason: z.string().nullish(),
  issued_at: z.string().nullish(),
  decided_at: z.string().nullish(),
  voided_at: z.string().nullish(),
  converted_at: z.string().nullish(),
  items: z.array(quotationItemSchema),
  sales_order_created: z.boolean().optional(),
});
export type QuotationDetail = z.infer<typeof quotationDetailSchema>;
export const quotationDetailEnvelope = apiEnvelope(quotationDetailSchema);

export const quotationDeletedEnvelope = apiEnvelope(z.object({ id: z.number(), deleted: z.boolean() }));

/* ---------------- draft form (POST / PUT) ---------------- */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const quotationLineInput = salesOrderLineInput.extend({
  description: z.string().trim().max(300, "Description must be 300 characters or fewer").optional(),
});

export const quotationDraftInput = z.object({
  customer_id: z.number().int().positive("Choose a customer"),
  valid_until: z
    .string()
    .trim()
    .refine((v) => v === "" || DATE_RE.test(v), "Enter a date")
    .optional(),
  notes: z.string().trim().max(2000, "Notes must be 2000 characters or fewer").optional(),
  items: z
    .array(quotationLineInput)
    .min(1, "Add at least one product line")
    .max(200, "A quotation can have at most 200 lines")
    .refine(
      (items) => new Set(items.map((i) => i.product_id)).size === items.length,
      "The same product appears on more than one line",
    ),
});
export type QuotationDraftForm = z.infer<typeof quotationDraftInput>;

/** The JSON body the backend expects: blanks become null, totals are never sent. */
export function toDraftPayload(form: QuotationDraftForm) {
  return {
    customer_id: form.customer_id,
    valid_until: form.valid_until ? form.valid_until : null,
    notes: form.notes ? form.notes : null,
    items: form.items.map((i) => ({
      product_id: i.product_id,
      quantity: i.quantity,
      unit_price: i.unit_price,
      description: i.description ? i.description : null,
    })),
  };
}
export type QuotationDraftPayload = ReturnType<typeof toDraftPayload>;

/** Which actions each status allows (backend is authoritative; this only decides what to show). */
export function quotationActions(status: string, isExpired: boolean) {
  const s = status.toUpperCase();
  return {
    edit: s === "DRAFT",
    remove: s === "DRAFT",
    issue: s === "DRAFT",
    accept: s === "ISSUED" && !isExpired,
    reject: s === "ISSUED",
    void: s === "ISSUED" || s === "ACCEPTED",
    revise: s === "ISSUED" || s === "ACCEPTED" || s === "REJECTED",
    convert: s === "ACCEPTED",
    pdf: s !== "DRAFT",
  };
}
