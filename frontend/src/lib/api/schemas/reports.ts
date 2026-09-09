import { z } from "zod";

import { apiEnvelope, paginated } from "./common";
import { productRowSchema } from "./products";
import { salesOrderListEnvelope } from "./sales";
import { purchaseOrderListEnvelope } from "./purchase-orders";
import { transferListEnvelope } from "./transfers";

/**
 * Phase 8 — Reports. Schemas written from the ACTUAL live responses
 * (`app/routers/report_router.py`), not from endpoint names.
 *
 * Two serialization styles are in play:
 *  - `_report_page()` / `phase8_json` → fixed-scale decimal **strings**
 *    (operational-stock, stock-movement, sales, purchase-orders, transfers).
 *  - `encode_quantities()` → Decimals as **int | float | string** depending on
 *    the value (expired/near-expiry/in-transit/low-stock-operational, charts).
 * `numericString` normalises the second style to a lossless string so the
 * Decimal helpers keep working — no `parseFloat` on business values.
 */
export const numericString = z
  .union([z.string(), z.number()])
  .transform((v) => (typeof v === "number" ? String(v) : v))
  .refine((v) => /^-?\d+(\.\d+)?$/.test(v), "expected a numeric value");

/* ------------------------------------------------------------------ enums == */

/** `StockTransaction.transaction_type` vocabulary (from app/). */
export const MOVEMENT_TYPES = [
  "IN_PO",
  "IN_BATCH",
  "IN_TRANSIT",
  "OUT_FEFO",
  "OUT_FIFO",
  "ADJUST",
  "TRANSFER_IN",
  "TRANSFER_OUT",
  "TRANSFER_TRANSIT_IN",
  "TRANSFER_TRANSIT_OUT",
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

export const MOVEMENT_TYPE_LABEL: Record<string, string> = {
  IN_PO: "PO receipt",
  IN_BATCH: "Batch in",
  IN_TRANSIT: "Into transit",
  OUT_FEFO: "Pick (FEFO)",
  OUT_FIFO: "Pick (FIFO)",
  ADJUST: "Adjustment",
  TRANSFER_IN: "Transfer in",
  TRANSFER_OUT: "Transfer out",
  TRANSFER_TRANSIT_IN: "Transit in",
  TRANSFER_TRANSIT_OUT: "Transit out",
};

export function movementTypeLabel(t: string): string {
  return MOVEMENT_TYPE_LABEL[t] ?? t.replace(/_/g, " ").toLowerCase();
}

/* ------------------------------------------------- paginated report shapes = */

/** `/reports/operational-stock` — same enriched row as the Products list. */
export const operationalStockEnvelope = apiEnvelope(paginated(productRowSchema));
export type OperationalStockEnvelope = z.infer<typeof operationalStockEnvelope>;
export const OPERATIONAL_STOCK_SORT_FIELDS = ["id", "product_name", "sku", "stock_qty", "created_at"] as const;

/** `/reports/stock-movement` — bounded StockTransaction history. */
export const movementRowSchema = z.object({
  id: z.number(),
  product_id: z.number().nullable(),
  transaction_type: z.string().nullable(),
  quantity: z.string(),
  remark: z.string().nullish(),
  created_at: z.string().nullish(),
});
export type MovementRow = z.infer<typeof movementRowSchema>;
export const movementReportEnvelope = apiEnvelope(paginated(movementRowSchema));
export type MovementReportEnvelope = z.infer<typeof movementReportEnvelope>;

/** `/reports/sales|purchase-orders|transfers` reuse the phase 3/5/6 list rows. */
export const salesReportEnvelope = salesOrderListEnvelope;
export const purchaseOrdersReportEnvelope = purchaseOrderListEnvelope;
export const transfersReportEnvelope = transferListEnvelope;

/* ------------------------------------------- unpaginated `{ items: [...] }` = */

const batchExpiryRow = z.object({
  batch_id: z.number(),
  product_id: z.number(),
  lot_no: z.string().nullish(),
  quantity: numericString,
  expiry_date: z.string().nullable(),
  days_to_expiry: z.number().nullable(),
});
export type BatchExpiryRow = z.infer<typeof batchExpiryRow>;

export const expiredStockSchema = z.object({ items: z.array(batchExpiryRow) });
export const nearExpiryStockSchema = z.object({ items: z.array(batchExpiryRow) });

export const inTransitStockRow = z.object({
  id: z.number(),
  product_id: z.number(),
  batch_id: z.number().nullable(),
  warehouse_id: z.number().nullable(),
  location_id: z.number().nullable(),
  on_hand_qty: numericString,
});
export type InTransitStockRow = z.infer<typeof inTransitStockRow>;
export const inTransitStockSchema = z.object({ items: z.array(inTransitStockRow) });

export const lowStockOperationalRow = z.object({
  product_id: z.number(),
  sku: z.string(),
  product_name: z.string(),
  operational_available_quantity: numericString,
  threshold: numericString,
});
export type LowStockOperationalRow = z.infer<typeof lowStockOperationalRow>;
export const lowStockOperationalSchema = z.object({ items: z.array(lowStockOperationalRow) });

/* ----------------------------------------------------------------- charts == */

export const salesSummarySchema = z.object({
  total_orders: z.number(),
  total_sales_amount: numericString,
});
export type SalesSummary = z.infer<typeof salesSummarySchema>;

export const chartSalesSchema = z.array(
  z.object({ date: z.string(), orders: z.number(), sales: numericString }),
);
export type ChartSalesPoint = z.infer<typeof chartSalesSchema>[number];

export const chartStockSchema = z.array(
  z.object({ product_name: z.string(), stock_qty: numericString }),
);
export type ChartStockPoint = z.infer<typeof chartStockSchema>[number];

export const EXPIRY_SERIES = ["eligible", "near_expiry", "expired", "no_expiry"] as const;
export type ExpirySeries = (typeof EXPIRY_SERIES)[number];
export const EXPIRY_SERIES_LABEL: Record<ExpirySeries, string> = {
  eligible: "Eligible",
  near_expiry: "Near expiry",
  expired: "Expired",
  no_expiry: "No expiry date",
};

export const chartExpirySchema = z.array(
  z.object({
    batch_id: z.number(),
    product_id: z.number(),
    lot_no: z.string().nullish(),
    quantity: numericString,
    expiry_date: z.string().nullable(),
    series: z.enum(EXPIRY_SERIES),
  }),
);
export type ChartExpiryRow = z.infer<typeof chartExpirySchema>[number];

/* --------------------------------------------------------------- exports === */

export interface ReportExport {
  key: "stock" | "sales" | "low-stock" | "expiring";
  title: string;
  description: string;
  path: string;
  /** extra URL params this export accepts, with defaults */
  params?: { name: "threshold" | "days"; label: string; default: string; kind: "decimal" | "int" }[];
}

export const REPORT_EXPORTS: ReportExport[] = [
  {
    key: "stock",
    title: "Stock workbook",
    description: "Every active product with quantity, unit price and stock value.",
    path: "/api/bff/reports/export/stock",
  },
  {
    key: "sales",
    title: "Sales workbook",
    description: "All sales orders — number, customer, status, total and date.",
    path: "/api/bff/reports/export/sales",
  },
  {
    key: "low-stock",
    title: "Low stock workbook",
    description: "Active products at or below the chosen quantity threshold.",
    path: "/api/bff/reports/export/low-stock",
    params: [{ name: "threshold", label: "Threshold", default: "10", kind: "decimal" }],
  },
  {
    key: "expiring",
    title: "Expiring workbook",
    description: "In-date batches with stock expiring within the chosen window.",
    path: "/api/bff/reports/export/expiring",
    params: [{ name: "days", label: "Within days", default: "90", kind: "int" }],
  },
];

/* --------------------------------------------------------- error handling == */

/** backend `message` → operator copy. Row-cap message is dynamic, matched below. */
export const REPORT_ERROR_COPY: Record<string, string> = {
  "Unknown sort field": "That column can't be sorted. Clear the sort and try again.",
};

export const EXPORT_ROW_CAP_RE = /^Export too large \(\d+ rows > \d+\); narrow the filters and retry$/;

export function reportErrorCopy(message: string | undefined): string | undefined {
  if (!message) return undefined;
  if (EXPORT_ROW_CAP_RE.test(message)) return "This export is too large. Narrow the filters (date range, status, threshold) and try again.";
  if (/^Unknown sort field/.test(message)) return REPORT_ERROR_COPY["Unknown sort field"];
  return undefined;
}
