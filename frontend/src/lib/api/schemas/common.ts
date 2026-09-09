import { z } from "zod";

/** Fixed-scale decimal string from the backend ("20.000"). Kept as a string. */
export const decimalString = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/, "expected a fixed-scale decimal string");

/** Standard success envelope: { success, message, data }. */
export function apiEnvelope<T extends z.ZodTypeAny>(data: T) {
  return z.object({
    success: z.boolean().optional(),
    message: z.string().optional(),
    data,
  });
}

/** Paginated payload: { items, pagination }. */
export const paginationMeta = z.object({
  page: z.number(),
  page_size: z.number(),
  total_items: z.number(),
  total_pages: z.number(),
});

export function paginated<T extends z.ZodTypeAny>(item: T) {
  return z.object({ items: z.array(item), pagination: paginationMeta });
}
