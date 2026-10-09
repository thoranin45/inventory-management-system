import { z } from "zod";

import { stockOperationEnvelope, stockOperationSchema, type StockOperationResult } from "./stock-in";

/**
 * Phase 14A — Stock Out (FIFO / FEFO).
 *
 * POST /api/v1/stock/out-fifo and POST /api/v1/stock/out-fefo both select
 * batches algorithmically (earliest-received / earliest-expiring) and only
 * ever deduct from batch-linked balances — never the warehouse/location
 * picker's concern, so (same interim choice as Stock-In) this never sends
 * warehouse_id/location_id; the backend's MAIN/DEFAULT resolution applies.
 * A real multi-warehouse picker becomes possible once Phase 14B's
 * GET /warehouses ships — not this phase's problem to solve.
 *
 * Both endpoints honour an optional `Idempotency-Key`, reusing the exact
 * same stock_operation_receipts mechanism Stock-In's Save-once session
 * already relies on. The response shape (StockOperationResponse) is
 * identical to Stock-In's, so the schema is imported, not duplicated.
 *
 * Quantities are decimal strings end-to-end — never `parseFloat` for
 * arithmetic (`Number()` here is only a `> 0` boolean gate).
 */

export { stockOperationEnvelope, stockOperationSchema };
export type { StockOperationResult };

export type StockOutStrategy = "fifo" | "fefo";

/* ------------------------------------------------------------- inputs ------ */

const qtyInput = z
  .string()
  .trim()
  .regex(/^\d+(\.\d+)?$/, "Quantity must be a number")
  .refine((v) => Number(v) > 0, "Quantity must be greater than 0")
  .refine((v) => (v.split(".")[1]?.length ?? 0) <= 3, "At most 3 decimal places");

const remarkInput = z.string().trim().max(255, "Keep the note under 255 characters").optional();

/** POST /api/v1/stock/out-fifo or /out-fefo — the strategy picks the endpoint,
 *  it is never sent in the body. */
export const stockOutInput = z.object({
  product_id: z.number().int().positive(),
  quantity: qtyInput,
  remark: remarkInput,
});
export type StockOutInput = z.infer<typeof stockOutInput>;

/* --------------------------------------------- Save-once Stock-Out session -- */

/**
 * SETUP step of the two-step Stock-Out session, mirroring Stock-In's shape.
 * `strategy` is part of the draft (changing it mid-session means abandoning
 * the pending operation, not silently rewriting it — see
 * buildStockOutSaveBody / the console's resolveStrategyChange guard).
 * `expected` is an optional target count — it never blocks a Save, only
 * warns when the counted/entered quantity goes over it.
 */
export const stockOutSetupInput = z.object({
  product_id: z.number().int().positive("Choose a product first"),
  strategy: z.enum(["fifo", "fefo"]),
  expected: qtyInput.optional(),
  remark: remarkInput,
});
export type StockOutSetupInput = z.infer<typeof stockOutSetupInput>;

export interface StockOutSaveBody {
  endpoint: "stock/out-fifo" | "stock/out-fefo";
  json: { product_id: number; quantity: string; remark?: string };
}

/**
 * The ONE authoritative request a Stock-Out session commits — the whole
 * entered/scanned quantity as a single call. Byte-stable for a given
 * (setup, quantity) so the session's Idempotency-Key can safely replay it.
 * `null` until setup is valid and a positive quantity has been entered.
 */
export function buildStockOutSaveBody(
  setup: Partial<StockOutSetupInput> | null,
  quantity: string,
): StockOutSaveBody | null {
  if (!setup) return null;
  const parsed = stockOutSetupInput.safeParse({ ...setup, expected: setup.expected || undefined });
  if (!parsed.success) return null;
  const qty = qtyInput.safeParse(quantity);
  if (!qty.success) return null;
  const v = parsed.data;
  const remark = v.remark ? { remark: v.remark } : {};
  return {
    endpoint: v.strategy === "fifo" ? "stock/out-fifo" : "stock/out-fefo",
    json: { product_id: v.product_id, quantity: qty.data, ...remark },
  };
}

/* ---------------------------------------------------------- strategy copy -- */

/**
 * Thai-first labels — the warehouse floor's working language. English stays
 * as the secondary line so the same copy serves either audience without a
 * separate i18n pass for this phase.
 */
export const STOCK_OUT_STRATEGY_LABELS: Record<
  StockOutStrategy,
  { labelTh: string; subTh: string; label: string; sub: string }
> = {
  fifo: {
    labelTh: "เข้าก่อน ออกก่อน (FIFO)",
    subTh: "ตัดสต๊อกที่รับเข้าคลังก่อนออกก่อน",
    label: "First In, First Out (FIFO)",
    sub: "Issues the oldest-received stock first.",
  },
  fefo: {
    labelTh: "หมดอายุก่อน ออกก่อน (FEFO)",
    subTh: "ตัดสต๊อกที่ใกล้วันหมดอายุก่อนออกก่อน",
    label: "First Expired, First Out (FEFO)",
    sub: "Issues the stock closest to its expiry date first.",
  },
};

/* -------------------------------------------------------- error copy ------ */

/**
 * Backend `message` strings → operator copy. Anything unmapped falls through
 * to `ApiError.userMessage`. Request IDs are always shown by ErrorState/toast.
 */
export const STOCK_OUT_ERROR_COPY: Record<string, string> = {
  "Product not found": "That barcode isn't a known active product. Nothing was deducted.",
  "Not enough stock": "There isn't enough stock on hand for that quantity. Nothing was deducted.",
  "Not enough batch stock":
    "There isn't enough eligible (non-expired) lot stock for that quantity. Nothing was deducted.",
  "Idempotency-Key already used with a different payload":
    "This session's saved request doesn't match what you're about to send. Start a new session.",
  "System transit storage is not operationally selectable":
    "Stock can't be issued from transit storage.",
  "Default warehouse/location not configured":
    "The demo has no MAIN/DEFAULT storage configured. Contact an administrator.",
};
