import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { salesOrderListResponse } from "@/test/fixtures";

let role = "warehouse";
vi.mock("@/components/session-provider", () => ({ useSession: () => ({ user: { role } }) }));

const replace = vi.fn();
let search = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: replace }),
  usePathname: () => "/shipping",
  useSearchParams: () => new URLSearchParams(search),
}));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));

const useSalesOrders = vi.fn();
vi.mock("@/lib/query/sales", () => ({ useSalesOrders: (...a: unknown[]) => useSalesOrders(...a) }));
vi.mock("@/components/sales/sales-detail", () => ({
  SalesDetailDrawer: ({ open }: { open: boolean }) => <div data-testid="detail-drawer" data-open={open} />,
}));

import { ShippingView } from "./shipping-view";

const READY = {
  items: salesOrderListResponse.data.items.map((r, i) => ({ ...r, status: "READY_TO_SHIP", so_number: `SO-90${i}` })),
  pagination: { page: 1, page_size: 25, total_items: 2, total_pages: 1 },
};

beforeEach(() => {
  role = "warehouse";
  replace.mockReset();
  search = "";
  useSalesOrders.mockReset().mockReturnValue({ data: READY, isLoading: false, isFetching: false, isError: false, refetch: vi.fn() });
  window.history.replaceState(null, "", "/shipping");
});

describe("ShippingView", () => {
  it("asks the backend for only READY_TO_SHIP orders", () => {
    render(<ShippingView />);
    expect(useSalesOrders.mock.calls.at(-1)?.[0].status).toBe("READY_TO_SHIP");
  });

  it("renders a row per ready order and opens the shared detail drawer on click", async () => {
    render(<ShippingView />);
    expect(screen.getByText("SO-900")).toBeInTheDocument();
    await userEvent.click(screen.getByText("SO-900"));
    expect(screen.getByTestId("detail-drawer")).toHaveAttribute("data-open", "true");
  });

  it("is visible to warehouse AND admin (no invented admin gate)", () => {
    const { unmount } = render(<ShippingView />);
    expect(screen.getByRole("heading", { name: "Shipping" })).toBeInTheDocument();
    unmount();
    role = "admin";
    render(<ShippingView />);
    expect(screen.getByRole("heading", { name: "Shipping" })).toBeInTheDocument();
  });

  it("shows the empty state when nothing is ready", () => {
    useSalesOrders.mockReturnValue({
      data: { items: [], pagination: { page: 1, page_size: 25, total_items: 0, total_pages: 0 } },
      isLoading: false, isFetching: false, isError: false, refetch: vi.fn(),
    });
    render(<ShippingView />);
    expect(screen.getByText("No orders are ready to ship.")).toBeInTheDocument();
  });
});
