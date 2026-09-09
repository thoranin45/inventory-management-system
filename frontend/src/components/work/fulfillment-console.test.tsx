import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ApiError } from "@/lib/api/errors";

/* ------------------------------ mocks ------------------------------ */
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@tanstack/react-query", () => ({ useQueries: () => [] }));

const scanMutate = vi.fn();
const startMutate = vi.fn();
const completeMutate = vi.fn();
let detail: unknown;

const COFFEE_2_ALLOC = {
  id: 8,
  sales_order_id: 7,
  product_id: 1,
  quantity: "4.000",
  unit_price: "210.00",
  total_price: "840.00",
  batch_allocations: [
    { id: 7, batch_id: 1, quantity: "3.000" },
    { id: 71, batch_id: 5, quantity: "1.000" },
  ],
  fulfillment_allocations: [
    { id: 7, batch_id: 1, stock_balance_id: 1, quantity: "3.000", picked_quantity: "0.000", packed_quantity: "0.000" },
    { id: 71, batch_id: 5, stock_balance_id: 9, quantity: "1.000", picked_quantity: "0.000", packed_quantity: "0.000" },
  ],
};
const SUGAR = {
  id: 9,
  sales_order_id: 7,
  product_id: 3,
  quantity: "2.000",
  unit_price: "640.00",
  total_price: "1280.00",
  batch_allocations: [],
  fulfillment_allocations: [
    { id: 8, batch_id: null, stock_balance_id: 4, quantity: "2.000", picked_quantity: "0.000", packed_quantity: "0.000" },
  ],
};

function makeDetail(status: string) {
  return {
    id: 7,
    so_number: "SO-000007",
    customer_id: 1,
    status,
    total_amount: "2120",
    created_at: "2026-09-08T13:02:11",
    items: [structuredClone(COFFEE_2_ALLOC), structuredClone(SUGAR)],
    picked_at: null,
    picked_by_user_id: null,
    packed_at: null,
    packed_by_user_id: null,
    shipped_at: null,
    shipped_by_user_id: null,
    shipment_number: null,
  };
}

vi.mock("@/lib/query/sales", () => ({
  useSalesOrder: () => ({ data: detail, isLoading: false, isError: false, refetch: vi.fn() }),
  useSalesOrders: () => ({ data: { items: [{ id: 7, attention_reason: null }] } }),
  useProductLookup: () => ({
    data: {
      1: { id: 1, sku: "WH-COFFEE-1KG", product_name: "Arabica Whole Bean 1kg", barcode: "885000000001", track_batch: true },
      3: { id: 3, sku: "WH-SUGAR-25KG", product_name: "Refined Sugar Sack 25kg", barcode: "885000000009", track_batch: false },
    },
  }),
  resolveBarcode: vi.fn(async () => ({
    barcode: "885000000001",
    context: "pick",
    product: { id: 1, sku: "WH-COFFEE-1KG", product_name: "Arabica Whole Bean 1kg", track_batch: true, track_expiry: true, operational_available_quantity: "10.000" },
    batches: [
      { id: 1, lot_no: "LOT-A", expiry_date: "2026-10-19", days_to_expiry: 41, is_expired: false, is_near_expiry: true, operational_available_quantity: "5.000" },
      { id: 5, lot_no: "LOT-B", expiry_date: "2026-09-30", days_to_expiry: 22, is_expired: false, is_near_expiry: true, operational_available_quantity: "5.000" },
    ],
    as_of_date: "2026-09-08",
  })),
  useStartPicking: () => ({ mutate: startMutate, isPending: false }),
  useScanPick: () => ({ mutate: scanMutate, isPending: false }),
  useScanPack: () => ({ mutate: vi.fn(), isPending: false }),
  useCompletePicking: () => ({ mutate: completeMutate, isPending: false }),
  useCompletePacking: () => ({ mutate: vi.fn(), isPending: false }),
  usePackingSlipData: () => ({ isLoading: true }),
  useShippingLabelData: () => ({ isLoading: true }),
}));

import { FulfillmentConsole } from "./fulfillment-console";

beforeEach(() => {
  push.mockReset();
  scanMutate.mockReset();
  startMutate.mockReset();
  completeMutate.mockReset();
  detail = makeDetail("PICKING");
});

async function scan(user: ReturnType<typeof userEvent.setup>, code: string) {
  const input = screen.getByLabelText("Barcode scan input");
  await user.click(input);
  await user.type(input, `${code}{Enter}`);
}

/* ------------------------------ tests ------------------------------ */

describe("FulfillmentConsole — start picking", () => {
  it("shows a Start picking screen for a CONFIRMED order and calls the mutation", async () => {
    const user = userEvent.setup();
    detail = makeDetail("CONFIRMED");
    render(<FulfillmentConsole orderId={7} mode="pick" />);
    await user.click(screen.getByRole("button", { name: /start picking/i }));
    expect(startMutate).toHaveBeenCalledWith(7, expect.any(Object));
  });
});

describe("FulfillmentConsole — correct scan", () => {
  it("counts a good scan, updates progress and never blocks the Complete gate early", async () => {
    const user = userEvent.setup();
    render(<FulfillmentConsole orderId={7} mode="pick" />);

    scanMutate.mockImplementation((_args, opts) =>
      opts.onSuccess({
        sales_order_id: 7,
        so_number: "SO-000007",
        status: "PICKING",
        allocation_id: 8,
        quantity: "2.000",
        picked_quantity: "2.000",
        packed_quantity: "0.000",
      }),
    );
    await scan(user, "885000000009"); // sugar → single allocation 8

    expect(scanMutate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 7, barcode: "885000000009" }),
      expect.any(Object),
    );
    expect(await screen.findByText(/Matched/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /complete picking/i })).toBeDisabled();
  });
});

