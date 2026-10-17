import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { toast } from "sonner";

import { ApiError } from "@/lib/api/errors";
import { purchaseOrderDetailResponse, purchaseOrderReceiveResponse } from "@/test/fixtures";

const receiveMutate = vi.fn();
let detail: unknown = purchaseOrderDetailResponse.data;
let receiveState: { isPending: boolean; isError: boolean; error: unknown } = { isPending: false, isError: false, error: undefined };

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/query/purchase-orders", () => ({
  usePurchaseOrder: () => ({ data: detail, isLoading: false, isError: false, refetch: vi.fn() }),
  useReceivePurchaseOrder: () => ({ mutate: receiveMutate, ...receiveState }),
}));
vi.mock("@/lib/query/sales", () => ({
  useProductLookup: () => ({
    data: {
      1: { id: 1, sku: "WH-COFFEE-1KG", product_name: "Arabica Whole Bean 1kg", barcode: "b1", track_batch: true, track_expiry: true },
      3: { id: 3, sku: "WH-SUGAR-25KG", product_name: "Refined Sugar Sack 25kg", barcode: "b3", track_batch: false, track_expiry: false },
      6: { id: 6, sku: "WH-TEA-200G", product_name: "Green Tea 200g", barcode: "b6", track_batch: true, track_expiry: true },
    },
  }),
  resolveBarcode: vi.fn(),
}));

import { ReceivingConsole } from "./receiving-console";
import { resolveBarcode } from "@/lib/query/sales";
import { LanguageProvider } from "@/lib/i18n/client";
import { LanguageSwitch } from "@/components/shell/language-switch";

beforeEach(() => {
  receiveMutate.mockReset();
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.info).mockClear();
  vi.mocked(resolveBarcode).mockReset();
  receiveState = { isPending: false, isError: false, error: undefined };
  detail = purchaseOrderDetailResponse.data;
  window.sessionStorage.clear();
});

const sugarQty = () => screen.getAllByLabelText("Receive now")[1]; // coffee, sugar, tea order
const coffeeQty = () => screen.getAllByLabelText("Receive now")[0];

describe("ReceivingConsole — line rendering + guards", () => {
  it("renders a receive line per PO item with ordered / received / remaining", () => {
    render(<ReceivingConsole poId={1} />);
    expect(screen.getByText("Arabica Whole Bean 1kg")).toBeInTheDocument();
    expect(screen.getByText("Refined Sugar Sack 25kg")).toBeInTheDocument();
    expect(screen.getAllByLabelText("Receive now")).toHaveLength(3);
    expect(screen.getAllByRole("button", { name: /^Receive$/i })[0]).toBeDisabled();
  });

  it("blocks a quantity above the line's remaining (client guard, backend still authoritative)", async () => {
    const user = userEvent.setup();
    render(<ReceivingConsole poId={1} />);
    await user.type(sugarQty(), "99");
    expect(screen.getByText(/Only 15.000 remaining/i)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Receive$/i })[0]).toBeDisabled();
  });
});

describe("ReceivingConsole — partial receive with a persisted Idempotency-Key", () => {
  it("submits { id, idempotencyKey, payload } and lists the receipt on success", async () => {
    const user = userEvent.setup();
    receiveMutate.mockImplementation((_args, opts) => opts.onSuccess(purchaseOrderReceiveResponse.data));
    render(<ReceivingConsole poId={1} />);

    await user.type(sugarQty(), "5");
    const receiveBtn = screen.getAllByRole("button", { name: /^Receive$/i })[0];
    expect(receiveBtn).toBeEnabled();
    await user.click(receiveBtn);

    expect(receiveMutate).toHaveBeenCalledTimes(1);
    const [args] = receiveMutate.mock.calls[0];
    expect(args.id).toBe(1);
    expect(args.idempotencyKey).toMatch(/^po-rcpt-/);
    expect(args.payload).toEqual({ items: [{ product_id: 3, quantity: "5.000" }] });

    expect(await screen.findByText(purchaseOrderReceiveResponse.data.receipt_number)).toBeInTheDocument();
    // draft cleared → Receive disabled again
    expect(screen.getAllByRole("button", { name: /^Receive$/i })[0]).toBeDisabled();
  });

  it("a multi-line receipt sends one atomic payload sorted by product_id", async () => {
    const user = userEvent.setup();
    receiveMutate.mockImplementation((_a, opts) => opts.onSuccess(purchaseOrderReceiveResponse.data));
    render(<ReceivingConsole poId={1} />);

    await user.type(coffeeQty(), "2");
    await user.type(screen.getAllByLabelText("Lot number")[0], "LOT-CF");
    await user.type(screen.getAllByLabelText("Manufacturing date")[0], "2026-06-01");
    await user.type(screen.getAllByLabelText("Expiry date")[0], "2027-06-01");
    await user.type(sugarQty(), "5");

    await user.click(screen.getAllByRole("button", { name: /^Receive$/i })[0]);
    const [args] = receiveMutate.mock.calls[0];
    expect(args.payload.items).toEqual([
      { product_id: 1, quantity: "2.000", lot_no: "LOT-CF", mfg_date: "2026-06-01", expiry_date: "2027-06-01" },
      { product_id: 3, quantity: "5.000" },
    ]);
  });
});

