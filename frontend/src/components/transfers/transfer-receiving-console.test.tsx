import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { toast } from "sonner";
import { ApiError } from "@/lib/api/errors";
import { transferDetailResponse, transferReceiptResponse } from "@/test/fixtures";

const receiveMutate = vi.fn();
let detail: unknown = transferDetailResponse;
let batchExpiry: Record<number, { expiry_date: string | null; days_to_expiry: number | null; is_expired: boolean }> = {};

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/query/transfers", () => ({
  useTransfer: () => ({ data: detail, isLoading: false, isError: false, refetch: vi.fn() }),
  useReceiveTransfer: () => ({ mutate: receiveMutate, isPending: false, isError: false, error: undefined }),
  useBatchExpiryMap: () => ({ map: batchExpiry, isLoading: false }),
  useWarehouseNames: () => ({ data: { 1: "Main Warehouse", 2: "Shop Warehouse" } }),
}));
vi.mock("@/lib/query/sales", () => ({
  useProductLookup: () => ({
    data: {
      1: { id: 1, sku: "WH-COFFEE-1KG", product_name: "Arabica Whole Bean 1kg", barcode: "b1", track_batch: true, track_expiry: true },
      3: { id: 3, sku: "WH-SUGAR-25KG", product_name: "Refined Sugar Sack 25kg", barcode: "b3", track_batch: false, track_expiry: false },
    },
  }),
  resolveBarcode: vi.fn(),
}));

import { TransferReceivingConsole } from "./transfer-receiving-console";
import { resolveBarcode } from "@/lib/query/sales";
import { LanguageProvider } from "@/lib/i18n/client";
import { LanguageSwitch } from "@/components/shell/language-switch";

beforeEach(() => {
  receiveMutate.mockReset();
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.info).mockClear();
  vi.mocked(resolveBarcode).mockReset();
  detail = transferDetailResponse;
  batchExpiry = {};
  window.sessionStorage.clear();
});

const qty = () => screen.getAllByLabelText("Receive now"); // coffee (item 1), sugar (item 2)
const reviewBtn = () => screen.getAllByRole("button", { name: /^Review receipt$/i })[0];
// R4: Review opens the sheet (sends nothing); only Confirm posts
async function reviewAndConfirm(user: ReturnType<typeof userEvent.setup>) {
  if (!screen.queryByRole("dialog")) await user.click(reviewBtn());
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: /^confirm receipt/i }));
}
const receiveBtn = reviewBtn;

describe("TransferReceivingConsole — lines + guards", () => {
  it("renders a line per transfer item, the route, and a disabled Receive", () => {
    render(<TransferReceivingConsole transferId={1} />);
    expect(screen.getByText("Arabica Whole Bean 1kg")).toBeInTheDocument();
    expect(screen.getByText("Refined Sugar Sack 25kg")).toBeInTheDocument();
    expect(screen.getByText("System transit")).toBeInTheDocument();
    expect(qty()).toHaveLength(2);
    expect(receiveBtn()).toBeDisabled();
  });

  it("blocks a quantity above the line's outstanding", async () => {
    const user = userEvent.setup();
    render(<TransferReceivingConsole transferId={1} />);
    await user.type(qty()[0], "99");
    expect(screen.getByText(/Only 5.000 still in transit/i)).toBeInTheDocument();
    expect(receiveBtn()).toBeDisabled();
  });
});

describe("TransferReceivingConsole — receive with a persisted Idempotency-Key", () => {
  it("submits { id, idempotencyKey, payload } and lists the receipt on success", async () => {
    const user = userEvent.setup();
    receiveMutate.mockImplementation((_a, opts) => opts.onSuccess(transferReceiptResponse));
    render(<TransferReceivingConsole transferId={1} />);

    await user.type(qty()[1], "3"); // sugar (transfer_item_id 2)
    expect(receiveBtn()).toBeEnabled();
    await reviewAndConfirm(user);

    const [args] = receiveMutate.mock.calls[0];
    expect(args.id).toBe(1);
    expect(args.idempotencyKey).toMatch(/^tr-rcpt-/);
    expect(args.payload).toEqual({ items: [{ transfer_item_id: 2, quantity: "3.000" }] });

    expect(await screen.findByText(transferReceiptResponse.receipt_number)).toBeInTheDocument();
    expect(receiveBtn()).toBeDisabled();
  });

  it("a multi-line receipt is one payload sorted by transfer_item_id", async () => {
    const user = userEvent.setup();
    receiveMutate.mockImplementation((_a, opts) => opts.onSuccess(transferReceiptResponse));
    render(<TransferReceivingConsole transferId={1} />);
    await user.type(qty()[0], "5");
    await user.type(qty()[1], "4");
    await reviewAndConfirm(user);
    expect(receiveMutate.mock.calls[0][0].payload.items).toEqual([
      { transfer_item_id: 1, quantity: "5.000" },
      { transfer_item_id: 2, quantity: "4.000" },
    ]);
  });
});

