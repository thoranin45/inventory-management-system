import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

/* ------------------- R3.0 characterization (pre-refactor) ------------------- */

describe("ReturnDrawer — characterization (R3.0)", () => {
  const qtyFor = (name: RegExp) => screen.getByLabelText(new RegExp(`Return quantity for ${name.source}`, "i"));
  const reasonFor = (name: RegExp) => screen.getByLabelText(new RegExp(`Return reason for ${name.source}`, "i"));
  const submit = () => userEvent.click(screen.getByRole("button", { name: /record return/i }));
  const conflict = "Idempotency-Key already used with a different payload";

  it("body: items ordered by product_id ascending regardless of entry order, quantities NOT padded, reasons trimmed or omitted", async () => {
    open();
    // Decimal values are set in one change: typing "1." keystroke by keystroke
    // currently throws in render (sumDecimals on a partial value), an R3.0
    // finding reported separately and deliberately not fixed in R3.
    fireEvent.change(qtyFor(/Green Tea 200g/), { target: { value: "1.50" } }); // product 6, entered first
    await userEvent.type(reasonFor(/Green Tea 200g/), "  torn bag  ");
    await userEvent.type(qtyFor(/Refined Sugar Sack 25kg/), "2"); // product 3
    await userEvent.type(reasonFor(/Refined Sugar Sack 25kg/), "   ");
    await submit();
    expect(retMut.mutate.mock.calls[0][0]).toEqual({
      id: 63,
      input: {
        items: [
          { product_id: 3, quantity: "2" },
          { product_id: 6, quantity: "1.50", reason: "torn bag" },
        ],
      },
      idempotencyKey: expect.stringMatching(/^so-ret-/),
    });
  });

  it("more than 3 decimals is a line error and nothing is sent", async () => {
    open();
    fireEvent.change(qtyFor(/Green Tea 200g/), { target: { value: "1.0001" } }); // see the decimal note above
    await submit();
    expect(await screen.findByText(/up to 3 decimals/i)).toBeInTheDocument();
    expect(retMut.mutate).not.toHaveBeenCalled();
  });

  it("an empty drawer submit is blocked (button disabled until a quantity is entered)", () => {
    open();
    expect(screen.getByRole("button", { name: /record return/i })).toBeDisabled();
  });

  it("Record return is disabled while a return is pending", async () => {
    retMut.isPending = true;
    open();
    await userEvent.type(qtyFor(/Green Tea 200g/), "1");
    expect(screen.getByRole("button", { name: /submitting…/i })).toBeDisabled();
  });

  it("the key-conflict predicate is status 409 AND the exact message", async () => {
    retMut.mutate.mockImplementationOnce((_a, { onError }) => onError(new ApiError({ status: 422, message: conflict, requestId: "r1" })));
    open();
    await userEvent.type(qtyFor(/Green Tea 200g/), "1");
    await submit();
    // not a conflict: resubmission stays possible, the copy still comes from the shared map
    expect(await screen.findByText(/may already be recorded/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /start a new return/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /record return/i })).toBeEnabled();

    retMut.mutate.mockImplementationOnce((_a, { onError }) =>
      onError(new ApiError({ status: 409, message: conflict.toUpperCase(), requestId: "r2" })),
    );
    await submit();
    expect(screen.queryByRole("button", { name: /start a new return/i })).not.toBeInTheDocument();
    expect(keyOfCall(1)).toBe(keyOfCall(0));
  });

  it("a key conflict keeps the entered lines; 'Start a new return' keeps them and only rotates the key", async () => {
    retMut.mutate.mockImplementationOnce((_a, { onError }) => onError(new ApiError({ status: 409, message: conflict, requestId: "r" })));
    open();
    await userEvent.type(qtyFor(/Green Tea 200g/), "2");
    await submit();
    await userEvent.click(await screen.findByRole("button", { name: /start a new return/i }));
    expect(qtyFor(/Green Tea 200g/)).toHaveValue("2");
    await submit();
    expect(retMut.mutate.mock.calls[1][0].input).toEqual(retMut.mutate.mock.calls[0][0].input);
    expect(keyOfCall(1)).not.toBe(keyOfCall(0));
  });

  it("a non-ApiError failure keeps entries with the generic copy", async () => {
    retMut.mutate.mockImplementationOnce((_a, { onError }) => onError(new TypeError("Failed to fetch")));
    open();
    await userEvent.type(qtyFor(/Green Tea 200g/), "2");
    await submit();
    expect(await screen.findByText("The return was rejected. Your entries are kept.")).toBeInTheDocument();
    expect(qtyFor(/Green Tea 200g/)).toHaveValue("2");
  });

  it("success clears only the returned lines' quantity and reason", async () => {
    retMut.mutate.mockImplementationOnce((_a, { onSuccess }) =>
      onSuccess({ sales_order_id: 63, so_number: "SO-000063", returned_items: [{ product_id: 6, returned_quantity: "1", previously_returned: "0", total_returned: "1", remaining_returnable: "4" }] }),
    );
    open();
    await userEvent.type(qtyFor(/Green Tea 200g/), "1");
    await userEvent.type(reasonFor(/Green Tea 200g/), "dent");
    await userEvent.type(qtyFor(/Refined Sugar Sack 25kg/), "1");
    await submit();
    expect(qtyFor(/Green Tea 200g/)).toHaveValue("");
    expect(reasonFor(/Green Tea 200g/)).toHaveValue("");
    expect(qtyFor(/Refined Sugar Sack 25kg/)).toHaveValue("1"); // not in the backend result: kept
  });

  it("the ceiling uses what the backend reported as already returned", async () => {
    retMut.mutate.mockImplementationOnce((_a, { onSuccess }) =>
      onSuccess({ sales_order_id: 63, so_number: "SO-000063", returned_items: [{ product_id: 6, returned_quantity: "4", previously_returned: "0", total_returned: "4", remaining_returnable: "1" }] }),
    );
    open();
    await userEvent.type(qtyFor(/Green Tea 200g/), "4");
    await submit();
    await userEvent.type(qtyFor(/Green Tea 200g/), "2");
    await submit();
    expect(await screen.findByText(/can't exceed 1\.000/i)).toBeInTheDocument();
    expect(retMut.mutate).toHaveBeenCalledTimes(1);
  });

  it("only the key survives a drawer reload — entered quantities do not", async () => {
    retMut.mutate.mockImplementation((_a, { onError }) => onError(new ApiError({ status: 504, message: "Gateway Timeout" })));
    const first = open();
    await userEvent.type(qtyFor(/Green Tea 200g/), "2");
    await submit();
    first.unmount();
    open();
    expect(qtyFor(/Green Tea 200g/)).toHaveValue("");
  });
});

/* --------- Sales Return input safety (pre-existing render crash, fixed) --------- */

describe("ReturnDrawer — partial and invalid quantity input never crashes", () => {
  const qtyFor = (name: RegExp) => screen.getByLabelText(new RegExp(`Return quantity for ${name.source}`, "i"));
  const submit = () => userEvent.click(screen.getByRole("button", { name: /record return/i }));
  const returning = () => screen.getByText(/^Returning/).textContent;

  it("typing a decimal keystroke by keystroke keeps the drawer and the typed text", async () => {
    open();
    await userEvent.type(qtyFor(/Green Tea 200g/), "1.5"); // passes through "1."
    expect(qtyFor(/Green Tea 200g/)).toHaveValue("1.5");
    expect(returning()).toMatch(/1\.5/);
  });

  it("a partial decimal shows no total and is rejected on submit, never sent", async () => {
    open();
    await userEvent.type(qtyFor(/Green Tea 200g/), "1.");
    expect(qtyFor(/Green Tea 200g/)).toHaveValue("1.");
    expect(returning()).toBe("Returning —"); // not a number, and not a silent zero
    await submit();
    expect(await screen.findByText(/up to 3 decimals/i)).toBeInTheDocument();
    expect(retMut.mutate).not.toHaveBeenCalled();
  });

  it("invalid text is kept, shows no total, and blocks the whole return (no silent zero line)", async () => {
    open();
    await userEvent.type(qtyFor(/Green Tea 200g/), "abc");
    await userEvent.type(qtyFor(/Refined Sugar Sack 25kg/), "1");
    expect(qtyFor(/Green Tea 200g/)).toHaveValue("abc");
    expect(returning()).toBe("Returning —");
    await submit();
    expect(await screen.findByText(/up to 3 decimals/i)).toBeInTheDocument();
    expect(retMut.mutate).not.toHaveBeenCalled(); // the valid sugar line is not sent alone
  });

  it("other non-numeric fragments ('.', '-', '1.2.3') render without crashing", async () => {
    open();
    for (const text of [".", "-", "1.2.3"]) {
      fireEvent.change(qtyFor(/Green Tea 200g/), { target: { value: text } });
      expect(qtyFor(/Green Tea 200g/)).toHaveValue(text);
      expect(returning()).toBe("Returning —");
    }
  });

  it("an emptied field returns to no active line (Record return disabled)", async () => {
    open();
    await userEvent.type(qtyFor(/Green Tea 200g/), "1.");
    await userEvent.clear(qtyFor(/Green Tea 200g/));
    expect(screen.getByRole("button", { name: /record return/i })).toBeDisabled();
    expect(returning()).toMatch(/Returning\s*0/);
  });

  it("correcting the input recovers: the corrected value is sent exactly, and a retry reuses the key", async () => {
    retMut.mutate.mockImplementation((_a, { onError }) => onError(new ApiError({ status: 504, message: "Gateway Timeout" })));
    open();
    await userEvent.type(qtyFor(/Green Tea 200g/), "1.");
    await submit();
    expect(retMut.mutate).not.toHaveBeenCalled();
    await userEvent.type(qtyFor(/Green Tea 200g/), "25"); // "1." -> "1.25"
    expect(returning()).toMatch(/1\.25/);
    await submit();
    await submit(); // retry after the timeout
    expect(retMut.mutate).toHaveBeenCalledTimes(2);
    expect(retMut.mutate.mock.calls[0][0].input).toEqual({ items: [{ product_id: 6, quantity: "1.25" }] });
    expect(retMut.mutate.mock.calls[1][0]).toEqual(retMut.mutate.mock.calls[0][0]);
  });

  it("the ceiling rule still applies to valid decimals", async () => {
    open();
    await userEvent.type(qtyFor(/Green Tea 200g/), "5.001");
    await submit();
    expect(await screen.findByText(/can't exceed 5/i)).toBeInTheDocument();
    expect(retMut.mutate).not.toHaveBeenCalled();
  });
});

describe("ReturnDrawer — the running total follows the quantity rule (over-precise input)", () => {
  const qtyFor = (name: RegExp) => screen.getByLabelText(new RegExp(`Return quantity for ${name.source}`, "i"));
  const submit = () => userEvent.click(screen.getByRole("button", { name: /record return/i }));
  const returning = () => screen.getByText(/^Returning/).textContent;
  // QuantityDisplay shows the approved 2-dp form and keeps the exact value in data-raw
  const rawTotal = () => screen.getByText(/^Returning/).querySelector(".qty")?.getAttribute("data-raw") ?? null;

  it.each(["0.0009", "1.2345"])("'%s' keeps the typed text, shows no total and sends nothing", async (typed) => {
    open();
    await userEvent.type(qtyFor(/Green Tea 200g/), typed);
    expect(qtyFor(/Green Tea 200g/)).toHaveValue(typed);
    expect(returning()).toBe("Returning —");
    await submit();
    expect(await screen.findByText(/up to 3 decimals/i)).toBeInTheDocument();
    expect(retMut.mutate).not.toHaveBeenCalled();
  });

  it("an over-precise line beside a valid one: no total, the whole return is blocked", async () => {
    open();
    await userEvent.type(qtyFor(/Refined Sugar Sack 25kg/), "1");
    await userEvent.type(qtyFor(/Green Tea 200g/), "0.0009");
    expect(returning()).toBe("Returning —");
    await submit();
    expect(retMut.mutate).not.toHaveBeenCalled();
  });

  it("valid 1.234 and 1.5 still total normally", async () => {
    open();
    await userEvent.type(qtyFor(/Green Tea 200g/), "1.234");
    expect(rawTotal()).toBe("1.234");
    expect(returning()).toBe("Returning 1.234"); // D-R4-1: exact 3 dp (was the flagged 1.23)
    await userEvent.clear(qtyFor(/Green Tea 200g/));
    await userEvent.type(qtyFor(/Green Tea 200g/), "1.5");
    expect(rawTotal()).toBe("1.500");
    expect(returning()).toBe("Returning 1.500");
  });

  it("correcting 0.0009 to 0.009 restores the total and sends the corrected value as typed", async () => {
    open();
    await userEvent.type(qtyFor(/Green Tea 200g/), "0.0009");
    await submit();
    expect(retMut.mutate).not.toHaveBeenCalled();
    await userEvent.type(qtyFor(/Green Tea 200g/), "{Backspace}{Backspace}9"); // "0.0009" -> "0.009"
    expect(qtyFor(/Green Tea 200g/)).toHaveValue("0.009");
    expect(rawTotal()).toBe("0.009");
    await submit();
    expect(retMut.mutate).toHaveBeenCalledTimes(1);
    expect(retMut.mutate.mock.calls[0][0].input).toEqual({ items: [{ product_id: 6, quantity: "0.009" }] });
  });
});
