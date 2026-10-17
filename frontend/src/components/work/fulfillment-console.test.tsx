import { afterEach, describe, expect, it, vi, beforeEach, type MockInstance } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ApiError } from "@/lib/api/errors";
import { DEFAULT_SCANNER_TIMING } from "./use-scanner";

/* ------------------------------ mocks ------------------------------ */
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@tanstack/react-query", () => ({ useQueries: () => [] }));

const scanMutate = vi.fn();
const startMutate = vi.fn();
const completeMutate = vi.fn();
const undoMutate = vi.fn();
const packScanMutate = vi.fn();
const completePackMutate = vi.fn();
const undoPackMutate = vi.fn();
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
  useScanPack: () => ({ mutate: packScanMutate, isPending: false }),
  useCompletePicking: () => ({ mutate: completeMutate, isPending: false }),
  useCompletePacking: () => ({ mutate: completePackMutate, isPending: false }),
  useUndoPick: () => ({ mutate: undoMutate, isPending: false }),
  useUndoPack: () => ({ mutate: undoPackMutate, isPending: false }),
  usePackingSlipData: () => ({ isLoading: true }),
  useShippingLabelData: () => ({ isLoading: true }),
}));

import { FulfillmentConsole } from "./fulfillment-console";
import { LanguageProvider } from "@/lib/i18n/client";
import { LanguageSwitch } from "@/components/shell/language-switch";

/*
 * Deterministic scanner clock. useScanner ignores a repeat of the same code
 * inside DEFAULT_SCANNER_TIMING.dedupeMs, measured with Date.now(). On a fast
 * runner two back-to-back scans of the same barcode can land inside that
 * window, so a deliberate second scan was silently de-duplicated (a CI-only
 * failure). Date.now() is pinned per test and only moves when a test says so.
 */
let clock = 0;
let nowSpy: MockInstance<() => number>;

beforeEach(() => {
  push.mockReset();
  scanMutate.mockReset();
  startMutate.mockReset();
  completeMutate.mockReset();
  undoMutate.mockReset();
  packScanMutate.mockReset();
  completePackMutate.mockReset();
  undoPackMutate.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  detail = makeDetail("PICKING");
  clock = 1_700_000_000_000;
  nowSpy = vi.spyOn(Date, "now").mockImplementation(() => clock);
});

afterEach(() => {
  nowSpy.mockRestore();
});

/** A deliberate new scan: step the clock well past the dedupe window first. */
async function scan(user: ReturnType<typeof userEvent.setup>, code: string) {
  clock += DEFAULT_SCANNER_TIMING.dedupeMs + 1_000;
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
    expect(await screen.findByText("✓ Picked +2.000 / 2.000")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /complete picking/i })).toBeDisabled();

    // coffee is ambiguous — a scan opens the allocation picker (no guessing).
    // First pick → alloc 71 (1.000).
    await scan(user, "885000000001");
    let dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByText("LOT-B").closest("button")!);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByText("✓ Picked +1.000 / 1.000")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /complete picking/i })).toBeDisabled();
    // second pick → alloc 7 (3.000) — the same barcode again, a deliberate new scan
    await scan(user, "885000000001");
    dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByText("LOT-A").closest("button")!);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByText("✓ Picked +3.000 / 3.000")).toBeInTheDocument();
    // 1 sugar + 2 × (ambiguous coffee scan + explicit allocation re-submit)
    expect(scanMutate).toHaveBeenCalledTimes(5);

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

