import { describe, expect, it } from "vitest";

import { asciiDigits, cleanBranchCode, cleanTaxId, formatTaxId, isValidThaiTaxId } from "./thai-tax-id";
import { branchCodeField, creditTermField, taxIdField } from "./api/schemas/finance-fields";
import { customerInput } from "./api/schemas/master-data";
import { companyProfileInput } from "./api/schemas/company-profile";

// Same fixtures as the backend tests (tests/test_customer_tax_fields.py).
const VALID = "0105536092641";

describe("Thai tax ID helpers (mirror the backend)", () => {
  it("checks the check digit", () => {
    expect(isValidThaiTaxId(VALID)).toBe(true);
    expect(isValidThaiTaxId("0105536092642")).toBe(false);
    expect(isValidThaiTaxId("010553609264")).toBe(false);
    expect(isValidThaiTaxId("01055360926410")).toBe(false);
    expect(isValidThaiTaxId("01055360926a1")).toBe(false);
  });

  it("cleans Thai numerals, dashes and spaces; blank is null", () => {
    expect(asciiDigits("๐๑๒๓๔๕๖๗๘๙")).toBe("0123456789");
    expect(cleanTaxId("0-1055-36092-64-1")).toBe(VALID);
    expect(cleanTaxId(" 0105 5360 92641 ")).toBe(VALID);
    expect(cleanTaxId("   ")).toBeNull();
    expect(cleanBranchCode(" ๐๐๐๐๐ ")).toBe("00000");
    expect(cleanBranchCode("")).toBeNull();
  });

  it("formats 13 digits with the usual grouping and leaves anything else alone", () => {
    expect(formatTaxId(VALID)).toBe("0-1055-36092-64-1");
    expect(formatTaxId("123")).toBe("123");
    expect(formatTaxId(null)).toBe("");
  });
});

describe("finance form fields", () => {
  it("tax ID: blank → null, valid → digits, invalid → message", () => {
    expect(taxIdField.parse("")).toBeNull();
    expect(taxIdField.parse(undefined)).toBeNull();
    expect(taxIdField.parse("๐-๑๐๕๕-๓๖๐๙๒-๖๔-๑")).toBe(VALID);
    const r = taxIdField.safeParse("0105536092642");
    expect(r.success).toBe(false);
    expect(r.error!.issues[0].message).toBe("Enter a valid 13-digit Thai tax ID");
    // Arabic-Indic digits are not accepted (the backend refuses them too)
    expect(taxIdField.safeParse("٠١٠٥٥٣٦٠٩٢٦٤١").success).toBe(false);
  });

  it("branch code: exactly 5 digits", () => {
    expect(branchCodeField.parse("00000")).toBe("00000");
    expect(branchCodeField.parse("")).toBeNull();
    expect(branchCodeField.safeParse("0001").success).toBe(false);
    expect(branchCodeField.safeParse("0000a").success).toBe(false);
  });

  it("credit term: whole days 0..365, blank → null", () => {
    expect(creditTermField.parse("")).toBeNull();
    expect(creditTermField.parse("0")).toBe(0);
    expect(creditTermField.parse(" 30 ")).toBe(30);
    expect(creditTermField.parse("365")).toBe(365);
    for (const bad of ["366", "-1", "1.5", "abc", "1000"]) expect(creditTermField.safeParse(bad).success, bad).toBe(false);
  });

  it("every field is idempotent: the mutation hook re-parses the parsed form", () => {
    const form = {
      customer_name: " Acme ",
      phone: "",
      email: "",
      address: "",
      tax_id: "0-1055-36092-64-1",
      branch_code: "00000",
      billing_address: "",
      credit_term_days: "30",
    };
    const once = customerInput.parse(form);
    expect(once).toEqual({
      customer_name: "Acme",
      phone: undefined,
      email: undefined,
      address: undefined,
      tax_id: VALID,
      branch_code: "00000",
      billing_address: null,
      credit_term_days: 30,
    });
    expect(customerInput.parse(once)).toEqual(once);
  });

  it("a blank tax field is sent as null so an edit can clear it", () => {
    const out = customerInput.parse({ customer_name: "Acme", tax_id: "", branch_code: "", billing_address: "", credit_term_days: "" });
    expect(out.tax_id).toBeNull();
    expect(out.branch_code).toBeNull();
    expect(out.billing_address).toBeNull();
    expect(out.credit_term_days).toBeNull();
    expect(JSON.parse(JSON.stringify(out))).toMatchObject({ tax_id: null, credit_term_days: null });
  });

  it("company profile: full payload, VAT rate format checked", () => {
    const base = {
      legal_name_th: "บริษัท ตัวอย่าง จำกัด",
      legal_name_en: "",
      tax_id: VALID,
      branch_code: "00000",
      address_th: "",
      address_en: "",
      phone: "",
      email: "",
      vat_registered: false,
      vat_rate: "7.00",
      prices_include_vat: false,
      default_credit_days: "30",
    };
    expect(companyProfileInput.parse(base)).toEqual({
      ...base,
      legal_name_en: null,
      address_th: null,
      address_en: null,
      phone: null,
      email: null,
      default_credit_days: 30,
    });
    expect(companyProfileInput.safeParse({ ...base, default_credit_days: "366" }).success).toBe(false);
    for (const bad of ["", "101", "7.001", "abc", "-1"]) {
      expect(companyProfileInput.safeParse({ ...base, vat_rate: bad }).success, bad).toBe(false);
    }
    expect(companyProfileInput.safeParse({ ...base, email: "nope" }).success).toBe(false);
  });
});
