import { z } from "zod";
import { apiEnvelope, decimalString, paginated } from "./common";

/**
 * GET /api/v1/stock-balances  ·  /stock-balances/in-transit  ·  /stock-balances/product/{id}
 * Phase 8 contract: ApiResponse<PaginatedData<StockBalanceRow>>.
 * Row shape verified against a live backend response (_enrich_balances()).
 *
 * NOTE: the flat /stock-balances endpoint hard-codes `is_transit: false` for
 * every row. The dedicated /stock-balances/in-transit endpoint is the
 * authoritative transit view (see Phase 2 report §F).
 */
export const stockBalanceRowSchema = z.object({
  id: z.number(),
  product_id: z.number(),
  warehouse_id: z.number().nullable(),
  location_id: z.number().nullable(),
  batch_id: z.number().nullable(),
  on_hand_qty: decimalString,
  reserved_qty: decimalString,
  available_qty: decimalString,
  created_at: z.string().nullish(),
  updated_at: z.string().nullish(),
  is_transit: z.boolean(),
  batch_expiry_date: z.string().nullable(),
  days_to_expiry: z.number().nullable(),
  is_expired: z.boolean(),
  as_of_date: z.string(),
});
export type StockBalanceRow = z.infer<typeof stockBalanceRowSchema>;

export const stockBalanceListEnvelope = apiEnvelope(paginated(stockBalanceRowSchema));
export type StockBalanceListEnvelope = z.infer<typeof stockBalanceListEnvelope>;

/** Sort fields the backend accepts for stock-balances (_BALANCE_SORTS). */
export const STOCK_SORT_FIELDS = ["id", "product_id", "on_hand_qty"] as const;
export type StockSortField = (typeof STOCK_SORT_FIELDS)[number];
