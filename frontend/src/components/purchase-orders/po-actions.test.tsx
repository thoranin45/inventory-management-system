import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ApiError } from "@/lib/api/errors";

const confirmMutate = vi.fn();
const cancelMutate = vi.fn();
let confirmState = { mutate: confirmMutate, isPending: false, isError: false, error: undefined as unknown };
let cancelState = { mutate: cancelMutate, isPending: false, isError: false, error: undefined as unknown };

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/query/purchase-orders", () => ({
  useConfirmPurchaseOrder: () => confirmState,
  useCancelPurchaseOrder: () => cancelState,
}));

import { PurchaseOrderActions } from "./po-actions";

beforeEach(() => {
  confirmMutate.mockReset();
  cancelMutate.mockReset();
  confirmState = { mutate: confirmMutate, isPending: false, isError: false, error: undefined };
  cancelState = { mutate: cancelMutate, isPending: false, isError: false, error: undefined };
});

describe("PurchaseOrderActions — role + lifecycle gating", () => {
  it("admin + DRAFT: Confirm shown, receiving link hidden (not receivable)", () => {
    render(<PurchaseOrderActions id={7} status="DRAFT" poNumber="PO-000007" role="admin" />);
    expect(screen.getByRole("button", { name: /confirm order/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /open receiving console/i })).toBeNull();
    expect(screen.getByRole("button", { name: /cancel order/i })).toBeEnabled();
  });

  it("admin + CONFIRMED: receiving link + Cancel, Confirm hidden", () => {
    render(<PurchaseOrderActions id={7} status="CONFIRMED" poNumber="PO-000007" role="admin" />);
    const link = screen.getByRole("link", { name: /open receiving console/i });
    expect(link).toHaveAttribute("href", "/purchase-orders/7/receive");
    expect(screen.queryByRole("button", { name: /confirm order/i })).toBeNull();
    expect(screen.getByRole("button", { name: /cancel order/i })).toBeInTheDocument();
  });

  it("warehouse + CONFIRMED: receiving link only, no admin actions", () => {
    render(<PurchaseOrderActions id={7} status="CONFIRMED" poNumber="PO-000007" role="warehouse" />);
    expect(screen.getByRole("link", { name: /open receiving console/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /confirm order/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /cancel order/i })).toBeNull();
  });

  it("admin + PARTIALLY_RECEIVED: receiving link, but Cancel is hidden (backend forbids it)", () => {
    render(<PurchaseOrderActions id={7} status="PARTIALLY_RECEIVED" poNumber="PO-000007" role="admin" />);
    expect(screen.getByRole("link", { name: /open receiving console/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /cancel order/i })).toBeNull();
  });

  it("RECEIVED: nothing to do", () => {
    const { container } = render(<PurchaseOrderActions id={7} status="RECEIVED" poNumber="PO-000007" role="admin" />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("PurchaseOrderActions — confirm flow", () => {
  it("opens a dialog and calls the confirm mutation with the PO id", async () => {
    const user = userEvent.setup();
    render(<PurchaseOrderActions id={7} status="DRAFT" poNumber="PO-000007" role="admin" />);
    await user.click(screen.getByRole("button", { name: /confirm order/i }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /confirm order/i }));
    expect(confirmMutate).toHaveBeenCalledTimes(1);
    expect(confirmMutate.mock.calls[0][0]).toBe(7);
  });

  it("surfaces a 409 lifecycle-conflict reason + request id in the dialog", async () => {
    const user = userEvent.setup();
    confirmState = {
      mutate: confirmMutate,
      isPending: false,
      isError: true,
      error: new ApiError({ status: 409, message: "Invalid purchase order status", requestId: "req-po-1" }),
    };
    render(<PurchaseOrderActions id={7} status="DRAFT" poNumber="PO-000007" role="admin" />);
    await user.click(screen.getByRole("button", { name: /confirm order/i }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/Invalid purchase order status/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/req-po-1/)).toBeInTheDocument();
  });
});
