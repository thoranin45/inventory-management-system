import { z } from "zod";
import { apiEnvelope, decimalString, paginated } from "./common";

/**
 * Purchase Order contracts — verified against the live FastAPI (Phase 5 gate).
 * Unlike the Sales *detail* endpoint, PO list AND detail serialise every
 * quantity / money value as a fixed-scale **decimal string** (e.g. "14220.00000",
 * "10.000", "180.00"). We keep them as strings and never parseFloat for maths.
 */

/* ---------------- lifecycle vocabulary (backend-authoritative) ---------------- */
export const PO_STATUSES = [
  "DRAFT",
  "CONFIRMED",
  "PARTIALLY_RECEIVED",
  "RECEIVED",
  "CANCELLED",
] as const;
export type PoStatus = (typeof PO_STATUSES)[number];

/** Ordered pipeline for PurchaseOrderLifecycle. CANCELLED is a terminal branch. */
export const PO_PIPELINE: PoStatus[] = ["DRAFT", "CONFIRMED", "PARTIALLY_RECEIVED", "RECEIVED"];

export const PO_STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  CONFIRMED: "Confirmed",
  PARTIALLY_RECEIVED: "Partially received",
  RECEIVED: "Received",
  CANCELLED: "Cancelled",
};

/** Work-queue tabs — backend `status` values only (CSV-filterable server-side). */
export const PO_FILTER_TABS = [
  { key: "all", label: "All", status: null as string | null },
  { key: "DRAFT", label: "Draft", status: "DRAFT" },
  { key: "CONFIRMED", label: "Confirmed", status: "CONFIRMED" },
  { key: "PARTIALLY_RECEIVED", label: "Partially received", status: "PARTIALLY_RECEIVED" },
  { key: "RECEIVED", label: "Received", status: "RECEIVED" },
  { key: "CANCELLED", label: "Cancelled", status: "CANCELLED" },
] as const;
export type PoFilterKey = (typeof PO_FILTER_TABS)[number]["key"];

/** Sort fields the backend accepts for GET /purchase-orders */
export const PO_SORT_FIELDS = ["id", "created_at", "status", "po_number"] as const;
export type PoSortField = (typeof PO_SORT_FIELDS)[number];

export const RECEIVABLE_STATUSES = ["CONFIRMED", "PARTIALLY_RECEIVED"] as const;
export const CANCELLABLE_STATUSES = ["DRAFT", "CONFIRMED"] as const;

/* ---------------- GET /purchase-orders  (list) ---------------- */
export const purchaseOrderRowSchema = z.object({
  id: z.number(),
  po_number: z.string().nullable(),
  supplier_id: z.number().nullable(),
  supplier_name: z.string().nullable(),
  status: z.string(),
  ordered_quantity: decimalString,
  received_quantity: decimalString,
  remaining_quantity: decimalString,
  receiving_pct: z.number(),
  total_amount: decimalString,
  created_at: z.string().nullish(),
  last_receipt_at: z.string().nullish(),
  receipt_count: z.number(),
});
export type PurchaseOrderRow = z.infer<typeof purchaseOrderRowSchema>;
export const purchaseOrderListEnvelope = apiEnvelope(paginated(purchaseOrderRowSchema));
export type PurchaseOrderListEnvelope = z.infer<typeof purchaseOrderListEnvelope>;

/* ---------------- GET /purchase-orders/{id}  (detail) ---------------- */
export const purchaseOrderItemSchema = z.object({
  id: z.number(),
  po_id: z.number(),
  product_id: z.number(),
  quantity: decimalString,
  received_quantity: decimalString,
  remaining_quantity: decimalString,
  unit_price: decimalString,
  total_price: decimalString,
});
export type PurchaseOrderItem = z.infer<typeof purchaseOrderItemSchema>;

export const purchaseOrderDetailSchema = z.object({
  id: z.number(),
  po_number: z.string().nullable(),
  supplier_id: z.number().nullable(),
  status: z.string(),
  total_amount: decimalString,
  created_at: z.string().nullish(),
  items: z.array(purchaseOrderItemSchema).default([]),
});
export type PurchaseOrderDetail = z.infer<typeof purchaseOrderDetailSchema>;
export const purchaseOrderDetailEnvelope = apiEnvelope(purchaseOrderDetailSchema);

/* ---------------- confirm / cancel result ---------------- */
export const poActionResultSchema = z.object({
  id: z.number(),
  po_number: z.string().nullable(),
  status: z.string(),
});
export type PoActionResult = z.infer<typeof poActionResultSchema>;
export const poActionEnvelope = apiEnvelope(poActionResultSchema);

