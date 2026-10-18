import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { productListResponse, productDetailResponse } from "@/test/fixtures";

let role = "admin";
vi.mock("@/components/session-provider", () => ({ useSession: () => ({ user: { role } }) }));
// R4.2 (D-R4-7): balances come from the verified load-more hook
let balancePages: unknown = { isLoading: false, isError: false, balances: { rows: [], total: 0, inconsistent: false }, hasNextPage: false };
vi.mock("@/lib/query/hooks", () => ({
  useProductBalancePages: () => balancePages,
}));
vi.mock("@/lib/query/warehouses", () => ({
  useWarehouses: () => ({
    data: [{ id: 1, warehouse_code: "MAIN", locations: [{ id: 11, location_code: "DEFAULT" }] }],
  }),
}));
vi.mock("@/lib/query/master-data", () => ({
  useAllCategories: () => ({ data: [{ id: 2, category_name: "Beverages" }], isLoading: false }),
}));
const deactivateMut = { mutate: vi.fn(), isPending: false };
vi.mock("@/lib/query/products", () => ({
  useProduct: () => ({ data: productDetailResponse.data, isLoading: false, isError: false, refetch: vi.fn() }),
  useUpdateProduct: () => ({ mutate: vi.fn(), isPending: false }),
  useDeactivateProduct: () => deactivateMut,
  useRestoreProduct: () => ({ mutate: vi.fn(), isPending: false }),
  useUploadProductImage: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/lib/api/binary", () => ({ bffBinary: vi.fn().mockResolvedValue({ blob: new Blob(), contentType: "image/png" }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));

import { ProductDetailDrawer } from "./product-detail";

const row = productListResponse.data.items[0]; // WH-TEA-200G, batch + expiry, thresholds set

beforeEach(() => {
  role = "admin";
  deactivateMut.mutate.mockReset();
  balancePages = { isLoading: false, isError: false, balances: { rows: [], total: 0, inconsistent: false }, hasNextPage: false };
});

describe("ProductDetailDrawer", () => {
  it("shows Identity, Inventory, Tracking, Thresholds, Image and Codes sections", () => {
    render(<ProductDetailDrawer product={row} open onOpenChange={() => {}} />);
    expect(screen.getByText("Identity")).toBeInTheDocument();
    expect(screen.getByText("Inventory")).toBeInTheDocument();
    expect(screen.getByText("Tracking")).toBeInTheDocument();
    expect(screen.getByText("Stock thresholds")).toBeInTheDocument();
    expect(screen.getByText("Image")).toBeInTheDocument();
    expect(screen.getByText(/Codes & labels/i)).toBeInTheDocument();
    // thresholds are shown read-only (no inputs)
    expect(screen.getByText("Minimum stock")).toBeInTheDocument();
    expect(screen.getByText(/read-only — no endpoint updates them/i)).toBeInTheDocument();
    // shelf_life_days is explicitly not tracked
    expect(screen.getByText(/not tracked/i)).toBeInTheDocument();
  });

  it("gives admins Edit + Deactivate", () => {
    render(<ProductDetailDrawer product={row} open onOpenChange={() => {}} />);
    expect(screen.getByRole("button", { name: /^edit$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /deactivate/i })).toBeInTheDocument();
  });

  it("is read-only for warehouse users", () => {
    role = "warehouse";
    render(<ProductDetailDrawer product={row} open onOpenChange={() => {}} />);
    expect(screen.queryByRole("button", { name: /^edit$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /deactivate/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/choose a product image/i)).not.toBeInTheDocument();
  });

  it("opens the edit form inline (no stacked drawer)", async () => {
    render(<ProductDetailDrawer product={row} open onOpenChange={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    expect(await screen.findByRole("button", { name: /save changes/i })).toBeInTheDocument();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it("confirms deactivation through a dialog", async () => {
    render(<ProductDetailDrawer product={row} open onOpenChange={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /deactivate/i }));
    const dialog = await screen.findByRole("dialog", { name: /deactivate WH-TEA-200G/i });
    await userEvent.click(within(dialog).getByRole("button", { name: /deactivate product/i }));
    expect(deactivateMut.mutate).toHaveBeenCalledWith(6, expect.anything());
  });
});

describe("ProductDetailDrawer — R4 lots and locations (D-R4-7)", () => {
  const bal = (id: number, over: Record<string, unknown> = {}) => ({
    id, product_id: 6, warehouse_id: 1, location_id: 11, batch_id: id, batch_lot_no: `LOT-${id}`,
    on_hand_qty: "10.000", reserved_qty: "3.000", available_qty: "7.000", is_transit: false,
    batch_expiry_date: "2027-09-30", days_to_expiry: 300, is_expired: false, as_of_date: "2026-10-17", ...over,
  });

  it("shows the on hand / reserved / available triad for the product", () => {
    render(<ProductDetailDrawer product={row} open onOpenChange={() => {}} />);
    expect(screen.getAllByText("On hand").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Available").length).toBeGreaterThan(0);
  });

  it("lists lots with real storage codes and offers Load more with an honest count", async () => {
    const fetchNextPage = vi.fn();
    balancePages = {
      isLoading: false, isError: false, hasNextPage: true, isFetchingNextPage: false, isFetchNextPageError: false, fetchNextPage,
      balances: { rows: [bal(1), bal(2)], total: 120, inconsistent: false },
    };
    render(<ProductDetailDrawer product={row} open onOpenChange={() => {}} />);
    expect(screen.getByText("LOT-1")).toBeInTheDocument();
    expect(screen.getAllByText("MAIN / DEFAULT")).toHaveLength(2);
    expect(screen.getByText("Showing 2 of 120 balances")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it("a balance list that changed while loading asks for a reload instead of showing a shifted list silently", () => {
    balancePages = {
      isLoading: false, isError: false, hasNextPage: false, refetch: vi.fn(),
      balances: { rows: [bal(1)], total: 2, inconsistent: true },
    };
    render(<ProductDetailDrawer product={row} open onOpenChange={() => {}} />);
    expect(screen.getByText(/changed while loading/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload balances" })).toBeInTheDocument();
  });

  it("a failed next page keeps the loaded rows and offers a retry", () => {
    balancePages = {
      isLoading: false, isError: true, hasNextPage: true, isFetchNextPageError: true, fetchNextPage: vi.fn(),
      balances: { rows: [bal(1)], total: 120, inconsistent: false },
    };
    render(<ProductDetailDrawer product={row} open onOpenChange={() => {}} />);
    expect(screen.getByText("LOT-1")).toBeInTheDocument();
    expect(screen.getByText(/could not be loaded/i)).toBeInTheDocument();
  });
});
