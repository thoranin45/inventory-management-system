import { z } from "zod";
import { apiEnvelope, decimalString, paginated } from "./common";

/**
 * Sales Order contracts — verified against real FastAPI responses (Phase 3
 * live gate). Two serialisation styles co-exist and are both tolerated:
 *   • LIST  → fixed-scale decimal strings ("2330.00")     [paginated_body]
 *   • DETAIL → money/qty as JSON numbers (2330.0, 5)       [success_response]
 * We normalise everything to a string and never do float arithmetic on it.
 */
const numeric = z
  .union([z.string(), z.number()])
  .transform((v) => (typeof v === "number" ? String(v) : v.trim()));

/* ---------------- lifecycle vocabulary (backend-authoritative) ---------------- */
export const SO_STATUSES = [
  "DRAFT",
  "CONFIRMED",
  "PICKING",
  "PACKING",
  "READY_TO_SHIP",
  "SHIPPED",
  "COMPLETED",
  "CANCELLED",
] as const;
export type SoStatus = (typeof SO_STATUSES)[number];

/** Ordered pipeline used by the SalesLifecycle component. CANCELLED is a branch. */
export const SO_PIPELINE: SoStatus[] = [
  "DRAFT",
  "CONFIRMED",
  "PICKING",
  "PACKING",
  "READY_TO_SHIP",
  "SHIPPED",
  "COMPLETED",
];

export const SO_STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  CONFIRMED: "Confirmed",
  PICKING: "Picking",
  PACKING: "Packing",
  READY_TO_SHIP: "Ready to ship",
  SHIPPED: "Shipped",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

/** attention_reason values seen from the backend (nullable). */
export const SO_ATTENTION_LABEL: Record<string, string> = {
  expired_allocation: "Blocked — an allocated batch has expired. Re-allocation is required before this order can proceed.",
};

/* ---------------- GET /sales-orders/  (list) ---------------- */
export const salesOrderRowSchema = z.object({
  id: z.number(),
  so_number: z.string().nullable(),
  customer_id: z.number().nullable(),
  customer_name: z.string().nullable(),
  status: z.string(),
  item_count: z.number(),
  total_quantity: decimalString,
  total_amount: decimalString,
  created_at: z.string().nullish(),
  last_activity_at: z.string().nullish(),
  picked_pct: z.number(),
  packed_pct: z.number(),
  attention_reason: z.string().nullable(),
});
export type SalesOrderRow = z.infer<typeof salesOrderRowSchema>;
export const salesOrderListEnvelope = apiEnvelope(paginated(salesOrderRowSchema));
export type SalesOrderListEnvelope = z.infer<typeof salesOrderListEnvelope>;

/** Sort fields the backend accepts for /sales-orders/ */
export const SO_SORT_FIELDS = ["id", "created_at", "status", "so_number", "total_amount"] as const;
export type SoSortField = (typeof SO_SORT_FIELDS)[number];

/**
 * Work-queue tabs. `status` is the value sent to the backend `status` filter;
 * `null` means no server filter. "attention" has no server-side filter — it is
 * a client predicate on `attention_reason != null` over the fetched page.
 */
export const SO_FILTER_TABS = [
  { key: "all", label: "All", status: null as string | null, clientOnly: false },
  { key: "DRAFT", label: "Draft", status: "DRAFT", clientOnly: false },
  { key: "CONFIRMED", label: "Confirmed", status: "CONFIRMED", clientOnly: false },
  { key: "PICKING", label: "Picking", status: "PICKING", clientOnly: false },
  { key: "PACKING", label: "Packing", status: "PACKING", clientOnly: false },
  { key: "READY_TO_SHIP", label: "Ready to ship", status: "READY_TO_SHIP", clientOnly: false },
  { key: "attention", label: "Attention", status: null as string | null, clientOnly: true },
] as const;
export type SoFilterKey = (typeof SO_FILTER_TABS)[number]["key"];

/* ---------------- GET /sales-orders/{id}  (detail) ---------------- */
export const salesFulfillmentAllocationSchema = z.object({
  id: z.number(),
  batch_id: z.number().nullable(),
  stock_balance_id: z.number().nullable(),
  quantity: numeric,
  picked_quantity: numeric,
  packed_quantity: numeric,
});

