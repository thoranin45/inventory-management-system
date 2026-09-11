import type { ProductRow } from "@/lib/api/schemas/products";
import { compareDecimals, isZero, type DecimalString } from "@/lib/decimal";

/**
 * Single source of truth for "what is this product's stock status" — used by
 * the Products page, the Stock page, and the Stock-page barcode-scan card, so
 * the three surfaces never disagree.
 *
 * Threshold rule (unchanged from the pre-existing Products page convention):
 *   low stock = operational available < max(safety_stock, minimum_stock)
 *   (threshold of 0 means "no threshold configured" — never flagged low)
 *
 * Priority when more than one condition applies (worst first):
 *   Expired > Out of stock > Near expiry > Low stock > In stock
 */
export type StockStatusKey = "inactive" | "expired" | "out_of_stock" | "near_expiry" | "low_stock" | "in_stock";
export type StockStatusTone = "success" | "warning" | "danger" | "neutral";

export interface StockStatus {
  key: StockStatusKey;
  tone: StockStatusTone;
  label: string;
}

/** Shape common to a full ProductRow and the thinner scan/resolve product payload. */
export interface StockStatusInput {
  operational_available_quantity: DecimalString;
  expired_quantity?: DecimalString | null;
  near_expiry_quantity?: DecimalString | null;
  minimum_stock?: DecimalString | null;
  safety_stock?: DecimalString | null;
  is_active?: boolean;
}

export function lowStockThreshold(p: Pick<StockStatusInput, "minimum_stock" | "safety_stock">): DecimalString {
  const safety = p.safety_stock ?? "0";
  const minimum = p.minimum_stock ?? "0";
  return compareDecimals(safety, minimum) >= 0 ? safety : minimum;
}

export function isLowStock(p: StockStatusInput): boolean {
  const threshold = lowStockThreshold(p);
  if (isZero(threshold)) return false;
  return compareDecimals(p.operational_available_quantity, threshold) < 0;
}

export function isOutOfStock(p: StockStatusInput): boolean {
  return compareDecimals(p.operational_available_quantity, "0") <= 0;
}

export function stockStatus(p: StockStatusInput): StockStatus {
  if (p.is_active === false) return { key: "inactive", tone: "neutral", label: "Inactive" };
  if (!isZero(p.expired_quantity ?? "0")) return { key: "expired", tone: "danger", label: "Expired stock" };
  if (isOutOfStock(p)) return { key: "out_of_stock", tone: "danger", label: "Out of stock" };
  if (!isZero(p.near_expiry_quantity ?? "0")) return { key: "near_expiry", tone: "warning", label: "Near expiry" };
  if (isLowStock(p)) return { key: "low_stock", tone: "warning", label: "Low stock" };
  return { key: "in_stock", tone: "success", label: "In stock" };
}

/** Row-level filter used by the (page-local, disclosed) Stock Status filter. */
export function matchesStockStatusFilter(p: ProductRow, filterKey: StockStatusKey | "all"): boolean {
  if (filterKey === "all") return true;
  return stockStatus(p).key === filterKey;
}

export const STOCK_STATUS_FILTERS: { key: StockStatusKey | "all"; label: string }[] = [
  { key: "all", label: "All status" },
  { key: "in_stock", label: "In stock" },
  { key: "low_stock", label: "Low stock" },
  { key: "out_of_stock", label: "Out of stock" },
  { key: "near_expiry", label: "Near expiry" },
  { key: "expired", label: "Expired" },
];
