import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { purchaseOrderListResponse } from "@/test/fixtures";

const replace = vi.fn();
let search = "";
let role = "admin";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: replace }),
  usePathname: () => "/purchase-orders",
  useSearchParams: () => new URLSearchParams(search),
}));
vi.mock("@/components/session-provider", () => ({ useSession: () => ({ user: { role } }) }));
vi.mock("@/lib/query/purchase-orders", () => ({
  usePurchaseOrders: () => ({
    data: purchaseOrderListResponse.data,
    isLoading: false,
    isFetching: false,
    isError: false,
    error: undefined,
    refetch: vi.fn(),
  }),
  usePurchaseOrder: () => ({ data: undefined, isLoading: true, isError: false }),
  useConfirmPurchaseOrder: () => ({ mutate: vi.fn() }),
  useCancelPurchaseOrder: () => ({ mutate: vi.fn() }),
  useCreatePurchaseOrder: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useSupplierSearch: () => ({ data: [], isFetching: false }),
}));
vi.mock("@/lib/query/sales", () => ({ useProductLookup: () => ({ data: {} }) }));

import { PurchaseOrdersView } from "./purchase-orders-view";

beforeEach(() => {
  replace.mockReset();
  search = "";
  role = "admin";
  window.history.replaceState(null, "", "/purchase-orders");
});

describe("PurchaseOrdersView", () => {
  it("renders a row per PO with number, supplier and received %", () => {
    render(<PurchaseOrdersView />);
    expect(screen.getByText("PO-000001")).toBeInTheDocument();
    expect(screen.getByText("Golden Harvest Trading")).toBeInTheDocument();
    expect(screen.getByText("22%")).toBeInTheDocument();
  });

  it("exposes only real backend status tabs", () => {
    render(<PurchaseOrdersView />);
    const tabs = screen.getByRole("tablist", { name: /status filter/i });
    ["All", "Draft", "Confirmed", "Partially received", "Received", "Cancelled"].forEach((t) =>
      expect(Array.from(tabs.querySelectorAll("button")).some((b) => b.textContent?.trim() === t)).toBe(true),
    );
  });

  it("shows 'New purchase order' to an admin, hides it from a warehouse user", () => {
    role = "admin";
    const { unmount } = render(<PurchaseOrdersView />);
    expect(screen.getByRole("button", { name: /new purchase order/i })).toBeInTheDocument();
    unmount();
    role = "warehouse";
    render(<PurchaseOrdersView />);
    expect(screen.queryByRole("button", { name: /new purchase order/i })).toBeNull();
  });

  it("writes sort_by + explicit sort_order to the URL on a header click", async () => {
    const user = userEvent.setup();
    render(<PurchaseOrdersView />);
    await user.click(screen.getByRole("button", { name: /^PO number/i }));
    const url = replace.mock.calls.at(-1)![0] as string;
    expect(url).toMatch(/sort_by=po_number/);
    expect(url).toMatch(/sort_order=desc/);
  });
});