/* ---------------- receive result ---------------- */
export const receivedBatchSchema = z.object({
  batch_id: z.number(),
  product_id: z.number(),
  lot_no: z.string(),
  received_quantity: decimalString,
  current_stock: decimalString,
});
export const receivedItemSchema = z.object({
  po_item_id: z.number(),
  product_id: z.number(),
  batch_id: z.number().nullable(),
  stock_balance_id: z.number(),
  received_quantity: decimalString,
  current_stock: decimalString,
});
export const purchaseOrderReceiveResultSchema = z.object({
  id: z.number(),
  po_number: z.string().nullable(),
  status: z.string(),
  received_batches: z.array(receivedBatchSchema).default([]),
  received_items: z.array(receivedItemSchema).default([]),
  receipt_id: z.number(),
  receipt_number: z.string(),
});
export type PurchaseOrderReceiveResult = z.infer<typeof purchaseOrderReceiveResultSchema>;
export const purchaseOrderReceiveEnvelope = apiEnvelope(purchaseOrderReceiveResultSchema);

/** Machine-readable receive error messages the backend returns (for typed copy). */
export const RECEIVE_ERROR_COPY: Record<string, string> = {
  "Batch product requires lot_no": "This product is batch-tracked — a lot number is required.",
  "Expiry-tracked product requires manufacturing and expiry dates":
    "This product is expiry-tracked — both a manufacturing date and an expiry date are required.",
  "Non-batch products cannot receive lot or date metadata":
    "This product is not batch-tracked — remove the lot / date fields.",
  "Expiry date must be after manufacturing date": "The expiry date must be later than the manufacturing date.",
  "Idempotency-Key already used with a different payload":
    "This receipt draft was already submitted with different quantities. Start a new receipt to change them.",
};

/* ---------------- POST /purchase-orders  request (admin) ---------------- */
const priceInput = z
  .string()
  .trim()
  .regex(/^\d+(\.\d+)?$/, "Unit price must be a number")
  .refine((v) => Number(v) >= 0, "Unit price cannot be negative")
  .refine((v) => (v.split(".")[1]?.length ?? 0) <= 2, "At most 2 decimal places");

const qtyInput = (label: string) =>
  z
    .string()
    .trim()
    .regex(/^\d+(\.\d+)?$/, `${label} must be a number`)
    .refine((v) => Number(v) > 0, `${label} must be greater than 0`)
    .refine((v) => (v.split(".")[1]?.length ?? 0) <= 3, `${label} allows at most 3 decimal places`);

export const purchaseOrderLineInput = z.object({
  product_id: z.number().int().positive("Choose a product"),
  quantity: qtyInput("Quantity"),
  unit_price: priceInput,
});
export const createPurchaseOrderInput = z.object({
  supplier_id: z.number().int().positive("Choose a supplier"),
  items: z
    .array(purchaseOrderLineInput)
    .min(1, "Add at least one product line")
    .refine(
      (items) => new Set(items.map((i) => i.product_id)).size === items.length,
      "The same product appears on more than one line",
    ),
});
export type CreatePurchaseOrderInput = z.infer<typeof createPurchaseOrderInput>;

/* ---------------- POST /purchase-orders/{id}/receive  request ---------------- */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const receivePurchaseOrderLine = z.object({
  product_id: z.number().int().positive(),
  quantity: qtyInput("Receive quantity"),
  lot_no: z.string().trim().min(1).max(100).optional(),
  mfg_date: z.string().regex(ISO_DATE).optional(),
  expiry_date: z.string().regex(ISO_DATE).optional(),
});
export const receivePurchaseOrderInput = z.object({
  items: z
    .array(receivePurchaseOrderLine)
    .min(1, "Enter a quantity on at least one line")
    .refine(
      (items) => new Set(items.map((i) => i.product_id)).size === items.length,
      "The same product appears twice in this receipt",
    ),
});
export type ReceivePurchaseOrderInput = z.infer<typeof receivePurchaseOrderInput>;

/* ---------------- suppliers (selector) ---------------- */
export const supplierRowSchema = z.object({
  id: z.number(),
  supplier_name: z.string(),
  contact_name: z.string().nullish(),
  phone: z.string().nullish(),
  email: z.string().nullish(),
  address: z.string().nullish(),
});
export type SupplierRow = z.infer<typeof supplierRowSchema>;
export const supplierListEnvelope = apiEnvelope(paginated(supplierRowSchema));
