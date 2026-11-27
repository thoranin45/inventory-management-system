import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ApiError } from "@/lib/api/errors";
import { LanguageProvider } from "@/lib/i18n/client";

let role = "admin";
vi.mock("@/components/session-provider", () => ({ useSession: () => ({ user: { role } }) }));

const profile = {
  legal_name_th: "บริษัท ตัวอย่าง จำกัด",
  legal_name_en: null,
  tax_id: null,
  branch_code: null,
  address_th: null,
  address_en: null,
  phone: null,
  email: null,
  vat_registered: false,
  vat_rate: "7.00",
  prices_include_vat: false,
  updated_at: null as string | null,
};
const query = { data: profile, isLoading: false, isError: false, error: undefined, refetch: vi.fn() };
const updateMut = { mutateAsync: vi.fn(), isPending: false };

vi.mock("@/lib/query/company-profile", () => ({
  useCompanyProfile: () => query,
  useUpdateCompanyProfile: () => updateMut,
}));

import { CompanyProfileView } from "./company-profile-view";

beforeEach(() => {
  role = "admin";
  updateMut.mutateAsync.mockReset().mockResolvedValue({ ...profile, updated_at: "2026-11-26T07:00:00Z" });
});

describe("CompanyProfileView", () => {
  it("admin saves the full profile with blanks sent as null and VAT off", async () => {
    render(<CompanyProfileView />);
    expect(screen.getByText(/VAT is off/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/VAT rate/)).not.toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/^Tax ID/), "0-1055-36092-64-1");
    await userEvent.type(screen.getByLabelText(/^Branch code/), "00000");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(updateMut.mutateAsync).toHaveBeenCalledWith({
        legal_name_th: "บริษัท ตัวอย่าง จำกัด",
        legal_name_en: null,
        tax_id: "0105536092641",
        branch_code: "00000",
        address_th: null,
        address_en: null,
        phone: null,
        email: null,
        vat_registered: false,
        vat_rate: "7.00",
        prices_include_vat: false,
        default_credit_days: 30,
      }),
    );
  });

  it("blocks an invalid tax ID before sending", async () => {
    render(<CompanyProfileView />);
    await userEvent.type(screen.getByLabelText(/^Tax ID/), "0105536092642");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Enter a valid 13-digit Thai tax ID")).toBeInTheDocument();
    expect(updateMut.mutateAsync).not.toHaveBeenCalled();
  });

  it("shows VAT rate and inclusive switch only when VAT-registered", async () => {
    render(<CompanyProfileView />);
    await userEvent.click(screen.getByLabelText(/VAT-registered business/));
    const rate = screen.getByLabelText("VAT rate (%)");
    await userEvent.clear(rate);
    await userEvent.type(rate, "7.001");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText(/VAT rate must be a number/)).toBeInTheDocument();
    expect(updateMut.mutateAsync).not.toHaveBeenCalled();
  });

  it("maps a backend field error onto the field", async () => {
    updateMut.mutateAsync.mockRejectedValueOnce(
      new ApiError({
        status: 422,
        message: "Validation error",
        details: [{ field: "tax_id", message: "Value error, tax_id must be a valid 13-digit Thai tax ID" }],
      }),
    );
    render(<CompanyProfileView />);
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Enter a valid 13-digit Thai tax ID")).toBeInTheDocument();
  });

  it("warehouse users see the profile read only, with no Save button", () => {
    role = "warehouse";
    render(<CompanyProfileView />);
    expect(screen.getByText("Only an admin can change the company profile.")).toBeInTheDocument();
    expect(screen.getByLabelText("Legal name (Thai)")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Save changes" })).not.toBeInTheDocument();
  });

  it("renders in Thai", () => {
    render(
      <LanguageProvider initialLocale="th">
        <CompanyProfileView />
      </LanguageProvider>,
    );
    expect(screen.getByRole("heading", { name: "ข้อมูลบริษัท" })).toBeInTheDocument();
    expect(screen.getByLabelText(/^เลขประจำตัวผู้เสียภาษี/)).toBeInTheDocument();
    expect(screen.getByText(/ปิด VAT อยู่/)).toBeInTheDocument();
  });
});
