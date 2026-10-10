import { z } from "zod";

import { apiEnvelope, decimalString, paginated } from "./common";

/**
 * Phase 14C — `GET /inventory-movements` (the physical inventory ledger).
 *
 * One row per balance change. StockTransaction (product-level summary) and
 * AuditLog (event history) are separate records and are never mixed in.
 * Adjustment notes / requester are redacted SERVER-side for viewers who are
 * neither Admin nor the request's owner; the UI only renders the indicator.
 */

/** movement_group values — the backend partitions every movement_type into exactly one. */
export const MOVEMENT_GROUPS = [
  { key: "IN", label: "Stock in" },
  { key: "OUT", label: "Stock out" },
  { key: "ADJUSTMENT", label: "Adjustment" },
  { key: "TRANSFER", label: "Transfer" },
  { key: "SALES", label: "Sales" },
  { key: "PURCHASE", label: "Purchase" },
] as const;
export type MovementGroup = (typeof MOVEMENT_GROUPS)[number]["key"];

type Tone = "neutral" | "info" | "accent" | "success" | "warning" | "danger";

export const LEDGER_TYPE_META: Record<string, { label: string; tone: Tone }> = {
  STOCK_IN: { label: "Stock in", tone: "success" },
  BATCH_IN: { label: "Batch in", tone: "success" },
  STOCK_OUT_FIFO: { label: "Stock out (FIFO)", tone: "warning" },
  STOCK_OUT_FEFO: { label: "Stock out (FEFO)", tone: "warning" },
  STOCK_ADJUST: { label: "Adjustment", tone: "accent" },
  PURCHASE_RECEIPT: { label: "PO receipt", tone: "success" },
  TRANSFER_OUT: { label: "Transfer out", tone: "info" },
  TRANSFER_IN: { label: "Transfer in", tone: "info" },
  TRANSFER_TRANSIT_IN: { label: "Into transit", tone: "neutral" },
  TRANSFER_TRANSIT_OUT: { label: "Out of transit", tone: "neutral" },
  SALES_SHIPMENT: { label: "Shipment", tone: "warning" },
  SALES_RETURN: { label: "Sales return", tone: "success" },
};

export function ledgerTypeMeta(type: string): { label: string; tone: Tone } {
  return LEDGER_TYPE_META[type] ?? { label: type.replace(/_/g, " ").toLowerCase(), tone: "neutral" };
}

const userRef = z.object({ id: z.number(), username: z.string().nullable() });

export const ledgerItemSchema = z.object({
  // legacy fields — unchanged names and values
  id: z.number(),
  product_id: z.number(),
  batch_id: z.number().nullable(),
  warehouse_id: z.number(),
  location_id: z.number(),
  movement_type: z.string(),
  quantity: decimalString,
  balance_before: decimalString,
  balance_after: decimalString,
  reference_type: z.string().nullable(),
  reference_id: z.number().nullable(),
  reference_number: z.string().nullable(),
  remark: z.string().nullable(),
  created_by_user_id: z.number().nullable(),
  created_at: z.string(),
  // Phase 14C additions
  /** Definitive instant ("…Z"); null when the row's storage zone is unproven. */
  occurred_at: z.string().nullable(),
  timestamp_verified: z.boolean(),
  direction: z.enum(["IN", "OUT"]),
  is_transit_leg: z.boolean(),
  product: z.object({
    id: z.number(),
    sku: z.string().nullable(),
    product_name: z.string().nullable(),
    is_active: z.boolean(),
  }),
  batch: z.object({ id: z.number(), lot_no: z.string().nullable(), expiry_date: z.string().nullable() }).nullable(),
  warehouse: z.object({
    id: z.number(),
    warehouse_code: z.string(),
    warehouse_name: z.string(),
    is_active: z.boolean(),
  }),
  location: z.object({
    id: z.number(),
    location_code: z.string(),
    location_name: z.string().nullable(),
    is_active: z.boolean(),
  }),
  created_by: userRef.nullable(),
  source: z.object({
    type: z.string().nullable(),
    id: z.number().nullable(),
    number: z.string().nullable(),
    receipt_number: z.string().nullable(),
  }),
  adjustment: z
    .object({
      linked: z.boolean(),
      request_id: z.number().nullable(),
      reference_number: z.string().nullable(),
      reason_code: z.string().nullable(),
      status: z.string().nullable(),
      requested_by: userRef.nullable(),
      notes: z.string().nullable(),
      can_view_detail: z.boolean(),
      redacted: z.boolean(),
    })
    .nullable(),
  remark_redacted: z.boolean(),
});
export type LedgerItem = z.infer<typeof ledgerItemSchema>;

export const ledgerEnvelope = apiEnvelope(paginated(ledgerItemSchema));
export type LedgerEnvelope = z.infer<typeof ledgerEnvelope>;

/** Was anything withheld from this viewer on this row? */
export function isRedacted(row: LedgerItem): boolean {
  return row.remark_redacted || Boolean(row.adjustment?.redacted);
}

/**
 * Where a row's source reference leads (D6: existing filtered list pages,
 * no cross-page drawers). Adjustment requests open in place, and only when
 * the backend says this viewer may see the detail.
 */
export type SourceLink =
  | { kind: "adjustment"; requestId: number; label: string }
  | { kind: "list"; href: string; label: string }
  | { kind: "text"; label: string };

export function sourceLink(row: LedgerItem): SourceLink {
  const { type, id, number } = row.source;
  if (type === "STOCK_ADJUSTMENT_REQUEST") {
    const label = row.adjustment?.reference_number ?? number ?? `Request #${id}`;
    if (row.adjustment?.can_view_detail && row.adjustment.request_id !== null) {
      return { kind: "adjustment", requestId: row.adjustment.request_id, label };
    }
    return { kind: "text", label };
  }
  const listPath: Record<string, string> = {
    PURCHASE_ORDER: "/purchase-orders",
    SALES_ORDER: "/sales",
    INVENTORY_TRANSFER: "/transfers",
  };
  if (type && listPath[type] && number) {
    return { kind: "list", href: `${listPath[type]}?search=${encodeURIComponent(number)}`, label: number };
  }
  if (row.movement_type === "STOCK_ADJUST") return { kind: "text", label: "Adjustment (unlinked)" };
  if (type === "STOCK_TRANSACTION") return { kind: "text", label: number ?? `TX-${id}` };
  return { kind: "text", label: number ?? "—" };
}
