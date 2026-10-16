import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ApiError } from "@/lib/api/errors";

const shippedDetail = {
  id: 63,
  so_number: "SO-000063",
  customer_id: 8,
  status: "SHIPPED",
  total_amount: "2.00",
  created_at: "2026-09-08T18:00:00",
  items: [
    { id: 98, sales_order_id: 63, product_id: 6, quantity: "5", unit_price: "1", total_price: "5", batch_allocations: [], fulfillment_allocations: [] },
    { id: 99, sales_order_id: 63, product_id: 3, quantity: "2", unit_price: "1", total_price: "2", batch_allocations: [], fulfillment_allocations: [] },
  ],
  picked_at: null, picked_by_user_id: null, packed_at: null, packed_by_user_id: null,
  shipped_at: "2026-09-08T18:05:00", shipped_by_user_id: 2, shipment_number: "SHIP-000063",
};

const retMut = { mutate: vi.fn(), isPending: false };
vi.mock("@/lib/query/sales", () => ({
  useSalesOrder: () => ({ data: shippedDetail, isLoading: false, isError: false }),
  useReturnSalesOrder: () => retMut,
  useProductLookup: () => ({ data: { 6: { id: 6, sku: "WH-TEA-200G", product_name: "Green Tea 200g" }, 3: { id: 3, sku: "WH-SUGAR-25KG", product_name: "Refined Sugar Sack 25kg" } } }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));

import { ReturnDrawer } from "./return-form";

beforeEach(() => {
  retMut.mutate.mockReset();
  retMut.isPending = false;
  window.sessionStorage.clear(); // V1-H1: the per-intent Idempotency-Key lives in sessionStorage
});

const keyOfCall = (n: number) => (retMut.mutate.mock.calls[n][0] as { idempotencyKey: string }).idempotencyKey;

const open = () => render(<ReturnDrawer id={63} soNumber="SO-000063" open onOpenChange={() => {}} />);

describe("ReturnDrawer", () => {
  it("shows Ordered / Shipped / Already returned / Remaining returnable per line", () => {
    open();
    expect(screen.getByText("Green Tea 200g")).toBeInTheDocument();
    expect(screen.getAllByText(/Ordered/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Shipped/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Already returned/).length).toBe(2);
    expect(screen.getAllByText(/unknown until you submit/i).length).toBe(2);
    expect(screen.getAllByText(/Remaining returnable/).length).toBe(2);
  });

  it("blocks a return above the ordered quantity client-side (no request)", async () => {
    open();
    await userEvent.type(screen.getByLabelText(/Return quantity for Green Tea 200g/i), "9");
    await userEvent.click(screen.getByRole("button", { name: /record return/i }));
    expect(await screen.findByText(/can't exceed 5/i)).toBeInTheDocument();
    expect(retMut.mutate).not.toHaveBeenCalled();
  });

  it("posts { id, input: { items:[{ product_id, quantity }] } } for the entered lines", async () => {
    open();
    await userEvent.type(screen.getByLabelText(/Return quantity for Green Tea 200g/i), "2");
    await userEvent.type(screen.getByLabelText(/Return reason for Green Tea 200g/i), "damaged");
    await userEvent.click(screen.getByRole("button", { name: /record return/i }));
    await waitFor(() => expect(retMut.mutate).toHaveBeenCalled());
    const [args] = retMut.mutate.mock.calls[0];
    expect(args).toEqual({
      id: 63,
      input: { items: [{ product_id: 6, quantity: "2", reason: "damaged" }] },
      idempotencyKey: expect.stringMatching(/^so-ret-[0-9a-f-]+$/),
    });
  });

  it("keeps entered draft quantities when the backend rejects the return, and shows 'Remaining: N' verbatim", async () => {
    retMut.mutate.mockImplementation((_a, { onError }) =>
      onError(new ApiError({ status: 409, message: "Return quantity exceeds remaining returnable quantity for product 6. Remaining: 1", requestId: "req-ret-409" })),
    );
    open();
    const input = screen.getByLabelText(/Return quantity for Green Tea 200g/i) as HTMLInputElement;
    await userEvent.type(input, "3");
    await userEvent.click(screen.getByRole("button", { name: /record return/i }));
    expect(await screen.findByText(/Remaining: 1/)).toBeInTheDocument();
    expect(screen.getByText("req-ret-409")).toBeInTheDocument();
    expect(input.value).toBe("3"); // draft preserved
  });

  it("on success shows the backend-recorded totals and updates 'already returned'", async () => {
    retMut.mutate.mockImplementation((_a, { onSuccess }) =>
      onSuccess({ sales_order_id: 63, so_number: "SO-000063", returned_items: [{ product_id: 6, returned_quantity: "2", previously_returned: "0", total_returned: "2", remaining_returnable: "3" }] }),
    );
    open();
    await userEvent.type(screen.getByLabelText(/Return quantity for Green Tea 200g/i), "2");
    await userEvent.click(screen.getByRole("button", { name: /record return/i }));
    expect(await screen.findByText(/Recorded by the backend/i)).toBeInTheDocument();
    expect(screen.getByText(/total returned/i)).toBeInTheDocument();
    // the "already returned" cell for that line now shows a real number
    const teaCard = screen.getByText("Green Tea 200g").closest("div")!.parentElement as HTMLElement;
    expect(within(teaCard).queryByText(/unknown until you submit/i)).not.toBeInTheDocument();
  });
});

describe("ReturnDrawer — V1-H1 Idempotency-Key lifecycle", () => {
  const typeTea = (value: string) => userEvent.type(screen.getByLabelText(/Return quantity for Green Tea 200g/i), value);
  const submit = () => userEvent.click(screen.getByRole("button", { name: /record return/i }));

  it("resubmitting after a failure (e.g. timeout) reuses the same key", async () => {
    retMut.mutate.mockImplementation((_a, { onError }) => onError(new ApiError({ status: 504, message: "Gateway Timeout" })));
    open();
    await typeTea("2");
    await submit();
    await submit();
    expect(retMut.mutate).toHaveBeenCalledTimes(2);
    expect(keyOfCall(1)).toBe(keyOfCall(0));
  });

  it("the key survives a reload of the drawer for the same order", async () => {
    retMut.mutate.mockImplementation((_a, { onError }) => onError(new ApiError({ status: 504, message: "Gateway Timeout" })));
    const first = open();
    await typeTea("2");
    await submit();
    const key = keyOfCall(0);
    first.unmount();
    open();
    await typeTea("2");
    await submit();
    expect(keyOfCall(1)).toBe(key);
  });

  it("a confirmed success starts a new intent with a new key", async () => {
    retMut.mutate.mockImplementation((_a, { onSuccess }) =>
      onSuccess({ sales_order_id: 63, so_number: "SO-000063", returned_items: [{ product_id: 6, returned_quantity: "1", previously_returned: "0", total_returned: "1", remaining_returnable: "4" }] }),
    );
    open();
    await typeTea("1");
    await submit();
    await typeTea("1");
    await submit();
    expect(retMut.mutate).toHaveBeenCalledTimes(2);
    expect(keyOfCall(1)).not.toBe(keyOfCall(0));
  });

  it("a 409 key conflict explains, blocks resubmission, and only rotates the key on request", async () => {
    retMut.mutate.mockImplementation((_a, { onError }) =>
      onError(new ApiError({ status: 409, message: "Idempotency-Key already used with a different payload", requestId: "req-key" })),
    );
    open();
    await typeTea("2");
    await submit();
    expect(await screen.findByText(/may already be recorded/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /record return/i })).toBeDisabled();
    const conflicted = keyOfCall(0);

    await userEvent.click(screen.getByRole("button", { name: /start a new return/i }));
    expect(screen.queryByText(/may already be recorded/i)).not.toBeInTheDocument();
    retMut.mutate.mockReset();
    await submit();
    expect(keyOfCall(0)).not.toBe(conflicted);
  });
});
