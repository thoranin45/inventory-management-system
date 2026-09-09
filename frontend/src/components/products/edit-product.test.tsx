import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { productDetailResponse } from "@/test/fixtures";

const updateMut = { mutate: vi.fn(), isPending: false };
let detail = { ...productDetailResponse.data };

vi.mock("@/lib/query/products", () => ({
  useProduct: () => ({ data: detail, isLoading: false, isError: false, error: undefined, refetch: vi.fn() }),
  useUpdateProduct: () => updateMut,
}));
vi.mock("@/lib/query/master-data", () => ({ useAllCategories: () => ({ data: [{ id: 2, category_name: "Beverages" }], isLoading: false }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));

import { EditProductDrawer } from "./edit-product";

beforeEach(() => {
  updateMut.mutate.mockReset();
  detail = { ...productDetailResponse.data, stock_qty: "0", track_batch: false, track_expiry: false };
});

describe("EditProductDrawer", () => {
  it("prefills the form from the real product detail response", () => {
    render(<EditProductDrawer productId={6} open onOpenChange={() => {}} onSaved={() => {}} />);
    expect((screen.getByLabelText(/^SKU/i) as HTMLInputElement).value).toBe("WH-TEA-200G");
    expect((screen.getByLabelText(/product name/i) as HTMLInputElement).value).toBe("Green Tea 200g");
    expect((screen.getByLabelText(/unit price/i) as HTMLInputElement).value).toBe("78.00");
  });

  it("sends only the fields that changed", async () => {
    render(<EditProductDrawer productId={6} open onOpenChange={() => {}} onSaved={() => {}} />);
    const name = screen.getByLabelText(/product name/i);
    await userEvent.clear(name);
    await userEvent.type(name, "Green Tea 250g");
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(updateMut.mutate).toHaveBeenCalled());
    expect(updateMut.mutate.mock.calls[0][0]).toEqual({ id: 6, patch: { product_name: "Green Tea 250g" } });
  });

  it("locks batch tracking when the product already has stock history", () => {
    detail = { ...productDetailResponse.data, stock_qty: "480.000" };
    render(<EditProductDrawer productId={6} open onOpenChange={() => {}} onSaved={() => {}} />);
    expect(screen.getByLabelText(/track batches/i)).toBeDisabled();
    expect(screen.getByText(/locked because this product already has stock/i)).toBeInTheDocument();
  });
});
