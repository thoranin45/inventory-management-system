import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/*
 * R5.0 characterization — the exact Create Sales Order request. Creation is
 * NOT keyed (POST /sales-orders sends no Idempotency-Key, backend accepts
 * none) and is never retried: one submit, one request.
 */

const createMutate = vi.fn();
let createState = { isPending: false, isError: false, error: undefined as unknown };
vi.mock("@/lib/query/sales", () => ({
  useCreateSalesOrder: () => ({ mutate: createMutate, ...createState }),
  useCustomerSearch: () => ({ data: [{ id: 3, customer_name: "Acme Foods", phone: null, email: null }], isFetching: false }),
}));
vi.mock("@/lib/query/hooks", () => ({
  useGlobalSearch: () => ({
    data: { results: [{ type: "product", id: "5", label: "Sea Salt 500g", sublabel: "WH-SALT" }] },
    isFetching: false,
  }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { CreateSalesOrderDrawer } from "./create-sales-order";

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

describe("CreateSalesOrderDrawer — request characterization (R5.0)", () => {
  it("sends exactly { customer_id, items: [{ product_id, quantity, unit_price }] } once, as strings, with no key", async () => {
    const user = userEvent.setup();
    render(<CreateSalesOrderDrawer open onOpenChange={() => {}} onCreated={() => {}} />);
    await pickFrom(user, /search customers/i, /Acme Foods/);
    await pickFrom(user, /search products for line 1/i, /Sea Salt 500g/);
    await user.type(screen.getByLabelText("Quantity"), "1.250");
    await user.type(screen.getByLabelText("Unit price"), "99.50");
    await user.click(screen.getByRole("button", { name: /create draft order/i }));
    await vi.waitFor(() => expect(createMutate).toHaveBeenCalledTimes(1));
    expect(createMutate.mock.calls[0][0]).toEqual({
      customer_id: 3,
      items: [{ product_id: 5, quantity: "1.250", unit_price: "99.50" }],
    });
  });

  it("disables the submit while pending (no second request)", () => {
    createState = { isPending: true, isError: false, error: undefined };
    render(<CreateSalesOrderDrawer open onOpenChange={() => {}} onCreated={() => {}} />);
    expect(screen.getByRole("button", { name: /creating/i })).toBeDisabled();
  });
});
