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

beforeEach(() => {
  receiveMutate.mockReset();
  detail = transferDetailResponse;
  batchExpiry = {};
  window.sessionStorage.clear();
});

const qty = () => screen.getAllByLabelText("Receive now"); // coffee (item 1), sugar (item 2)
const receiveBtn = () => screen.getAllByRole("button", { name: /^Receive$/i })[0];

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
    await user.click(receiveBtn());

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
    await user.click(receiveBtn());
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
    await user.click(receiveBtn());
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
    await user.click(receiveBtn());
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
    await user.click(receiveBtn());
    expect(receiveMutate).toHaveBeenCalledTimes(1);
  });

  it("a COMPLETED transfer shows an info screen, not the console", () => {
    detail = { ...transferDetailResponse, status: "COMPLETED" };
    render(<TransferReceivingConsole transferId={1} />);
    expect(screen.getByText(/not in transit — nothing to receive/i)).toBeInTheDocument();
    expect(screen.queryByLabelText("Receive now")).toBeNull();
  });
});
