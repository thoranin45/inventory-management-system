import type { MessageKey, MessageVars } from "@/lib/i18n/translate";
import { EXPIRED_BATCH_DISPATCH_RE } from "@/lib/api/schemas/transfers";
import type { KeyedMessage, VerbatimMessage } from "@/lib/order-copy";
import { messageText } from "@/lib/master-data-copy";

/**
 * P6 — display-time translation of the transfer copy.
 *
 * TRANSFER_ERROR_COPY and the zod messages in lib/api/schemas/transfers.ts stay
 * as they are; these resolvers map the SAME messages to dictionary keys.
 * transfer-copy.test.ts proves the English dictionary text is identical.
 */

type T = (key: MessageKey, vars?: MessageVars) => string;

/** TRANSFER_ERROR_COPY backend message → key (same entries, same order). */
export const TRANSFER_ERROR_KEY: Record<string, MessageKey> = {
  "Idempotency-Key already used with a different payload": "transfers.errKeyConflict",
  "Receipt exceeds outstanding dispatched quantity": "transfers.errExceedsOutstanding",
  "Transfer item does not belong to this transfer": "transfers.errItemNotInTransfer",
  "Not enough stock": "transfers.errNotEnoughStock",
  "Transfer state conflict: IN_TRANSIT": "transfers.errAlreadyDispatched",
  "System transit storage is not operationally selectable": "transfers.errTransitNotSelectable",
  "Source and destination warehouses must differ": "transfers.errSameWarehouse",
  "Inventory transfer is cancelled": "transfers.errCannotCancel",
  "Immediate transfer completion is retired; dispatch this transfer then receive it": "transfers.errCompleteRetired",
};

/** Mirrors `TRANSFER_ERROR_COPY[raw]`, plus the expired-batch dispatch message. */
export function transferErrorMessage(raw: string | undefined): KeyedMessage | undefined {
  if (!raw) return undefined;
  if (TRANSFER_ERROR_KEY[raw]) return { key: TRANSFER_ERROR_KEY[raw] };
  if (EXPIRED_BATCH_DISPATCH_RE.test(raw)) return { key: "transfers.errExpiredBatch", vars: { message: raw } };
  return undefined;
}

/** Backend error → copy in the UI language, else the fallback (the API's own message). */
export function transferErrorText(t: T, raw: string | undefined, fallback: string): string {
  const m = transferErrorMessage(raw);
  return m ? t(m.key, m.vars) : fallback;
}

const FORM_FIXED: Record<string, MessageKey> = {
  "Choose a product": "transfers.errChooseProduct",
  "Choose a source": "transfers.errChooseSource",
  "Choose a destination": "transfers.errChooseDestination",
  "Choose a source warehouse": "transfers.errChooseSourceWarehouse",
  "Choose a destination warehouse": "transfers.errChooseDestinationWarehouse",
  "Add at least one line": "transfers.errAddLine",
  "Source and destination must be different warehouses": "transfers.errSameWarehouseField",
  "Two lines have the same product / batch / source / destination": "transfers.errDuplicateLine",
  "Enter a quantity on at least one line": "transfers.errEnterQuantity",
  "The same line appears twice in this receipt": "transfers.errDuplicateReceiptLine",
  "Quantity must be a number": "transfers.errQtyNumber",
  "Quantity must be greater than 0": "transfers.errQtyPositive",
  "Quantity allows at most 3 decimal places": "transfers.errQtyScale",
};

/** A createTransferInput / transferReceiveInput zod message as a key; unknown messages are shown as sent. */
export function transferFormMessage(message: string): KeyedMessage | VerbatimMessage {
  return FORM_FIXED[message] ? { key: FORM_FIXED[message] } : { verbatim: message };
}

export function transferFormText(t: T, message: string | undefined): string | undefined {
  return message ? messageText(t, transferFormMessage(message)) : undefined;
}
