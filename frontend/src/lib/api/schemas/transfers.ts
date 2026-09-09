import { z } from "zod";
import { apiEnvelope, decimalString, paginated } from "./common";

/**
 * Inventory Transfer contracts — verified against the live FastAPI (Phase 6
 * gate). Every quantity is a fixed-scale decimal STRING. Detail / create /
 * dispatch / cancel / receive.transfer are RAW `InventoryTransferResponse`
 * (NOT wrapped in {success,message,data}); only GET /inventory-transfers (list)
 * is enveloped.
 */

/* ---------------- lifecycle vocabulary (backend-authoritative) ---------------- */
export const TRANSFER_STATUSES = [
  "DRAFT",
  "IN_TRANSIT",
  "PARTIALLY_RECEIVED",
  "COMPLETED",
  "CANCELLED",
] as const;
export type TransferStatus = (typeof TRANSFER_STATUSES)[number];

/** Ordered pipeline for TransferLifecycle. CANCELLED is a terminal branch from DRAFT. */
export const TRANSFER_PIPELINE: TransferStatus[] = [
  "DRAFT",
  "IN_TRANSIT",
  "PARTIALLY_RECEIVED",
  "COMPLETED",
];

export const TRANSFER_STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  IN_TRANSIT: "In transit",
  PARTIALLY_RECEIVED: "Partially received",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

/** Work-queue tabs — backend `status` values only. */
export const TRANSFER_FILTER_TABS = [
  { key: "all", label: "All", status: null as string | null },
  { key: "DRAFT", label: "Draft", status: "DRAFT" },
  { key: "IN_TRANSIT", label: "In transit", status: "IN_TRANSIT" },
  { key: "PARTIALLY_RECEIVED", label: "Partially received", status: "PARTIALLY_RECEIVED" },
  { key: "COMPLETED", label: "Completed", status: "COMPLETED" },
  { key: "CANCELLED", label: "Cancelled", status: "CANCELLED" },
] as const;
export type TransferFilterKey = (typeof TRANSFER_FILTER_TABS)[number]["key"];

/** Sort fields the backend accepts for GET /inventory-transfers */
export const TRANSFER_SORT_FIELDS = ["id", "created_at", "status", "transfer_number", "dispatched_at"] as const;

export const RECEIVABLE_TRANSFER_STATUSES = ["IN_TRANSIT", "PARTIALLY_RECEIVED"] as const;

/* ---------------- GET /inventory-transfers  (list, enveloped) ---------------- */
export const transferRowSchema = z.object({
  id: z.number(),
  transfer_number: z.string(),
  source_warehouse_id: z.number(),
  source_warehouse_name: z.string().nullable(),
  destination_warehouse_id: z.number(),
  destination_warehouse_name: z.string().nullable(),
  status: z.string(),
  line_count: z.number(),
  total_quantity: decimalString,
  dispatched_quantity: decimalString,
  received_quantity: decimalString,
  outstanding_quantity: decimalString,
  progress_pct: z.number(),
  dispatched_at: z.string().nullable(),
  latest_receipt_at: z.string().nullable(),
  legacy_completed: z.boolean(),
});
export type TransferRow = z.infer<typeof transferRowSchema>;
export const transferListEnvelope = apiEnvelope(paginated(transferRowSchema));
export type TransferListEnvelope = z.infer<typeof transferListEnvelope>;

/* ---------------- GET /inventory-transfers/{id}  (detail, RAW) ---------------- */
export const transferItemSchema = z.object({
  id: z.number(),
  transfer_id: z.number(),
  product_id: z.number(),
  batch_id: z.number().nullable(),
  from_location_id: z.number(),
  to_location_id: z.number(),
  quantity: decimalString,
  dispatched_quantity: decimalString.nullable(),
  received_quantity: decimalString.nullable(),
  outstanding_quantity: decimalString.nullable(),
  source_stock_balance_id: z.number().nullable(),
  transit_stock_balance_id: z.number().nullable(),
  created_at: z.string().nullish(),
});
export type TransferItem = z.infer<typeof transferItemSchema>;