describe("ReceivingConsole — backend rejections", () => {
  it("over-receive 409 → error + request id, no receipt listed, no fake progress", async () => {
    const user = userEvent.setup();
    receiveMutate.mockImplementation((_a, opts) =>
      opts.onError(
        new ApiError({
          status: 409,
          message: "Received quantity exceeds remaining purchase order quantity for product_id 1",
          requestId: "req-over",
        }),
      ),
    );
    render(<ReceivingConsole poId={1} />);
    await user.type(sugarQty(), "5");
    await user.click(screen.getAllByRole("button", { name: /^Receive$/i })[0]);

    // surfaced (message + request id), nothing recorded, no fake progress
    expect(toast.error).toHaveBeenCalledWith(
      "Receipt rejected",
      expect.objectContaining({ description: expect.stringMatching(/exceeds remaining.*req-over/i) }),
    );
    expect(screen.queryByText(/^POR-/)).toBeNull();
    expect(screen.getByText(/No receipts recorded in this session/i)).toBeInTheDocument();
  });

  it("idempotency mismatch 409 → banner + 'Start a new receipt', never auto-regenerates the key", async () => {
    const user = userEvent.setup();
    receiveMutate.mockImplementation((_a, opts) =>
      opts.onError(
        new ApiError({ status: 409, message: "Idempotency-Key already used with a different payload", requestId: "req-mm" }),
      ),
    );
    render(<ReceivingConsole poId={1} />);
    await user.type(sugarQty(), "5");
    await user.click(screen.getAllByRole("button", { name: /^Receive$/i })[0]);

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText(/already submitted with different quantities/i)).toBeInTheDocument();
    const startNew = within(alert).getByRole("button", { name: /start a new receipt/i });
    await user.click(startNew);
    expect(screen.queryByText(/already submitted with different quantities/i)).toBeNull();
    // the entered quantity is kept so the operator can resubmit as a new operation
    expect(sugarQty()).toHaveValue("5");
  });
});

