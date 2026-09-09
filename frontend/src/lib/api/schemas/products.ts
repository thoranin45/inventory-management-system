import { z } from "zod";
import { apiEnvelope, decimalString, paginated } from "./common";
import { MASTER_DATA_ERROR_COPY, masterDataErrorCopy } from "./master-data";

/**
 * GET /api/v1/products — Phase 8 list contract:
 *   ApiResponse<PaginatedData<ProductRow>>
 * Row shape verified against a live backend response (enrich_products()).
 * All quantities arrive as fixed-scale decimal strings ("480.000", "0").
 * stock_qty keeps its Phase 2 meaning (total owned) and is echoed as
 * owned_quantity — do not redefine it.
 */
export const productRowSchema = z.object({
  id: z.number(),
  sku: z.string(),
  barcode: z.string().nullish(),
  product_name: z.string(),
  price: decimalString.nullish(),
  stock_qty: decimalString,
  owned_quantity: decimalString,
  operational_available_quantity: decimalString,
  reserved_quantity: decimalString,
  expired_quantity: decimalString,
  near_expiry_quantity: decimalString,
  transit_quantity: decimalString,
  minimum_stock: decimalString.nullish(),
  safety_stock: decimalString.nullish(),
  maximum_stock: decimalString.nullish(),
  category_id: z.number().nullable(),
  image_url: z.string().nullable(),
  is_active: z.boolean(),
  created_at: z.string().nullish(),
  track_batch: z.boolean(),
  track_expiry: z.boolean(),
  as_of_date: z.string(),
});
export type ProductRow = z.infer<typeof productRowSchema>;

export const productListEnvelope = apiEnvelope(paginated(productRowSchema));
export type ProductListEnvelope = z.infer<typeof productListEnvelope>;

/** Sort fields the backend accepts for /products (resolve_ordering allow-list). */
export const PRODUCT_SORT_FIELDS = ["id", "product_name", "sku", "stock_qty", "created_at"] as const;
export type ProductSortField = (typeof PRODUCT_SORT_FIELDS)[number];

/** Inventory filter tabs → the backend query they compose. */
export const PRODUCT_FILTERS = [
  { key: "all", label: "All" },
  { key: "low", label: "Low stock" },
  { key: "expired", label: "Expired" },
  { key: "near", label: "Near expiry" },
  { key: "transit", label: "In transit" },
  { key: "inactive", label: "Inactive" },
] as const;
export type ProductFilterKey = (typeof PRODUCT_FILTERS)[number]["key"];

/* ================================================ Phase 7: detail + CRUD === */

/**
 * `GET /products/{id}` / create / update / delete / restore / upload-image all
 * return `ApiResponse<ProductResponse>` — the base row only. It does NOT carry
 * derived quantities or the stock thresholds; those live on the list row.
 */
export const productDetailSchema = z.object({
  id: z.number(),
  sku: z.string(),
  barcode: z.string().nullish(),
  product_name: z.string(),
  price: decimalString.nullish(),
  stock_qty: decimalString,
  category_id: z.number().nullable(),
  image_url: z.string().nullable(),
  is_active: z.boolean(),
  created_at: z.string().nullish(),
  track_batch: z.boolean(),
  track_expiry: z.boolean(),
});
export type ProductDetail = z.infer<typeof productDetailSchema>;

export const productDetailEnvelope = apiEnvelope(productDetailSchema);

/** SKU / barcode allowed characters — mirrors a sensible superset of the seed data. */
export const SKU_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
export const BARCODE_RE = /^[A-Za-z0-9-]+$/;

const priceString = z
  .string()
  .trim()
  .min(1, "Price is required")
  .regex(/^\d+(\.\d{1,2})?$/, "Price must be a number with up to 2 decimals");

const qtyString = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v && v.length ? v : undefined))
  .refine(
    (v) => v === undefined || /^\d+(\.\d{1,3})?$/.test(v),
    "Quantity must be a number with up to 3 decimals",
  );

/**
 * `ProductCreate`. `track_expiry ⇒ track_batch` is enforced here (the backend
 * enforces it on update; we mirror it everywhere so the operator can't submit
 * an impossible combination).
 */
export const productCreateInput = z
  .object({
    sku: z.string().trim().min(1, "SKU is required").max(50, "SKU must be 50 characters or fewer").regex(SKU_RE, "Use letters, digits, dot, dash or underscore"),
    barcode: z
      .string()
      .trim()
      .max(64, "Barcode must be 64 characters or fewer")
      .optional()
      .transform((v) => (v ? v : undefined))
      .refine((v) => v === undefined || BARCODE_RE.test(v), "Use letters, digits or dashes only"),
    product_name: z.string().trim().min(1, "Product name is required").max(255, "Product name must be 255 characters or fewer"),
    price: priceString,
    stock_qty: qtyString,
    category_id: z.number().int().positive().nullable().optional(),
    track_batch: z.boolean().default(false),
    track_expiry: z.boolean().default(false),
  })
  .refine((v) => !v.track_expiry || v.track_batch, {
    message: "Expiry tracking needs batch tracking switched on",
    path: ["track_expiry"],
  });
export type ProductCreateInput = z.infer<typeof productCreateInput>;

/** `ProductUpdate` — every field optional; same tracking-relationship rule. */
export const productUpdateInput = z
  .object({
    sku: z.string().trim().min(1, "SKU is required").max(50).regex(SKU_RE, "Use letters, digits, dot, dash or underscore").optional(),
    barcode: z
      .string()
      .trim()
      .max(64)
      .optional()
      .transform((v) => (v === undefined ? undefined : v === "" ? null : v))
      .refine((v) => v === undefined || v === null || BARCODE_RE.test(v), "Use letters, digits or dashes only"),
    product_name: z.string().trim().min(1, "Product name is required").max(255).optional(),
    price: priceString.optional(),
    category_id: z.number().int().positive().nullable().optional(),
    track_batch: z.boolean().optional(),
    track_expiry: z.boolean().optional(),
  })
  .refine((v) => !(v.track_expiry === true) || v.track_batch !== false, {
    message: "Expiry tracking needs batch tracking switched on",
    path: ["track_expiry"],
  });
export type ProductUpdateInput = z.infer<typeof productUpdateInput>;

/** Image upload constraints — must match app/services/product_service.py (Phase 9). */
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const IMAGE_ACCEPT = ["image/jpeg", "image/png", "image/webp"] as const;
export const IMAGE_ACCEPT_ATTR = "image/jpeg,image/png,image/webp";

export function validateImageFile(file: File): string | null {
  if (!(IMAGE_ACCEPT as readonly string[]).includes(file.type)) {
    return "Choose a JPEG, PNG or WebP image.";
  }
  if (file.size > IMAGE_MAX_BYTES) return "Image is too large. The limit is 5 MiB.";
  if (file.size === 0) return "That file is empty.";
  return null;
}

/** Re-export so product components have one import for error copy. */
export const PRODUCT_ERROR_COPY = MASTER_DATA_ERROR_COPY;
export const productErrorCopy = masterDataErrorCopy;
