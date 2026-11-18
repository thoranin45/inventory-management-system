import type { MessageKey, MessageVars } from "@/lib/i18n/translate";
import { DICTIONARIES } from "@/lib/i18n/translate";
import { EXPORT_ROW_CAP_RE, type ExpirySeries, type ReportExport } from "@/lib/api/schemas/reports";
import type { ReportGroup } from "./registry";

/**
 * P6 — display-time translation of the report copy.
 *
 * The English registry (lib/reports/registry.ts) and the English maps in
 * lib/api/schemas/reports.ts stay as they are (tests and meaning depend on
 * them). These resolvers map the SAME slugs, codes and messages to dictionary
 * keys. report-copy.test.ts proves the English dictionary text is identical.
 */

type T = (key: MessageKey, vars?: MessageVars) => string;

export const REPORT_TITLE_KEY: Record<string, { title: MessageKey; blurb: MessageKey }> = {
  "operational-stock": { title: "reports.tOperationalStock", blurb: "reports.bOperationalStock" },
  expired: { title: "reports.tExpired", blurb: "reports.bExpired" },
  "near-expiry": { title: "reports.tNearExpiry", blurb: "reports.bNearExpiry" },
  "in-transit": { title: "reports.tInTransit", blurb: "reports.bInTransit" },
  "low-stock": { title: "reports.tLowStock", blurb: "reports.bLowStock" },
  movements: { title: "reports.tMovements", blurb: "reports.bMovements" },
  sales: { title: "reports.tSales", blurb: "reports.bSales" },
  "purchase-orders": { title: "reports.tPurchaseOrders", blurb: "reports.bPurchaseOrders" },
  transfers: { title: "reports.tTransfers", blurb: "reports.bTransfers" },
};

export const REPORT_GROUP_KEY: Record<ReportGroup, MessageKey> = {
  Inventory: "reports.groupInventory",
  Orders: "reports.groupOrders",
};

export const REPORT_EXPORT_KEY: Record<ReportExport["key"], { title: MessageKey; description: MessageKey }> = {
  stock: { title: "reports.xStockTitle", description: "reports.xStockDesc" },
  sales: { title: "reports.xSalesTitle", description: "reports.xSalesDesc" },
  "low-stock": { title: "reports.xLowStockTitle", description: "reports.xLowStockDesc" },
  expiring: { title: "reports.xExpiringTitle", description: "reports.xExpiringDesc" },
};

export const REPORT_PARAM_KEY: Record<"threshold" | "days", MessageKey> = {
  threshold: "reports.paramThreshold",
  days: "reports.paramDays",
};

export const MOVEMENT_TYPE_KEY: Record<string, MessageKey> = {
  IN: "reports.mvIN",
  IN_PO: "reports.mvIN_PO",
  IN_BATCH: "reports.mvIN_BATCH",
  OUT_FEFO: "reports.mvOUT_FEFO",
  OUT_FIFO: "reports.mvOUT_FIFO",
  ADJUST: "reports.mvADJUST",
  SALE_SHIPMENT: "reports.mvSALE_SHIPMENT",
  SALE_RETURN: "reports.mvSALE_RETURN",
};

/** Mirrors `movementTypeLabel`: unknown codes are humanized, not translated. */
export function movementTypeText(t: T, code: string): string {
  const key = MOVEMENT_TYPE_KEY[code];
  return key ? t(key) : code.replace(/_/g, " ").toLowerCase();
}

export const EXPIRY_SERIES_KEY: Record<ExpirySeries, MessageKey> = {
  eligible: "reports.seriesEligible",
  near_expiry: "reports.seriesNear",
  expired: "reports.seriesExpired",
  no_expiry: "reports.seriesNoExpiry",
};

/** Mirrors `reportErrorCopy`, as a key. */
export function reportErrorKey(message: string | undefined): MessageKey | undefined {
  if (!message) return undefined;
  if (EXPORT_ROW_CAP_RE.test(message)) return "reports.errTooLarge";
  if (/^Unknown sort field/.test(message)) return "reports.errUnknownSort";
  return undefined;
}

export function reportErrorText(t: T, message: string | undefined, fallback: string): string {
  const key = reportErrorKey(message);
  return key ? t(key) : fallback;
}

/** An order / transfer status in the UI language; unknown codes fall back to the English map. */
export function statusText(t: T, status: string, fallback: Record<string, string>): string {
  return status in DICTIONARIES.en.status ? t(`status.${status}` as MessageKey) : (fallback[status] ?? status);
}