export const salesOrderItemSchema = z.object({
  id: z.number(),
  sales_order_id: z.number(),
  product_id: z.number(),
  quantity: numeric,
  unit_price: numeric,
  total_price: numeric,
  batch_allocations: z
    .array(z.object({ id: z.number(), batch_id: z.number().nullable(), quantity: numeric }))
    .default([]),
  fulfillment_allocations: z.array(salesFulfillmentAllocationSchema).default([]),
});
export type SalesOrderItem = z.infer<typeof salesOrderItemSchema>;

export const salesOrderDetailSchema = z.object({
  id: z.number(),
  so_number: z.string().nullable(),
  customer_id: z.number().nullable(),
  status: z.string(),
  total_amount: numeric,
  created_at: z.string().nullish(),
  items: z.array(salesOrderItemSchema).default([]),
  picked_at: z.string().nullable(),
  picked_by_user_id: z.number().nullable(),
  packed_at: z.string().nullable(),
  packed_by_user_id: z.number().nullable(),
  shipped_at: z.string().nullable(),
  shipped_by_user_id: z.number().nullable(),
  shipment_number: z.string().nullable(),
});
export type SalesOrderDetail = z.infer<typeof salesOrderDetailSchema>;
export const salesOrderDetailEnvelope = apiEnvelope(salesOrderDetailSchema);

/* ---------------- mutation responses ---------------- */
export const salesMutationResultSchema = z.object({
  sales_order_id: z.number(),
  so_number: z.string().nullable(),
  status: z.string(),
  shipment_number: z.string().nullable().optional(),
  total_amount: numeric.optional(),
});
export const salesMutationEnvelope = apiEnvelope(salesMutationResultSchema);
export type SalesMutationResult = z.infer<typeof salesMutationResultSchema>;

/* ---------------- POST /sales-orders/  request (admin) ----------------
   customer_id > 0 ; items min 1, unique product_id ;
   quantity > 0 (3dp) ; unit_price > 0 (2dp). Kept as strings. */
const decimalInput = (dp: number, label: string) =>
  z
    .string()
    .trim()
    .regex(/^\d+(\.\d+)?$/, `${label} must be a number`)
    .refine((v) => Number(v) > 0, `${label} must be greater than 0`)
    .refine((v) => (v.split(".")[1]?.length ?? 0) <= dp, `${label} allows at most ${dp} decimal places`);

export const salesOrderLineInput = z.object({
  product_id: z.number().int().positive("Choose a product"),
  quantity: decimalInput(3, "Quantity"),
  unit_price: decimalInput(2, "Unit price"),
});
export type SalesOrderLineInput = z.infer<typeof salesOrderLineInput>;

export const createSalesOrderInput = z.object({
  customer_id: z.number().int().positive("Choose a customer"),
  items: z
    .array(salesOrderLineInput)
    .min(1, "Add at least one product line")
    .refine(
      (items) => new Set(items.map((i) => i.product_id)).size === items.length,
      "The same product appears on more than one line",
    ),
});
export type CreateSalesOrderInput = z.infer<typeof createSalesOrderInput>;

/* ---------------- customers (selector) ---------------- */
export const customerRowSchema = z.object({
  id: z.number(),
  customer_name: z.string(),
  phone: z.string().nullish(),
  email: z.string().nullish(),
  address: z.string().nullish(),
});
export type CustomerRow = z.infer<typeof customerRowSchema>;
export const customerListEnvelope = apiEnvelope(paginated(customerRowSchema));

/* ================================================================
 * Phase 4 — Picking / Packing / Scanner
 * ================================================================ */

/** Work-queue status sets (backend vocabulary only). */
export const PICKING_QUEUE_STATUSES = ["CONFIRMED", "PICKING"] as const;
export const PACKING_QUEUE_STATUSES = ["PACKING"] as const;

/** Lifecycle transitions the frontend drives (backend is authoritative). */
export const FULFILLMENT_TRANSITIONS = {
  "start-picking": { from: "CONFIRMED", to: "PICKING" },
  "complete-picking": { from: "PICKING", to: "PACKING" },
  "complete-packing": { from: "PACKING", to: "READY_TO_SHIP" },
} as const;

