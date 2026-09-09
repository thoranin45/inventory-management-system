import { z } from "zod";

/**
 * Phase 9 — Audit Log. Verified against the live backend:
 *   GET /audit-logs/       → require_admin, a BARE ARRAY of AuditLog rows,
 *                            ordered created_at desc. No envelope, no
 *                            pagination, no filter/sort params.
 *   GET /audit-logs/{id}   → require_admin, one bare AuditLog row (404 if missing).
 *
 * The `AuditLog` model has exactly these columns — nothing sensitive
 * (no password / hash / token / header / secret).
 */
export const auditLogSchema = z.object({
  id: z.number(),
  username: z.string().nullable(),
  action: z.string().nullable(),
  table_name: z.string().nullable(),
  record_id: z.number().nullable(),
  description: z.string().nullable(),
  created_at: z.string().nullable(),
});
export type AuditLog = z.infer<typeof auditLogSchema>;

/** The list endpoint returns a bare array (not `{ items: [...] }`). */
export const auditLogListSchema = z.array(auditLogSchema);

/** Readable labels for the entities that appear in `table_name`. */
export const AUDIT_ENTITY_LABEL: Record<string, string> = {
  sales_orders: "Sales order",
  purchase_orders: "Purchase order",
  inventory_transfers: "Transfer",
  products: "Product",
  categories: "Category",
  customers: "Customer",
  suppliers: "Supplier",
  stock_balances: "Stock balance",
  product_batches: "Batch",
  users: "User",
};

export function auditEntityLabel(table: string | null): string {
  if (!table) return "—";
  return AUDIT_ENTITY_LABEL[table] ?? table.replace(/_/g, " ");
}

export function auditActionLabel(action: string | null): string {
  if (!action) return "—";
  return action.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}
