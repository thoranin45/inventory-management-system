import type { MessageKey, MessageVars } from "@/lib/i18n/translate";
import { SO_STATE_CONFLICT_RE } from "@/lib/api/schemas/sales";

/**
 * R5 (D-R5-10) — display-time translation of the sales / purchasing copy maps.
 *
 * The English maps in lib/api/schemas/{sales,purchase-orders}.ts stay as they
 * are (tests and meaning depend on them). These resolvers map the SAME codes
 * and messages to dictionary keys, so the UI shows them in the user's
 * language. order-copy.test.ts proves, entry by entry, that the English
 * dictionary text equals the existing English copy.
 */

export interface KeyedMessage {
  key: MessageKey;
  vars?: MessageVars;
}
/** A message the UI shows exactly as the backend sent it (it carries data, e.g. "Remaining: N"). */
export interface VerbatimMessage {
  verbatim: string;
}

/* ------------------------------------------------------------ status tabs */

const STATUS_TAB: Record<string, MessageKey> = {
  DRAFT: "status.DRAFT",
  CONFIRMED: "status.CONFIRMED",
  PICKING: "status.PICKING",
  PACKING: "status.PACKING",
  READY_TO_SHIP: "status.READY_TO_SHIP",
  PARTIALLY_RECEIVED: "status.PARTIALLY_RECEIVED",
  RECEIVED: "status.RECEIVED",
  CANCELLED: "status.CANCELLED",
};

/** SO_FILTER_TABS / PO_FILTER_TABS key → label key */
export function filterTabKey(tab: string): MessageKey {
  if (tab === "all") return "orders.tabAll";
  if (tab === "attention") return "orders.tabAttention";
  return STATUS_TAB[tab] ?? "orders.tabAll";
}

/* ------------------------------------------------------------ attention */

const ATTENTION: Record<string, MessageKey> = {
  expired_allocation: "orders.attentionExpiredAllocation",
};

export function attentionMessage(reason: string): KeyedMessage {
  return ATTENTION[reason]
    ? { key: ATTENTION[reason] }
    : { key: "orders.attentionGeneric", vars: { reason: reason.replace(/_/g, " ") } };
}

/* ------------------------------------------------------------ scan errors */

const SCAN_ERROR: Record<string, MessageKey> = {
  BARCODE_NOT_FOUND: "fulfil.errBarcodeNotFound",
  PRODUCT_NOT_IN_ORDER: "fulfil.errProductNotInOrder",
  ALLOCATION_IDENTIFICATION_REQUIRED: "fulfil.errAllocationRequired",
  ALLOCATION_SCAN_EXCEEDS_REMAINING: "fulfil.errExceedsRemaining",
  ALLOCATION_NOT_IN_ORDER: "fulfil.errAllocationNotInOrder",
  SCANNED_PRODUCT_MISMATCHES_LINE: "fulfil.errMismatchesLine",
  UNDO_BELOW_ZERO: "fulfil.errUndoBelowZero",
  UNDO_BELOW_PACKED: "fulfil.errUndoBelowPacked",
};

/** SCAN_ERROR_COPY code → key (null when the code is not a known scan error) */
export function scanErrorKey(code: string): MessageKey | null {
  return SCAN_ERROR[code] ?? null;
}

/* ------------------------------------------------------- ship / return errors */

const SHIP_ERROR: Record<string, MessageKey> = {
  "Insufficient reserved or on-hand stock": "sales.errInsufficientReserved",
  "Only completed Sales Order can be returned": "sales.errOnlyShippedReturn",
  "Idempotency-Key already used with a different payload": "sales.errReturnKeyConflict",
};

/** Mirrors `shipErrorCopy` exactly, as a key (or the backend text where that copy shows it verbatim). */
export function shipErrorMessage(message: string | undefined): KeyedMessage | VerbatimMessage | undefined {
  if (!message) return undefined;
  if (SHIP_ERROR[message]) return { key: SHIP_ERROR[message] };
  const m = SO_STATE_CONFLICT_RE.exec(message);
  if (m) return { key: "sales.errStateConflict", vars: { current: m[1], required: m[2] } };
  if (/^Allocation not completely picked and packed/.test(message)) return { key: "sales.errNotFullyPacked" };
  if (/^Expired allocated batch/.test(message)) return { key: "sales.errExpiredAllocated", vars: { message } };
  if (/^Return quantity exceeds remaining returnable/.test(message)) return { verbatim: message };
  if (/not found in this sales order$/.test(message)) return { verbatim: message };
  return undefined;
}

/* ------------------------------------------------------- form validation */

/**
 * The zod messages of createSalesOrderInput / createPurchaseOrderInput and the
 * sales-return line rules (lib/workflow/return-submission), as keys. Unknown
 * messages fall back to the original text.
 */
const FORM_FIXED: Record<string, MessageKey> = {
  "Choose a customer": "orders.errChooseCustomer",
  "Choose a supplier": "orders.errChooseSupplier",
  "Choose a product": "orders.errChooseProduct",
  "Add at least one product line": "orders.errAddLine",
  "The same product appears on more than one line": "orders.errDuplicateProduct",
  "Unit price must be a number": "orders.errUnitPriceNumber",
  "Unit price cannot be negative": "orders.errUnitPriceNegative",
  "At most 2 decimal places": "orders.errMoneyScale",
  "Quantity must be a number with up to 3 decimals": "sales.errReturnQtyFormat",
  "Quantity must be greater than zero": "sales.errReturnQtyPositive",
  "Reason must be 255 characters or fewer": "sales.errReturnReasonLength",
};
const FIELD: Record<string, MessageKey> = {
  Quantity: "orders.fieldQuantity",
  "Unit price": "orders.fieldUnitPrice",
};

export function formMessage(message: string): KeyedMessage | VerbatimMessage {
  if (FORM_FIXED[message]) return { key: FORM_FIXED[message] };
  let m = /^(Quantity|Unit price) must be a number$/.exec(message);
  if (m) return { key: "orders.errFieldNumber", vars: { field: m[1] } };
  m = /^(Quantity|Unit price) must be greater than 0$/.exec(message);
  if (m) return { key: "orders.errFieldPositive", vars: { field: m[1] } };
  m = /^(Quantity|Unit price) allows at most (\d) decimal places$/.exec(message);
  if (m) return { key: "orders.errFieldScale", vars: { field: m[1], dp: m[2] } };
  return { verbatim: message };
}

/** the field name inside a form message, as a key (so "{field}" is translated too) */
export function fieldKey(field: string): MessageKey | null {
  return FIELD[field] ?? null;
}
