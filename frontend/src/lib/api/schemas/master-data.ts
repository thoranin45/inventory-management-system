import { z } from "zod";

import { apiEnvelope, decimalString, paginated } from "./common";

/**
 * Phase 7 — Product & Master-Data CRUD contract, verified against the live
 * FastAPI backend (Phases 1–9 frozen). The write schemas here mirror the
 * ACTUAL `*Create` / `*Update` Pydantic models — deliberately small. Fields
 * the Phase 7 brief guessed at (brand, base_unit, shelf_life_days, the stock
 * thresholds, is_active…) are NOT in the backend contract and are not sent.
 */

/* ============================================================ shared ===== */

/** Backend error `message` strings → operator-facing copy. */
export const MASTER_DATA_ERROR_COPY: Record<string, string> = {
  "SKU already exists": "That SKU is already used by another product.",
  "Barcode already exists": "That barcode is already used by another product.",
  "Category not found": "That category no longer exists — reload and pick another.",
  "Category already exists": "A category with that name already exists.",
  "Cannot delete category with active products":
    "This category still has active products. Move or deactivate them first.",
  "Customer already exists": "A customer with that name already exists.",
  "Supplier already exists": "A supplier with that name already exists.",
  "Database constraint error":
    "This record is referenced by existing orders and can't be deleted.",
  "track_expiry requires track_batch=True": "Expiry tracking needs batch tracking switched on.",
  "Tracking mode cannot change after inventory or allocation history exists":
    "Batch tracking can't change once this product has stock or movement history.",
  "Inactive product not found": "That product is already active.",
  "Product not found": "That product no longer exists.",
  "Image exceeds the 5242880 byte limit": "Image is too large. The limit is 5 MiB.",
  "File is not a valid image": "That file isn't a valid JPEG, PNG or WebP image.",
  "A supported image Content-Type is required": "Choose a JPEG, PNG or WebP image.",
  "Only jpg, jpeg, png, and webp files are allowed": "Only JPEG, PNG and WebP images are allowed.",
  "Uploaded file is empty": "That file is empty.",
};

export function masterDataErrorCopy(message: string | undefined): string | undefined {
  if (!message) return undefined;
  if (MASTER_DATA_ERROR_COPY[message]) return MASTER_DATA_ERROR_COPY[message];
  // 413 message embeds the byte cap; match loosely.
  if (/^Image exceeds the \d+ byte limit$/.test(message)) return "Image is too large. The limit is 5 MiB.";
  return undefined;
}

const trimmed = (max: number, label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .max(max, `${label} must be ${max} characters or fewer`);

/** optional free-text: "" → undefined so we never POST an empty string. */
const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be ${max} characters or fewer`)
    .optional()
    .transform((v) => (v ? v : undefined));

/** optional e-mail: validated only when non-empty (backend stores a plain string). */
const optionalEmail = z
  .string()
  .trim()
  .max(255, "Email must be 255 characters or fewer")
  .optional()
  .transform((v) => (v ? v : undefined))
  .refine((v) => v === undefined || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "Enter a valid email address");

/* ========================================================== categories === */

export const categoryRowSchema = z.object({
  id: z.number(),
  category_name: z.string(),
});
export type CategoryRow = z.infer<typeof categoryRowSchema>;

export const categoryListEnvelope = apiEnvelope(paginated(categoryRowSchema));
export const categoryMutationEnvelope = apiEnvelope(categoryRowSchema);
export type CategoryListEnvelope = z.infer<typeof categoryListEnvelope>;

export const categoryInput = z.object({
  category_name: trimmed(255, "Category name"),
});
export type CategoryInput = z.infer<typeof categoryInput>;

export const CATEGORY_SORT_FIELDS = ["id", "category_name"] as const;

/* =========================================================== customers === */

export const customerRowSchema = z.object({
  id: z.number(),
  customer_name: z.string(),
  phone: z.string().nullish(),
  email: z.string().nullish(),
  address: z.string().nullish(),
});
export type CustomerRow = z.infer<typeof customerRowSchema>;

export const customerListEnvelope = apiEnvelope(paginated(customerRowSchema));
export const customerMutationEnvelope = apiEnvelope(customerRowSchema);
export type CustomerListEnvelope = z.infer<typeof customerListEnvelope>;

export const customerInput = z.object({
  customer_name: trimmed(255, "Customer name"),
  phone: optionalText(50, "Phone"),
  email: optionalEmail,
  address: optionalText(500, "Address"),
});
export type CustomerInput = z.infer<typeof customerInput>;

export const CUSTOMER_SORT_FIELDS = ["id", "customer_name"] as const;

/* =========================================================== suppliers === */

export const supplierRowSchema = z.object({
  id: z.number(),
  supplier_name: z.string(),
  contact_name: z.string().nullish(),
  phone: z.string().nullish(),
  email: z.string().nullish(),
  address: z.string().nullish(),
});
export type SupplierRow = z.infer<typeof supplierRowSchema>;

export const supplierListEnvelope = apiEnvelope(paginated(supplierRowSchema));
export const supplierMutationEnvelope = apiEnvelope(supplierRowSchema);
export type SupplierListEnvelope = z.infer<typeof supplierListEnvelope>;

export const supplierInput = z.object({
  supplier_name: trimmed(255, "Supplier name"),
  contact_name: optionalText(255, "Contact name"),
  phone: optionalText(50, "Phone"),
  email: optionalEmail,
  address: optionalText(500, "Address"),
});
export type SupplierInput = z.infer<typeof supplierInput>;

export const SUPPLIER_SORT_FIELDS = ["id", "supplier_name"] as const;

/* ============================================================= batches === */

/** GET /batches row — Phase 8 enriched. Derived expiry fields are authoritative. */
export const batchRowSchema = z.object({
  id: z.number(),
  product_id: z.number(),
  lot_no: z.string(),
  mfg_date: z.string().nullish(),
  expiry_date: z.string().nullish(),
  quantity: decimalString,
  created_at: z.string().nullish(),
  owned_quantity: decimalString.nullish(),
  operational_available_quantity: decimalString.nullish(),
  transit_quantity: decimalString.nullish(),
  days_to_expiry: z.number().nullish(),
  is_expired: z.boolean().nullish(),
  is_near_expiry: z.boolean().nullish(),
  as_of_date: z.string().nullish(),
});
export type BatchRow = z.infer<typeof batchRowSchema>;

export const batchListEnvelope = apiEnvelope(paginated(batchRowSchema));
export const BATCH_SORT_FIELDS = ["id", "created_at", "expiry_date", "lot_no"] as const;
