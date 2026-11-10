import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";

import { ApiError } from "@/lib/api/errors";
import {
  classifyReturnRefusal,
  confirmsReturnIntent,
  RETURN_KEY_CONFLICT,
  RETURN_REFUSED_NOT_RETURNABLE,
  RETURN_REFUSED_OVER_BATCH_ALLOCATION,
} from "@/lib/api/schemas/sales";

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
// the order the drawer sees; a test may swap it to simulate a refreshed order
const orderQ = vi.hoisted(() => ({ data: null as unknown }));
vi.mock("@/lib/query/sales", () => ({
  useSalesOrder: () => ({ data: orderQ.data, isLoading: false, isError: false }),
  useReturnSalesOrder: () => retMut,
  useProductLookup: () => ({ data: { 6: { id: 6, sku: "WH-TEA-200G", product_name: "Green Tea 200g" }, 3: { id: 3, sku: "WH-SUGAR-25KG", product_name: "Refined Sugar Sack 25kg" } } }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));
// P0-A5: the signed-in user the pending intent is bound to (null = no SessionProvider)
const session = vi.hoisted(() => ({ userId: 7 as number | null }));
vi.mock("@/components/session-provider", () => ({
  useSession: () => {
    if (session.userId === null) throw new Error("useSession must be used within <SessionProvider>");
    return { user: { id: session.userId } };
  },
}));

import { ReturnDrawer } from "./return-form";

beforeEach(() => {
  retMut.mutate.mockReset();
  retMut.isPending = false;
  orderQ.data = shippedDetail;
  session.userId = 7;
  vi.mocked(toast.success).mockClear();
  window.sessionStorage.clear(); // V1-H1 / P0-A5: the pending intent lives in sessionStorage
});

const keyOfCall = (n: number) => (retMut.mutate.mock.calls[n][0] as { idempotencyKey: string }).idempotencyKey;

const drawer = (open = true) => <ReturnDrawer id={63} soNumber="SO-000063" open={open} onOpenChange={() => {}} />;
const open = () => render(drawer());

/* ---------------------------------- helpers ---------------------------------- */

const RECORD_KEY = "sales-return:63";
const rawRecord = () => window.sessionStorage.getItem(RECORD_KEY);
const record = () => JSON.parse(rawRecord() ?? "null");

/** A backend refusal exactly as the BFF delivers it: status + the backend's error envelope. */
const backendError = (status: number, message: string, requestId = "req-x") =>
  new ApiError({ status, message, requestId, body: { success: false, message, errors: [], request_id: requestId } });

/** A 2xx body answering the given lines. */
const reply = (lines: Array<[number, string | number]>, salesOrderId = 63) => ({
  sales_order_id: salesOrderId,
  so_number: "SO-000063",
  returned_items: lines.map(([product_id, q]) => ({
    product_id,
    returned_quantity: q,
    previously_returned: "0",
    total_returned: String(q),
    remaining_returnable: "1",
  })),
});

type Handlers = { onSuccess: (data: unknown) => void; onError: (error: unknown) => void };
/** Requests stay out until the test settles them (handlers()[n]). */
function holdRequests() {
  const held: Handlers[] = [];
  retMut.mutate.mockImplementation((_vars, handlers: Handlers) => {
    held.push(handlers);
  });
  return held;
}
const failWith = (error: unknown) => retMut.mutate.mockImplementation((_a, { onError }) => onError(error));
const succeedWith = (data: unknown) => retMut.mutate.mockImplementation((_a, { onSuccess }) => onSuccess(data));

const qtyFor = (name: RegExp) => screen.getByLabelText(new RegExp(`Return quantity for ${name.source}`, "i")) as HTMLInputElement;
const reasonFor = (name: RegExp) => screen.getByLabelText(new RegExp(`Return reason for ${name.source}`, "i")) as HTMLInputElement;
const TEA = /Green Tea 200g/;
const SUGAR = /Refined Sugar Sack 25kg/;
const recordButton = () => screen.getByRole("button", { name: /^record return$/i });
const retryButton = () => screen.getByRole("button", { name: /retry: record return/i });
const clickRecord = () => userEvent.click(screen.getByRole("button", { name: /record return/i }));

/** Make every access to window.sessionStorage throw; returns the undo. */
function blockSessionStorage() {
  const descriptor =
    Object.getOwnPropertyDescriptor(window, "sessionStorage") ??
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(window), "sessionStorage");
  Object.defineProperty(window, "sessionStorage", {
    configurable: true,
    get() {
      throw new DOMException("The operation is insecure.", "SecurityError");
    },
  });
  return () => {
    if (Object.getOwnPropertyDescriptor(window, "sessionStorage") && descriptor) {
      Object.defineProperty(window, "sessionStorage", descriptor);
    }
  };
}

/** Assert the intent is still pending with exactly this key and payload. */
function expectPending(key: string, items: unknown[]) {
  const r = record();
  expect(r.pending).not.toBeNull();
  expect(r.pending.idempotencyKey).toBe(key);
  expect(r.pending.payload).toEqual({ items });
}

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

  it("a proven refusal releases the intent: entries come back editable, 'Remaining: N' verbatim, and the next return gets a new key", async () => {
    failWith(backendError(409, "Return quantity exceeds remaining returnable quantity for product 6. Remaining: 1", "req-ret-409"));
    open();
    const input = qtyFor(TEA);
    await userEvent.type(input, "3");
    await clickRecord();
    expect(await screen.findByText(/Remaining: 1/)).toBeInTheDocument();
    expect(screen.getByText("req-ret-409")).toBeInTheDocument();
    expect(input.value).toBe("3"); // draft preserved
    expect(input).not.toHaveAttribute("readonly"); // and editable again
    const refused = keyOfCall(0);
    expect(record()).toEqual({ version: 1, salesOrderId: 63, usedKeys: [refused], pending: null });

    retMut.mutate.mockReset();
    await userEvent.clear(input);
    await userEvent.type(input, "1");
    await clickRecord();
    expect(keyOfCall(0)).not.toBe(refused); // a sent key is never reused
    expect(record().usedKeys).toEqual([refused, keyOfCall(0)]);
  });

  it("on success shows the backend-recorded totals and updates 'already returned'", async () => {
    succeedWith({ sales_order_id: 63, so_number: "SO-000063", returned_items: [{ product_id: 6, returned_quantity: "2", previously_returned: "0", total_returned: "2", remaining_returnable: "3" }] });
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

  it("resubmitting after a failure (e.g. timeout) reuses the same key and the same payload", async () => {
    retMut.mutate.mockImplementation((_a, { onError }) => onError(new ApiError({ status: 504, message: "Gateway Timeout" })));
    open();
    await typeTea("2");
    await submit();
    await submit();
    expect(retMut.mutate).toHaveBeenCalledTimes(2);
    expect(keyOfCall(1)).toBe(keyOfCall(0));
    expect(retMut.mutate.mock.calls[1][0]).toEqual(retMut.mutate.mock.calls[0][0]);
  });

  it("the key AND the payload survive a reload of the drawer for the same order", async () => {
    retMut.mutate.mockImplementation((_a, { onError }) => onError(new ApiError({ status: 504, message: "Gateway Timeout" })));
    const first = open();
    await typeTea("2");
    await submit();
    const key = keyOfCall(0);
    first.unmount();
    open();
    expect(qtyFor(TEA)).toHaveValue("2"); // restored from the stored intent
    await typeTea("9"); // read-only: nothing changes
    expect(qtyFor(TEA)).toHaveValue("2");
    await submit();
    expect(keyOfCall(1)).toBe(key);
    expect(retMut.mutate.mock.calls[1][0]).toEqual(retMut.mutate.mock.calls[0][0]);
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

  it("a 409 key conflict explains, keeps the intent and its key, and never unlocks a new return", async () => {
    retMut.mutate.mockImplementation((_a, { onError }) => onError(backendError(409, RETURN_KEY_CONFLICT, "req-key")));
    const first = open();
    await typeTea("2");
    await submit();
    expect(await screen.findByText(/may already be recorded/i)).toBeInTheDocument();
    expect(screen.getByText(/Failed — request key conflict/i)).toBeInTheDocument();
    // P0-A5-F1: dedicated copy — Retry doesn't change the answer, check ledger + order, closing the tab resets
    expect(screen.getByText(/won't change the server's answer/i)).toBeInTheDocument();
    expect(screen.getByText(/Check the stock ledger \(SALES_RETURN movements for SO-000063 .*\) and the sales order/i)).toBeInTheDocument();
    expect(screen.getByText(/Closing this browser tab is the only way to reset/i)).toBeInTheDocument();
    // and none of the generic unknown-outcome copy that implies Retry can resolve it
    expect(screen.queryByText(/until the backend confirms or refuses it/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/before recording anything else/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /start a new return/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^record return$/i })).not.toBeInTheDocument();
    expect(qtyFor(TEA)).toHaveAttribute("readonly");
    const conflicted = keyOfCall(0);
    expectPending(conflicted, [{ product_id: 6, quantity: "2" }]);

    await submit(); // the only action (D4, unchanged): the same intent again
    expect(keyOfCall(1)).toBe(conflicted);
    expect(retMut.mutate.mock.calls[1][0]).toEqual(retMut.mutate.mock.calls[0][0]);
    expect(screen.getByText(/won't change the server's answer/i)).toBeInTheDocument();
    first.unmount();
    open(); // nor does a reload rotate it
    await submit();
    expect(keyOfCall(2)).toBe(conflicted);
    expectPending(conflicted, [{ product_id: 6, quantity: "2" }]);
  });
});

/* ------------------- R3.0 characterization (pre-refactor) ------------------- */

describe("ReturnDrawer — characterization (R3.0)", () => {
  const submit = () => userEvent.click(screen.getByRole("button", { name: /record return/i }));
  const conflict = "Idempotency-Key already used with a different payload";

  it("body: items ordered by product_id ascending regardless of entry order, quantities NOT padded, reasons trimmed or omitted", async () => {
    open();
    // Decimal values are set in one change: typing "1." keystroke by keystroke
    // currently throws in render (sumDecimals on a partial value), an R3.0
    // finding reported separately and deliberately not fixed in R3.
    fireEvent.change(qtyFor(TEA), { target: { value: "1.50" } }); // product 6, entered first
    await userEvent.type(reasonFor(TEA), "  torn bag  ");
    await userEvent.type(qtyFor(SUGAR), "2"); // product 3
    await userEvent.type(reasonFor(SUGAR), "   ");
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
    fireEvent.change(qtyFor(TEA), { target: { value: "1.0001" } }); // see the decimal note above
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
    await userEvent.type(qtyFor(TEA), "1");
    expect(screen.getByRole("button", { name: /submitting…/i })).toBeDisabled();
  });

  it("the key-conflict predicate is status 409 AND the exact message", async () => {
    retMut.mutate.mockImplementationOnce((_a, { onError }) => onError(new ApiError({ status: 422, message: conflict, requestId: "r1" })));
    open();
    await userEvent.type(qtyFor(TEA), "1");
    await submit();
    // not a conflict: retrying stays possible, the copy still comes from the shared map
    expect(await screen.findByText(/may already be recorded/i)).toBeInTheDocument();
    expect(screen.queryByText(/request key conflict/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /start a new return/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /record return/i })).toBeEnabled();

    retMut.mutate.mockImplementationOnce((_a, { onError }) =>
      onError(new ApiError({ status: 409, message: conflict.toUpperCase(), requestId: "r2" })),
    );
    await submit();
    expect(screen.queryByText(/request key conflict/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /start a new return/i })).not.toBeInTheDocument();
    expect(keyOfCall(1)).toBe(keyOfCall(0));
  });

  // P0-A5: replaces "a key conflict keeps the entered lines; 'Start a new return'
  // keeps them and only rotates the key" — that rotation let the same lines go
  // out under a fresh key while the first return might already be recorded.
  it("a key conflict keeps the sent lines AND the key: no new return, every retry resends exactly the stored intent", async () => {
    retMut.mutate.mockImplementation((_a, { onError }) => onError(backendError(409, conflict, "r")));
    open();
    await userEvent.type(qtyFor(TEA), "2");
    await submit();
    expect(await screen.findByText(/request key conflict/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /start a new return/i })).not.toBeInTheDocument();
    expect(qtyFor(TEA)).toHaveValue("2");
    expect(qtyFor(TEA)).toHaveAttribute("readonly");
    const stored = rawRecord();
    for (let i = 1; i <= 3; i++) {
      await submit();
      expect(retMut.mutate.mock.calls[i][0]).toEqual(retMut.mutate.mock.calls[0][0]); // same key, same payload
    }
    expect(rawRecord()).toBe(stored); // the intent is untouched by retries
  });

  it("a non-ApiError failure keeps the sent entries, read-only, with an unknown-outcome status", async () => {
    retMut.mutate.mockImplementationOnce((_a, { onError }) => onError(new TypeError("Failed to fetch")));
    open();
    await userEvent.type(qtyFor(TEA), "2");
    await submit();
    expect(await screen.findByText(/No response was received/i)).toBeInTheDocument();
    expect(screen.getByText(/Outcome unknown/i)).toBeInTheDocument();
    expect(qtyFor(TEA)).toHaveValue("2");
    expect(qtyFor(TEA)).toHaveAttribute("readonly");
    await submit();
    expect(keyOfCall(1)).toBe(keyOfCall(0));
  });

  // P0-A5: "success clears only the returned lines" now means a 2xx must answer
  // EVERY sent line; one that leaves a line out is not a success at all.
  it("a confirmed success clears the returned lines' quantity and reason; a reply missing a sent line clears nothing", async () => {
    retMut.mutate.mockImplementationOnce((_a, { onSuccess }) => onSuccess(reply([[6, "1"]]))); // sugar left out
    open();
    await userEvent.type(qtyFor(TEA), "1");
    await userEvent.type(reasonFor(TEA), "dent");
    await userEvent.type(qtyFor(SUGAR), "1");
    await submit();
    expect(await screen.findByText(/didn't match this return/i)).toBeInTheDocument();
    expect(qtyFor(TEA)).toHaveValue("1");
    expect(reasonFor(TEA)).toHaveValue("dent");
    expect(qtyFor(SUGAR)).toHaveValue("1"); // kept
    expect(toast.success).not.toHaveBeenCalled();

    retMut.mutate.mockImplementationOnce((_a, { onSuccess }) => onSuccess(reply([[3, "1"], [6, "1"]])));
    await submit();
    expect(await screen.findByText(/Recorded by the backend/i)).toBeInTheDocument();
    expect(qtyFor(TEA)).toHaveValue("");
    expect(reasonFor(TEA)).toHaveValue("");
    expect(qtyFor(SUGAR)).toHaveValue("");
    expect(qtyFor(TEA)).not.toHaveAttribute("readonly");
  });

  it("the ceiling uses what the backend reported as already returned", async () => {
    retMut.mutate.mockImplementationOnce((_a, { onSuccess }) =>
      onSuccess({ sales_order_id: 63, so_number: "SO-000063", returned_items: [{ product_id: 6, returned_quantity: "4", previously_returned: "0", total_returned: "4", remaining_returnable: "1" }] }),
    );
    open();
    await userEvent.type(qtyFor(TEA), "4");
    await submit();
    await userEvent.type(qtyFor(TEA), "2");
    await submit();
    expect(await screen.findByText(/can't exceed 1\.000/i)).toBeInTheDocument();
    expect(retMut.mutate).toHaveBeenCalledTimes(1);
  });

  // P0-A5: replaces "only the key survives a drawer reload — entered quantities
  // do not" — an empty form after a reload invited a second, different return.
  it("the whole intent survives a drawer reload: the exact sent payload shows read-only and Retry sends exactly it", async () => {
    retMut.mutate.mockImplementation((_a, { onError }) => onError(new ApiError({ status: 504, message: "Gateway Timeout" })));
    const first = open();
    fireEvent.change(qtyFor(TEA), { target: { value: "1.25" } });
    await userEvent.type(reasonFor(TEA), " torn ");
    await userEvent.type(qtyFor(SUGAR), "2");
    await submit();
    first.unmount();
    open();
    expect(screen.getByText(/hasn't been confirmed/i)).toBeInTheDocument();
    expect(qtyFor(TEA)).toHaveValue("1.25");
    expect(reasonFor(TEA)).toHaveValue("torn");
    expect(qtyFor(SUGAR)).toHaveValue("2");
    for (const input of [qtyFor(TEA), reasonFor(TEA), qtyFor(SUGAR), reasonFor(SUGAR)]) expect(input).toHaveAttribute("readonly");
    expect(screen.queryByRole("button", { name: /^record return$/i })).not.toBeInTheDocument();
    await userEvent.click(retryButton());
    expect(retMut.mutate.mock.calls[1][0]).toEqual(retMut.mutate.mock.calls[0][0]);
    expect(retMut.mutate.mock.calls[1][0].input).toEqual({
      items: [{ product_id: 3, quantity: "2" }, { product_id: 6, quantity: "1.25", reason: "torn" }],
    });
  });
});

/* --------- Sales Return input safety (pre-existing render crash, fixed) --------- */

describe("ReturnDrawer — partial and invalid quantity input never crashes", () => {
  const submit = () => userEvent.click(screen.getByRole("button", { name: /record return/i }));
  const returning = () => screen.getByText(/^Returning/).textContent;

  it("typing a decimal keystroke by keystroke keeps the drawer and the typed text", async () => {
    open();
    await userEvent.type(qtyFor(TEA), "1.5"); // passes through "1."
    expect(qtyFor(TEA)).toHaveValue("1.5");
    expect(returning()).toMatch(/1\.5/);
  });

  it("a partial decimal shows no total and is rejected on submit, never sent", async () => {
    open();
    await userEvent.type(qtyFor(TEA), "1.");
    expect(qtyFor(TEA)).toHaveValue("1.");
    expect(returning()).toBe("Returning —"); // not a number, and not a silent zero
    await submit();
    expect(await screen.findByText(/up to 3 decimals/i)).toBeInTheDocument();
    expect(retMut.mutate).not.toHaveBeenCalled();
  });

  it("invalid text is kept, shows no total, and blocks the whole return (no silent zero line)", async () => {
    open();
    await userEvent.type(qtyFor(TEA), "abc");
    await userEvent.type(qtyFor(SUGAR), "1");
    expect(qtyFor(TEA)).toHaveValue("abc");
    expect(returning()).toBe("Returning —");
    await submit();
    expect(await screen.findByText(/up to 3 decimals/i)).toBeInTheDocument();
    expect(retMut.mutate).not.toHaveBeenCalled(); // the valid sugar line is not sent alone
  });

  it("other non-numeric fragments ('.', '-', '1.2.3') render without crashing", async () => {
    open();
    for (const text of [".", "-", "1.2.3"]) {
      fireEvent.change(qtyFor(TEA), { target: { value: text } });
      expect(qtyFor(TEA)).toHaveValue(text);
      expect(returning()).toBe("Returning —");
    }
  });

  it("an emptied field returns to no active line (Record return disabled)", async () => {
    open();
    await userEvent.type(qtyFor(TEA), "1.");
    await userEvent.clear(qtyFor(TEA));
    expect(screen.getByRole("button", { name: /record return/i })).toBeDisabled();
    expect(returning()).toMatch(/Returning\s*0/);
  });

  it("correcting the input recovers: the corrected value is sent exactly, and a retry reuses the key", async () => {
    retMut.mutate.mockImplementation((_a, { onError }) => onError(new ApiError({ status: 504, message: "Gateway Timeout" })));
    open();
    await userEvent.type(qtyFor(TEA), "1.");
    await submit();
    expect(retMut.mutate).not.toHaveBeenCalled();
    await userEvent.type(qtyFor(TEA), "25"); // "1." -> "1.25"
    expect(returning()).toMatch(/1\.25/);
    await submit();
    await submit(); // retry after the timeout
    expect(retMut.mutate).toHaveBeenCalledTimes(2);
    expect(retMut.mutate.mock.calls[0][0].input).toEqual({ items: [{ product_id: 6, quantity: "1.25" }] });
    expect(retMut.mutate.mock.calls[1][0]).toEqual(retMut.mutate.mock.calls[0][0]);
  });

  it("the ceiling rule still applies to valid decimals", async () => {
    open();
    await userEvent.type(qtyFor(TEA), "5.001");
    await submit();
    expect(await screen.findByText(/can't exceed 5/i)).toBeInTheDocument();
    expect(retMut.mutate).not.toHaveBeenCalled();
  });
});

describe("ReturnDrawer — the running total follows the quantity rule (over-precise input)", () => {
  const submit = () => userEvent.click(screen.getByRole("button", { name: /record return/i }));
  const returning = () => screen.getByText(/^Returning/).textContent;
  // QuantityDisplay shows the approved 2-dp form and keeps the exact value in data-raw
  const rawTotal = () => screen.getByText(/^Returning/).querySelector(".qty")?.getAttribute("data-raw") ?? null;

  it.each(["0.0009", "1.2345"])("'%s' keeps the typed text, shows no total and sends nothing", async (typed) => {
    open();
    await userEvent.type(qtyFor(TEA), typed);
    expect(qtyFor(TEA)).toHaveValue(typed);
    expect(returning()).toBe("Returning —");
    await submit();
    expect(await screen.findByText(/up to 3 decimals/i)).toBeInTheDocument();
    expect(retMut.mutate).not.toHaveBeenCalled();
  });

  it("an over-precise line beside a valid one: no total, the whole return is blocked", async () => {
    open();
    await userEvent.type(qtyFor(SUGAR), "1");
    await userEvent.type(qtyFor(TEA), "0.0009");
    expect(returning()).toBe("Returning —");
    await submit();
    expect(retMut.mutate).not.toHaveBeenCalled();
  });

  it("valid 1.234 and 1.5 still total normally", async () => {
    open();
    await userEvent.type(qtyFor(TEA), "1.234");
    expect(rawTotal()).toBe("1.234");
    expect(returning()).toBe("Returning 1.234"); // D-R4-1: exact 3 dp (was the flagged 1.23)
    await userEvent.clear(qtyFor(TEA));
    await userEvent.type(qtyFor(TEA), "1.5");
    expect(rawTotal()).toBe("1.500");
    expect(returning()).toBe("Returning 1.500");
  });

  it("correcting 0.0009 to 0.009 restores the total and sends the corrected value as typed", async () => {
    open();
    await userEvent.type(qtyFor(TEA), "0.0009");
    await submit();
    expect(retMut.mutate).not.toHaveBeenCalled();
    await userEvent.type(qtyFor(TEA), "{Backspace}{Backspace}9"); // "0.0009" -> "0.009"
    expect(qtyFor(TEA)).toHaveValue("0.009");
    expect(rawTotal()).toBe("0.009");
    await submit();
    expect(retMut.mutate).toHaveBeenCalledTimes(1);
    expect(retMut.mutate.mock.calls[0][0].input).toEqual({ items: [{ product_id: 6, quantity: "0.009" }] });
  });
});

/* ================= P0-A5 — pending-intent recovery (fail closed) ================= */

describe("ReturnDrawer — P0-A5 pending intent", () => {
  /** Enter 2 × Green Tea ("damaged") and press Record return. */
  async function returnTwoTea() {
    await userEvent.type(qtyFor(TEA), "2");
    await userEvent.type(reasonFor(TEA), "damaged");
    await userEvent.click(recordButton());
  }
  const TEA_TWO = [{ product_id: 6, quantity: "2", reason: "damaged" }];

  it("persists the versioned, actor-bound intent with the exact payload BEFORE the request leaves", async () => {
    let storedAtSend: unknown = "not called";
    retMut.mutate.mockImplementation(() => {
      storedAtSend = record();
    });
    open();
    await returnTwoTea();
    const key = keyOfCall(0);
    const expected = {
      version: 1,
      salesOrderId: 63,
      usedKeys: [key],
      pending: { actor: 7, idempotencyKey: key, payload: { items: TEA_TWO }, createdAt: expect.any(String) },
    };
    expect(storedAtSend).toEqual(expected);
    expect(record()).toEqual(expected);
    expect(Number.isNaN(Date.parse(record().pending.createdAt))).toBe(false);
    // what was sent is exactly what is stored
    expect(retMut.mutate.mock.calls[0][0]).toEqual({ id: 63, input: { items: TEA_TWO }, idempotencyKey: key });
    // while it is out: read-only inputs, nothing else to press
    expect(screen.getByText(/Submitting this return/i)).toBeInTheDocument();
    expect(qtyFor(TEA)).toHaveAttribute("readonly");
    expect(screen.getByRole("button", { name: /submitting…/i })).toBeDisabled();
  });

  it("lost response after commit: Retry replays the same key and payload, and only the matching reply releases the intent", async () => {
    const held = holdRequests();
    open();
    await returnTwoTea();
    const key = keyOfCall(0);
    act(() => held[0].onError(ApiError.network(new TypeError("Failed to fetch"))));
    expect(screen.getByText(/Outcome unknown/i)).toBeInTheDocument();
    expectPending(key, TEA_TWO);
    expect(qtyFor(TEA)).toHaveAttribute("readonly");

    await userEvent.click(retryButton());
    expect(retMut.mutate.mock.calls[1][0]).toEqual(retMut.mutate.mock.calls[0][0]);
    // the backend had committed the first send: it replays the stored body
    act(() => held[1].onSuccess(reply([[6, "2"]])));
    expect(screen.getByText(/Recorded by the backend/i)).toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(record()).toEqual({ version: 1, salesOrderId: 63, usedKeys: [key], pending: null });
    expect(qtyFor(TEA)).not.toHaveAttribute("readonly");

    await userEvent.type(qtyFor(TEA), "1");
    await userEvent.click(recordButton());
    expect(keyOfCall(2)).not.toBe(key); // a new intent, never the spent key
    expect(record().usedKeys).toEqual([key, keyOfCall(2)]);
  });

  it.each([
    ["timeout (504 from the proxy)", new ApiError({ status: 504, message: "Gateway Timeout", requestId: "req-504" })],
    ["timeout (aborted fetch)", new DOMException("The operation timed out.", "TimeoutError")],
    ["500", backendError(500, "Internal server error", "req-500")],
    ["502 BFF upstream failure", backendError(502, "Upstream request failed.", "req-502")],
    ["503", backendError(503, "Service unavailable", "req-503")],
    ["401", new ApiError({ kind: "unauthorized", status: 401, requestId: "req-401" })],
    ["403", backendError(403, "Not enough permissions", "req-403")],
    ["422", backendError(422, "Validation error", "req-422")],
    ["404 order", backendError(404, "Sales Order not found", "req-404")],
    ["404 product", backendError(404, "Product not found", "req-404p")],
    ["404 stock balance", backendError(404, "Stock balance not found for product 6", "req-404s")],
    ["409 unknown message", backendError(409, "Missing shipment source evidence", "req-409")],
    ["400 unknown message", backendError(400, "Ambiguous non-batch return source", "req-400")],
    ["429", backendError(429, "Too many requests", "req-429")],
    ["unparseable 2xx (parse error)", ApiError.parse(new Error("bad json"), "req-parse")],
    ["network", ApiError.network(new TypeError("Failed to fetch"))],
  ])("%s keeps the intent pending (fail closed) and Retry resends the same key and payload", async (_label, error) => {
    failWith(error);
    open();
    await returnTwoTea();
    const key = keyOfCall(0);
    expect(await screen.findByText(/Outcome unknown/i)).toBeInTheDocument();
    expectPending(key, TEA_TWO);
    expect(qtyFor(TEA)).toHaveAttribute("readonly");
    expect(screen.queryByRole("button", { name: /^record return$/i })).not.toBeInTheDocument();
    await userEvent.click(retryButton());
    expect(retMut.mutate.mock.calls[1][0]).toEqual(retMut.mutate.mock.calls[0][0]);
    expectPending(key, TEA_TWO);
  });

  it("same-intent retry: any number of failed retries resends the identical key and payload and never releases the intent", async () => {
    failWith(backendError(503, "Service unavailable"));
    open();
    await returnTwoTea();
    const stored = rawRecord();
    for (let i = 0; i < 6; i++) await userEvent.click(retryButton());
    expect(retMut.mutate).toHaveBeenCalledTimes(7);
    for (const [vars] of retMut.mutate.mock.calls) expect(vars).toEqual(retMut.mutate.mock.calls[0][0]);
    expect(rawRecord()).toBe(stored);
    expect(qtyFor(TEA)).toHaveAttribute("readonly");
  });

  it("reload recovery: a remount restores the intent, blocks edits and new returns, and a matching replay resolves it", async () => {
    holdRequests(); // the page reloads before any answer
    const first = open();
    await returnTwoTea();
    const key = keyOfCall(0);
    first.unmount();

    succeedWith(reply([[6, 2]])); // a replay; numbers and 3-dp strings compare equal
    open();
    expect(screen.getByText(/hasn't been confirmed/i)).toBeInTheDocument();
    expect(qtyFor(TEA)).toHaveValue("2");
    expect(reasonFor(TEA)).toHaveValue("damaged");
    await userEvent.type(qtyFor(SUGAR), "1"); // read-only like every input
    expect(qtyFor(SUGAR)).toHaveValue("");
    expect(screen.queryByRole("button", { name: /^record return$/i })).not.toBeInTheDocument();

    await userEvent.click(retryButton());
    expect(retMut.mutate.mock.calls[1][0]).toEqual({ id: 63, input: { items: TEA_TWO }, idempotencyKey: key });
    expect(screen.getByText(/Recorded by the backend/i)).toBeInTheDocument();
    expect(record().pending).toBeNull();
    expect(qtyFor(TEA)).toHaveValue("");
    expect(qtyFor(TEA)).not.toHaveAttribute("readonly");
  });

  it("a refreshed order never releases the intent", async () => {
    failWith(backendError(503, "Service unavailable"));
    const view = open();
    await returnTwoTea();
    const stored = rawRecord();
    orderQ.data = { ...shippedDetail, status: "COMPLETED", items: shippedDetail.items.map((i) => ({ ...i })) };
    view.rerender(drawer());
    expect(screen.getByText(/Outcome unknown/i)).toBeInTheDocument();
    expect(qtyFor(TEA)).toHaveAttribute("readonly");
    expect(rawRecord()).toBe(stored);
  });

  it("double click sends once (synchronous guard), and so does a double click on Retry", async () => {
    const held = holdRequests();
    open();
    await userEvent.type(qtyFor(TEA), "2");
    const button = recordButton();
    // both clicks land before React re-renders, as a fast double click can
    act(() => {
      button.click();
      button.click();
    });
    expect(retMut.mutate).toHaveBeenCalledTimes(1);

    act(() => held[0].onError(backendError(503, "Service unavailable")));
    const retry = retryButton();
    act(() => {
      retry.click();
      retry.click();
    });
    expect(retMut.mutate).toHaveBeenCalledTimes(2);
    expect(retMut.mutate.mock.calls[1][0]).toEqual(retMut.mutate.mock.calls[0][0]);
  });

  it("remount while in flight (drawer closed and reopened) neither re-sends nor unlocks until the request settles", async () => {
    const held = holdRequests();
    const view = open();
    await returnTwoTea();
    view.rerender(drawer(false));
    view.rerender(drawer(true));
    expect(screen.getByText(/still in progress/i)).toBeInTheDocument();
    const retry = screen.getByRole("button", { name: /submitting…/i });
    expect(retry).toBeDisabled();
    act(() => {
      retry.click();
    });
    expect(retMut.mutate).toHaveBeenCalledTimes(1);

    // the first request settles while the original body is gone: its outcome is
    // dropped, the guard is released and the stored intent stays pending
    act(() => held[0].onError(backendError(503, "Service unavailable")));
    await userEvent.click(retryButton());
    expect(retMut.mutate).toHaveBeenCalledTimes(2);
    expect(retMut.mutate.mock.calls[1][0]).toEqual(retMut.mutate.mock.calls[0][0]);
    act(() => held[1].onSuccess(reply([[6, "2.000"]])));
    expect(record().pending).toBeNull();
  });

  describe("storage unavailable (fail closed)", () => {
    it("sessionStorage that throws on access blocks the drawer with a clear error and sends nothing", async () => {
      const restore = blockSessionStorage();
      try {
        open();
        expect(screen.getByText(/Returns blocked/i)).toBeInTheDocument();
        expect(screen.getByText(/can't be read/i)).toBeInTheDocument();
        await userEvent.type(qtyFor(TEA), "2");
        expect(recordButton()).toBeDisabled();
        await userEvent.click(recordButton());
      } finally {
        restore();
      }
      expect(retMut.mutate).not.toHaveBeenCalled();
    });

    it("storage that can't be written (quota/private mode) blocks at mount", async () => {
      const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      });
      try {
        open();
        expect(screen.getByText(/Returns blocked/i)).toBeInTheDocument();
        await userEvent.type(qtyFor(TEA), "2");
        expect(recordButton()).toBeDisabled();
      } finally {
        spy.mockRestore();
      }
      expect(retMut.mutate).not.toHaveBeenCalled();
    });

    it("a failed intent write at submit sends nothing and blocks", async () => {
      open();
      await userEvent.type(qtyFor(TEA), "2");
      const original = Storage.prototype.setItem;
      const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key: string, value: string) {
        if (key === RECORD_KEY) throw new DOMException("Quota exceeded", "QuotaExceededError");
        return original.call(this, key, value);
      });
      try {
        await userEvent.click(recordButton());
      } finally {
        spy.mockRestore();
      }
      expect(retMut.mutate).not.toHaveBeenCalled();
      expect(screen.getByText(/Nothing was sent/i)).toBeInTheDocument();
      expect(rawRecord()).toBeNull();
      expect(recordButton()).toBeDisabled();
    });
  });

  describe("recovery-copy write failures (fail closed)", () => {
    const realSetItem = Storage.prototype.setItem;
    const realRemoveItem = Storage.prototype.removeItem;

    /** Break writes of the intent record only; every other key (the draft hook's, the probe) still works. */
    function breakIntentWrites(mode: string) {
      if (mode === "storage access throws") return blockSessionStorage();
      const setSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key: string, value: string) {
        if (key !== RECORD_KEY) return realSetItem.call(this, key, value);
        if (mode === "the write is silently dropped") return; // the read-back then differs
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      });
      const removeSpy = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(function (this: Storage, key: string) {
        if (key === RECORD_KEY) throw new DOMException("Quota exceeded", "QuotaExceededError");
        return realRemoveItem.call(this, key);
      });
      return () => {
        setSpy.mockRestore();
        removeSpy.mockRestore();
      };
    }

    const MODES = ["setItem/removeItem throw", "the write is silently dropped", "storage access throws"];
    const OUTCOMES: Array<[string, (h: Handlers) => void, RegExp]> = [
      ["a confirmed 2xx", (h) => h.onSuccess(reply([[6, "2"]])), /The return was recorded\. Reload/],
      ["a proven terminal refusal", (h) => h.onError(backendError(409, RETURN_REFUSED_NOT_RETURNABLE)), /The backend refused this return/],
    ];

    it.each(OUTCOMES.flatMap(([label, settle, copy]) => MODES.map((mode) => [label, mode, settle, copy] as const)))(
      "after %s, a release that fails (%s) keeps the stored intent, shows the blocked copy and sends nothing more",
      async (_label, mode, settle, copy) => {
        const held = holdRequests();
        const first = open();
        await returnTwoTea();
        const stored = rawRecord();
        expect(record().pending.idempotencyKey).toBe(keyOfCall(0));

        const restore = breakIntentWrites(mode);
        try {
          act(() => settle(held[0]));
        } finally {
          restore();
        }
        expect(rawRecord()).toBe(stored); // the intent was NOT released
        expect(screen.getByText(/New returns paused/i)).toBeInTheDocument();
        expect(screen.getByText(copy)).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
        expect(recordButton()).toBeDisabled();
        expect(qtyFor(TEA)).toHaveAttribute("readonly");
        await userEvent.click(recordButton());
        expect(retMut.mutate).toHaveBeenCalledTimes(1); // nothing further was sent

        // the promised way out: a reload re-checks the SAME intent instead of allowing another
        first.unmount();
        open();
        expect(screen.getByText(/hasn't been confirmed/i)).toBeInTheDocument();
        await userEvent.click(retryButton());
        expect(retMut.mutate).toHaveBeenCalledTimes(2);
        expect(retMut.mutate.mock.calls[1][0]).toEqual(retMut.mutate.mock.calls[0][0]);
      },
    );

    it.each([
      ["nothing stored before", null],
      ["an earlier resolved record", JSON.stringify({ version: 1, salesOrderId: 63, usedKeys: ["so-ret-earlier"], pending: null })],
    ])("a failed read-back when admitting a return (%s) puts back what was stored, shows the blocked copy and sends nothing", async (_label, before) => {
      if (before !== null) window.sessionStorage.setItem(RECORD_KEY, before);
      holdRequests();
      open();
      await userEvent.type(qtyFor(TEA), "2");
      let intentWrites = 0;
      const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key: string, value: string) {
        // the first write of the intent lands, but not as written: its read-back differs
        if (key === RECORD_KEY && intentWrites++ === 0) return realSetItem.call(this, key, `${value} `);
        return realSetItem.call(this, key, value);
      });
      try {
        await userEvent.click(recordButton());
      } finally {
        spy.mockRestore();
      }
      expect(intentWrites).toBeGreaterThan(0);
      expect(rawRecord()).toBe(before); // put back exactly
      expect(screen.getByText(/Returns blocked/i)).toBeInTheDocument();
      expect(screen.getByText(/Nothing was sent/i)).toBeInTheDocument();
      expect(recordButton()).toBeDisabled();
      await userEvent.click(recordButton());
      expect(retMut.mutate).not.toHaveBeenCalled();
    });

    it("if putting back fails too, the unverified record is never trusted: blocked now, not restorable later, nothing sent", async () => {
      holdRequests();
      const first = open();
      await userEvent.type(qtyFor(TEA), "2");
      const setSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key: string, value: string) {
        return realSetItem.call(this, key, key === RECORD_KEY ? "tampered" : value);
      });
      const removeSpy = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(function (this: Storage, key: string) {
        if (key === RECORD_KEY) throw new DOMException("denied", "SecurityError");
        return realRemoveItem.call(this, key);
      });
      try {
        await userEvent.click(recordButton());
      } finally {
        setSpy.mockRestore();
        removeSpy.mockRestore();
      }
      expect(screen.getByText(/Nothing was sent/i)).toBeInTheDocument();
      expect(retMut.mutate).not.toHaveBeenCalled();
      expect(rawRecord()).toBe("tampered");
      first.unmount();
      open();
      expect(screen.getByText(/an earlier return couldn't be restored/i)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
      expect(retMut.mutate).not.toHaveBeenCalled();
    });
  });

  describe("actor binding", () => {
    const foreignRecord = (actor: number | null) => ({
      version: 1,
      salesOrderId: 63,
      usedKeys: ["so-ret-other-user-key"],
      pending: {
        actor,
        idempotencyKey: "so-ret-other-user-key",
        payload: { items: [{ product_id: 6, quantity: "4" }] },
        createdAt: "2026-11-09T01:02:03.000Z",
      },
    });

    it("another user's pending intent is shown as unknown, can't be replayed or resolved, and is not deleted", async () => {
      window.sessionStorage.setItem(RECORD_KEY, JSON.stringify(foreignRecord(99)));
      const stored = rawRecord();
      const first = open();
      expect(screen.getByText(/submitted by another user/i)).toBeInTheDocument();
      expect(screen.getByText(/Outcome unknown/i)).toBeInTheDocument();
      expect(qtyFor(TEA)).toHaveValue("4");
      expect(qtyFor(TEA)).toHaveAttribute("readonly");
      expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
      expect(recordButton()).toBeDisabled();
      await userEvent.type(qtyFor(SUGAR), "1");
      await userEvent.click(recordButton());
      first.unmount();
      open();
      expect(screen.getByText(/submitted by another user/i)).toBeInTheDocument();
      expect(retMut.mutate).not.toHaveBeenCalled();
      expect(rawRecord()).toBe(stored);
    });

    it("an intent left by user 7 is blocked for user 8 and recoverable again by user 7", async () => {
      failWith(backendError(503, "Service unavailable"));
      const first = open();
      await returnTwoTea();
      const key = keyOfCall(0);
      const stored = rawRecord();
      first.unmount();

      session.userId = 8;
      const second = open();
      expect(screen.getByText(/submitted by another user/i)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
      expect(rawRecord()).toBe(stored);
      second.unmount();

      session.userId = 7;
      open();
      await userEvent.click(retryButton());
      expect(keyOfCall(1)).toBe(key);
      expect(retMut.mutate).toHaveBeenCalledTimes(2);
    });

    it("without a SessionProvider the actor is null: its own identity, never a signed-in user's", async () => {
      session.userId = null;
      holdRequests();
      const first = open();
      await returnTwoTea();
      expect(record().pending.actor).toBeNull();
      first.unmount();
      window.sessionStorage.setItem(RECORD_KEY, JSON.stringify(foreignRecord(7)));
      open();
      expect(screen.getByText(/submitted by another user/i)).toBeInTheDocument();
    });
  });

  it("unsafe discard is blocked: no discard or new-return control, and closing, reopening or retrying never clears the intent", async () => {
    failWith(backendError(500, "Internal server error"));
    const view = open();
    await returnTwoTea();
    const stored = rawRecord();
    expect(screen.queryByRole("button", { name: /discard|start a new return|new return|cancel|clear/i })).not.toBeInTheDocument();
    view.rerender(drawer(false));
    view.rerender(drawer(true));
    expect(screen.getByText(/hasn't been confirmed/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /discard|start a new return|new return|cancel|clear/i })).not.toBeInTheDocument();
    await userEvent.click(retryButton());
    for (const close of screen.getAllByRole("button", { name: /^close$/i })) await userEvent.click(close);
    expect(rawRecord()).toBe(stored);
    expect(qtyFor(TEA)).toHaveAttribute("readonly");
  });

  it("RETURN_KEY_CONFLICT keeps the intent; a business 409 with its full backend message releases it", async () => {
    failWith(backendError(409, RETURN_KEY_CONFLICT));
    const first = open();
    await returnTwoTea();
    expect(await screen.findByText(/request key conflict/i)).toBeInTheDocument();
    const key = keyOfCall(0);
    expectPending(key, TEA_TWO);
    first.unmount();

    window.sessionStorage.clear();
    retMut.mutate.mockReset();
    failWith(backendError(409, "Return quantity exceeds remaining returnable quantity for product 6. Remaining: 1.000"));
    open();
    await returnTwoTea();
    expect(await screen.findByText(/Remaining: 1\.000/)).toBeInTheDocument();
    expect(screen.queryByText(/Outcome unknown/i)).not.toBeInTheDocument();
    expect(record().pending).toBeNull();
    expect(qtyFor(TEA)).not.toHaveAttribute("readonly");
  });

  it.each([
    [409, RETURN_REFUSED_NOT_RETURNABLE, /Only a shipped or completed order can be returned/],
    [400, "Product 6 not found in this sales order", /Product 6 not found in this sales order/],
    [409, "Return quantity exceeds remaining returnable quantity for product 6. Remaining: 1.000", /Remaining: 1\.000/],
    [409, "Return quantity exceeds remaining returnable quantity for product 6. Remaining: 0", /Remaining: 0/],
    [409, RETURN_REFUSED_OVER_BATCH_ALLOCATION, /exceeds available batch allocation/],
  ])("terminal refusal %i %s releases the intent and re-opens editing with the sent values", async (status, message, copy) => {
    failWith(backendError(status, message, "req-terminal"));
    open();
    await returnTwoTea();
    const refused = keyOfCall(0);
    expect(await screen.findByText(copy)).toBeInTheDocument();
    expect(screen.getByText("req-terminal")).toBeInTheDocument();
    expect(screen.queryByText(/Outcome unknown/i)).not.toBeInTheDocument();
    expect(record()).toEqual({ version: 1, salesOrderId: 63, usedKeys: [refused], pending: null });
    expect(qtyFor(TEA)).toHaveValue("2");
    expect(reasonFor(TEA)).toHaveValue("damaged");
    expect(qtyFor(TEA)).not.toHaveAttribute("readonly");
    await userEvent.click(recordButton());
    expect(keyOfCall(1)).not.toBe(refused);
  });

  it.each([
    // 409 "Only completed Sales Order can be returned"
    [400, "Only completed Sales Order can be returned"],
    [409, "Only completed Sales Order can be returned."],
    [409, "only completed Sales Order can be returned"],
    [409, " Only completed Sales Order can be returned"],
    [409, "Only completed Sales Order can be returned: SHIPPED"],
    [409, "Only completed Sales Order"],
    // 400 "Product {id} not found in this sales order"
    [409, "Product 6 not found in this sales order"],
    [400, "Product 06 not found in this sales order"],
    [400, "Product abc not found in this sales order"],
    [400, "Product  not found in this sales order"],
    [400, "Product -6 not found in this sales order"],
    [400, "Product 6 not found in this sales order."],
    [400, "Error: Product 6 not found in this sales order"],
    [400, "Product 9 not found in this sales order"], // not a product of this intent
    // 409 "Return quantity exceeds remaining returnable quantity for product {id}. Remaining: {n}"
    [400, "Return quantity exceeds remaining returnable quantity for product 6. Remaining: 1.000"],
    [409, "Return quantity exceeds remaining returnable quantity for product 6"],
    [409, "Return quantity exceeds remaining returnable"],
    [409, "Return quantity exceeds remaining returnable quantity for product 6. Remaining: 1.000 (batch)"],
    [409, "Return quantity exceeds remaining returnable quantity for product 6. Remaining: -1.000"],
    [409, "Return quantity exceeds remaining returnable quantity for product 6. Remaining: 1E+3"],
    [409, "Return quantity exceeds remaining returnable quantity for product 6. Remaining: 1.0000"],
    [409, "Return quantity exceeds remaining returnable quantity for product 6. Remaining: "],
    [409, "Return quantity exceeds remaining returnable quantity for product 6.  Remaining: 1"],
    [409, "Return quantity exceeds remaining returnable quantity for product x. Remaining: 1"],
    [409, "Return quantity exceeds remaining returnable quantity for product 6. Remaining: 2.000"], // not below what was sent
    [409, "Return quantity exceeds remaining returnable quantity for product 3. Remaining: 0.000"], // not a product of this intent
    // 409 "Return quantity exceeds available batch allocation"
    [422, "Return quantity exceeds available batch allocation"],
    [409, "Return quantity exceeds available batch allocation."],
    [409, "Return quantity exceeds available batch allocation for product 6"],
    [409, "Return quantity exceeds available batch"],
    // the key conflict and other 409s
    [409, RETURN_KEY_CONFLICT],
    [409, "Sales Order state conflict: CONFIRMED; requires SHIPPED"],
  ])("near miss %i %j is NOT terminal: the intent stays pending", async (status, message) => {
    failWith(backendError(status, message));
    open();
    await returnTwoTea();
    const key = keyOfCall(0);
    expect(await screen.findByText(/Outcome unknown|request key conflict/i)).toBeInTheDocument();
    expectPending(key, TEA_TWO);
    expect(qtyFor(TEA)).toHaveAttribute("readonly");
    await userEvent.click(retryButton());
    expect(keyOfCall(1)).toBe(key);
  });

  it("a terminal message that did not arrive in the backend's error envelope is not trusted", async () => {
    failWith(new ApiError({ status: 409, message: RETURN_REFUSED_NOT_RETURNABLE })); // no body
    open();
    await returnTwoTea();
    expect(await screen.findByText(/Outcome unknown/i)).toBeInTheDocument();
    expectPending(keyOfCall(0), TEA_TWO);
  });

  it.each([
    ["another order", reply([[6, "2"]], 64)],
    ["a missing line", { ...reply([[6, "2"]]), returned_items: [] }],
    ["no returned_items", { sales_order_id: 63, so_number: "SO-000063" }],
    ["an extra line", reply([[6, "2"], [3, "1"]])],
    ["a duplicate line", reply([[6, "2"], [6, "2"]])],
    ["another product", reply([[3, "2"]])],
    ["another quantity", reply([[6, "1.999"]])],
    ["an over-precise quantity", reply([[6, "2.0001"]])],
    ["a non-numeric quantity", reply([[6, "two"]])],
    ["a negative quantity", reply([[6, "-2"]])],
    ["null", null],
    ["a string", "ok"],
  ])("a 2xx answering %s is not a confirmation: the intent stays pending", async (_label, body) => {
    succeedWith(body);
    open();
    await returnTwoTea();
    const key = keyOfCall(0);
    expect(await screen.findByText(/didn't match this return/i)).toBeInTheDocument();
    expect(screen.queryByText(/Recorded by the backend/i)).not.toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
    expectPending(key, TEA_TWO);
    await userEvent.click(retryButton());
    expect(keyOfCall(1)).toBe(key);
  });

  it("a 2xx matches by product and 3-decimal quantity, in any line order", async () => {
    succeedWith(reply([[6, "1.250"], [3, 2]]));
    open();
    fireEvent.change(qtyFor(TEA), { target: { value: "1.25" } });
    await userEvent.type(qtyFor(SUGAR), "2.000");
    await userEvent.click(recordButton());
    expect(await screen.findByText(/Recorded by the backend/i)).toBeInTheDocument();
    expect(record().pending).toBeNull();
  });

  it("a key this tab already sent is never reused, even if the draft restores it", async () => {
    // the draft hook's stored next key equals a key already recorded as sent
    window.sessionStorage.setItem("sales-return:63:active", "d1");
    window.sessionStorage.setItem("sales-return:63:d1", JSON.stringify({ idempotencyKey: "so-ret-spent", lines: {} }));
    window.sessionStorage.setItem(RECORD_KEY, JSON.stringify({ version: 1, salesOrderId: 63, usedKeys: ["so-ret-spent"], pending: null }));
    holdRequests();
    open();
    await userEvent.type(qtyFor(TEA), "2");
    await userEvent.click(recordButton());
    expect(retMut.mutate).not.toHaveBeenCalled();
    expect(screen.getByText(/needed a fresh request key/i)).toBeInTheDocument();
    await userEvent.click(recordButton());
    expect(retMut.mutate).toHaveBeenCalledTimes(1);
    expect(keyOfCall(0)).not.toBe("so-ret-spent");
    expect(record().usedKeys).toEqual(["so-ret-spent", keyOfCall(0)]);
  });

  it.each([
    ["not JSON", "{oops"],
    ["another version", JSON.stringify({ version: 2, salesOrderId: 63, usedKeys: [], pending: null })],
    ["another order", JSON.stringify({ version: 1, salesOrderId: 64, usedKeys: [], pending: null })],
    [
      "a pending key that was never recorded as used",
      JSON.stringify({ version: 1, salesOrderId: 63, usedKeys: [], pending: { actor: 7, idempotencyKey: "so-ret-x", payload: { items: [{ product_id: 6, quantity: "1" }] }, createdAt: "2026-11-09T00:00:00.000Z" } }),
    ],
    [
      "a payload this drawer could not have sent",
      JSON.stringify({ version: 1, salesOrderId: 63, usedKeys: ["so-ret-x"], pending: { actor: 7, idempotencyKey: "so-ret-x", payload: { items: [{ product_id: 6, quantity: "1.0001" }] }, createdAt: "2026-11-09T00:00:00.000Z" } }),
    ],
    [
      "a product that isn't on this order",
      JSON.stringify({ version: 1, salesOrderId: 63, usedKeys: ["so-ret-x"], pending: { actor: 7, idempotencyKey: "so-ret-x", payload: { items: [{ product_id: 99, quantity: "1" }] }, createdAt: "2026-11-09T00:00:00.000Z" } }),
    ],
  ])("a stored record with %s is not trusted: new returns are blocked and nothing is sent or deleted", async (_label, raw) => {
    window.sessionStorage.setItem(RECORD_KEY, raw);
    open();
    expect(screen.getByText(/an earlier return couldn't be restored/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
    expect(recordButton()).toBeDisabled();
    expect(retMut.mutate).not.toHaveBeenCalled();
    expect(rawRecord()).toBe(raw);
  });
});

/* ------------- P0-A5 — the response contract (sales.ts), directly ------------- */

describe("classifyReturnRefusal / confirmsReturnIntent", () => {
  it("recognises exactly the four backend refusals by status and complete message", () => {
    expect(classifyReturnRefusal(409, "Only completed Sales Order can be returned")).toEqual({ kind: "not_returnable" });
    expect(classifyReturnRefusal(400, "Product 12 not found in this sales order")).toEqual({ kind: "product_not_in_order", productId: 12 });
    expect(classifyReturnRefusal(409, "Return quantity exceeds remaining returnable quantity for product 12. Remaining: 3.500")).toEqual({
      kind: "over_remaining",
      productId: 12,
      remaining: "3.500",
    });
    expect(classifyReturnRefusal(409, "Return quantity exceeds available batch allocation")).toEqual({ kind: "over_batch_allocation" });
    expect(classifyReturnRefusal(409, "Product 12 not found in this sales order")).toBeNull();
    // the backend's own status (400), so only the 1–10 digit id bound can reject these
    expect(classifyReturnRefusal(400, "Product 2147483647 not found in this sales order")).toEqual({ kind: "product_not_in_order", productId: 2147483647 });
    expect(classifyReturnRefusal(400, "Product 12345678901 not found in this sales order")).toBeNull(); // 11 digits
    expect(classifyReturnRefusal(409, "Return quantity exceeds remaining returnable quantity for product 12345678901. Remaining: 1")).toBeNull();
    expect(classifyReturnRefusal(409, RETURN_KEY_CONFLICT)).toBeNull();
    expect(classifyReturnRefusal(409, "Only completed Sales Order can be returned\n")).toBeNull();
  });

  it("confirms only an exact answer to the sent lines", () => {
    const sent = [{ product_id: 3, quantity: "2" }, { product_id: 6, quantity: "1.25", reason: "torn" }];
    expect(confirmsReturnIntent(reply([[6, 1.25], [3, "2.000"]]), 63, sent)).toBe(true);
    expect(confirmsReturnIntent(reply([[6, 1.25]]), 63, sent)).toBe(false);
    expect(confirmsReturnIntent(reply([[6, 1.25], [3, "2.000"]]), 64, sent)).toBe(false);
    expect(confirmsReturnIntent(reply([[6, "1.251"], [3, "2"]]), 63, sent)).toBe(false);
    expect(confirmsReturnIntent(undefined, 63, sent)).toBe(false);
  });
});
