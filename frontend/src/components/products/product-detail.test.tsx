import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { productListResponse, productDetailResponse } from "@/test/fixtures";

let role = "admin";
vi.mock("@/components/session-provider", () => ({ useSession: () => ({ user: { role } }) }));
vi.mock("@/lib/query/hooks", () => ({
  useProductStock: () => ({ data: { items: [] }, isLoading: false, isError: false }),
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
