import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ApiError } from "@/lib/api/errors";

const shipMut = { mutate: vi.fn(), isPending: false, isError: false, error: undefined as unknown };
vi.mock("@/lib/query/sales", () => ({ useShipSalesOrder: () => shipMut }));
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) } }));

import { ShipAction } from "./ship-action";

beforeEach(() => {
  shipMut.mutate.mockReset();
  shipMut.isPending = false;
  shipMut.isError = false;
  shipMut.error = undefined;
  toastSuccess.mockReset();
  toastError.mockReset();
});

describe("ShipAction", () => {
  it("only renders for a READY_TO_SHIP order and a warehouse/admin role", () => {
    const { rerender, container } = render(<ShipAction id={1} status="READY_TO_SHIP" soNumber="SO-1" role="warehouse" />);
    expect(screen.getByRole("button", { name: /ship order/i })).toBeInTheDocument();

    rerender(<ShipAction id={1} status="PACKING" soNumber="SO-1" role="warehouse" />);
    expect(container).toBeEmptyDOMElement();

    rerender(<ShipAction id={1} status="READY_TO_SHIP" soNumber="SO-1" role={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("ships through the mutation and shows the shipment number on success", async () => {
    shipMut.mutate.mockImplementation((_id, { onSuccess }) =>
      onSuccess({ sales_order_id: 1, so_number: "SO-1", status: "SHIPPED", shipment_number: "SHIP-000001" }),
    );
    render(<ShipAction id={1} status="READY_TO_SHIP" soNumber="SO-1" role="warehouse" />);
    await userEvent.click(screen.getByRole("button", { name: /ship order/i }));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: /ship order/i }));
    await waitFor(() => expect(shipMut.mutate).toHaveBeenCalledWith(1, expect.anything()));
    expect(toastSuccess.mock.calls[0][1].description).toMatch(/SHIP-000001/);
  });

  it("surfaces a 409 state conflict with copy + Request ID", async () => {
    shipMut.isError = true;
    shipMut.error = new ApiError({ status: 409, message: "Sales Order state conflict: DRAFT; requires READY_TO_SHIP", requestId: "req-ship-409" });
    render(<ShipAction id={1} status="READY_TO_SHIP" soNumber="SO-1" role="admin" />);
    await userEvent.click(screen.getByRole("button", { name: /ship order/i }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/needs it to be.*Ready to ship/i)).toBeInTheDocument();
    expect(within(dialog).getByText("req-ship-409")).toBeInTheDocument();
  });
});
