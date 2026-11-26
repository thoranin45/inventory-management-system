/**
 * F0b: Thai tax ID / branch code helpers. They mirror the backend's
 * normalize_tax_id / normalize_branch_code (app/schemas/company_profile_schema.py)
 * so the form can explain a mistake before the request is sent. The backend
 * stays the authority and validates again.
 */

const THAI_DIGITS = "๐๑๒๓๔๕๖๗๘๙";

/** Thai numerals → ASCII digits; every other character is kept. */
export function asciiDigits(value: string): string {
  return value.replace(/[๐-๙]/g, (d) => String(THAI_DIGITS.indexOf(d)));
}

/** 13 ASCII digits with the Revenue Department / national ID check digit. */
export function isValidThaiTaxId(value: string): boolean {
  if (!/^[0-9]{13}$/.test(value)) return false;
  let total = 0;
  for (let i = 0; i < 12; i++) total += Number(value[i]) * (13 - i);
  return (11 - (total % 11)) % 10 === Number(value[12]);
}

/** Blank → null; otherwise the digits only (spaces and dashes removed). Not validated. */
export function cleanTaxId(value: string): string | null {
  const digits = asciiDigits(value).replace(/[-\s]/g, "");
  return digits === "" ? null : digits;
}

/** Blank → null; otherwise trimmed ASCII digits. Not validated. */
export function cleanBranchCode(value: string): string | null {
  const code = asciiDigits(value.trim());
  return code === "" ? null : code;
}

/** "0105536000315" → "0-1055-36000-31-5" (the usual printed grouping). */
export function formatTaxId(value: string | null | undefined): string {
  if (!value) return "";
  if (!/^[0-9]{13}$/.test(value)) return value;
  return `${value[0]}-${value.slice(1, 5)}-${value.slice(5, 10)}-${value.slice(10, 12)}-${value[12]}`;
}