describe("ReceivingConsole — non-receivable PO", () => {
  it("shows an info screen for a DRAFT purchase order", () => {
    detail = { ...purchaseOrderDetailResponse.data, status: "DRAFT" };
    render(<ReceivingConsole poId={1} />);
    expect(screen.getByText(/not in a receivable state/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("Receive now")).toBeNull();
  });
});

/* ------------------- R3.0 characterization (pre-refactor) ------------------- */

describe("ReceivingConsole — characterization (R3.0)", () => {
  const receiveButton = () => screen.getAllByRole("button", { name: /^Receive$/i })[0];
  const field = (id: string) => document.getElementById(id) as HTMLInputElement;
  const MISMATCH = "Idempotency-Key already used with a different payload";

  it("exact mutate arguments: quantity padded to 3dp, only entered lines, sorted, key prefix po-rcpt-", async () => {
    const user = userEvent.setup();
    render(<ReceivingConsole poId={1} />);
    await user.type(sugarQty(), "5.5");
    await user.click(receiveButton());
    expect(receiveMutate.mock.calls[0][0]).toEqual({
      id: 1,
      idempotencyKey: expect.stringMatching(/^po-rcpt-/),
      payload: { items: [{ product_id: 3, quantity: "5.500" }] },
    });
  });

  it("a batch + expiry line sends its trimmed lot and both dates; incomplete batch data keeps Receive disabled", async () => {
    const user = userEvent.setup();
    render(<ReceivingConsole poId={1} />);
    await user.type(coffeeQty(), "2");
    expect(receiveButton()).toBeDisabled(); // lot + dates required
    await user.type(field("rl-1-lot"), "  LOT-9  ");
    fireEvent.change(field("rl-1-mfg"), { target: { value: "2026-01-01" } });
    expect(receiveButton()).toBeDisabled();
    fireEvent.change(field("rl-1-exp"), { target: { value: "2027-01-01" } });
    expect(receiveButton()).toBeEnabled();
    await user.click(receiveButton());
    expect(receiveMutate.mock.calls[0][0].payload).toEqual({
      items: [{ product_id: 1, quantity: "2.000", lot_no: "LOT-9", mfg_date: "2026-01-01", expiry_date: "2027-01-01" }],
    });
  });

  it("more than 3 decimals is rejected client-side", async () => {
    const user = userEvent.setup();
    render(<ReceivingConsole poId={1} />);
    await user.type(sugarQty(), "1.2345");
    expect(screen.getByText(/At most 3 decimal places/i)).toBeInTheDocument();
    expect(receiveButton()).toBeDisabled();
  });

  it("a failed receive keeps entries and the key; the retry sends identical arguments", async () => {
    const user = userEvent.setup();
    receiveMutate.mockImplementation((_a, opts) => opts.onError(new ApiError({ status: 503, message: "down", requestId: "r1" })));
    render(<ReceivingConsole poId={1} />);
    await user.type(sugarQty(), "5");
    await user.click(receiveButton());
    await user.click(receiveButton());
    expect(receiveMutate).toHaveBeenCalledTimes(2);
    expect(receiveMutate.mock.calls[1][0]).toEqual(receiveMutate.mock.calls[0][0]);
    expect(sugarQty()).toHaveValue("5");
  });

  it("reload (unmount + remount) restores the entered quantities and the SAME key", async () => {
    const user = userEvent.setup();
    const first = render(<ReceivingConsole poId={1} />);
    await user.type(sugarQty(), "4");
    await user.click(receiveButton());
    const k1 = receiveMutate.mock.calls[0][0].idempotencyKey;
    first.unmount();
    render(<ReceivingConsole poId={1} />);
    expect(sugarQty()).toHaveValue("4");
    await user.click(receiveButton());
    expect(receiveMutate.mock.calls[1][0].idempotencyKey).toBe(k1);
  });

  it("success rotates the key and clears entries; a replayed receipt is listed once", async () => {
    const user = userEvent.setup();
    receiveMutate.mockImplementation((_a, opts) => opts.onSuccess(purchaseOrderReceiveResponse.data));
    render(<ReceivingConsole poId={1} />);
    await user.type(sugarQty(), "5");
    await user.click(receiveButton());
    const k1 = receiveMutate.mock.calls[0][0].idempotencyKey;
    expect(sugarQty()).toHaveValue("");
    await user.type(sugarQty(), "5");
    await user.click(receiveButton()); // the backend replays the same receipt
    expect(receiveMutate.mock.calls[1][0].idempotencyKey).not.toBe(k1);
    const receipt = purchaseOrderReceiveResponse.data.receipt_number;
    expect(screen.getAllByText((_, el) => el?.textContent === receipt && el.children.length === 0)).toHaveLength(1);
  });

  it("the mismatch predicate is the exact message, regardless of status", async () => {
    const user = userEvent.setup();
    receiveMutate.mockImplementationOnce((_a, opts) => opts.onError(new ApiError({ status: 422, message: MISMATCH, requestId: "r" })));
    render(<ReceivingConsole poId={1} />);
    await user.type(sugarQty(), "5");
    await user.click(receiveButton());
    expect(await screen.findByText(/already submitted with different quantities/i)).toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("a 409 whose message only resembles the mismatch is a normal rejection (toast), not the banner", async () => {
    const user = userEvent.setup();
    receiveMutate.mockImplementationOnce((_a, opts) =>
      opts.onError(new ApiError({ status: 409, message: "idempotency-key already used with a DIFFERENT payload", requestId: "r" })),
    );
    render(<ReceivingConsole poId={1} />);
    await user.type(sugarQty(), "5");
    await user.click(receiveButton());
    expect(screen.queryByText(/already submitted with different quantities/i)).toBeNull();
    expect(toast.error).toHaveBeenCalledWith("Receipt rejected", expect.anything());
  });

  it("mismatch recovery 'Start a new receipt' keeps entries and the next submit uses a NEW key", async () => {
    const user = userEvent.setup();
    receiveMutate.mockImplementationOnce((_a, opts) => opts.onError(new ApiError({ status: 409, message: MISMATCH, requestId: "r" })));
    render(<ReceivingConsole poId={1} />);
    await user.type(sugarQty(), "5");
    await user.click(receiveButton());
    expect(receiveButton()).toBeDisabled(); // blocked until the operator decides
    const k1 = receiveMutate.mock.calls[0][0].idempotencyKey;
    await user.click(screen.getByRole("button", { name: /start a new receipt/i }));
    await user.click(receiveButton());
    expect(receiveMutate.mock.calls[1][0]).toEqual({ ...receiveMutate.mock.calls[0][0], idempotencyKey: expect.any(String) });
    expect(receiveMutate.mock.calls[1][0].idempotencyKey).not.toBe(k1);
  });

  it("Receive is disabled while a receive is pending", async () => {
    const user = userEvent.setup();
    receiveState = { ...receiveState, isPending: true };
    render(<ReceivingConsole poId={1} />);
    await user.type(sugarQty(), "5");
    const pending = screen.getAllByRole("button", { name: /^Submitting…$/i })[0];
    expect(pending).toBeDisabled();
    await user.click(pending);
    expect(receiveMutate).not.toHaveBeenCalled();
  });

  it("a non-mismatch error is shown inline with copy and request id; a mismatch error is not", () => {
    receiveState = {
      ...receiveState,
      isError: true,
      error: new ApiError({ status: 409, message: "Received quantity exceeds remaining purchase order quantity for product_id 1", requestId: "req-x" }),
    };
    const { unmount } = render(<ReceivingConsole poId={1} />);
    expect(screen.getByText("req-x")).toBeInTheDocument();
    unmount();
    receiveState = { ...receiveState, error: new ApiError({ status: 409, message: MISMATCH, requestId: "req-y" }) };
    render(<ReceivingConsole poId={1} />);
    expect(screen.queryByText("req-y")).toBeNull();
  });

  describe("barcode assist (read-only, never a receive)", () => {
    const assist = async (user: ReturnType<typeof userEvent.setup>, code: string) => {
      await user.type(screen.getByLabelText("Barcode assist"), `${code}{Enter}`);
    };
    const product = (id: number, product_name: string) => ({ product: { id, product_name }, batches: [], barcode: "x", context: "stock_in" });

    it("jumps to the scanned product's line using the 'stock_in' purpose", async () => {
      const user = userEvent.setup();
      // jsdom has no scrollIntoView; the console scrolls the line into view before focusing it
      const scroll = vi.fn();
      Element.prototype.scrollIntoView = scroll;
      vi.mocked(resolveBarcode).mockResolvedValueOnce(product(3, "Refined Sugar Sack 25kg") as never);
      render(<ReceivingConsole poId={1} />);
      await assist(user, "8800000000003");
      await vi.waitFor(() => expect(field("rl-3-qty")).toHaveFocus());
      expect(resolveBarcode).toHaveBeenCalledWith("8800000000003", "stock_in");
      expect(scroll).toHaveBeenCalledWith({ block: "center", behavior: "smooth" });
      // @ts-expect-error -- remove the test-only stub again
      delete Element.prototype.scrollIntoView;
      expect(receiveMutate).not.toHaveBeenCalled();
    });

    it("a product not on the PO, a fully received line and an unknown code are toasts only", async () => {
      const user = userEvent.setup();
      detail = {
        ...purchaseOrderDetailResponse.data,
        items: purchaseOrderDetailResponse.data.items.map((it) =>
          it.product_id === 6 ? { ...it, received_quantity: it.quantity, remaining_quantity: "0.000" } : it,
        ),
      };
      render(<ReceivingConsole poId={1} />);
      vi.mocked(resolveBarcode).mockResolvedValueOnce(product(99, "Stranger") as never);
      await assist(user, "8800000000099");
      await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith("Stranger is not on this purchase order."));
      vi.mocked(resolveBarcode).mockResolvedValueOnce(product(6, "Green Tea 200g") as never);
      await assist(user, "8800000000006");
      await vi.waitFor(() => expect(toast.info).toHaveBeenCalledWith("Green Tea 200g is already fully received."));
      vi.mocked(resolveBarcode).mockRejectedValueOnce(new ApiError({ status: 404, message: "Product not found" }));
      await assist(user, "8800000000404");
      await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith("Unknown barcode 8800000000404."));
      expect(receiveMutate).not.toHaveBeenCalled();
    });
  });

  it("a language switch keeps entries and the key and sends no business request", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      render(
        <LanguageProvider initialLocale="th">
          <LanguageSwitch />
          <ReceivingConsole poId={1} />
        </LanguageProvider>,
      );
      await user.type(sugarQty(), "5");
      const input = sugarQty();
      await user.click(screen.getByRole("button", { name: "EN" }));
      await user.click(screen.getByRole("button", { name: "ไทย" }));
      expect(sugarQty()).toBe(input);
      expect(input).toHaveValue("5");
      expect(receiveMutate).not.toHaveBeenCalled();
      expect(fetchMock.mock.calls.every((c) => (c as unknown[])[0] === "/api/prefs/language")).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
