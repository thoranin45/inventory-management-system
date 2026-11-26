import { z } from "zod";

import { cleanBranchCode, cleanTaxId, isValidThaiTaxId } from "@/lib/thai-tax-id";

/**
 * F0b: shared form fields for seller / customer tax data.
 *
 * - A blank input becomes `null` (not undefined) so an edit can CLEAR a stored
 *   value: the backend applies an explicit null and ignores an omitted field.
 * - Each field is idempotent: the mutation hooks parse the already-parsed form
 *   output a second time, so `null` and numbers are accepted as input too.
 */

export const TAX_ID_MESSAGE = "Enter a valid 13-digit Thai tax ID";
export const BRANCH_CODE_MESSAGE = "Branch code must be 5 digits (00000 = head office)";
export const CREDIT_TERM_MESSAGE = "Credit term must be a whole number of days from 0 to 365";
export const VAT_RATE_MESSAGE = "VAT rate must be a number from 0 to 100 with up to 2 decimals";

/** null / undefined → "", numbers → their string form, strings unchanged. */
const asText = (v: unknown) => (v === null || v === undefined ? "" : typeof v === "number" ? String(v) : v);

export const taxIdField = z
  .preprocess(asText, z.string())
  .transform((v) => cleanTaxId(v))
  .refine((v) => v === null || isValidThaiTaxId(v), TAX_ID_MESSAGE);

export const branchCodeField = z
  .preprocess(asText, z.string())
  .transform((v) => cleanBranchCode(v))
  .refine((v) => v === null || /^[0-9]{5}$/.test(v), BRANCH_CODE_MESSAGE);

/** optional free text: blank → null, otherwise trimmed and length-capped. */
export const nullableText = (max: number, label: string) =>
  z
    .preprocess(asText, z.string().trim().max(max, `${label} must be ${max} characters or fewer`))
    .transform((v) => (v ? v : null));

export const creditTermField = z
  .preprocess(asText, z.string().trim())
  .refine((v) => v === "" || (/^[0-9]{1,3}$/.test(v) && Number(v) <= 365), CREDIT_TERM_MESSAGE)
  .transform((v) => (v === "" ? null : Number(v)));
