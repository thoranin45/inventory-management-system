import { z } from "zod";

import { apiEnvelope, decimalString } from "./common";
import { branchCodeField, nullableText, taxIdField, VAT_RATE_MESSAGE } from "./finance-fields";

/**
 * F0b: the seller's company profile (GET/PUT /company-profile). Mirrors
 * CompanyProfileResponse / CompanyProfileUpdate (app/schemas/company_profile_schema.py).
 * PUT is a full replacement, so the form always sends every field.
 */

export const companyProfileSchema = z.object({
  legal_name_th: z.string().nullish(),
  legal_name_en: z.string().nullish(),
  tax_id: z.string().nullish(),
  branch_code: z.string().nullish(),
  address_th: z.string().nullish(),
  address_en: z.string().nullish(),
  phone: z.string().nullish(),
  email: z.string().nullish(),
  vat_registered: z.boolean(),
  vat_rate: decimalString,
  prices_include_vat: z.boolean(),
  updated_at: z.string().nullish(),
});
export type CompanyProfile = z.infer<typeof companyProfileSchema>;

export const companyProfileEnvelope = apiEnvelope(companyProfileSchema);

const optionalEmail = nullableText(255, "Email").refine((v) => v === null || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "Enter a valid email address");

export const companyProfileInput = z.object({
  legal_name_th: nullableText(255, "Legal name (Thai)"),
  legal_name_en: nullableText(255, "Legal name (English)"),
  tax_id: taxIdField,
  branch_code: branchCodeField,
  address_th: nullableText(1000, "Address (Thai)"),
  address_en: nullableText(1000, "Address (English)"),
  phone: nullableText(50, "Phone"),
  email: optionalEmail,
  vat_registered: z.boolean(),
  vat_rate: z
    .string()
    .trim()
    .refine((v) => /^\d{1,3}(\.\d{1,2})?$/.test(v) && Number(v) <= 100, VAT_RATE_MESSAGE),
  prices_include_vat: z.boolean(),
});
/** What the form holds (strings and booleans). */
export type CompanyProfileForm = z.input<typeof companyProfileInput>;
/** What is sent to PUT /company-profile. */
export type CompanyProfileInput = z.output<typeof companyProfileInput>;

export function companyProfileToForm(p: CompanyProfile): CompanyProfileForm {
  return {
    legal_name_th: p.legal_name_th ?? "",
    legal_name_en: p.legal_name_en ?? "",
    tax_id: p.tax_id ?? "",
    branch_code: p.branch_code ?? "",
    address_th: p.address_th ?? "",
    address_en: p.address_en ?? "",
    phone: p.phone ?? "",
    email: p.email ?? "",
    vat_registered: p.vat_registered,
    vat_rate: p.vat_rate,
    prices_include_vat: p.prices_include_vat,
  };
}
