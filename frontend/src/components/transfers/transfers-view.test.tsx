import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { transferListResponse } from "@/test/fixtures";

const replace = vi.fn();
let search = "";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: replace }),
  usePathname: () => "/transfers",
  useSearchParams: () => new URLSearchParams(search),
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock("@/lib/query/transfers", () => ({
  useTransfers: () => ({
    data: transferListResponse.data,
    isLoading: false,
    isFetching: false,
    isError: false,
    error: undefined,
    refetch: vi.fn(),
  }),
  useTransfer: () => ({ data: undefined, isLoading: true, isError: false }),
  useWarehouseNames: () => ({ data: {} }),
  useBatchExpiryMap: () => ({ map: {}, isLoading: false }),
  useDispatchTransfer: () => ({ mutate: vi.fn() }),
  useCancelTransfer: () => ({ mutate: vi.fn() }),
  useCreateTransfer: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
}));
vi.mock("@/lib/query/sales", () => ({ useProductLookup: () => ({ data: {} }) }));
vi.mock("@/lib/query/hooks", () => ({
  useStockBalances: () => ({ data: { items: [] } }),
  useProductStock: () => ({ data: { items: [] } }),
  useGlobalSearch: () => ({ data: undefined, isFetching: false }),
}));

import { TransfersView } from "./transfers-view";

beforeEach(() => {
  replace.mockReset();
  search = "";
  window.history.replaceState(null, "", "/transfers");
});

describe("TransfersView", () => {
  it("renders a row per transfer with route + progress, and a legacy badge", () => {
    render(<TransfersView />);
    expect(screen.getByText("TR-20260908215819350799")).toBeInTheDocument();
    expect(screen.getAllByText("Main Warehouse").length).toBeGreaterThan(0);
    expect(screen.getByText("Legacy completed")).toBeInTheDocument();
  });

  it("exposes only real backend status tabs", () => {
    render(<TransfersView />);
    const tabs = screen.getByRole("tablist", { name: /status filter/i });
    ["All", "Draft", "In transit", "Partially received", "Completed", "Cancelled"].forEach((t) =>
      expect(Array.from(tabs.querySelectorAll("button")).some((b) => b.textContent?.trim() === t)).toBe(true),
    );
  });

  it("shows 'New transfer' and 'View in-transit inventory'", () => {
    render(<TransfersView />);
    expect(screen.getByRole("button", { name: /new transfer/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /view in-transit inventory/i })).toHaveAttribute(
      "href",
      "/stock?tab=in-transit",
    );
  });

  it("writes sort_by + explicit sort_order to the URL on a header click", async () => {
    const user = userEvent.setup();
    render(<TransfersView />);
    await user.click(screen.getByRole("button", { name: /^Transfer #/i }));
    const url = replace.mock.calls.at(-1)![0] as string;
    expect(url).toMatch(/sort_by=transfer_number/);
    expect(url).toMatch(/sort_order=desc/);
  });
});
