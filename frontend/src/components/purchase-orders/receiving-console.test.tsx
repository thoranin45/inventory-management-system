import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { toast } from "sonner";

import { ApiError } from "@/lib/api/errors";
import { purchaseOrderDetailResponse, purchaseOrderReceiveResponse } from "@/test/fixtures";

const receiveMutate = vi.fn();
let detail: unknown = purchaseOrderDetailResponse.data;

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/query/purchase-orders", () => ({
  usePurchaseOrder: () => ({ data: detail, isLoading: false, isError: false, refetch: vi.fn() }),
  useReceivePurchaseOrder: () => ({ mutate: receiveMutate, isPending: false, isError: false, error: undefined }),
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

beforeEach(() => {
  receiveMutate.mockReset();
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
