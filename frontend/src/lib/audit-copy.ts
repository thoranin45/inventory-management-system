import type { MessageKey, MessageVars } from "@/lib/i18n/translate";
import { auditActionLabel, auditEntityLabel } from "@/lib/api/schemas/audit";

/**
 * P6 — display-time translation of the audit log's action and entity codes.
 * auditActionLabel / auditEntityLabel in lib/api/schemas/audit.ts stay as
 * they are; audit-copy.test.ts proves the English dictionary text equals what
 * they return. Codes the backend adds later fall back to those helpers.
 */

type T = (key: MessageKey, vars?: MessageVars) => string;

/** Action codes the backend writes to audit_logs.action. */
export const AUDIT_ACTION_KEY: Record<string, MessageKey> = {
  STOCK_IN: "auditCopy.act_STOCK_IN",
  BATCH_IN: "auditCopy.act_BATCH_IN",
  STOCK_OUT_FIFO: "auditCopy.act_STOCK_OUT_FIFO",
  STOCK_OUT_FEFO: "auditCopy.act_STOCK_OUT_FEFO",
  STOCK_ADJUST: "auditCopy.act_STOCK_ADJUST",
  CREATE_ADJUSTMENT_REQUEST: "auditCopy.act_CREATE_ADJUSTMENT_REQUEST",
  APPROVE_ADJUSTMENT_REQUEST: "auditCopy.act_APPROVE_ADJUSTMENT_REQUEST",
  REJECT_ADJUSTMENT_REQUEST: "auditCopy.act_REJECT_ADJUSTMENT_REQUEST",
  CANCEL_ADJUSTMENT_REQUEST: "auditCopy.act_CANCEL_ADJUSTMENT_REQUEST",
  CREATE_SALES_ORDER: "auditCopy.act_CREATE_SALES_ORDER",
  CONFIRM_SALES_ORDER: "auditCopy.act_CONFIRM_SALES_ORDER",
  CANCEL_SALES_ORDER: "auditCopy.act_CANCEL_SALES_ORDER",
  START_PICKING: "auditCopy.act_START_PICKING",
  SCAN_PICK: "auditCopy.act_SCAN_PICK",
  PICK_UNDO: "auditCopy.act_PICK_UNDO",
  COMPLETE_PICKING: "auditCopy.act_COMPLETE_PICKING",
  SCAN_PACK: "auditCopy.act_SCAN_PACK",
  PACK_UNDO: "auditCopy.act_PACK_UNDO",
  COMPLETE_PACKING: "auditCopy.act_COMPLETE_PACKING",
  SHIP_SALES_ORDER: "auditCopy.act_SHIP_SALES_ORDER",
  COMPLETE: "auditCopy.act_COMPLETE",
  SALES_RETURN: "auditCopy.act_SALES_RETURN",
  CREATE_TRANSFER: "auditCopy.act_CREATE_TRANSFER",
  DISPATCH_TRANSFER: "auditCopy.act_DISPATCH_TRANSFER",
  RECEIVE_TRANSFER: "auditCopy.act_RECEIVE_TRANSFER",
  CANCEL_TRANSFER: "auditCopy.act_CANCEL_TRANSFER",
  CREATE_PURCHASE_ORDER: "auditCopy.act_CREATE_PURCHASE_ORDER",
  CONFIRM_PURCHASE_ORDER: "auditCopy.act_CONFIRM_PURCHASE_ORDER",
  RECEIVE_PURCHASE_ORDER: "auditCopy.act_RECEIVE_PURCHASE_ORDER",
  CANCEL_PURCHASE_ORDER: "auditCopy.act_CANCEL_PURCHASE_ORDER",
  CREATE_PRODUCT: "auditCopy.act_CREATE_PRODUCT",
  UPDATE_PRODUCT: "auditCopy.act_UPDATE_PRODUCT",
  SOFT_DELETE_PRODUCT: "auditCopy.act_SOFT_DELETE_PRODUCT",
  RESTORE_PRODUCT: "auditCopy.act_RESTORE_PRODUCT",
  UPLOAD_PRODUCT_IMAGE: "auditCopy.act_UPLOAD_PRODUCT_IMAGE",
  DERIVE_INVENTORY_TOTAL: "auditCopy.act_DERIVE_INVENTORY_TOTAL",
  CREATE_COMPANY_PROFILE: "auditCopy.act_CREATE_COMPANY_PROFILE",
  UPDATE_COMPANY_PROFILE: "auditCopy.act_UPDATE_COMPANY_PROFILE",
};

/** Table names the backend writes to audit_logs.table_name. */
export const AUDIT_ENTITY_KEY: Record<string, MessageKey> = {
  sales_orders: "auditCopy.ent_sales_orders",
  purchase_orders: "auditCopy.ent_purchase_orders",
  inventory_transfers: "auditCopy.ent_inventory_transfers",
  products: "auditCopy.ent_products",
  categories: "auditCopy.ent_categories",
  customers: "auditCopy.ent_customers",
  suppliers: "auditCopy.ent_suppliers",
  stock_balances: "auditCopy.ent_stock_balances",
  product_batches: "auditCopy.ent_product_batches",
  users: "auditCopy.ent_users",
  stock_adjustment_requests: "auditCopy.ent_stock_adjustment_requests",
  stock_transactions: "auditCopy.ent_stock_transactions",
  inventory_movements: "auditCopy.ent_inventory_movements",
  inventory_transfer_items: "auditCopy.ent_inventory_transfer_items",
  warehouses: "auditCopy.ent_warehouses",
  warehouse_locations: "auditCopy.ent_warehouse_locations",
  company_profile: "auditCopy.ent_company_profile",
};

export function auditActionText(t: T, action: string | null): string {
  const key = action ? AUDIT_ACTION_KEY[action] : undefined;
  return key ? t(key) : auditActionLabel(action);
}

export function auditEntityText(t: T, table: string | null): string {
  const key = table ? AUDIT_ENTITY_KEY[table] : undefined;
  return key ? t(key) : auditEntityLabel(table);
}
