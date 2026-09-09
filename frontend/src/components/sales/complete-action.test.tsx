import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ApiError } from "@/lib/api/errors";

const mut = { mutate: vi.fn(), isPending: false, isError: false, error: undefined as unknown };
vi.mock("@/lib/query/sales", () => ({ useCompleteSalesOrder: () => mut }));
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) } }));

import { CompleteAction } from "./complete-action";

beforeEach(() => {
  mut.mutate.mockReset();
  mut.isError = false;
  mut.error = undefined;
  toastSuccess.mockReset();
  toastError.mockReset();
});

describe("CompleteAction", () => {
  it("is admin-only and SHIPPED-only", () => {
    const { rerender, container } = render(<CompleteAction id={1} status="SHIPPED" soNumber="SO-1" role="admin" />);
    expect(screen.getByRole("button", { name: /complete order/i })).toBeInTheDocument();

    rerender(<CompleteAction id={1} status="SHIPPED" soNumber="SO-1" role="warehouse" />);
    expect(container).toBeEmptyDOMElement();

    rerender(<CompleteAction id={1} status="READY_TO_SHIP" soNumber="SO-1" role="admin" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("confirms then completes; copy says it is internal-only, not payment/courier", async () => {
    mut.mutate.mockImplementation((_id, { onSuccess }) => onSuccess({ sales_order_id: 1, so_number: "SO-1", status: "COMPLETED" }));
    render(<CompleteAction id={1} status="SHIPPED" soNumber="SO-1" role="admin" />);
    await userEvent.click(screen.getByRole("button", { name: /complete order/i }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/does not imply payment settlement or courier delivery/i)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: /complete order/i }));
    await waitFor(() => expect(mut.mutate).toHaveBeenCalledWith(1, expect.anything()));
    expect(toastSuccess).toHaveBeenCalled();
  });

  it("surfaces a 409 with a Request ID", async () => {
    mut.isError = true;
    mut.error = new ApiError({ status: 409, message: "Sales Order state conflict: DRAFT; requires SHIPPED", requestId: "req-c-409" });
    render(<CompleteAction id={1} status="SHIPPED" soNumber="SO-1" role="admin" />);
    await userEvent.click(screen.getByRole("button", { name: /complete order/i }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("req-c-409")).toBeInTheDocument();
  });
});