describe("FulfillmentConsole — Phase 12C Scan +1 / Undo", () => {
  it("[Scan +1] targets a line without any backend call", async () => {
    const user = userEvent.setup();
    render(<FulfillmentConsole orderId={7} mode="pick" />);

    await user.click(screen.getByRole("button", { name: /scan one Refined Sugar/i }));
    expect(scanMutate).not.toHaveBeenCalled();
    // the scan panel now shows it is waiting for that item
    expect(screen.getByText(/Scan Refined Sugar Sack 25kg/i)).toBeInTheDocument();
  });

  it("a scan while a single-allocation line is targeted goes to that allocation", async () => {
    const user = userEvent.setup();
    render(<FulfillmentConsole orderId={7} mode="pick" />);
    scanMutate.mockImplementation((_a, opts) =>
      opts.onSuccess({
        sales_order_id: 7, so_number: "SO-000007", status: "PICKING",
        allocation_id: 8, quantity: "2.000", picked_quantity: "1.000", packed_quantity: "0.000",
      }),
    );

    await user.click(screen.getByRole("button", { name: /scan one Refined Sugar/i }));
    await scan(user, "885000000009");

    expect(scanMutate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 7, barcode: "885000000009", allocation_id: 8 }),
      expect.any(Object),
    );
  });

  it("[Undo] on a line with progress calls the undo mutation for its allocation", async () => {
    const user = userEvent.setup();
    // seed some progress on the sugar allocation via a scan
    scanMutate.mockImplementation((_a, opts) =>
      opts.onSuccess({
        sales_order_id: 7, so_number: "SO-000007", status: "PICKING",
        allocation_id: 8, quantity: "2.000", picked_quantity: "2.000", packed_quantity: "0.000",
      }),
    );
    render(<FulfillmentConsole orderId={7} mode="pick" />);
    await scan(user, "885000000009");

    undoMutate.mockImplementation((_a, opts) =>
      opts.onSuccess({
        sales_order_id: 7, so_number: "SO-000007", status: "PICKING",
        allocation_id: 8, quantity: "2.000", picked_quantity: "1.000", packed_quantity: "0.000",
      }),
    );
    await user.click(screen.getByRole("button", { name: /undo one Refined Sugar/i }));

    expect(undoMutate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 7, allocation_id: 8, quantity: "1" }),
      expect.any(Object),
    );
    expect(await screen.findByText(/Picked undone · now/i)).toBeInTheDocument();
  });
});

/* ------------------- R3.0 characterization (pre-refactor) ------------------- */

