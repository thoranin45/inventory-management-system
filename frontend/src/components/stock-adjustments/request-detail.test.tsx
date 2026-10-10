import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ApiError } from "@/lib/api/errors";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const BASE_REQUEST = {
  id: 42,
  reference_number: "ADJ-000042",
  status: "PENDING" as string,
  product: { id: 5, sku: "WH-COFFEE", product_name: "Coffee 1kg" },
  warehouse: { id: 1, warehouse_code: "MAIN", warehouse_name: "Main Warehouse" },
  location: { id: 1, location_code: "DEFAULT", location_name: "Default Location" },
  observed_quantity: "10.000",
  requested_quantity: "8.000",
  reason_code: "CYCLE_COUNT_VARIANCE",
  notes: null as string | null,
  requested_by: { id: 2, username: "warehouse1" },
  reviewed_by: null as { id: number; username: string } | null,
  rejection_reason: null as string | null,
  created_at: "2026-01-01T10:00:00Z",
  reviewed_at: null as string | null,
  completed_at: null as string | null,
  history: [{ action: "CREATE_ADJUSTMENT_REQUEST", actor: "warehouse1", at: "2026-01-01T10:00:00Z", detail: "PENDING" }] as {
    action: string; actor: string; at: string; detail: string;
  }[],
};

const approveMutate = vi.fn();
const rejectMutate = vi.fn();
const cancelMutate = vi.fn();
let requestData = { ...BASE_REQUEST };
let approveState = { mutate: approveMutate, isPending: false, isError: false, error: undefined as unknown };
let rejectState = { mutate: rejectMutate, isPending: false, isError: false, error: undefined as unknown };
let cancelState = { mutate: cancelMutate, isPending: false, isError: false, error: undefined as unknown };

vi.mock("@/lib/query/stock-adjustment-requests", () => ({
  useStockAdjustmentRequest: () => ({ data: requestData, isLoading: false, isError: false, error: undefined, refetch: vi.fn() }),
  useApproveStockAdjustmentRequest: () => approveState,
  useRejectStockAdjustmentRequest: () => rejectState,
  useCancelStockAdjustmentRequest: () => cancelState,
}));

import { StockAdjustmentRequestDetailBody } from "./request-detail";

beforeEach(() => {
  approveMutate.mockReset();
  rejectMutate.mockReset();
  cancelMutate.mockReset();
  requestData = { ...BASE_REQUEST, history: [...BASE_REQUEST.history] };
  approveState = { mutate: approveMutate, isPending: false, isError: false, error: undefined };
  rejectState = { mutate: rejectMutate, isPending: false, isError: false, error: undefined };
  cancelState = { mutate: cancelMutate, isPending: false, isError: false, error: undefined };
  window.sessionStorage.clear();
});

