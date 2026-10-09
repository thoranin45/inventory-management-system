import { z } from "zod";

import { apiEnvelope } from "./common";
import { numericString } from "./reports";

/**
 * Phase 12 — direct Stock In.
 *
 * The backend exposes two inbound primitives and enforces a tracking
 * invariant on each (frontend routing is a UX convenience, not the only
 * guard):
 *
 *   POST /api/v1/stock/in   non-batch products only  (409 for track_batch)
 *   POST /api/v1/batches    batch-tracked products only (409 for !track_batch)
 *
 * Phase 12C.0: both endpoints honour an optional `Idempotency-Key`. The
 * Save-once Stock-In session sends one stable key per draft, so a retried or
 * reloaded Save replays the stored response instead of applying stock twice.
 *
 * Quantities are decimal strings end-to-end — never `parseFloat` for
 * arithmetic (`Number()` here is only a `> 0` boolean gate).
 */

/* ------------------------------------------------------------- inputs ------ */

const qtyInput = z
  .string()
  .trim()
  .regex(/^\d+(\.\d+)?$/, "Quantity must be a number")
  .refine((v) => Number(v) > 0, "Quantity must be greater than 0")
  .refine((v) => (v.split(".")[1]?.length ?? 0) <= 3, "At most 3 decimal places");

const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date");

const remarkInput = z.string().trim().max(255, "Keep the note under 255 characters").optional();

/** POST /api/v1/stock/in — non-batch. */
export const stockInInput = z.object({
  product_id: z.number().int().positive(),
  quantity: qtyInput,
  remark: remarkInput,
});
export type StockInInput = z.infer<typeof stockInInput>;

/**
 * POST /api/v1/batches — batch-tracked. Date rules mirror the backend:
 *   track_expiry  -> both mfg_date and expiry_date required, expiry > mfg
 *   !track_expiry -> both optional, all-or-nothing, expiry > mfg when present
 * The caller passes `trackExpiry` so this schema can enforce the same thing
 * client-side before the request is built.
 */
export const batchInInput = z
  .object({
    product_id: z.number().int().positive(),
    lot_no: z.string().trim().min(1, "Lot number is required").max(100),
    quantity: qtyInput,
    mfg_date: isoDate.optional(),
    expiry_date: isoDate.optional(),
    remark: remarkInput,
    /** not sent — drives client-side validation only */
    trackExpiry: z.boolean(),
  })
  .refine((v) => !v.trackExpiry || (!!v.mfg_date && !!v.expiry_date), {
    message: "Manufacturing and expiry dates are required for this product",
    path: ["expiry_date"],
  })
  .refine((v) => v.trackExpiry || !!v.mfg_date === !!v.expiry_date, {
    message: "Enter both dates or neither",
    path: ["expiry_date"],
  })
  .refine((v) => !(v.mfg_date && v.expiry_date) || v.expiry_date > v.mfg_date, {
    message: "Expiry date must be after the manufacturing date",
    path: ["expiry_date"],
  });
export type BatchInInput = z.infer<typeof batchInInput>;

/** The exact JSON body sent to POST /api/v1/batches (no `trackExpiry`). */
export function toBatchRequestBody(v: BatchInInput) {
  return {
    product_id: v.product_id,
    lot_no: v.lot_no,
    quantity: v.quantity,
    ...(v.mfg_date ? { mfg_date: v.mfg_date } : {}),
    ...(v.expiry_date ? { expiry_date: v.expiry_date } : {}),
    ...(v.remark ? { remark: v.remark } : {}),
  };
}

/* --------------------------------------------- Save-once Stock-In session -- */

/**
 * SETUP step of the two-step Stock-In session. The operator picks a product
 * (and, per its tracking mode, a lot / dates) BEFORE any scanning. `expected`
 * is an optional target count — it never blocks a Save, only warns when the
 * scanned count goes over it.
 */