describe("FulfillmentConsole — wrong item / over-scan", () => {
  it("wrong item → Error, nothing counted, request id surfaced", async () => {
    const user = userEvent.setup();
    render(<FulfillmentConsole orderId={7} mode="pick" />);
    scanMutate.mockImplementation((_a, opts) =>
      opts.onError(new ApiError({ status: 409, message: "PRODUCT_NOT_IN_ORDER", requestId: "req-77" })),
    );
    await scan(user, "999999999999");
    expect(await screen.findByText(/Error/i)).toBeInTheDocument();
    expect(screen.getByText(/isn.t on this order/i)).toBeInTheDocument();
    expect(screen.getByText(/req-77/)).toBeInTheDocument();
  });

  it("over-scan → Error with the 'exceeds remaining' copy", async () => {
    const user = userEvent.setup();
    render(<FulfillmentConsole orderId={7} mode="pick" />);
    scanMutate.mockImplementation((_a, opts) =>
      opts.onError(new ApiError({ status: 409, message: "ALLOCATION_SCAN_EXCEEDS_REMAINING", requestId: "req-9" })),
    );
    await scan(user, "885000000009");
    expect(await screen.findByText(/exceed the quantity required/i)).toBeInTheDocument();
  });
});

describe("FulfillmentConsole — ambiguous allocation", () => {
  it("opens the allocation picker on ALLOCATION_IDENTIFICATION_REQUIRED and never guesses", async () => {
    const user = userEvent.setup();
    render(<FulfillmentConsole orderId={7} mode="pick" />);
    scanMutate.mockImplementation((_a, opts) =>
      opts.onError(new ApiError({ status: 409, message: "ALLOCATION_IDENTIFICATION_REQUIRED" })),
    );
    await scan(user, "885000000001"); // coffee → 2 allocations

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Which batch/i)).toBeInTheDocument();
    // FEFO: LOT-B (2026-09-30) before LOT-A (2026-10-19)
    const options = within(dialog).getAllByRole("button", { name: /LOT-/ });
    expect(options[0]).toHaveTextContent("LOT-B");

    // choosing re-submits the SAME barcode with an explicit allocation_id
    scanMutate.mockImplementation((_a, opts) =>
      opts.onSuccess({
        sales_order_id: 7, so_number: "SO-000007", status: "PICKING",
        allocation_id: 71, quantity: "1.000", picked_quantity: "1.000", packed_quantity: "0.000",
      }),
    );
    await user.click(options[0]);
    expect(scanMutate).toHaveBeenLastCalledWith(
      expect.objectContaining({ barcode: "885000000001", allocation_id: expect.any(Number) }),
      expect.any(Object),
    );
  });
});

describe("FulfillmentConsole — complete gating", () => {
  it("enables Complete only once every allocation is fully picked, then posts the full payload", async () => {
    const user = userEvent.setup();
    render(<FulfillmentConsole orderId={7} mode="pick" />);

    const responses: Record<string, { allocation_id: number; picked: string; qty: string }> = {
      "885000000009": { allocation_id: 8, picked: "2.000", qty: "2.000" },
    };
    scanMutate.mockImplementation((args, opts) => {
      if (args.barcode === "885000000001") {
        // coffee is ambiguous unless allocation_id supplied
        if (!args.allocation_id) {
          opts.onError(new ApiError({ status: 409, message: "ALLOCATION_IDENTIFICATION_REQUIRED" }));
          return;
        }
        opts.onSuccess({
          sales_order_id: 7, so_number: "SO-000007", status: "PICKING",
          allocation_id: args.allocation_id, quantity: args.allocation_id === 7 ? "3.000" : "1.000",
          picked_quantity: args.allocation_id === 7 ? "3.000" : "1.000", packed_quantity: "0.000",
        });
        return;
      }
      const r = responses[args.barcode];
      opts.onSuccess({
        sales_order_id: 7, so_number: "SO-000007", status: "PICKING",
        allocation_id: r.allocation_id, quantity: r.qty, picked_quantity: r.picked, packed_quantity: "0.000",
      });
    });

    await scan(user, "885000000009"); // sugar done
    expect(screen.getByRole("button", { name: /complete picking/i })).toBeDisabled();

    // coffee is ambiguous — drive it via the line's "+1" (bypasses the scanner
    // input, same backend path). First pick → alloc 71 (1.000).
    await user.click(screen.getByRole("button", { name: /scan one Arabica/i }));
    let dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByText("LOT-B").closest("button")!);
    // second pick → alloc 7 (3.000)
    await user.click(screen.getByRole("button", { name: /scan one Arabica/i }));
    dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByText("LOT-A").closest("button")!);

    const completeBtn = screen.getByRole("button", { name: /complete picking/i });
    expect(completeBtn).toBeEnabled();
    await user.click(completeBtn);
    expect(completeMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 7,
        allocations: expect.arrayContaining([
          { allocation_id: 7, quantity: "3.000" },
          { allocation_id: 71, quantity: "1.000" },
          { allocation_id: 8, quantity: "2.000" },
        ]),
      }),
      expect.any(Object),
    );
  });
});

describe("FulfillmentConsole — wrong lifecycle state", () => {
  it("directs a packing-state order away from the pick console", () => {
    detail = makeDetail("PACKING");
    render(<FulfillmentConsole orderId={7} mode="pick" />);
    expect(screen.getByText(/not in picking/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open packing console/i })).toBeInTheDocument();
  });
});
