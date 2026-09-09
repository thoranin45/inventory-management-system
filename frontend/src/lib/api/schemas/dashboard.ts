import { z } from "zod";
import { apiEnvelope, decimalString } from "./common";

/* ---------------- GET /api/v1/dashboard/summary ---------------- */
export const dashboardSummarySchema = z.object({
  inventory: z.object({
    owned_quantity: decimalString,
    operational_available_quantity: decimalString,
    reserved_quantity: decimalString,
    expired_quantity: decimalString,
    near_expiry_quantity: decimalString,
    in_transit_quantity: decimalString,
  }),
  sales: z.object({
    DRAFT: z.number(),
    CONFIRMED: z.number(),
    PICKING: z.number(),
    PACKING: z.number(),
    READY_TO_SHIP: z.number(),
    shipped_today: z.number(),
    attention_required: z.number(),
  }),
  purchase_orders: z.object({
    DRAFT: z.number(),
    CONFIRMED: z.number(),
    PARTIALLY_RECEIVED: z.number(),
    received_today: z.number(),
    pending_receiving: z.number(),
  }),
  transfers: z.object({
    DRAFT: z.number(),
    IN_TRANSIT: z.number(),
    PARTIALLY_RECEIVED: z.number(),
    completed_today: z.number(),
  }),
  generated_at: z.string(),
  as_of_date: z.string(),
});
export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;
export const dashboardSummaryEnvelope = apiEnvelope(dashboardSummarySchema);

/* ---------------- GET /api/v1/attention/summary ---------------- */
export const attentionSummarySchema = z.object({
  low_operational_stock: z.number(),
  expired_inventory_products: z.number(),
  near_expiry_products: z.number(),
  sales_blocked_by_expiry: z.number(),
  sales_awaiting_picking: z.number(),
  sales_awaiting_packing: z.number(),
  sales_ready_to_ship: z.number(),
  po_partially_received: z.number(),
  transfers_in_transit: z.number(),
  transfers_partially_received: z.number(),
  as_of_date: z.string(),
});
export type AttentionSummary = z.infer<typeof attentionSummarySchema>;
export const attentionSummaryEnvelope = apiEnvelope(attentionSummarySchema);

/* ---------------- GET /api/v1/dashboard/recent-transactions ----------------
   Closest real source for the prototype's "Recent activity" band. Rows are
   raw stock movements (transaction_type / quantity / remark / created_at).
   `quantity` may arrive as a number or a string depending on backend
   serialization — it is coerced to a string here and never parseFloat-ed. */
export const recentTransactionSchema = z.object({
  id: z.number(),
  product_id: z.number().nullish(),
  transaction_type: z.string().nullish(),
  quantity: z.union([z.string(), z.number()]).transform((v) => String(v)),
  remark: z.string().nullish(),
  created_at: z.string().nullish(),
});
export type RecentTransaction = z.infer<typeof recentTransactionSchema>;
export const recentTransactionsEnvelope = apiEnvelope(
  z.object({ items: z.array(recentTransactionSchema) }),
);