export const stockInSetupInput = z
  .object({
    product_id: z.number().int().positive("Choose a product first"),
    /** drives which fields are required — mirrors the resolved product */
    trackBatch: z.boolean(),
    trackExpiry: z.boolean(),
    lot_no: z.string().trim().max(100).optional(),
    mfg_date: isoDate.optional(),
    expiry_date: isoDate.optional(),
    expected: qtyInput.optional(),
    remark: remarkInput,
  })
  .refine((v) => !v.trackBatch || (v.lot_no?.length ?? 0) >= 1, {
    message: "This product is batch-tracked — enter a lot number",
    path: ["lot_no"],
  })
  .refine((v) => !v.trackExpiry || (!!v.mfg_date && !!v.expiry_date), {
    message: "Manufacturing and expiry dates are required for this product",
    path: ["expiry_date"],
  })
  .refine((v) => v.trackExpiry || !v.trackBatch || !!v.mfg_date === !!v.expiry_date, {
    message: "Enter both dates or neither",
    path: ["expiry_date"],
  })
  .refine((v) => !(v.mfg_date && v.expiry_date) || v.expiry_date > v.mfg_date, {
    message: "Expiry date must be after the manufacturing date",
    path: ["expiry_date"],
  });
export type StockInSetupInput = z.infer<typeof stockInSetupInput>;

export type StockInSaveBody =
  | { endpoint: "stock/in"; json: { product_id: number; quantity: string; remark?: string } }
  | {
      endpoint: "batches";
      json: {
        product_id: number;
        lot_no: string;
        quantity: string;
        mfg_date?: string;
        expiry_date?: string;
        remark?: string;
      };
    };

/**
 * The ONE authoritative request a Stock-In session commits: the whole scanned
 * count as a single quantity. Byte-stable for a given (setup, count) so the
 * session Idempotency-Key can safely replay it. `null` until setup is valid
 * and at least one item has been counted.
 */
export function buildStockInSaveBody(
  setup: Partial<StockInSetupInput> | null,
  count: number,
): StockInSaveBody | null {
  if (!setup || count <= 0) return null;
  const parsed = stockInSetupInput.safeParse(setup);
  if (!parsed.success) return null;
  const v = parsed.data;
  const quantity = String(count);
  const remark = v.remark ? { remark: v.remark } : {};
  if (v.trackBatch) {
    return {
      endpoint: "batches",
      json: {
        product_id: v.product_id,
        lot_no: v.lot_no as string,
        quantity,
        ...(v.mfg_date ? { mfg_date: v.mfg_date } : {}),
        ...(v.expiry_date ? { expiry_date: v.expiry_date } : {}),
        ...remark,
      },
    };
  }
  return { endpoint: "stock/in", json: { product_id: v.product_id, quantity, ...remark } };
}

/* ------------------------------------------------------------ responses --- */

/** ApiResponse[StockOperationResponse] */
export const stockOperationSchema = z.object({
  product_id: z.number(),
  product_name: z.string(),
  previous_stock: numericString,
  current_stock: numericString,
  difference: numericString,
});
export const stockOperationEnvelope = apiEnvelope(stockOperationSchema);
export type StockOperationResult = z.infer<typeof stockOperationSchema>;

/** ApiResponse[BatchCreateResponse] */
export const batchCreateSchema = z.object({
  batch: z.object({
    id: z.number(),
    product_id: z.number(),
    lot_no: z.string(),
    mfg_date: z.string().nullable(),
    expiry_date: z.string().nullable(),
    quantity: numericString,
    created_at: z.string().nullish(),
  }),
  current_stock: numericString,
});
export const batchCreateEnvelope = apiEnvelope(batchCreateSchema);
export type BatchCreateResult = z.infer<typeof batchCreateSchema>;

/* -------------------------------------------------------- error copy ------ */

/**
 * Backend `message` strings → operator copy. Anything unmapped falls through
 * to `ApiError.userMessage`. Request IDs are always shown by ErrorState/toast.
 */
export const STOCK_IN_ERROR_COPY: Record<string, string> = {
  "Product not found": "That barcode isn't a known active product. Nothing was added.",
  "Batch-tracked products must be received with a lot number via POST /batches, not direct stock in":
    "This product is batch-tracked — enter a lot number. Nothing was added.",
  "This product is not batch-tracked — add stock directly via POST /stock/in, not as a batch":
    "This product isn't batch-tracked — add the quantity without a lot. Nothing was added.",
  "Lot number already exists": "That lot number is already on file for this product. Use a different lot.",
  "Expiry date must be after manufacturing date":
    "The expiry date must be later than the manufacturing date.",
  "Expiry-tracked product requires manufacturing and expiry dates":
    "This product needs both a manufacturing and an expiry date.",
  "Supply both manufacturing and expiry dates, or neither":
    "Enter both dates, or leave both blank.",
  "System transit storage is not operationally selectable":
    "Stock can't be received into transit storage.",
  "Default warehouse/location not configured":
    "The demo has no MAIN/DEFAULT storage configured. Contact an administrator.",
};