describe("TransferReceivingConsole — rejections", () => {
  it("over-receive 409 → toast with message + request id, nothing recorded", async () => {
    const user = userEvent.setup();
    receiveMutate.mockImplementation((_a, opts) =>
      opts.onError(
        new ApiError({ status: 409, message: "Receipt exceeds outstanding dispatched quantity", requestId: "req-over" }),
      ),
    );
    render(<TransferReceivingConsole transferId={1} />);
    await user.type(qty()[1], "3");
    await reviewAndConfirm(user);
    expect(toast.error).toHaveBeenCalledWith(
      "Receipt rejected",
      expect.objectContaining({ description: expect.stringMatching(/still in transit.*req-over/i) }),
    );
    expect(screen.getByText(/No receipts recorded in this session/i)).toBeInTheDocument();
  });

  it("idempotency mismatch 409 → banner + 'Start a new receipt', keeps entries, no auto key", async () => {
    const user = userEvent.setup();
    receiveMutate.mockImplementation((_a, opts) =>
      opts.onError(
        new ApiError({ status: 409, message: "Idempotency-Key already used with a different payload", requestId: "req-mm" }),
      ),
    );
    render(<TransferReceivingConsole transferId={1} />);
    await user.type(qty()[1], "3");
    await reviewAndConfirm(user);
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText(/already submitted with different quantities/i)).toBeInTheDocument();
    await user.click(within(alert).getByRole("button", { name: /start a new receipt/i }));
    expect(screen.queryByText(/already submitted with different quantities/i)).toBeNull();
    expect(qty()[1]).toHaveValue("3");
  });
});