/* ---- POST /sales-orders/{id}/scan-pick | scan-pack ---- */
export const fulfillmentScanInput = z.object({
  barcode: z.string().min(1).max(100),
  quantity: decimalString.optional(), // default "1" server-side; >0, 3dp
  allocation_id: z.number().int().positive().optional(),
});
export type FulfillmentScanInput = z.infer<typeof fulfillmentScanInput>;

/** scan-pick / scan-pack success payload — money/qty as JSON numbers → string. */
export const fulfillmentScanResultSchema = z.object({
  sales_order_id: z.number(),
  so_number: z.string().nullable(),
  status: z.string(),
  shipment_number: z.string().nullable().optional(),
  allocation_id: z.number(),
  quantity: numeric,
  picked_quantity: numeric,
  packed_quantity: numeric,
});
export type FulfillmentScanResult = z.infer<typeof fulfillmentScanResultSchema>;
export const fulfillmentScanEnvelope = apiEnvelope(fulfillmentScanResultSchema);

/**
 * Machine-readable scan error codes the backend returns in `message` (409/404).
 * Anything else falls through to the generic ApiError copy.
 */
export const SCAN_ERROR_COPY: Record<string, string> = {
  BARCODE_NOT_FOUND: "That barcode isn’t a known product. Nothing was counted.",
  PRODUCT_NOT_IN_ORDER: "That product isn’t on this order. Nothing was counted.",
  ALLOCATION_IDENTIFICATION_REQUIRED: "More than one allocation matches — choose which batch this scan counts against.",
  ALLOCATION_SCAN_EXCEEDS_REMAINING: "That would exceed the quantity required for this allocation. Nothing was counted.",
};

/* ---- POST /sales-orders/{id}/complete-picking | complete-packing ---- */
export const completeFulfillmentLine = z.object({
  allocation_id: z.number().int().positive(),
  quantity: decimalString, // must equal the allocation's required quantity
});
export const completeFulfillmentInput = z.object({
  allocations: z.array(completeFulfillmentLine).min(1),
});
export type CompleteFulfillmentInput = z.infer<typeof completeFulfillmentInput>;

/* ---- GET /scan/resolve?barcode=&context=lookup|stock_in|pick|pack ---- */
export const scanResolveBatchSchema = z.object({
  id: z.number(),
  lot_no: z.string().nullable(),
  expiry_date: z.string().nullable(),
  days_to_expiry: z.number().nullable(),
  is_expired: z.boolean(),
  is_near_expiry: z.boolean(),
  operational_available_quantity: numeric,
});
export type ScanResolveBatch = z.infer<typeof scanResolveBatchSchema>;

export const scanResolveSchema = z.object({
  barcode: z.string(),
  context: z.string(),
  product: z.object({
    id: z.number(),
    sku: z.string(),
    product_name: z.string(),
    track_batch: z.boolean(),
    track_expiry: z.boolean(),
    operational_available_quantity: numeric,
  }),
  batches: z.array(scanResolveBatchSchema).default([]),
  as_of_date: z.string().nullish(),
});
export type ScanResolve = z.infer<typeof scanResolveSchema>;
export const scanResolveEnvelope = apiEnvelope(scanResolveSchema);

/* ---- GET /sales-orders/{id}/packing-slip-data ---- */
export const packingSlipDataSchema = z.object({
  so_number: z.string().nullable(),
  status: z.string(),
  created_at: z.string().nullish(),
  shipment_number: z.string().nullable(),
  customer: z.object({
    id: z.number().nullable(),
    name: z.string().nullable(),
    address: z.string().nullable(),
    phone: z.string().nullable(),
  }),
  items: z.array(
    z.object({
      product_id: z.number(),
      quantity: numeric,
      batch_allocations: z
        .array(z.object({ id: z.number(), batch_id: z.number().nullable(), quantity: numeric }))
        .default([]),
      fulfillment_allocations: z.array(salesFulfillmentAllocationSchema).default([]),
    }),
  ).default([]),
});
export type PackingSlipData = z.infer<typeof packingSlipDataSchema>;
export const packingSlipDataEnvelope = apiEnvelope(packingSlipDataSchema);

