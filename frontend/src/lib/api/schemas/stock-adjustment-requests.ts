import { z } from "zod";

import { apiEnvelope, decimalString, paginated } from "./common";

/**
 * Phase 14B — Stock Adjustment Request & Approval.
 *
 * Replaces the retired direct POST /stock/adjust. Warehouse submits a
 * request (never mutates stock); only Admin may approve or reject it.
 * CREATE and APPROVE both require an Idempotency-Key — CREATE for the same
 * lost-response/reload-recovery reason Stock In/Out's Save-once session
 * has one, APPROVE because it is the one step that actually mutates stock
 * (mirrors PO/Transfer receive's mandatory-key precedent).
 */

export const REASON_CODES = [
  "CYCLE_COUNT_VARIANCE",
  "DAMAGE",
  "LOSS_THEFT",
  "SYSTEM_ERROR_CORRECTION",
  "OTHER",
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

export const REASON_LABELS: Record<ReasonCode, { labelTh: string; label: string }> = {
  CYCLE_COUNT_VARIANCE: { labelTh: "นับสต๊อกไม่ตรง", label: "Cycle count variance" },
  DAMAGE: { labelTh: "สินค้าเสียหาย", label: "Damage" },
  LOSS_THEFT: { labelTh: "สูญหาย/ถูกขโมย", label: "Loss or theft" },
  SYSTEM_ERROR_CORRECTION: { labelTh: "แก้ไขข้อผิดพลาดระบบ", label: "System error correction" },
  OTHER: { labelTh: "อื่นๆ", label: "Other (note required)" },
};

/* ------------------------------------------------------------- inputs ------ */

const qtyInput = z
  .string()
  .trim()
  .regex(/^\d+(\.\d+)?$/, "Quantity must be a number")
  .refine((v) => (v.split(".")[1]?.length ?? 0) <= 3, "At most 3 decimal places");

export const createAdjustmentRequestInput = z
  .object({
    product_id: z.number().int().positive("Choose a product first"),
    observed_quantity: qtyInput,
    requested_quantity: qtyInput,
    reason_code: z.enum(REASON_CODES),
    notes: z.string().trim().max(500, "Keep the note under 500 characters").optional(),
  })
  .refine((v) => v.reason_code !== "OTHER" || !!v.notes, {
    message: "A note is required when the reason is Other",
    path: ["notes"],
  });
export type CreateAdjustmentRequestInput = z.infer<typeof createAdjustmentRequestInput>;

export interface CreateAdjustmentRequestBody {
  product_id: number;
  observed_quantity: string;
  requested_quantity: string;
  reason_code: ReasonCode;
  notes?: string;
}

/** `null` until the form is genuinely submittable. */
export function buildCreateAdjustmentRequestBody(
  draft: Partial<CreateAdjustmentRequestInput> | null,
): CreateAdjustmentRequestBody | null {
  if (!draft) return null;
  const parsed = createAdjustmentRequestInput.safeParse(draft);
  if (!parsed.success) return null;
  const v = parsed.data;
  return {
    product_id: v.product_id,
    observed_quantity: v.observed_quantity,
    requested_quantity: v.requested_quantity,
    reason_code: v.reason_code,
    ...(v.notes ? { notes: v.notes } : {}),
  };
}

/* ------------------------------------------------------------ responses --- */

const refSchema = z.object({ id: z.number() }).passthrough();

export const adjustmentRequestHistoryEntrySchema = z.object({
  action: z.string(),
  actor: z.string(),
  at: z.string(),
  detail: z.string(),
});

export const adjustmentRequestDetailSchema = z.object({
  id: z.number(),
  reference_number: z.string().nullable(),
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "CANCELLED"]),
  product: refSchema.extend({ sku: z.string(), product_name: z.string() }),
  warehouse: refSchema.extend({ warehouse_code: z.string(), warehouse_name: z.string() }),
  location: refSchema.extend({ location_code: z.string(), location_name: z.string().nullable() }),
  observed_quantity: decimalString,
  requested_quantity: decimalString,
  reason_code: z.string(),
  notes: z.string().nullable(),
  requested_by: refSchema.extend({ username: z.string() }),
  reviewed_by: refSchema.extend({ username: z.string() }).nullable(),
  rejection_reason: z.string().nullable(),
  created_at: z.string(),
  reviewed_at: z.string().nullable(),
  completed_at: z.string().nullable(),
  history: z.array(adjustmentRequestHistoryEntrySchema),
  // Phase 14C (D7): request -> StockTransaction link; served only to requester/admin.
  stock_transaction_id: z.number().nullable().optional(),
});
export type AdjustmentRequestDetail = z.infer<typeof adjustmentRequestDetailSchema>;
export const adjustmentRequestDetailEnvelope = apiEnvelope(adjustmentRequestDetailSchema);

export const ADJUSTMENT_REQUEST_FILTER_TABS = [
  { key: "PENDING", label: "Pending", status: "PENDING" as string | null },
  { key: "all", label: "All", status: null as string | null },
  { key: "APPROVED", label: "Approved", status: "APPROVED" },
  { key: "REJECTED", label: "Rejected", status: "REJECTED" },
  { key: "CANCELLED", label: "Cancelled", status: "CANCELLED" },
] as const;

export const adjustmentRequestRowSchema = z.object({
  id: z.number(),
  reference_number: z.string().nullable(),
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "CANCELLED"]),
  product_id: z.number(),
  warehouse_id: z.number(),
  location_id: z.number(),
  observed_quantity: decimalString,
  requested_quantity: decimalString,
  reason_code: z.string(),
  requested_by_user_id: z.number(),
  created_at: z.string(),
});
export type AdjustmentRequestRow = z.infer<typeof adjustmentRequestRowSchema>;
export const adjustmentRequestListEnvelope = apiEnvelope(paginated(adjustmentRequestRowSchema));
export type AdjustmentRequestListEnvelope = z.infer<typeof adjustmentRequestListEnvelope>;

/* -------------------------------------------------------- error copy ------ */

export const ADJUSTMENT_REQUEST_ERROR_COPY: Record<string, string> = {
  "Product not found": "That product is no longer active. Nothing was submitted.",
  "System transit storage is not operationally selectable": "This correction can't target transit storage.",
  "Direct stock adjustment is retired; submit a stock adjustment request instead (POST /stock-adjustment-requests)":
    "Direct adjustment is retired — submit a request instead.",
};

export function approveRejectErrorCopy(message: string): string {
  if (message.startsWith("Someone already changed this balance")) {
    return `${message} Refresh this request to see the current balance before deciding again.`;
  }
  if (message.startsWith("This request was already decided")) {
    return message;
  }
  if (message === "You cannot approve a request you submitted yourself") {
    return "You can't approve your own request — ask another admin to review it.";
  }
  if (message === "Batch-tracked products cannot be adjusted directly — receive via POST /batches or issue via /stock/out-fefo / /stock/out-fifo instead") {
    return "This product became batch-tracked after the request was submitted and can no longer be approved this way.";
  }
  return message;
}