describe("TransferReceivingConsole — expired in transit / not receivable", () => {
  it("an expired-in-transit batch is flagged but still receivable", async () => {
    const user = userEvent.setup();
    batchExpiry = { 1: { expiry_date: "2020-01-01", days_to_expiry: -2000, is_expired: true } };
    receiveMutate.mockImplementation((_a, opts) => opts.onSuccess(transferReceiptResponse));
    render(<TransferReceivingConsole transferId={1} />);
    expect(screen.getByText(/Expired in transit — receive required/i)).toBeInTheDocument();
    await user.type(qty()[0], "5"); // coffee, the expired line
    expect(receiveBtn()).toBeEnabled();
    await reviewAndConfirm(user);
    expect(receiveMutate).toHaveBeenCalledTimes(1);
  });

  it("a COMPLETED transfer shows an info screen, not the console", () => {
    detail = { ...transferDetailResponse, status: "COMPLETED" };
    render(<TransferReceivingConsole transferId={1} />);
    expect(screen.getByText(/not in transit — nothing to receive/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("Receive now")).toBeNull();
  });
});

/* ------------------- R3.0 characterization (pre-refactor) ------------------- */

describe("TransferReceivingConsole — characterization (R3.0)", () => {
  const MISMATCH = "Idempotency-Key already used with a different payload";

  it("exact mutate arguments: transfer_item_id lines sorted, quantity padded to 3dp, key prefix tr-rcpt-", async () => {
    const user = userEvent.setup();
    render(<TransferReceivingConsole transferId={1} />);
    await user.type(qty()[1], "1.5");
    await user.type(qty()[0], "2");
    await reviewAndConfirm(user);
    expect(receiveMutate.mock.calls[0][0]).toEqual({
      id: 1,
      idempotencyKey: expect.stringMatching(/^tr-rcpt-/),
      payload: {
        items: [
          { transfer_item_id: 1, quantity: "2.000" },
          { transfer_item_id: 2, quantity: "1.500" },
        ],
      },
    });
  });

  it("more than 3 decimals is rejected client-side", async () => {
    const user = userEvent.setup();
    render(<TransferReceivingConsole transferId={1} />);
    await user.type(qty()[0], "1.0001");
    expect(screen.getByText(/At most 3 decimal places/i)).toBeInTheDocument();
    expect(receiveBtn()).toBeDisabled();
  });

  it("a failed receive keeps entries and key; the retry is identical; a reload restores both", async () => {
    const user = userEvent.setup();
    receiveMutate.mockImplementation((_a, opts) => opts.onError(new ApiError({ status: 503, message: "down", requestId: "r" })));
    const first = render(<TransferReceivingConsole transferId={1} />);
    await user.type(qty()[0], "2");
    await reviewAndConfirm(user);
    await reviewAndConfirm(user);
    expect(receiveMutate.mock.calls[1][0]).toEqual(receiveMutate.mock.calls[0][0]);
    first.unmount();
    render(<TransferReceivingConsole transferId={1} />);
    expect(qty()[0]).toHaveValue("2");
    await reviewAndConfirm(user);
    expect(receiveMutate.mock.calls[2][0]).toEqual(receiveMutate.mock.calls[0][0]);
  });

  it("success rotates the key and clears entries; a replayed receipt is listed once", async () => {
    const user = userEvent.setup();
    receiveMutate.mockImplementation((_a, opts) => opts.onSuccess(transferReceiptResponse));
    render(<TransferReceivingConsole transferId={1} />);
    await user.type(qty()[0], "2");
    await reviewAndConfirm(user);
    const k1 = receiveMutate.mock.calls[0][0].idempotencyKey;
    expect(qty()[0]).toHaveValue("");
    await user.type(qty()[0], "2");
    await reviewAndConfirm(user);
    expect(receiveMutate.mock.calls[1][0].idempotencyKey).not.toBe(k1);
    const receipt = transferReceiptResponse.receipt_number;
    expect(screen.getAllByText((_, el) => el?.textContent === receipt && el.children.length === 0)).toHaveLength(1);
  });

  it("the mismatch predicate is the exact message regardless of status; a look-alike is a normal rejection", async () => {
    const user = userEvent.setup();
    receiveMutate.mockImplementationOnce((_a, opts) =>
      opts.onError(new ApiError({ status: 409, message: "IDEMPOTENCY-KEY already used with a different payload", requestId: "r" })),
    );
    render(<TransferReceivingConsole transferId={1} />);
    await user.type(qty()[0], "2");
    await reviewAndConfirm(user);
    expect(toast.error).toHaveBeenCalledWith("Receipt rejected", expect.anything());
    expect(screen.queryByRole("button", { name: /start a new receipt/i })).toBeNull();

    receiveMutate.mockImplementationOnce((_a, opts) => opts.onError(new ApiError({ status: 500, message: MISMATCH, requestId: "r" })));
    await reviewAndConfirm(user);
    expect(await screen.findByRole("button", { name: /start a new receipt/i })).toBeInTheDocument();
  });

  it("mismatch recovery keeps entries and the next submit uses a NEW key with the same payload", async () => {
    const user = userEvent.setup();
    receiveMutate.mockImplementationOnce((_a, opts) => opts.onError(new ApiError({ status: 409, message: MISMATCH, requestId: "r" })));
    render(<TransferReceivingConsole transferId={1} />);
    await user.type(qty()[0], "2");
    await reviewAndConfirm(user);
    expect(receiveBtn()).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /start a new receipt/i }));
    await reviewAndConfirm(user);
    expect(receiveMutate.mock.calls[1][0].payload).toEqual(receiveMutate.mock.calls[0][0].payload);
    expect(receiveMutate.mock.calls[1][0].idempotencyKey).not.toBe(receiveMutate.mock.calls[0][0].idempotencyKey);
  });

  describe("barcode assist (read-only, never a receive)", () => {
    const assist = async (user: ReturnType<typeof userEvent.setup>, code: string) => {
      await user.type(screen.getByLabelText("Barcode assist"), `${code}{Enter}`);
    };
    const product = (id: number, product_name: string) => ({ product: { id, product_name }, batches: [], barcode: "x", context: "stock_in" });

    it("jumps to the first line still in transit and announces when a product has several lines", async () => {
      const user = userEvent.setup();
      const scroll = vi.fn();
      Element.prototype.scrollIntoView = scroll; // jsdom has no scrollIntoView
      detail = {
        ...transferDetailResponse,
        items: [
          { ...transferDetailResponse.items[0], received_quantity: "5.000", outstanding_quantity: "0.000" },
          { ...transferDetailResponse.items[0], id: 3, batch_id: 9 },
          transferDetailResponse.items[1],
        ],
      };
      vi.mocked(resolveBarcode).mockResolvedValueOnce(product(1, "Arabica Whole Bean 1kg") as never);
      render(<TransferReceivingConsole transferId={1} />);
      await assist(user, "8800000000001");
      await vi.waitFor(() => expect(document.getElementById("trl-3-qty")).toHaveFocus());
      expect(resolveBarcode).toHaveBeenCalledWith("8800000000001", "stock_in");
      expect(toast.info).toHaveBeenCalledWith("Arabica Whole Bean 1kg has 2 lines — jumped to the first with stock in transit.");
      expect(receiveMutate).not.toHaveBeenCalled();
      // @ts-expect-error -- remove the test-only stub again
      delete Element.prototype.scrollIntoView;
    });

    it("not on the transfer / fully received / unknown code are toasts only", async () => {
      const user = userEvent.setup();
      detail = {
        ...transferDetailResponse,
        items: [{ ...transferDetailResponse.items[0], received_quantity: "5.000", outstanding_quantity: "0.000" }, transferDetailResponse.items[1]],
      };
      render(<TransferReceivingConsole transferId={1} />);
      vi.mocked(resolveBarcode).mockResolvedValueOnce(product(99, "Stranger") as never);
      await assist(user, "8800000000099");
      await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith("Stranger is not on this transfer."));
      vi.mocked(resolveBarcode).mockResolvedValueOnce(product(1, "Arabica Whole Bean 1kg") as never);
      await assist(user, "8800000000001");
      await vi.waitFor(() => expect(toast.info).toHaveBeenCalledWith("Arabica Whole Bean 1kg is already fully received."));
      vi.mocked(resolveBarcode).mockRejectedValueOnce(new Error("network"));
      await assist(user, "8800000000500");
      await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith("Could not resolve that barcode."));
      expect(receiveMutate).not.toHaveBeenCalled();
    });
  });

  it("a language switch keeps entries and sends no business request", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      render(
        <LanguageProvider initialLocale="en">
          <LanguageSwitch />
          <TransferReceivingConsole transferId={1} />
        </LanguageProvider>,
      );
      await user.type(qty()[0], "2");
      const input = qty()[0];
      await user.click(screen.getByRole("button", { name: "ไทย" }));
      await user.click(screen.getByRole("button", { name: "EN" }));
      expect(qty()[0]).toBe(input);
      expect(input).toHaveValue("2");
      expect(receiveMutate).not.toHaveBeenCalled();
      expect(fetchMock.mock.calls.every((c) => (c as unknown[])[0] === "/api/prefs/language")).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

/* ------------------- R4 review before commit (D-R4-4) ------------------- */

describe("TransferReceivingConsole — R4 review before commit", () => {
  it("opening the review sends nothing and lists the included line, its in-transit after and the destination", async () => {
    const user = userEvent.setup();
    render(<TransferReceivingConsole transferId={1} />);
    await user.type(qty()[0], "1");
    await user.click(reviewBtn());
    const dialog = screen.getByRole("dialog");
    expect(receiveMutate).not.toHaveBeenCalled();
    expect(within(dialog).getByText("+1.000")).toBeInTheDocument();
    expect(within(dialog).getByText("Destination")).toBeInTheDocument();
    expect(within(dialog).getByText(/in transit after/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Confirm receipt +1.000" })).toBeInTheDocument();
  });

  it("Back to edit keeps the entry; Escape returns focus; only Confirm posts", async () => {
    const user = userEvent.setup();
    render(<TransferReceivingConsole transferId={1} />);
    await user.type(qty()[0], "1");
    await user.click(reviewBtn());
    await user.click(screen.getByRole("button", { name: "Back to edit" }));
    expect(qty()[0]).toHaveValue("1");
    await user.click(reviewBtn());
    await user.keyboard("{Escape}");
    expect(reviewBtn()).toHaveFocus();
    expect(receiveMutate).not.toHaveBeenCalled();
    await reviewAndConfirm(user);
    expect(receiveMutate).toHaveBeenCalledTimes(1);
  });

  it("while the review is open the barcode assist neither resolves nor receives", async () => {
    const user = userEvent.setup();
    render(<TransferReceivingConsole transferId={1} />);
    await user.type(qty()[0], "1");
    await user.click(reviewBtn());
    await user.keyboard("8800000000001{Enter}");
    expect(resolveBarcode).not.toHaveBeenCalled();
    expect(receiveMutate).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("is translated: Thai review button and the system-transit route", () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    try {
      render(
        <LanguageProvider initialLocale="th">
          <TransferReceivingConsole transferId={1} />
        </LanguageProvider>,
      );
      expect(screen.getAllByRole("button", { name: "ตรวจสอบใบรับ" })[0]).toBeDisabled();
      expect(screen.getByText("ระหว่างขนส่ง (ระบบ)")).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
