import type { MessageKey, MessageVars } from "@/lib/i18n/translate";
import type { LedgerItem } from "@/lib/api/schemas/inventory-movements";
import { sourceLink } from "@/lib/api/schemas/inventory-movements";

/**
 * P6 — display-time translation of the inventory ledger copy. The English maps
 * in lib/api/schemas/inventory-movements.ts stay as they are; ledger-copy.test.ts
 * proves the English dictionary text is identical.
 */

type T = (key: MessageKey, vars?: MessageVars) => string;

export const MOVEMENT_GROUP_KEY: Record<string, MessageKey> = {
  IN: "ledger.groupIN",
  OUT: "ledger.groupOUT",
  ADJUSTMENT: "ledger.groupADJUSTMENT",
  TRANSFER: "ledger.groupTRANSFER",
  SALES: "ledger.groupSALES",
  PURCHASE: "ledger.groupPURCHASE",
};

export const LEDGER_TYPE_KEY: Record<string, MessageKey> = {
  STOCK_IN: "ledger.typeSTOCK_IN",
  BATCH_IN: "ledger.typeBATCH_IN",
  STOCK_OUT_FIFO: "ledger.typeSTOCK_OUT_FIFO",
  STOCK_OUT_FEFO: "ledger.typeSTOCK_OUT_FEFO",
  STOCK_ADJUST: "ledger.typeSTOCK_ADJUST",
  PURCHASE_RECEIPT: "ledger.typePURCHASE_RECEIPT",
  TRANSFER_OUT: "ledger.typeTRANSFER_OUT",
  TRANSFER_IN: "ledger.typeTRANSFER_IN",
  TRANSFER_TRANSIT_IN: "ledger.typeTRANSFER_TRANSIT_IN",
  TRANSFER_TRANSIT_OUT: "ledger.typeTRANSFER_TRANSIT_OUT",
  SALES_SHIPMENT: "ledger.typeSALES_SHIPMENT",
  SALES_RETURN: "ledger.typeSALES_RETURN",
};

/** Mirrors `ledgerTypeMeta(type).label`: unknown types are humanized, not translated. */
export function ledgerTypeText(t: T, type: string): string {
  const key = LEDGER_TYPE_KEY[type];
  return key ? t(key) : type.replace(/_/g, " ").toLowerCase();
}

/** `sourceLink(row).label`, with its one fixed English text translated. Document numbers stay as they are. */
export function sourceLabelText(t: T, row: LedgerItem): string {
  const link = sourceLink(row);
  return link.kind === "text" && link.label === "Adjustment (unlinked)" ? t("ledger.adjustmentUnlinked") : link.label;
}