describe("StockAdjustmentRequestDetailBody", () => {
  it("shows the request detail and its inline lifecycle history", () => {
    requestData.history = [
      { action: "CREATE_ADJUSTMENT_REQUEST", actor: "warehouse1", at: "2026-01-01T10:00:00Z", detail: "PENDING" },
      { action: "APPROVE_ADJUSTMENT_REQUEST", actor: "admin1", at: "2026-01-01T11:00:00Z", detail: "PENDING -> APPROVED" },
    ];
    render(<StockAdjustmentRequestDetailBody id={42} role="admin" />);
    expect(screen.getByText("ADJ-000042")).toBeInTheDocument();
    expect(screen.getAllByText(/warehouse1/).length).toBeGreaterThan(0);
    expect(screen.getByText(/CREATE ADJUSTMENT REQUEST/i)).toBeInTheDocument();
    expect(screen.getByText(/APPROVE ADJUSTMENT REQUEST/i)).toBeInTheDocument();
    expect(screen.getByText(/admin1/)).toBeInTheDocument();
  });

  it("admin sees Approve/Reject on a PENDING request; confirming Approve calls the mutation", async () => {
    const user = userEvent.setup();
    render(<StockAdjustmentRequestDetailBody id={42} role="admin" />);
    await user.click(screen.getByRole("button", { name: /^approve$/i }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /^approve$/i }));
    expect(approveMutate).toHaveBeenCalledTimes(1);
    expect(approveMutate.mock.calls[0][0].id).toBe(42);
    expect(typeof approveMutate.mock.calls[0][0].idempotencyKey).toBe("string");
  });

  it("reject requires a non-blank reason before it can be confirmed", async () => {
    const user = userEvent.setup();
    render(<StockAdjustmentRequestDetailBody id={42} role="admin" />);
    await user.click(screen.getByRole("button", { name: /^reject$/i }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("button", { name: /^reject$/i })).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/rejection reason/i), "Counted again, original was correct");
    expect(within(dialog).getByRole("button", { name: /^reject$/i })).toBeEnabled();
    await user.click(within(dialog).getByRole("button", { name: /^reject$/i }));
    expect(rejectMutate).toHaveBeenCalledTimes(1);
    expect(rejectMutate.mock.calls[0][0]).toEqual({ id: 42, rejection_reason: "Counted again, original was correct" });
  });

  it("disables Approve/Reject while a decision is already pending, to prevent a second submission", () => {
    approveState = { mutate: approveMutate, isPending: true, isError: false, error: undefined };
    render(<StockAdjustmentRequestDetailBody id={42} role="admin" />);
    expect(screen.getByRole("button", { name: /^approve$/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^reject$/i })).toBeDisabled();
  });

  it("warehouse role never sees Approve/Reject, only Cancel", () => {
    render(<StockAdjustmentRequestDetailBody id={42} role="warehouse" />);
    expect(screen.queryByRole("button", { name: /^approve$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^reject$/i })).toBeNull();
    expect(screen.getByRole("button", { name: /cancel request/i })).toBeInTheDocument();
  });

  it("an already-decided (APPROVED) request shows no decision actions at all", () => {
    requestData.status = "APPROVED";
    requestData.reviewed_by = { id: 1, username: "admin1" };
    render(<StockAdjustmentRequestDetailBody id={42} role="admin" />);
    expect(screen.queryByRole("button", { name: /^approve$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^reject$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /cancel request/i })).toBeNull();
  });

  it("surfaces a stale-quantity conflict with the actual current value, and lets the admin retry", async () => {
    const user = userEvent.setup();
    approveState = {
      mutate: approveMutate,
      isPending: false,
      isError: true,
      error: new ApiError({
        status: 409,
        message: "Someone already changed this balance to 12.000. Review and retry.",
        requestId: "req-stale-1",
      }),
    };
    render(<StockAdjustmentRequestDetailBody id={42} role="admin" />);
    await user.click(screen.getByRole("button", { name: /^approve$/i }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/already changed this balance to 12\.000/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/req-stale-1/)).toBeInTheDocument();
    // the Approve action itself is still available to retry, not wedged shut
    expect(within(dialog).getByRole("button", { name: /^approve$/i })).toBeEnabled();
  });

  it("a different-key retry on an already-decided request shows the terminal message, not a mutation", async () => {
    const user = userEvent.setup();
    approveState = {
      mutate: approveMutate,
      isPending: false,
      isError: true,
      error: new ApiError({ status: 409, message: "This request was already decided: APPROVED.", requestId: "req-term-1" }),
    };
    render(<StockAdjustmentRequestDetailBody id={42} role="admin" />);
    await user.click(screen.getByRole("button", { name: /^approve$/i }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/already decided: APPROVED/i)).toBeInTheDocument();
  });

  it("retries approve after a lost response using the SAME Idempotency-Key, even across a reload", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<StockAdjustmentRequestDetailBody id={42} role="admin" />);
    await user.click(screen.getByRole("button", { name: /^approve$/i }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: /^approve$/i }));
    expect(approveMutate).toHaveBeenCalledTimes(1);
    const firstKey = approveMutate.mock.calls[0][0].idempotencyKey as string;

    // simulate a lost response: the key is NOT cleared (no success, no
    // "already decided" error) — then the page reloads (unmount + remount).
    unmount();
    render(<StockAdjustmentRequestDetailBody id={42} role="admin" />);
    await user.click(screen.getByRole("button", { name: /^approve$/i }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: /^approve$/i }));
    expect(approveMutate).toHaveBeenCalledTimes(2);
    expect(approveMutate.mock.calls[1][0].idempotencyKey).toBe(firstKey);
  });

  it("a successful approve clears the persisted key from storage", async () => {
    const user = userEvent.setup();
    approveMutate.mockImplementation((_vars, opts) => {
      opts.onSuccess({ ...requestData, status: "APPROVED" });
    });
    render(<StockAdjustmentRequestDetailBody id={42} role="admin" />);
    await user.click(screen.getByRole("button", { name: /^approve$/i }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: /^approve$/i }));
    expect(window.sessionStorage.getItem("adjreq-approve-key:42")).toBeNull();
  });
});