export const transferDetailSchema = z.object({
  id: z.number(),
  transfer_number: z.string(),
  status: z.string(),
  source_warehouse_id: z.number(),
  destination_warehouse_id: z.number(),
  requested_by_user_id: z.number().nullable(),
  dispatched_by_user_id: z.number().nullable(),
  completed_by_user_id: z.number().nullable(),
  legacy_completed: z.boolean(),
  remark: z.string().nullable(),
  created_at: z.string().nullish(),
  dispatched_at: z.string().nullable(),
  completed_at: z.string().nullable(),
  updated_at: z.string().nullish(),
  items: z.array(transferItemSchema).default([]),
});
export type TransferDetail = z.infer<typeof transferDetailSchema>;

/* ---------------- POST /inventory-transfers/{id}/receive → TransferReceiptResponse (RAW) --------- */
export const transferReceiptResponseSchema = z.object({
  receipt_id: z.number(),
  receipt_number: z.string(),
  transfer: transferDetailSchema,
});
export type TransferReceiptResponse = z.infer<typeof transferReceiptResponseSchema>;

/** Machine-readable transfer error messages → typed operator copy. */
export const TRANSFER_ERROR_COPY: Record<string, string> = {
  "Idempotency-Key already used with a different payload":
    "This receipt draft was already submitted with different quantities. Start a new receipt to change them.",
  "Receipt exceeds outstanding dispatched quantity":
    "That is more than is still in transit for this line. Nothing was received.",
  "Transfer item does not belong to this transfer": "That line isn’t part of this transfer.",
  "Not enough stock": "The source doesn’t have enough available stock to dispatch this transfer.",
  "Transfer state conflict: IN_TRANSIT": "This transfer has already been dispatched.",
  "System transit storage is not operationally selectable":
    "System transit is not a selectable warehouse or location.",
  "Source and destination warehouses must differ": "Source and destination must be different warehouses.",
  "Inventory transfer is cancelled": "This transfer can no longer be cancelled from its current state.",
  "Immediate transfer completion is retired; dispatch this transfer then receive it":
    "Transfers are completed by receiving every line — there is no separate complete step.",
};
/** message prefixes that carry a batch id: "Cannot dispatch expired batch: 7" */
export const EXPIRED_BATCH_DISPATCH_RE = /^Cannot dispatch expired batch/i;

/* ---------------- POST /inventory-transfers  request ---------------- */
const qtyInput = (label: string) =>
  z
    .string()
    .trim()
    .regex(/^\d+(\.\d+)?$/, `${label} must be a number`)
    .refine((v) => Number(v) > 0, `${label} must be greater than 0`)
    .refine((v) => (v.split(".")[1]?.length ?? 0) <= 3, `${label} allows at most 3 decimal places`);

export const createTransferLineInput = z.object({
  product_id: z.number().int().positive("Choose a product"),
  batch_id: z.number().int().positive().nullable(),
  from_location_id: z.number().int().positive("Choose a source"),
  to_location_id: z.number().int().positive("Choose a destination"),
  quantity: qtyInput("Quantity"),
});
export const createTransferInput = z
  .object({
    source_warehouse_id: z.number().int().positive("Choose a source warehouse"),
    destination_warehouse_id: z.number().int().positive("Choose a destination warehouse"),
    remark: z.string().max(500).optional(),
    items: z.array(createTransferLineInput).min(1, "Add at least one line"),
  })
  .refine((v) => v.source_warehouse_id !== v.destination_warehouse_id, {
    message: "Source and destination must be different warehouses",
    path: ["destination_warehouse_id"],
  })
  .refine(
    (v) =>
      new Set(
        v.items.map((i) => `${i.product_id}|${i.batch_id ?? ""}|${i.from_location_id}|${i.to_location_id}`),
      ).size === v.items.length,
    { message: "Two lines have the same product / batch / source / destination", path: ["items"] },
  );
export type CreateTransferInput = z.infer<typeof createTransferInput>;

/* ---------------- POST /inventory-transfers/{id}/receive  request ---------------- */
export const transferReceiveLine = z.object({
  transfer_item_id: z.number().int().positive(),
  quantity: decimalString, // 3dp, > 0
});
export const transferReceiveInput = z.object({
  items: z
    .array(transferReceiveLine)
    .min(1, "Enter a quantity on at least one line")
    .refine(
      (items) => new Set(items.map((i) => i.transfer_item_id)).size === items.length,
      "The same line appears twice in this receipt",
    ),
});
export type TransferReceiveInput = z.infer<typeof transferReceiveInput>;
