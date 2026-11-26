import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/components/session-provider", () => ({ useSession: () => ({ user: { role: "admin" } }) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/customers",
  useSearchParams: () => new URLSearchParams(""),
}));

const row = {
  id: 7,
  customer_name: "Acme",
  phone: null,
  email: null,
  address: "1 Road",
  tax_id: "0105536092641",
  branch_code: "00001",
  billing_address: "Billing St",
  credit_term_days: 30,
};
const createMut = { mutateAsync: vi.fn(), isPending: false };
const updateMut = { mutateAsync: vi.fn(), isPending: false };
const listResult = {
  data: { items: [row], pagination: { page: 1, page_size: 20, total_items: 1, total_pages: 1 } },
  isLoading: false,
  isFetching: false,
  isError: false,
  error: undefined,
  refetch: vi.fn(),
};
vi.mock("@/lib/query/master-data", () => ({
  useCustomers: () => listResult,
  useCreateCustomer: () => createMut,
  useUpdateCustomer: () => updateMut,
  useDeleteCustomer: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { CustomersView } from "./customers-view";

beforeEach(() => {
  createMut.mutateAsync.mockReset().mockResolvedValue(row);
  updateMut.mutateAsync.mockReset().mockResolvedValue(row);
});

describe("CustomersView tax fields (F0b)", () => {
  it("shows the tax ID grouped in the list", () => {
    render(<CustomersView />);
    expect(screen.getAllByText("0-1055-36092-64-1").length).toBeGreaterThan(0);
  });

  it("creates a customer with cleaned tax data", async () => {
    render(<CustomersView />);
    await userEvent.click(screen.getByRole("button", { name: /new customer/i }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText(/customer name/i), "Beta");
    await userEvent.type(within(dialog).getByLabelText(/^Tax ID/), "๐-๑๐๕๕-๓๖๐๙๒-๖๔-๑");
    await userEvent.type(within(dialog).getByLabelText(/^Branch code/), "00000");
    await userEvent.type(within(dialog).getByLabelText(/^Credit term \(days\)/), "45");
    await userEvent.click(within(dialog).getByRole("button", { name: /create customer/i }));
    await waitFor(() =>
      expect(createMut.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          customer_name: "Beta",
          tax_id: "0105536092641",
          branch_code: "00000",
          billing_address: null,
          credit_term_days: 45,
        }),
      ),
    );
  });

  it("clearing the tax fields on edit sends null so the backend clears them", async () => {
    render(<CustomersView />);
    await userEvent.click(screen.getAllByRole("button", { name: /edit acme/i })[0]);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText(/^Tax ID/)).toHaveValue("0105536092641");
    expect(within(dialog).getByLabelText(/^Credit term \(days\)/)).toHaveValue("30");
    for (const label of ["Tax ID", "Branch code", "Billing address", "Credit term (days)"]) {
      await userEvent.clear(within(dialog).getByLabelText(new RegExp(`^${label.replace(/[()]/g, "\\$&")}`)));
    }
    await userEvent.click(within(dialog).getByRole("button", { name: /save changes/i }));
    await waitFor(() =>
      expect(updateMut.mutateAsync).toHaveBeenCalledWith({
        id: 7,
        patch: expect.objectContaining({ tax_id: null, branch_code: null, billing_address: null, credit_term_days: null }),
      }),
    );
  });

  it("refuses a bad credit term and a bad tax ID", async () => {
    render(<CustomersView />);
    await userEvent.click(screen.getByRole("button", { name: /new customer/i }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText(/customer name/i), "Gamma");
    await userEvent.type(within(dialog).getByLabelText(/^Tax ID/), "1234567890123");
    await userEvent.type(within(dialog).getByLabelText(/^Credit term \(days\)/), "400");
    await userEvent.click(within(dialog).getByRole("button", { name: /create customer/i }));
    expect(await within(dialog).findByText("Enter a valid 13-digit Thai tax ID")).toBeInTheDocument();
    expect(within(dialog).getByText("Credit term must be a whole number of days from 0 to 365")).toBeInTheDocument();
    expect(createMut.mutateAsync).not.toHaveBeenCalled();
  });
});
