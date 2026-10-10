import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const replace = vi.fn();
let search = "";
let role = "admin";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: replace }),
  usePathname: () => "/stock-adjustments/approvals",
  useSearchParams: () => new URLSearchParams(search),
}));
vi.mock("@/components/session-provider", () => ({ useSession: () => ({ user: { role } }) }));

const LIST_DATA = {
  items: [
    {
      id: 42, reference_number: "ADJ-000042", status: "PENDING",
      product_id: 5, warehouse_id: 1, location_id: 1,
      observed_quantity: "10.000", requested_quantity: "8.000",
      reason_code: "CYCLE_COUNT_VARIANCE", requested_by_user_id: 2,
      created_at: "2026-01-01T10:00:00Z",
    },
  ],
  pagination: { page: 1, page_size: 20, total_items: 1, total_pages: 1 },
};

vi.mock("@/lib/query/stock-adjustment-requests", () => ({
  useStockAdjustmentRequests: () => ({
    data: LIST_DATA, isLoading: false, isFetching: false, isError: false, error: undefined, refetch: vi.fn(),
  }),
  useStockAdjustmentRequest: () => ({ data: undefined, isLoading: true, isError: false, error: undefined, refetch: vi.fn() }),
  useApproveStockAdjustmentRequest: () => ({ mutate: vi.fn(), isPending: false, isError: false, error: undefined }),
  useRejectStockAdjustmentRequest: () => ({ mutate: vi.fn(), isPending: false, isError: false, error: undefined }),
  useCancelStockAdjustmentRequest: () => ({ mutate: vi.fn(), isPending: false, isError: false, error: undefined }),
}));

import { StockAdjustmentRequestList } from "./request-list";

beforeEach(() => {
  replace.mockReset();
  search = "";
  role = "admin";
  window.history.replaceState(null, "", "/stock-adjustments/approvals");
});

describe("StockAdjustmentRequestList", () => {
  it("renders a row per request with reference, observed/requested quantities and reason", () => {
    render(<StockAdjustmentRequestList scope="approvals" title="Stock Adjustment Approvals" />);
    expect(screen.getByText("ADJ-000042")).toBeInTheDocument();
    expect(screen.getByText("Cycle count variance")).toBeInTheDocument();
  });

  it("defaults the Approvals queue to the Pending tab", () => {
    render(<StockAdjustmentRequestList scope="approvals" title="Stock Adjustment Approvals" />);
    const tabs = screen.getByRole("tablist", { name: /status filter/i });
    const pendingTab = Array.from(tabs.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Pending");
    expect(pendingTab).toHaveAttribute("aria-selected", "true");
  });

  it("defaults My Requests to the All tab", () => {
    render(<StockAdjustmentRequestList scope="mine" title="My Stock Adjustment Requests" />);
    const tabs = screen.getByRole("tablist", { name: /status filter/i });
    const allTab = Array.from(tabs.querySelectorAll("button")).find((b) => b.textContent?.trim() === "All");
    expect(allTab).toHaveAttribute("aria-selected", "true");
  });

  it("offers a New request link regardless of role", () => {
    role = "warehouse";
    render(<StockAdjustmentRequestList scope="mine" title="My Stock Adjustment Requests" />);
    expect(screen.getByRole("link", { name: /new request/i })).toBeInTheDocument();
  });
});
