import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const createMutate = vi.fn();

vi.mock("@/lib/query/sales", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/query/sales")>();
  return {
    ...actual,
    useCreateSalesOrder: () => ({ mutate: createMutate, isPending: false, isError: false, error: undefined }),
    useCustomerSearch: () => ({ data: [], isFetching: false }),
  };
});
vi.mock("@/lib/query/hooks", () => ({ useGlobalSearch: () => ({ data: undefined, isFetching: false }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { CreateSalesOrderDrawer } from "./create-sales-order";

function open() {
  return render(<CreateSalesOrderDrawer open onOpenChange={() => {}} onCreated={() => {}} />);
}

beforeEach(() => createMutate.mockReset());

describe("CreateSalesOrderDrawer — validation summary", () => {
  it("blocks submit and shows field errors when the form is empty", async () => {
    const user = userEvent.setup();
    open();
    await user.click(screen.getByRole("button", { name: /create draft order/i }));

    expect(await screen.findByText(/choose a customer/i)).toBeInTheDocument();
    expect(screen.getByText(/choose a product/i)).toBeInTheDocument();
    expect(screen.getByText(/quantity must be a number/i)).toBeInTheDocument();
    expect(createMutate).not.toHaveBeenCalled();
  });
});

describe("CreateSalesOrderDrawer — decimal-safe totals", () => {
  it("computes line + grand totals with BigInt math, not JS float", async () => {
    const user = userEvent.setup();
    open();

    await user.type(screen.getByLabelText("Quantity"), "5.000");
    await user.type(screen.getByLabelText("Unit price"), "210.00");

    // 5.000 × 210.00 = 1050.00 exactly
    expect(screen.getAllByText("฿1,050.00").length).toBeGreaterThanOrEqual(2); // line total + grand total
  });

  it("adds a second product line on demand", async () => {
    const user = userEvent.setup();
    open();
    expect(screen.getByText("Line 1")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /add product line/i }));
    expect(screen.getByText("Line 2")).toBeInTheDocument();
  });
});