/* ---- GET /sales-orders/{id}/shipping-label-data ---- */
export const shippingLabelDataSchema = z.object({
  so_number: z.string().nullable(),
  shipment_number: z.string().nullable(),
  status: z.string(),
  shipped_at: z.string().nullable(),
  ship_to: z.object({
    name: z.string().nullable(),
    address: z.string().nullable(),
    phone: z.string().nullable(),
  }),
  total_quantity: numeric,
  order_barcode: z.string().nullable(),
});
export type ShippingLabelData = z.infer<typeof shippingLabelDataSchema>;
export const shippingLabelDataEnvelope = apiEnvelope(shippingLabelDataSchema);

/* ================================================================ Phase 9 ===
 * Shipping / Complete / Return. Verified against the live backend:
 *   POST /sales-orders/{id}/ship      → require_warehouse, READY_TO_SHIP → SHIPPED,
 *       no body, shipment_number auto = "SHIP-{id:06d}"
 *   POST /sales-orders/{id}/complete  → require_admin, SHIPPED → COMPLETED, no body
 *   POST /sales-orders/{id}/return    → require_warehouse, SHIPPED|COMPLETED only,
 *       body { items:[{product_id, quantity, reason?}] } — PER PRODUCT, no batch id.
 *       Order status is unchanged; the return is a stock + audit event.
 * ========================================================================== */

/** State-conflict message shape: "Sales Order state conflict: X; requires Y". */
export const SO_STATE_CONFLICT_RE = /^Sales Order state conflict: (\w+); requires (\w+)$/;

export const SHIP_STARTABLE_STATUS = "READY_TO_SHIP";
export const COMPLETE_STARTABLE_STATUS = "SHIPPED";
export const RETURNABLE_STATUSES = ["SHIPPED", "COMPLETED"] as const;

export const SALES_SHIP_ERROR_COPY: Record<string, string> = {
  "Insufficient reserved or on-hand stock":
    "Stock moved since packing — the reserved quantity is no longer on hand. Refresh and re-check the allocation.",
  "Only completed Sales Order can be returned":
    "Only a shipped or completed order can be returned.",
};

export function shipErrorCopy(message: string | undefined): string | undefined {
  if (!message) return undefined;
  if (SALES_SHIP_ERROR_COPY[message]) return SALES_SHIP_ERROR_COPY[message];
  const m = SO_STATE_CONFLICT_RE.exec(message);
  if (m) return `This order is ${SO_STATUS_LABEL[m[1]] ?? m[1]} — the action needs it to be ${SO_STATUS_LABEL[m[2]] ?? m[2]}.`;
  if (/^Allocation not completely picked and packed/.test(message)) return "An allocation isn't fully picked and packed yet — finish packing before shipping.";
  if (/^Expired allocated batch/.test(message)) return `${message}. An allocated batch has expired — the order can't ship until it is re-allocated.`;
  if (/^Return quantity exceeds remaining returnable/.test(message)) return message; // carries "Remaining: N" — show verbatim
  if (/not found in this sales order$/.test(message)) return message;
  return undefined;
}

/* ---- return request ---- */
export const salesReturnLineInput = z.object({
  product_id: z.number().int().positive(),
  quantity: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,3})?$/, "Quantity must be a number with up to 3 decimals")
    .refine((v) => Number(v) > 0, "Quantity must be greater than zero"),
  reason: z.string().trim().max(255, "Reason must be 255 characters or fewer").optional().transform((v) => (v ? v : undefined)),
});
export type SalesReturnLineInput = z.infer<typeof salesReturnLineInput>;

export const salesReturnInput = z.object({
  items: z.array(salesReturnLineInput).min(1, "Add at least one line to return"),
});
export type SalesReturnInput = z.infer<typeof salesReturnInput>;

/* ---- return response ---- */
export const salesReturnItemResultSchema = z.object({
  product_id: z.number(),
  returned_quantity: numeric,
  previously_returned: numeric,
  total_returned: numeric,
  remaining_returnable: numeric,
});
export type SalesReturnItemResult = z.infer<typeof salesReturnItemResultSchema>;

export const salesReturnResultSchema = z.object({
  sales_order_id: z.number(),
  so_number: z.string().nullable(),
  returned_items: z.array(salesReturnItemResultSchema).default([]),
});
export type SalesReturnResult = z.infer<typeof salesReturnResultSchema>;
export const salesReturnEnvelope = apiEnvelope(salesReturnResultSchema);
