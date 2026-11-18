import type { MessageKey, MessageVars } from "@/lib/i18n/translate";
import type { KeyedMessage, VerbatimMessage } from "@/lib/order-copy";

/**
 * P6 — display-time translation of the master-data and product copy.
 *
 * The English maps and zod messages in lib/api/schemas/{master-data,products}.ts
 * stay as they are (tests and meaning depend on them). These resolvers map the
 * SAME backend messages and zod messages to dictionary keys, so the UI shows
 * them in the user's language. master-data-copy.test.ts proves, entry by entry,
 * that the English dictionary text equals the existing English copy.
 */

type T = (key: MessageKey, vars?: MessageVars) => string;

/** Render a keyed or verbatim message in the current language. */
export function messageText(t: T, m: KeyedMessage | VerbatimMessage): string {
  return "key" in m ? t(m.key, m.vars) : m.verbatim;
}

/* ------------------------------------------------------- backend errors */

/** MASTER_DATA_ERROR_COPY backend message → key (same entries, same order). */
export const MASTER_DATA_ERROR_KEY: Record<string, MessageKey> = {
  "SKU already exists": "masterData.errSkuExists",
  "Barcode already exists": "masterData.errBarcodeExists",
  "Category not found": "masterData.errCategoryNotFound",
  "Category already exists": "masterData.errCategoryExists",
  "Cannot delete category with active products": "masterData.errCategoryInUse",
  "Customer already exists": "masterData.errCustomerExists",
  "Supplier already exists": "masterData.errSupplierExists",
  "Database constraint error": "masterData.errReferenced",
  "track_expiry requires track_batch=True": "masterData.errExpiryNeedsBatch",
  "Tracking mode cannot change after inventory or allocation history exists": "masterData.errTrackingLocked",
  "Inactive product not found": "masterData.errAlreadyActive",
  "Product not found": "masterData.errProductNotFound",
  "Image exceeds the 5242880 byte limit": "masterData.errImageTooLarge",
  "File is not a valid image": "masterData.errImageInvalid",
  "A supported image Content-Type is required": "masterData.errImageType",
  "Only jpg, jpeg, png, and webp files are allowed": "masterData.errImageOnly",
  "Uploaded file is empty": "masterData.errFileEmpty",
};

/** Mirrors `masterDataErrorCopy` exactly, as a key. */
export function masterDataErrorKey(message: string | undefined): MessageKey | undefined {
  if (!message) return undefined;
  if (MASTER_DATA_ERROR_KEY[message]) return MASTER_DATA_ERROR_KEY[message];
  if (/^Image exceeds the \d+ byte limit$/.test(message)) return "masterData.errImageTooLarge";
  return undefined;
}

/* ------------------------------------------------------- form validation */

/**
 * The zod messages of the category / customer / supplier / product input
 * schemas and of validateImageFile, as keys. Unknown messages (for example a
 * backend 422 detail) are shown as sent.
 */
const FORM_FIXED: Record<string, MessageKey> = {
  "Enter a valid email address": "masterData.errEmail",
  "Use letters, digits, dot, dash or underscore": "masterData.errSkuChars",
  "Use letters, digits or dashes only": "masterData.errBarcodeChars",
  "Price must be a number with up to 2 decimals": "masterData.errPriceFormat",
  "Quantity must be a number with up to 3 decimals": "masterData.errQtyFormat",
  "Expiry tracking needs batch tracking switched on": "masterData.errExpiryNeedsBatchField",
  "Choose a JPEG, PNG or WebP image.": "masterData.errImageType",
  "Image is too large. The limit is 5 MiB.": "masterData.errImageTooLarge",
  "That file is empty.": "masterData.errFileEmpty",
};

/** zod field label → key, so "{field}" is translated too */
const FIELD: Record<string, MessageKey> = {
  "Category name": "masterData.categoryName",
  "Customer name": "masterData.customerName",
  "Supplier name": "masterData.supplierName",
  "Contact name": "masterData.contactName",
  Phone: "masterData.phone",
  Email: "masterData.email",
  Address: "masterData.address",
  SKU: "product.sku",
  Barcode: "product.barcode",
  "Product name": "product.productName",
  Price: "masterData.fieldPrice",
};

const FIELD_ALT = Object.keys(FIELD)
  .map((f) => f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  .join("|");
const REQUIRED_RE = new RegExp(`^(${FIELD_ALT}) is required$`);
const TOO_LONG_RE = new RegExp(`^(${FIELD_ALT}) must be (\\d+) characters or fewer$`);

/**
 * A zod / file-check message as a key. `{field}` is passed as the English
 * label; `fieldText` translates it before display.
 */
export function masterFormMessage(message: string): KeyedMessage | VerbatimMessage {
  if (FORM_FIXED[message]) return { key: FORM_FIXED[message] };
  let m = REQUIRED_RE.exec(message);
  if (m) return { key: "masterData.errRequired", vars: { field: m[1] } };
  m = TOO_LONG_RE.exec(message);
  if (m) return { key: "masterData.errTooLong", vars: { field: m[1], max: m[2] } };
  return { verbatim: message };
}

/** Translate a form message, including its `{field}` label. */
export function formMessageText(t: T, message: string | undefined): string | undefined {
  if (!message) return undefined;
  const m = masterFormMessage(message);
  if ("key" in m && m.vars && typeof m.vars.field === "string" && FIELD[m.vars.field]) {
    return t(m.key, { ...m.vars, field: t(FIELD[m.vars.field]) });
  }
  return messageText(t, m);
}

/** Backend error → operator copy in the current language (falls back to the API's own message). */
export function masterDataErrorText(t: T, message: string | undefined, fallback: string): string {
  const key = masterDataErrorKey(message);
  return key ? t(key) : fallback;
}
