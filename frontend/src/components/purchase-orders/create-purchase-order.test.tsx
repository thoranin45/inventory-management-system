import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/* R5.0 characterization — Create Purchase Order (previously untested). */

const createMutate = vi.fn();
let createState = { isPending: false, isError: false, error: undefined as unknown };
vi.mock("@/lib/query/purchase-orders", () => ({
  useCreatePurchaseOrder: () => ({ mutate: createMutate, ...createState }),
  useSupplierSearch: () => ({ data: [{ id: 2, supplier_name: "Bean Co", contact_name: "Ann", phone: "081" }], isFetching: false }),
}));
vi.mock("@/lib/query/hooks", () => ({
  useGlobalSearch: () => ({
    data: { results: [{ type: "product", id: "3", label: "Sugar 25kg", sublabel: "WH-SUGAR" }] },
    isFetching: false,
  }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { CreatePurchaseOrderDrawer } from "./create-purchase-order";

beforeEach(() => {
  createMutate.mockReset();
  createState = { isPending: false, isError: false, error: undefined };
});

async function pickFrom(user: ReturnType<typeof userEvent.setup>, comboName: RegExp, option: RegExp) {
  await user.click(screen.getByRole("combobox", { name: comboName }));
  await user.keyboard("ab");
  const opt = await screen.findByRole("option", { name: option });
  await user.click(within(opt).getByRole("button"));
}

describe("CreatePurchaseOrderDrawer — characterization (R5.0)", () => {
  it("blocks an empty submit with field errors and sends nothing", async () => {
    const user = userEvent.setup();
    render(<CreatePurchaseOrderDrawer open onOpenChange={() => {}} onCreated={() => {}} />);
    await user.click(screen.getByRole("button", { name: /create draft/i }));
    expect(await screen.findByText(/choose a supplier/i)).toBeInTheDocument();
    expect(screen.getByText(/choose a product/i)).toBeInTheDocument();
    expect(createMutate).not.toHaveBeenCalled();
  });

  it("sends exactly { supplier_id, items: [{ product_id, quantity, unit_price }] } once, as strings", async () => {
    const user = userEvent.setup();
    render(<CreatePurchaseOrderDrawer open onOpenChange={() => {}} onCreated={() => {}} />);
    await pickFrom(user, /search suppliers/i, /Bean Co/);
    await pickFrom(user, /search products for line 1/i, /Sugar 25kg/);
    await user.type(screen.getByLabelText("Quantity"), "2.5");
    await user.type(screen.getByLabelText("Unit price"), "40");
    await user.click(screen.getByRole("button", { name: /create draft/i }));
    await vi.waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1));
    expect(createMutate.mock.calls[0][0]).toEqual({
      supplier_id: 2,
      items: [{ product_id: 3, quantity: "2.5", unit_price: "40" }],
    });
  });

  it("disables the submit while the create is pending (no second request)", () => {
    createState = { isPending: true, isError: false, error: undefined };
    render(<CreatePurchaseOrderDrawer open onOpenChange={() => {}} onCreated={() => {}} />);
    expect(screen.getByRole("button", { name: /creating/i })).toBeDisabled();
  });
});
