import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ApiError } from "@/lib/api/errors";

const confirmMutate = vi.fn();
const cancelMutate = vi.fn();
let confirmState = { mutate: confirmMutate, isPending: false, isError: false, error: undefined as unknown };
let cancelState = { mutate: cancelMutate, isPending: false, isError: false, error: undefined as unknown };

vi.mock("@/lib/query/sales", () => ({
  useConfirmSalesOrder: () => confirmState,
  useCancelSalesOrder: () => cancelState,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// The Phase 9 sub-actions have their own dedicated tests; here we only check
// that SalesActions mounts them for the right status + role.
vi.mock("./ship-action", () => ({ ShipAction: () => <button>Ship order</button> }));
vi.mock("./complete-action", () => ({ CompleteAction: () => <button>Complete order</button> }));
vi.mock("./return-form", () => ({ ReturnDrawer: ({ open }: { open: boolean }) => <div data-testid="return-drawer" data-open={open} /> }));

import { SalesActions } from "./sales-actions";

beforeEach(() => {
  confirmMutate.mockReset();
  cancelMutate.mockReset();
  confirmState = { mutate: confirmMutate, isPending: false, isError: false, error: undefined };
  cancelState = { mutate: cancelMutate, isPending: false, isError: false, error: undefined };
});

describe("SalesActions — role + state gating", () => {
  it("shows Confirm only to an admin on a DRAFT order", () => {
    render(<SalesActions id={1} status="DRAFT" soNumber="SO-000001" role="admin" />);
    expect(screen.getByRole("button", { name: /confirm order/i })).toBeInTheDocument();
  });

  it("hides Confirm from a warehouse user", () => {
    render(<SalesActions id={1} status="DRAFT" soNumber="SO-000001" role="warehouse" />);
    expect(screen.queryByRole("button", { name: /confirm order/i })).toBeNull();
    // but warehouse can still cancel a draft
    expect(screen.getByRole("button", { name: /cancel order/i })).toBeEnabled();
  });

  it("disables Cancel with an explanation once the order has shipped", () => {
    render(<SalesActions id={1} status="SHIPPED" soNumber="SO-000001" role="warehouse" />);
    const btn = screen.getByRole("button", { name: /cancel order/i });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("title", expect.stringMatching(/no longer be cancelled/i));
  });

  it("renders nothing for a cancelled order seen by a warehouse user", () => {
    const { container } = render(
      <SalesActions id={1} status="CANCELLED" soNumber="SO-000001" role="warehouse" />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("SalesActions — confirm flow", () => {
  it("opens a confirmation dialog and calls the mutation with the order id", async () => {
    const user = userEvent.setup();
    render(<SalesActions id={7} status="DRAFT" soNumber="SO-000007" role="admin" />);

    await user.click(screen.getByRole("button", { name: /confirm order/i }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/confirm so-000007/i)).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: /confirm order/i }));
    expect(confirmMutate).toHaveBeenCalledTimes(1);
    expect(confirmMutate.mock.calls[0][0]).toBe(7);
  });

  it("surfaces a 409 state-conflict reason and its request id inside the dialog", async () => {
    const user = userEvent.setup();
    confirmState = {
      mutate: confirmMutate,
      isPending: false,
      isError: true,
      error: new ApiError({
        status: 409,
        message: "Sales Order state conflict: CONFIRMED; requires DRAFT",
        requestId: "req-abc-123",
      }),
    };
    render(<SalesActions id={7} status="DRAFT" soNumber="SO-000007" role="admin" />);
    await user.click(screen.getByRole("button", { name: /confirm order/i }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/state conflict: CONFIRMED; requires DRAFT/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/req-abc-123/)).toBeInTheDocument();
  });
});

describe("SalesActions — cancel flow", () => {
  it("calls the cancel mutation from its confirmation dialog", async () => {
    const user = userEvent.setup();
    render(<SalesActions id={5} status="CONFIRMED" soNumber="SO-000005" role="warehouse" />);
    await user.click(screen.getByRole("button", { name: /cancel order/i }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /cancel order/i }));
    expect(cancelMutate).toHaveBeenCalledWith(5, expect.any(Object));
  });
});

describe("SalesActions — Phase 9 ship / complete / return gating", () => {
  it("shows Ship for a READY_TO_SHIP order to warehouse and admin", () => {
    const { unmount } = render(<SalesActions id={1} status="READY_TO_SHIP" soNumber="SO-1" role="warehouse" />);
    expect(screen.getByRole("button", { name: /ship order/i })).toBeInTheDocument();
    unmount();
    render(<SalesActions id={1} status="READY_TO_SHIP" soNumber="SO-1" role="admin" />);
    expect(screen.getByRole("button", { name: /ship order/i })).toBeInTheDocument();
  });

  it("shows Complete only to an admin on a SHIPPED order, never to warehouse", () => {
    const { unmount } = render(<SalesActions id={1} status="SHIPPED" soNumber="SO-1" role="admin" />);
    expect(screen.getByRole("button", { name: /complete order/i })).toBeInTheDocument();
    unmount();
    render(<SalesActions id={1} status="SHIPPED" soNumber="SO-1" role="warehouse" />);
    expect(screen.queryByRole("button", { name: /complete order/i })).toBeNull();
  });

  it("offers Return items on SHIPPED and COMPLETED to warehouse + admin, and nowhere else", () => {
    for (const status of ["SHIPPED", "COMPLETED"]) {
      const { unmount } = render(<SalesActions id={1} status={status} soNumber="SO-1" role="warehouse" />);
      expect(screen.getByRole("button", { name: /return items/i })).toBeInTheDocument();
      unmount();
    }
    render(<SalesActions id={1} status="READY_TO_SHIP" soNumber="SO-1" role="warehouse" />);
    expect(screen.queryByRole("button", { name: /return items/i })).toBeNull();
  });

  it("does not show Ship or Complete once the order is COMPLETED", () => {
    render(<SalesActions id={1} status="COMPLETED" soNumber="SO-1" role="admin" />);
    expect(screen.queryByRole("button", { name: /ship order/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /complete order/i })).toBeNull();
  });
});
