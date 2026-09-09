import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ApiError } from "@/lib/api/errors";

const dispatchMutate = vi.fn();
const cancelMutate = vi.fn();
let dispatchState = { mutate: dispatchMutate, isPending: false, isError: false, error: undefined as unknown };
let cancelState = { mutate: cancelMutate, isPending: false, isError: false, error: undefined as unknown };

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/query/transfers", () => ({
  useDispatchTransfer: () => dispatchState,
  useCancelTransfer: () => cancelState,
}));

import { TransferActions } from "./transfer-actions";

beforeEach(() => {
  dispatchMutate.mockReset();
  cancelMutate.mockReset();
  dispatchState = { mutate: dispatchMutate, isPending: false, isError: false, error: undefined };
  cancelState = { mutate: cancelMutate, isPending: false, isError: false, error: undefined };
});

describe("TransferActions — gating + no Complete action", () => {
  it("DRAFT: Dispatch + Cancel, no receiving link, NO 'Complete' anywhere", () => {
    render(<TransferActions id={1} status="DRAFT" transferNumber="TR-1" />);
    expect(screen.getByRole("button", { name: /^Dispatch$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cancel transfer/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /receiving console/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /complete/i })).toBeNull();
  });

  it("IN_TRANSIT: only the receiving link — Dispatch + Cancel are gone", () => {
    render(<TransferActions id={1} status="IN_TRANSIT" transferNumber="TR-1" />);
    expect(screen.getByRole("link", { name: /open receiving console/i })).toHaveAttribute("href", "/transfers/1/receive");
    expect(screen.queryByRole("button", { name: /^Dispatch$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /cancel transfer/i })).toBeNull();
  });

  it("PARTIALLY_RECEIVED: still just the receiving link, never Complete", () => {
    render(<TransferActions id={1} status="PARTIALLY_RECEIVED" transferNumber="TR-1" />);
    expect(screen.getByRole("link", { name: /open receiving console/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /complete/i })).toBeNull();
  });

  it("COMPLETED / legacy: no actions", () => {
    const { container: a } = render(<TransferActions id={1} status="COMPLETED" transferNumber="TR-1" />);
    expect(a).toBeEmptyDOMElement();
    const { container: b } = render(
      <TransferActions id={1} status="COMPLETED" transferNumber="TR-1" legacyCompleted />,
    );
    expect(b).toBeEmptyDOMElement();
  });
});

describe("TransferActions — dispatch flow", () => {
  it("opens an all-or-nothing dialog and calls dispatch with the id", async () => {
    const user = userEvent.setup();
    render(<TransferActions id={9} status="DRAFT" transferNumber="TR-9" />);
    await user.click(screen.getByRole("button", { name: /^Dispatch$/i }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/all-or-nothing/i)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: /dispatch all lines/i }));
    expect(dispatchMutate).toHaveBeenCalledWith(9, expect.any(Object));
  });

  it("surfaces a duplicate-dispatch 409 + request id inside the dialog", async () => {
    const user = userEvent.setup();
    dispatchState = {
      mutate: dispatchMutate,
      isPending: false,
      isError: true,
      error: new ApiError({ status: 409, message: "Transfer state conflict: IN_TRANSIT", requestId: "req-dd" }),
    };
    render(<TransferActions id={9} status="DRAFT" transferNumber="TR-9" />);
    await user.click(screen.getByRole("button", { name: /^Dispatch$/i }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/already been dispatched/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/req-dd/)).toBeInTheDocument();
  });

  it("surfaces an expired-batch 409 with actionable copy", async () => {
    const user = userEvent.setup();
    dispatchState = {
      mutate: dispatchMutate,
      isPending: false,
      isError: true,
      error: new ApiError({ status: 409, message: "Cannot dispatch expired batch: 7", requestId: "req-x" }),
    };
    render(<TransferActions id={9} status="DRAFT" transferNumber="TR-9" />);
    await user.click(screen.getByRole("button", { name: /^Dispatch$/i }));
    expect(within(screen.getByRole("dialog")).getByText(/expired batch.*in-date batch/i)).toBeInTheDocument();
  });
});