describe("FulfillmentConsole — characterization (R3.0)", () => {
  const ok = (allocation_id: number, quantity: string, picked: string, packed = "0.000", status = "PICKING") => ({
    sales_order_id: 7, so_number: "SO-000007", status, allocation_id, quantity, picked_quantity: picked, packed_quantity: packed,
  });

  /** fully picked / packed order (every allocation done) */
  function doneDetail(status: string, packed: boolean) {
    const d = makeDetail(status);
    for (const it of d.items) {
      for (const a of it.fulfillment_allocations) {
        a.picked_quantity = a.quantity;
        if (packed) a.packed_quantity = a.quantity;
      }
    }
    return d;
  }

  it("scan arguments: { id, barcode } with no allocation or quantity unless targeted", async () => {
    const user = userEvent.setup();
    render(<FulfillmentConsole orderId={7} mode="pick" />);
    await scan(user, "885000000009");
    expect(scanMutate.mock.calls[0][0]).toEqual({ id: 7, barcode: "885000000009", allocation_id: undefined, quantity: undefined });
  });

  it("scans are NOT idempotent: two deliberate scans while the first is pending send two requests", async () => {
    const user = userEvent.setup();
    render(<FulfillmentConsole orderId={7} mode="pick" />); // scanMutate never settles here
    await scan(user, "885000000009");
    await scan(user, "885000000009");
    expect(scanMutate).toHaveBeenCalledTimes(2);
  });

  it("the scanner drops a repeat of the same code inside the 120 ms window, and only that", async () => {
    const user = userEvent.setup();
    expect(DEFAULT_SCANNER_TIMING.dedupeMs).toBe(120);
    render(<FulfillmentConsole orderId={7} mode="pick" />);
    await scan(user, "885000000009");
    clock += 119;
    const input = screen.getByLabelText("Barcode scan input");
    await user.type(input, "885000000009{Enter}");
    expect(scanMutate).toHaveBeenCalledTimes(1);
    clock += 1;
    await user.type(input, "885000000009{Enter}");
    expect(scanMutate).toHaveBeenCalledTimes(2);
  });

  it("complete picking posts every allocation in item order with its full quantity, then opens packing", async () => {
    const user = userEvent.setup();
    detail = doneDetail("PICKING", false);
    completeMutate.mockImplementation((_a, opts) => opts.onSuccess({ so_number: "SO-000007" }));
    render(<FulfillmentConsole orderId={7} mode="pick" />);
    await user.click(screen.getByRole("button", { name: /complete picking/i }));
    expect(completeMutate.mock.calls[0][0]).toEqual({
      id: 7,
      allocations: [
        { allocation_id: 7, quantity: "3.000" },
        { allocation_id: 71, quantity: "1.000" },
        { allocation_id: 8, quantity: "2.000" },
      ],
    });
    expect(push).toHaveBeenCalledWith("/packing/7");
  });

  it("a failed complete toasts with the request id and stays", async () => {
    const user = userEvent.setup();
    detail = doneDetail("PICKING", false);
    completeMutate.mockImplementation((_a, opts) => opts.onError(new ApiError({ status: 409, message: "x", requestId: "req-c" })));
    render(<FulfillmentConsole orderId={7} mode="pick" />);
    await user.click(screen.getByRole("button", { name: /complete picking/i }));
    expect(toast.error).toHaveBeenCalledWith("Complete picking failed", { description: expect.stringMatching(/req-c/) });
    expect(push).not.toHaveBeenCalled();
  });

  it("a failed undo toasts and records the failure on the line", async () => {
    const user = userEvent.setup();
    scanMutate.mockImplementation((_a, opts) => opts.onSuccess(ok(8, "2.000", "2.000")));
    undoMutate.mockImplementation((_a, opts) => opts.onError(new ApiError({ status: 409, message: "x", requestId: "req-u" })));
    render(<FulfillmentConsole orderId={7} mode="pick" />);
    await scan(user, "885000000009");
    await user.click(screen.getByRole("button", { name: /undo one Refined Sugar/i }));
    expect(toast.error).toHaveBeenCalledWith("Undo picked failed", { description: expect.stringMatching(/req-u/) });
    expect(await screen.findByText("Undo failed · Request req-u")).toBeInTheDocument();
  });

  describe("pack mode", () => {
    it("scans go to the pack mutation and count packed quantities", async () => {
      const user = userEvent.setup();
      detail = doneDetail("PACKING", false);
      packScanMutate.mockImplementation((_a, opts) => opts.onSuccess(ok(8, "2.000", "2.000", "2.000", "PACKING")));
      render(<FulfillmentConsole orderId={7} mode="pack" />);
      await scan(user, "885000000009");
      expect(packScanMutate.mock.calls[0][0]).toEqual({ id: 7, barcode: "885000000009", allocation_id: undefined, quantity: undefined });
      expect(scanMutate).not.toHaveBeenCalled();
      expect(await screen.findByText("✓ Packed +2.000 / 2.000")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /complete packing/i })).toBeDisabled();
    });

    it("complete packing posts every allocation and returns to the packing queue", async () => {
      const user = userEvent.setup();
      detail = doneDetail("PACKING", true);
      completePackMutate.mockImplementation((_a, opts) => opts.onSuccess({ so_number: "SO-000007" }));
      render(<FulfillmentConsole orderId={7} mode="pack" />);
      await user.click(screen.getByRole("button", { name: /complete packing/i }));
      expect(completePackMutate.mock.calls[0][0]).toEqual({
        id: 7,
        allocations: [
          { allocation_id: 7, quantity: "3.000" },
          { allocation_id: 71, quantity: "1.000" },
          { allocation_id: 8, quantity: "2.000" },
        ],
      });
      expect(push).toHaveBeenCalledWith("/packing");
      expect(completeMutate).not.toHaveBeenCalled();
    });

    it("undo in pack mode uses the pack undo mutation with quantity '1'", async () => {
      const user = userEvent.setup();
      const d = doneDetail("PACKING", false);
      d.items[1].fulfillment_allocations[0].packed_quantity = "2.000";
      detail = d;
      undoPackMutate.mockImplementation((_a, opts) => opts.onSuccess(ok(8, "2.000", "2.000", "1.000", "PACKING")));
      render(<FulfillmentConsole orderId={7} mode="pack" />);
      await user.click(screen.getByRole("button", { name: /undo one Refined Sugar/i }));
      expect(undoPackMutate.mock.calls[0][0]).toEqual({ id: 7, allocation_id: 8, quantity: "1" });
      expect(undoMutate).not.toHaveBeenCalled();
    });

    it("a picking-state order is directed to the picking console", () => {
      detail = makeDetail("PICKING");
      render(<FulfillmentConsole orderId={7} mode="pack" />);
      expect(screen.getByText(/not in packing/i)).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /open picking console/i })).toHaveAttribute("href", "/picking/7");
    });
  });

  it("a language switch keeps scan progress and sends no fulfillment request", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      scanMutate.mockImplementation((_a, opts) => opts.onSuccess(ok(8, "2.000", "2.000")));
      render(
        <LanguageProvider initialLocale="th">
          <LanguageSwitch />
          <FulfillmentConsole orderId={7} mode="pick" />
        </LanguageProvider>,
      );
      await scan(user, "885000000009");
      expect(await screen.findByText("✓ Picked +2.000 / 2.000")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "EN" }));
      await user.click(screen.getByRole("button", { name: "ไทย" }));
      expect(screen.getByText("✓ Picked +2.000 / 2.000")).toBeInTheDocument();
      expect(scanMutate).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls.every((c) => (c as unknown[])[0] === "/api/prefs/language")).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
