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

/** Reasons offered for a NON-batch product (unchanged since Phase 14B). */
export const REASON_CODES = [
  "CYCLE_COUNT_VARIANCE",
  "DAMAGE",
  "LOSS_THEFT",
  "SYSTEM_ERROR_CORRECTION",
  "OTHER",
] as const;

/** Phase 14D — reasons offered for a batch (exact lot) adjustment. */
export const BATCH_REASON_CODES = [...REASON_CODES, "EXPIRY_WRITE_OFF"] as const;
export type ReasonCode = (typeof BATCH_REASON_CODES)[number];

export const REASON_LABELS: Record<ReasonCode, { labelTh: string; label: string }> = {
  CYCLE_COUNT_VARIANCE: { labelTh: "นับสต๊อกไม่ตรง", label: "Cycle count variance" },
  DAMAGE: { labelTh: "สินค้าเสียหาย", label: "Damage" },
  LOSS_THEFT: { labelTh: "สูญหาย/ถูกขโมย", label: "Loss or theft" },
  SYSTEM_ERROR_CORRECTION: { labelTh: "แก้ไขข้อผิดพลาดระบบ", label: "System error correction" },
  OTHER: { labelTh: "อื่นๆ", label: "Other (note required)" },
  EXPIRY_WRITE_OFF: { labelTh: "ตัดจำหน่ายสินค้าหมดอายุ", label: "Expiry write-off (expired lot)" },
};

/**
 * Phase 14D (D4/D5) — the backend's batch-only reason rules, mirrored for
 * instant feedback (the backend stays authoritative). Non-batch requests are
 * never subject to these. Returns a message, or null when the batch
 * request is allowed.
 */
export const BATCH_DECREASE_ONLY_REASONS: ReadonlySet<ReasonCode> = new Set(["DAMAGE", "LOSS_THEFT", "EXPIRY_WRITE_OFF"]);

export function batchReasonError(input: {
  reasonCode: ReasonCode;
  observed: string;
  requested: string;
  isExpired: boolean;
}): string | null {
  if (input.reasonCode === "EXPIRY_WRITE_OFF" && !input.isExpired) {
    return "Expiry write-off is only for a lot whose expiry date is before today (Asia/Bangkok).";
  }
  if (BATCH_DECREASE_ONLY_REASONS.has(input.reasonCode) && input.observed !== "" && input.requested !== "") {
    if (compareQty(input.requested, input.observed) >= 0) {
      return `${REASON_LABELS[input.reasonCode].label} must lower the quantity: requested must be below observed.`;
    }
  }
  return null;
}

/** String-exact decimal comparison (no float): -1, 0 or 1. */
export function compareQty(a: string, b: string): number {
  const scale = (v: string) => {
    const [i, f = ""] = v.trim().split(".");
    return BigInt((i || "0") + (f + "000").slice(0, 3));
  };
  const x = scale(a);
  const y = scale(b);
  return x === y ? 0 : x < y ? -1 : 1;
}

/* ------------------------------------------------------------- inputs ------ */

const qtyInput = z
  .string()
  .trim()
  .regex(/^\d+(\.\d+)?$/, "Quantity must be a number")
  .refine((v) => (v.split(".")[1]?.length ?? 0) <= 3, "At most 3 decimal places");

export const createAdjustmentRequestInput = z
  .object({
    product_id: z.number().int().positive("Choose a product first"),
    // Phase 14D: an exact (warehouse, location, batch) balance. Omitted for
    // a non-batch product, which keeps the default-storage behavior.
    warehouse_id: z.number().int().positive().optional(),
    location_id: z.number().int().positive().optional(),
    batch_id: z.number().int().positive().optional(),
    observed_quantity: qtyInput,
    requested_quantity: qtyInput,
    reason_code: z.enum(BATCH_REASON_CODES),
    notes: z.string().trim().max(500, "Keep the note under 500 characters").optional(),
  })
  .refine((v) => v.reason_code !== "OTHER" || !!v.notes, {
    message: "A note is required when the reason is Other",
    path: ["notes"],
  })
  .refine((v) => v.reason_code !== "EXPIRY_WRITE_OFF" || v.batch_id !== undefined, {
    message: "Expiry write-off needs a specific lot",
    path: ["batch_id"],
  });
export type CreateAdjustmentRequestInput = z.infer<typeof createAdjustmentRequestInput>;

export interface CreateAdjustmentRequestBody {
  product_id: number;
  warehouse_id?: number;
  location_id?: number;
  batch_id?: number;
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
    // Only sent for a batch request, so a non-batch body (and its
    // idempotency fingerprint) stays exactly as before Phase 14D.
    ...(v.batch_id !== undefined
      ? { warehouse_id: v.warehouse_id, location_id: v.location_id, batch_id: v.batch_id }
      : {}),
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
  // Phase 14D (additive; absent on pre-14D replay snapshots).
  batch: z
    .object({ id: z.number(), lot_no: z.string().nullable(), expiry_date: z.string().nullable(), is_expired: z.boolean() })
    .nullish(),
  current_balance: z.object({ on_hand: decimalString, reserved: decimalString, available: decimalString }).nullish(),
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
  batch_id: z.number().nullish(),
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
  "Batch not found": "That lot no longer exists for this product. Pick the lot again.",
  "batch_id is required for a batch-tracked product": "Pick the exact lot and location for this batch-tracked product.",
};

/** Phase 14D create/approve messages that deserve plain-language copy. */
export function batchAdjustmentErrorCopy(message: string): string | null {
  if (message.startsWith("No stock balance exists for this batch")) {
    return "This lot has no stock record at that location. Receive it there (Batch In or PO receipt) or transfer it first.";
  }
  if (message.startsWith("Requested quantity is below the")) {
    return `${message} Lower the reservation by changing the sales order first.`;
  }
  return null;
}

export function approveRejectErrorCopy(message: string): string {
  if (message.startsWith("Someone already changed this balance")) {
    return `${message} Refresh this request to see the current balance before deciding again.`;
  }
  if (message.startsWith("This request was already decided")) {
    return message;
  }
  const batchCopy = batchAdjustmentErrorCopy(message);
  if (batchCopy) return batchCopy;
  if (message === "This batch request is no longer valid for the product") {
    return "This lot request no longer matches the product's tracking — reject it and submit a new one.";
  }
  if (message === "You cannot approve a request you submitted yourself") {
    return "You can't approve your own request — ask another admin to review it.";
  }
  if (message === "Batch-tracked products cannot be adjusted directly — receive via POST /batches or issue via /stock/out-fefo / /stock/out-fifo instead") {
    return "This product became batch-tracked after the request was submitted and can no longer be approved this way.";
  }
  return message;
}
