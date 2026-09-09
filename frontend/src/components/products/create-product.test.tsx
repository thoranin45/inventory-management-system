import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ApiError } from "@/lib/api/errors";

const createMut = { mutate: vi.fn(), isPending: false };
vi.mock("@/lib/query/products", () => ({ useCreateProduct: () => createMut }));
vi.mock("@/lib/query/master-data", () => ({ useAllCategories: () => ({ data: [{ id: 2, category_name: "Beverages" }], isLoading: false }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));

import { CreateProductDrawer } from "./create-product";

function open() {
  render(<CreateProductDrawer open onOpenChange={() => {}} onCreated={() => {}} />);
}

beforeEach(() => {
  createMut.mutate.mockReset();
  createMut.isPending = false;
});

describe("CreateProductDrawer", () => {
  it("renders only the real ProductCreate fields (no brand/unit/shelf-life/thresholds)", () => {
    open();
    expect(screen.getByLabelText(/^SKU/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/product name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/barcode/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/unit price/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/brand/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/shelf.life/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/safety stock/i)).not.toBeInTheDocument();
  });

  it("keeps 'Track expiry' disabled until 'Track batches' is on", async () => {
    open();
    const batch = screen.getByLabelText(/track batches/i);
    const expiry = screen.getByLabelText(/track expiry/i);
    expect(expiry).toBeDisabled();
    await userEvent.click(batch);
    expect(expiry).toBeEnabled();
    await userEvent.click(expiry);
    await userEvent.click(batch); // turning batch off clears expiry
    expect(expiry).not.toBeChecked();
  });

  it("submits the parsed payload and drops empty optionals", async () => {
    open();
    await userEvent.type(screen.getByLabelText(/^SKU/i), "QA-P7-SKU");
    await userEvent.type(screen.getByLabelText(/product name/i), "QA Product");
    await userEvent.type(screen.getByLabelText(/unit price/i), "12.50");
    await userEvent.click(screen.getByRole("button", { name: /create product/i }));
    await waitFor(() => expect(createMut.mutate).toHaveBeenCalled());
    const payload = createMut.mutate.mock.calls[0][0];
    expect(payload).toMatchObject({ sku: "QA-P7-SKU", product_name: "QA Product", price: "12.50", track_batch: false, track_expiry: false });
    expect(payload.barcode).toBeUndefined();
  });

  it("blocks an invalid SKU with an inline message", async () => {
    open();
    await userEvent.type(screen.getByLabelText(/^SKU/i), "bad sku!");
    await userEvent.type(screen.getByLabelText(/product name/i), "X");
    await userEvent.type(screen.getByLabelText(/unit price/i), "1.00");
    await userEvent.click(screen.getByRole("button", { name: /create product/i }));
    expect(await screen.findByText(/letters, digits, dot, dash or underscore/i)).toBeInTheDocument();
    expect(createMut.mutate).not.toHaveBeenCalled();
  });

  it("shows the 409 duplicate-SKU copy with a Request ID", async () => {
    createMut.mutate.mockImplementation((_p, { onError }) =>
      onError(new ApiError({ status: 409, message: "SKU already exists", requestId: "req-dup-1" })),
    );
    open();
    await userEvent.type(screen.getByLabelText(/^SKU/i), "QA-DUP");
    await userEvent.type(screen.getByLabelText(/product name/i), "Dup");
    await userEvent.type(screen.getByLabelText(/unit price/i), "1.00");
    await userEvent.click(screen.getByRole("button", { name: /create product/i }));
    expect(await screen.findByText(/already used by another product/i)).toBeInTheDocument();
    expect(screen.getByText("req-dup-1")).toBeInTheDocument();
  });
});
