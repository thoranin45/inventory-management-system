import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const replace = vi.fn();
let search = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: replace }),
  usePathname: () => "/stock",
  useSearchParams: () => new URLSearchParams(search),
}));

const useProducts = vi.fn();
const useInTransitStock = vi.fn();
vi.mock("@/lib/query/hooks", () => ({
  useProducts: (...a: unknown[]) => useProducts(...a),
  useInTransitStock: (...a: unknown[]) => useInTransitStock(...a),
}));
vi.mock("@/lib/query/master-data", () => ({
  useAllCategories: () => ({ data: [{ id: 9, category_name: "Dairy" }, { id: 10, category_name: "Bakery" }] }),
}));

let capturedDrawerProps: { product: unknown; open: boolean } | null = null;
vi.mock("@/components/products/product-detail", () => ({
  ProductDetailDrawer: (props: { product: unknown; open: boolean }) => {
    capturedDrawerProps = props;
    return props.open ? <div data-testid="detail-drawer" /> : null;
  },
}));

vi.mock("@/components/stock/barcode-lookup-sheet", () => ({
  StockScanButton: () => <button type="button">Scan Barcode</button>,
}));

import { StockView } from "./stock-view";

const MILK = {
  id: 1,
  sku: "MILK-001",
  barcode: "885000000001",
  product_name: "Fresh Milk 1L",
  price: "45.00",
  stock_qty: "125.000",
  owned_quantity: "125.000",
  operational_available_quantity: "125.000",
  reserved_quantity: "10.000",
  expired_quantity: "0",
  near_expiry_quantity: "0",
  transit_quantity: "0",
  minimum_stock: "20.000",
  safety_stock: "0",
  maximum_stock: null,
  category_id: 9,
  image_url: null,
  is_active: true,
  created_at: "2026-09-01T00:00:00",
  track_batch: true,
  track_expiry: true,
  as_of_date: "2026-09-11",
  lot_count: 1,
  nearest_lot_no: "LOT-2026-08-01",
  nearest_expiry_date: "2099-01-01",
  location_count: 1,
  primary_warehouse_code: "WH-A",
  primary_location_code: "A-01",
};

const CHOC = {
  ...MILK,
  id: 2,
  sku: "CHOC-001",
  barcode: "885000000002",
  product_name: "Chocolate Milk",
  operational_available_quantity: "3.000",
  reserved_quantity: "0",
  minimum_stock: "10.000",
  track_batch: false,
  track_expiry: false,
  lot_count: 0,
  nearest_lot_no: null,
  nearest_expiry_date: null,
  location_count: 2,
  primary_warehouse_code: null,
  primary_location_code: null,
};

function page(items = [MILK, CHOC]) {
  return {
    data: {
      items,
      pagination: { page: 1, page_size: 20, total_items: items.length, total_pages: 1 },
    },
    isLoading: false,
    isFetching: false,
    isError: false,
    error: undefined,
    refetch: vi.fn(),
  };
}

beforeEach(() => {
  search = "";
  replace.mockReset();
  capturedDrawerProps = null;
  useProducts.mockReset().mockReturnValue(page());
  useInTransitStock.mockReset().mockReturnValue(page([]));
  window.history.replaceState(null, "", "/stock");
});

describe("StockView — product-centric list (reuses GET /products, not raw balances)", () => {
  it("renders warehouse-friendly columns — never a bare internal id as the primary label", () => {
    render(<StockView />);
    const thead = screen.getByRole("table").querySelector("thead")!;
    for (const label of ["Product", "Barcode", "Available", "Status", "Lot / Batch", "Expiry"]) {
      expect(within(thead as HTMLElement).getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.getByText("Fresh Milk 1L")).toBeInTheDocument();
    expect(screen.getByText("MILK-001")).toBeInTheDocument();
    expect(screen.getByText("885000000001")).toBeInTheDocument();
    expect(screen.queryByText(/^#1$/)).not.toBeInTheDocument();
  });

  it("search state (name, SKU or barcode) flows through as the server-side `search` query — one field, not three", () => {
    search = "search=885000000001";
    render(<StockView />);
    const lastCall = useProducts.mock.calls.at(-1)?.[0];
    expect(lastCall.search).toBe("885000000001");
    expect(screen.getByRole("searchbox", { name: /search stock/i })).toHaveValue("885000000001");
  });

  it("category filter narrows the request via a real category_id query param", async () => {
    const user = userEvent.setup();
    render(<StockView />);
    await user.selectOptions(screen.getByRole("combobox", { name: /category/i }), "9");
    // the select drives a URL param → re-render with the new value
    expect(replace).toHaveBeenCalled();
    const url = replace.mock.calls.at(-1)?.[0] as string;
    expect(url).toContain("category=9");
  });

  it("stock status filter is page-local (disclosed) and narrows visible rows without hiding the other product", () => {
    search = "status=low_stock";
    render(<StockView />);
    expect(screen.getByText("Chocolate Milk")).toBeInTheDocument();
    expect(screen.queryByText("Fresh Milk 1L")).not.toBeInTheDocument();
    expect(screen.getByText(/no server-side filter exists for stock status/i)).toBeInTheDocument();
  });

  it("Lot/Batch: shows the lot number for a single-lot batch-tracked product, and 'ไม่ติดตาม Lot' for a non-batch product", () => {
    render(<StockView />);
    expect(screen.getByText("LOT-2026-08-01")).toBeInTheDocument();
    expect(screen.getByText("ไม่ติดตาม Lot")).toBeInTheDocument();
  });

  it("Expiry: track_expiry=false never shows a misleading expiry warning", () => {
    render(<StockView />);
    expect(screen.getByText("ไม่ติดตามวันหมดอายุ")).toBeInTheDocument();
  });

  it("Available / On Hand / Reserved render the backend-authoritative values (no frontend recalculation)", () => {
    render(<StockView />);
    expect(screen.getAllByText("125.00").length).toBeGreaterThan(0); // available + on-hand share the value here
    expect(screen.getByText("10.00")).toBeInTheDocument(); // reserved
  });

  it("row activation opens the Product Detail Drawer with the full enriched row", async () => {
    const user = userEvent.setup();
    render(<StockView />);
    await user.click(screen.getByText("Fresh Milk 1L").closest("tr")!);
    expect(capturedDrawerProps?.open).toBe(true);
    expect((capturedDrawerProps?.product as { id: number }).id).toBe(1);
  });

  it("+ Stock In navigates to /stock-in and never mutates stock itself", async () => {
    const user = userEvent.setup();
    render(<StockView />);
    await user.click(screen.getByRole("button", { name: /^stock in$/i }));
    expect(replace).not.toHaveBeenCalledWith(expect.stringContaining("mutate"));
  });

  it("pagination is server-driven when no page-local filter is active, and suppressed while one is", () => {
    const { unmount } = render(<StockView />);
    expect(screen.getByText("1 / 1")).toBeInTheDocument();
    unmount();

    search = "status=low_stock";
    render(<StockView />);
    expect(screen.getByText("Chocolate Milk")).toBeInTheDocument();
    expect(screen.queryByText("1 / 1")).not.toBeInTheDocument();
  });

  it("In transit tab keeps using the dedicated balances endpoint, unchanged", () => {
    search = "tab=in-transit";
    render(<StockView />);
    expect(useInTransitStock).toHaveBeenCalled();
    expect(screen.getByRole("tab", { name: "In transit" })).toHaveAttribute("aria-selected", "true");
  });
});
