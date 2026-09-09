import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { salesOrderListResponse } from "@/test/fixtures";

const replace = vi.fn();
let search = "";
let role = "admin";
const refetch = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: replace }),
  usePathname: () => "/sales",
  useSearchParams: () => new URLSearchParams(search),
}));
vi.mock("@/components/session-provider", () => ({ useSession: () => ({ user: { role } }) }));
vi.mock("@/lib/query/sales", () => ({
  useSalesOrders: () => ({
    data: salesOrderListResponse.data,
    isLoading: false,
    isFetching: false,
    isError: false,
    error: undefined,
    refetch,
  }),
  useSalesOrder: () => ({ data: undefined, isLoading: true, isError: false }),
  useConfirmSalesOrder: () => ({ mutate: vi.fn() }),
  useCancelSalesOrder: () => ({ mutate: vi.fn() }),
  useCreateSalesOrder: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useCustomerSearch: () => ({ data: [], isFetching: false }),
}));

import { SalesView } from "./sales-view";

beforeEach(() => {
  replace.mockReset();
  search = "";
  role = "admin";
  window.history.replaceState(null, "", "/sales");
});

describe("SalesView — list rendering", () => {
  it("renders one row per sales order with number, customer and amount", () => {
    render(<SalesView />);
    expect(screen.getByText("SO-000002")).toBeInTheDocument();
    expect(screen.getByText("SO-000001")).toBeInTheDocument();
    expect(screen.getAllByText("Acme Test Co").length).toBe(2);
    expect(screen.getByText("฿2,330.00")).toBeInTheDocument();
  });

  it("exposes the status tabs without inventing statuses", () => {
    render(<SalesView />);
    const tablist = screen.getByRole("tablist", { name: /status filter/i });
    ["All", "Draft", "Confirmed", "Picking", "Packing", "Ready to ship", "Attention"].forEach((t) =>
      expect(within_tablist(tablist, t)).toBeTruthy(),
    );
  });
});

function within_tablist(tablist: HTMLElement, label: string) {
  return Array.from(tablist.querySelectorAll("button")).find((b) => b.textContent?.trim() === label);
}

describe("SalesView — admin-only create action", () => {
  it("shows 'New sales order' to an admin", () => {
    role = "admin";
    render(<SalesView />);
    expect(screen.getByRole("button", { name: /new sales order/i })).toBeInTheDocument();
  });

  it("hides 'New sales order' from a warehouse user", () => {
    role = "warehouse";
    render(<SalesView />);
    expect(screen.queryByRole("button", { name: /new sales order/i })).toBeNull();
  });
});

describe("SalesView — URL sort state", () => {
  it("writes sort_by + explicit sort_order to the URL on a header click (DEFAULT → DESC)", async () => {
    const user = userEvent.setup();
    render(<SalesView />);
    await user.click(screen.getByRole("button", { name: /^SO number/i }));
    expect(replace).toHaveBeenCalled();
    const url = replace.mock.calls.at(-1)![0] as string;
    expect(url).toMatch(/sort_by=so_number/);
    expect(url).toMatch(/sort_order=desc/);
  });

  it("keeps an existing status tab in the URL when sorting", async () => {
    const user = userEvent.setup();
    search = "status=CONFIRMED";
    window.history.replaceState(null, "", "/sales?status=CONFIRMED");
    render(<SalesView />);
    await user.click(screen.getByRole("button", { name: /^Total amount/i }));
    const url = replace.mock.calls.at(-1)![0] as string;
    expect(url).toMatch(/status=CONFIRMED/);
    expect(url).toMatch(/sort_by=total_amount/);
  });
});
