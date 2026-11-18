import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ApiError } from "@/lib/api/errors";
import { DEFAULT_SCANNER_TIMING } from "./use-scanner";

/*
 * R5 (D-R5-5) + resync safety repair — a scan / undo whose outcome is unknown
 * is never reported as "nothing counted", never repeated, and LOCKS every
 * fulfilment mutation (scan, undo, complete) until it is reconciled:
 *   - a failed refresh GET never unlocks;
 *   - a successful GET unlocks only when every unresolved failure carried the
 *     backend's X-Request-ID (the backend finished that request, so the GET
 *     reflects its final effect);
 *   - after a network loss / BFF failure (no request id) the request may still
 *     commit later, so no GET can resolve it: the lock stays.
 */

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@tanstack/react-query", () => ({ useQueries: () => [] }));

// Entry points that bypass the visible scan field: a camera decode and an
// allocation choice. Rendered as always-present triggers so a test can fire
// them while the console is locked and prove the HANDLER refuses.
vi.mock("./camera-barcode-scanner", () => ({
  CameraBarcodeScanner: ({ onDecode }: { onDecode: (v: string) => void }) => (
    <button type="button" onClick={() => onDecode("885000000009")}>
      fake camera decode
    </button>
  ),
}));
vi.mock("./allocation-picker", () => ({
  AllocationPicker: ({ open, onChoose }: { open: boolean; onChoose: (id: number) => void }) =>
    open ? (
      <button type="button" onClick={() => onChoose(8)}>
        fake choose allocation
      </button>
    ) : null,
}));

const scanMutate = vi.fn();
const undoMutate = vi.fn();
const completeMutate = vi.fn();
const packScanMutate = vi.fn();
const completePackMutate = vi.fn();
const refetch = vi.fn();
let detail: unknown;

const SUGAR = (picked = "0.000", packed = "0.000") => ({
  id: 9,
  sales_order_id: 7,
  product_id: 3,
  quantity: "2.000",
  unit_price: "640.00",
  total_price: "1280.00",
  batch_allocations: [],
  fulfillment_allocations: [
    { id: 8, batch_id: null, stock_balance_id: 4, quantity: "2.000", picked_quantity: picked, packed_quantity: packed },
  ],
});

function makeDetail(picked = "0.000", status = "PICKING", packed = "0.000") {
  return {
    id: 7,
    so_number: "SO-000007",
    customer_id: 1,
    status,
    total_amount: "1280",
    created_at: "2026-09-08T13:02:11",
    items: [SUGAR(picked, packed)],
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
  useSalesOrder: () => ({ data: detail, isLoading: false, isError: false, refetch }),
  useSalesOrders: () => ({ data: { items: [{ id: 7, attention_reason: null }] } }),
  useProductLookup: () => ({
    data: { 3: { id: 3, sku: "WH-SUGAR-25KG", product_name: "Refined Sugar Sack 25kg", barcode: "885000000009", track_batch: false } },
  }),
  resolveBarcode: vi.fn(async () => null),
  useStartPicking: () => ({ mutate: vi.fn(), isPending: false }),
  useScanPick: () => ({ mutate: scanMutate, isPending: false }),
  useScanPack: () => ({ mutate: packScanMutate, isPending: false }),
  useCompletePicking: () => ({ mutate: completeMutate, isPending: false }),
  useCompletePacking: () => ({ mutate: completePackMutate, isPending: false }),
  useUndoPick: () => ({ mutate: undoMutate, isPending: false }),
  useUndoPack: () => ({ mutate: vi.fn(), isPending: false }),
  usePackingSlipData: () => ({ isLoading: true }),
  useShippingLabelData: () => ({ isLoading: true }),
}));

import { FulfillmentConsole } from "./fulfillment-console";

let clock = 0;
let nowSpy: MockInstance<() => number>;

beforeEach(() => {
  [push, scanMutate, undoMutate, completeMutate, packScanMutate, completePackMutate, refetch, toast.success, toast.error].forEach((m) =>
    m.mockReset(),
  );
  detail = makeDetail();
  clock = 1_700_000_000_000;
  nowSpy = vi.spyOn(Date, "now").mockImplementation(() => clock);
});
afterEach(() => nowSpy.mockRestore());

const scanInput = () => screen.getByLabelText("Barcode scan input");
async function scan(user: ReturnType<typeof userEvent.setup>, code = "885000000009") {
  clock += DEFAULT_SCANNER_TIMING.dedupeMs + 1_000;
  await user.click(scanInput());
  await user.type(scanInput(), `${code}{Enter}`);
}

const ok = (picked: string) => ({
  sales_order_id: 7,
  so_number: "SO-000007",
  status: "PICKING",
  allocation_id: 8,
  quantity: "2.000",
  picked_quantity: picked,
  packed_quantity: "0.000",
});

/** no response reached the browser — the backend may still be processing */
const lost = () => ApiError.network(new TypeError("fetch failed"));
/** a backend-produced failure: carries the backend's X-Request-ID, so that request has finished */
const backend500 = (rid = "req-500") => new ApiError({ status: 500, message: "Internal server error", requestId: rid });

/** a refetch the test resolves by hand */
function deferredRefetch() {
  let resolve!: (r: { isSuccess: boolean; data?: unknown }) => void;
  refetch.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
  return (r: { isSuccess: boolean; data?: unknown }) => act(async () => resolve(r));
}

const undoButton = () => screen.getByRole("button", { name: /undo one/i });
const completeButton = (name = "Complete picking") => screen.getByRole("button", { name });
const refreshButton = () => screen.getByRole("button", { name: /refresh progress/i });

/** every fulfilment mutation entry point refuses */
async function expectAllMutationsBlocked(user: ReturnType<typeof userEvent.setup>, completeName = "Complete picking") {
  const before = { scan: scanMutate.mock.calls.length, undo: undoMutate.mock.calls.length, complete: completeMutate.mock.calls.length };
  // barcode field + its Enter button
  expect(scanInput()).toBeDisabled();
  expect(screen.getByRole("button", { name: "Enter" })).toBeDisabled();
  await user.type(scanInput(), "885000000009{Enter}");
  // camera decode (bypasses the field) — the handler must refuse
  clock += DEFAULT_SCANNER_TIMING.dedupeMs + 1_000;
  await user.click(screen.getByRole("button", { name: "fake camera decode" }));
  // undo + complete
  expect(undoButton()).toBeDisabled();
  await user.click(undoButton());
  expect(completeButton(completeName)).toBeDisabled();
  await user.click(completeButton(completeName));
  expect(scanMutate.mock.calls.length).toBe(before.scan);
  expect(undoMutate.mock.calls.length).toBe(before.undo);
  expect(completeMutate.mock.calls.length).toBe(before.complete);
}

describe("Case A — uncertain scan, automatic GET fails: everything stays locked", () => {
  it("keeps the warning, blocks scan / camera / undo / complete, and offers a read-only refresh", async () => {
    const user = userEvent.setup();
    detail = makeDetail("1.000"); // something to undo
    scanMutate.mockImplementationOnce((_a, opts) => {
      opts.onError(lost());
      opts.onSettled?.();
    });
    refetch.mockResolvedValueOnce({ isSuccess: false, data: undefined });
    render(<FulfillmentConsole orderId={7} mode="pick" />);
    await scan(user);

    expect(await screen.findByText("Couldn't refresh progress")).toBeInTheDocument();
    expect(screen.getByText(/result of this scan is unknown/i)).toBeInTheDocument();
    expect(screen.queryByText(/nothing was counted/i)).not.toBeInTheDocument();
    expect(refreshButton()).toBeEnabled();
    await expectAllMutationsBlocked(user);
    expect(scanMutate).toHaveBeenCalledTimes(1); // the original scan only — never repeated
  });

  it("a refresh that throws is a failed refresh — still locked", async () => {
    const user = userEvent.setup();
    scanMutate.mockImplementationOnce((_a, opts) => opts.onError(backend500()));
    refetch.mockRejectedValueOnce(new Error("boom"));
    render(<FulfillmentConsole orderId={7} mode="pick" />);
    await scan(user);
    expect(await screen.findByText("Couldn't refresh progress")).toBeInTheDocument();
    expect(scanInput()).toBeDisabled();
    expect(scanMutate).toHaveBeenCalledTimes(1);
  });
});

describe("Case B — manual refresh that still fails", () => {
  it("sends only the GET, keeps the warning and the lock, however often it fails", async () => {
    const user = userEvent.setup();
    detail = makeDetail("1.000");
    scanMutate.mockImplementationOnce((_a, opts) => opts.onError(backend500()));
    refetch.mockResolvedValue({ isSuccess: false, data: undefined });
    render(<FulfillmentConsole orderId={7} mode="pick" />);
    await scan(user);
    expect(await screen.findByText("Couldn't refresh progress")).toBeInTheDocument();

    for (let i = 0; i < 3; i++) {
      await user.click(refreshButton());
      await waitFor(() => expect(refetch).toHaveBeenCalledTimes(2 + i));
      expect(await screen.findByText("Couldn't refresh progress")).toBeInTheDocument();
    }
    expect(scanMutate).toHaveBeenCalledTimes(1);
    expect(undoMutate).not.toHaveBeenCalled();
    await expectAllMutationsBlocked(user);
  });
});

describe("Case C — reconciliation", () => {
  it("a backend-produced failure (request id) + a validated GET: server progress shown, lock lifted, normal work resumes", async () => {
    const user = userEvent.setup();
    scanMutate
      .mockImplementationOnce((_a, opts) => opts.onSuccess(ok("1.000")))
      .mockImplementationOnce((_a, opts) => opts.onError(backend500()));
    const settle = deferredRefetch();
    render(<FulfillmentConsole orderId={7} mode="pick" />);
    await scan(user);
    expect(await screen.findByText("✓ Picked +1.000 / 2.000")).toBeInTheDocument();
    await scan(user);
    expect(await screen.findByText(/result of this scan is unknown/i)).toBeInTheDocument();
    expect(scanInput()).toBeDisabled(); // pending: locked

    // the server says the uncertain scan DID count
    detail = makeDetail("2.000");
    await settle({ isSuccess: true, data: detail });
    expect(await screen.findByText("Progress refreshed from the server")).toBeInTheDocument();
    expect(scanInput()).toBeEnabled();
    expect(completeButton()).toBeEnabled(); // the server's 2.000 / 2.000 wins over the older local 1.000

    // normal operation afterwards
    completeMutate.mockImplementationOnce((_a, opts) => opts.onSuccess({ so_number: "SO-000007" }));
    await user.click(completeButton());
    expect(completeMutate).toHaveBeenCalledTimes(1);
    expect(scanMutate).toHaveBeenCalledTimes(2);
  });

  it("a lost response (no request id) + a successful GET: progress refreshed but the lock STAYS — the request may still commit", async () => {
    const user = userEvent.setup();
    detail = makeDetail("1.000");
    scanMutate.mockImplementationOnce((_a, opts) => opts.onError(lost()));
    refetch.mockResolvedValue({ isSuccess: true, data: makeDetail("1.000") });
    render(<FulfillmentConsole orderId={7} mode="pick" />);
    await scan(user);

    expect(await screen.findByText("Progress refreshed from the server")).toBeInTheDocument();
    expect(screen.getByText(/may or may not have been recorded/i)).toBeInTheDocument();
    await expectAllMutationsBlocked(user);
    // repeated successful GETs cannot prove it either
    await user.click(refreshButton());
    await waitFor(() => expect(refetch).toHaveBeenCalledTimes(2));
    expect(screen.getByText(/may or may not have been recorded/i)).toBeInTheDocument();
    expect(scanInput()).toBeDisabled();
    expect(scanMutate).toHaveBeenCalledTimes(1);
  });

  it("an uncertain undo (lost response) is not repeated and locks the console", async () => {
    const user = userEvent.setup();
    detail = makeDetail("1.000");
    undoMutate.mockImplementationOnce((_a, opts) => opts.onError(lost()));
    refetch.mockResolvedValue({ isSuccess: true, data: detail });
    render(<FulfillmentConsole orderId={7} mode="pick" />);
    await user.click(undoButton());
    await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1));
    expect(toast.error).toHaveBeenCalledWith("Undo picked failed", {
      description: expect.stringMatching(/result of this undo is unknown/i),
    });
    expect(await screen.findByText("Progress refreshed from the server")).toBeInTheDocument();
    await expectAllMutationsBlocked(user);
    expect(undoMutate).toHaveBeenCalledTimes(1);
  });
});

describe("Case D — stale and overlapping responses", () => {
  /** an undo whose response the test delivers later (in flight when the lock engages) */
  function inFlightUndo() {
    let opts!: { onSuccess: (d: unknown) => void; onError: (e: unknown) => void; onSettled?: () => void };
    undoMutate.mockImplementationOnce((_a, o) => (opts = o));
    return () => opts;
  }

  it("an older GET's success cannot unlock after a newer, unprovable failure", async () => {
    const user = userEvent.setup();
    detail = makeDetail("1.000");
    const undo = inFlightUndo();
    scanMutate.mockImplementationOnce((_a, opts) => opts.onError(backend500()));
    const settleA = deferredRefetch();
    const settleB = deferredRefetch();
    render(<FulfillmentConsole orderId={7} mode="pick" />);
    await user.click(undoButton()); // in flight
    await scan(user); // backend 500 → lock, GET A
    await act(async () => undo().onError(lost())); // the earlier undo's response is lost → GET B

    await settleA({ isSuccess: true, data: makeDetail("1.000") }); // stale: superseded by B
    expect(scanInput()).toBeDisabled();
    await settleB({ isSuccess: false });
    expect(await screen.findByText("Couldn't refresh progress")).toBeInTheDocument();

    refetch.mockResolvedValueOnce({ isSuccess: true, data: makeDetail("1.000") });
    await user.click(refreshButton());
    // the lost undo can't be proven settled by any GET
    expect(await screen.findByText(/may or may not have been recorded/i)).toBeInTheDocument();
    await expectAllMutationsBlocked(user);
  });

  it("an older GET's failure cannot re-lock a state a newer GET resolved", async () => {
    const user = userEvent.setup();
    detail = makeDetail("1.000");
    const undo = inFlightUndo();
    scanMutate.mockImplementationOnce((_a, opts) => opts.onError(backend500("req-a")));
    const settleA = deferredRefetch();
    const settleB = deferredRefetch();
    render(<FulfillmentConsole orderId={7} mode="pick" />);
    await user.click(undoButton());
    await scan(user); // GET A
    await act(async () => undo().onError(backend500("req-b"))); // GET B (both backend-settled)

    await settleB({ isSuccess: true, data: makeDetail("1.000") });
    expect(await screen.findByText("Progress refreshed from the server")).toBeInTheDocument();
    expect(scanInput()).toBeEnabled();
    await settleA({ isSuccess: false }); // older, superseded
    expect(screen.queryByText("Couldn't refresh progress")).not.toBeInTheDocument();
    expect(scanInput()).toBeEnabled();
  });

  it("a late mutation failure after reconciliation locks again — the UI is never left falsely reconciled", async () => {
    const user = userEvent.setup();
    detail = makeDetail("1.000");
    const undo = inFlightUndo();
    scanMutate.mockImplementationOnce((_a, opts) => opts.onError(backend500()));
    refetch.mockResolvedValueOnce({ isSuccess: true, data: makeDetail("1.000") });
    render(<FulfillmentConsole orderId={7} mode="pick" />);
    await user.click(undoButton());
    await scan(user);
    expect(await screen.findByText("Progress refreshed from the server")).toBeInTheDocument();
    expect(scanInput()).toBeEnabled();

    refetch.mockResolvedValueOnce({ isSuccess: false });
    await act(async () => undo().onError(lost())); // the late undo response
    expect(await screen.findByText("Couldn't refresh progress")).toBeInTheDocument();
    await expectAllMutationsBlocked(user);
  });
});

describe("Case E — every mutation entry point", () => {
  it("an allocation choice that would send a scan is refused while locked", async () => {
    const user = userEvent.setup();
    scanMutate
      .mockImplementationOnce((_a, opts) => opts.onError(new ApiError({ status: 409, message: "ALLOCATION_IDENTIFICATION_REQUIRED" })))
      .mockImplementationOnce((_a, opts) => opts.onError(lost()));
    refetch.mockResolvedValue({ isSuccess: false });
    render(<FulfillmentConsole orderId={7} mode="pick" />);
    await scan(user); // → picker opens (definitive, nothing counted)
    const choose = await screen.findByRole("button", { name: "fake choose allocation" });
    clock += DEFAULT_SCANNER_TIMING.dedupeMs + 1_000;
    await user.click(screen.getByRole("button", { name: "fake camera decode" })); // lost → lock
    expect(await screen.findByText("Couldn't refresh progress")).toBeInTheDocument();
    fireEvent.click(choose);
    expect(scanMutate).toHaveBeenCalledTimes(2); // the choice sent nothing
  });

  it("pack mode: scan and Complete packing are locked too", async () => {
    const user = userEvent.setup();
    detail = makeDetail("2.000", "PACKING", "2.000"); // fully packed: Complete packing would be enabled
    packScanMutate.mockImplementationOnce((_a, opts) => opts.onError(lost()));
    refetch.mockResolvedValue({ isSuccess: false });
    render(<FulfillmentConsole orderId={7} mode="pack" />);
    expect(completeButton("Complete packing")).toBeEnabled();
    clock += DEFAULT_SCANNER_TIMING.dedupeMs + 1_000;
    await user.click(screen.getByRole("button", { name: "fake camera decode" }));
    expect(await screen.findByText("Couldn't refresh progress")).toBeInTheDocument();
    expect(completeButton("Complete packing")).toBeDisabled();
    await user.click(completeButton("Complete packing"));
    clock += DEFAULT_SCANNER_TIMING.dedupeMs + 1_000;
    await user.click(screen.getByRole("button", { name: "fake camera decode" }));
    expect(completePackMutate).not.toHaveBeenCalled();
    expect(packScanMutate).toHaveBeenCalledTimes(1);
  });
});

describe("Case F — normal operation is unchanged", () => {
  it("successful scans and undo: no refresh GET, one request each, no lock", async () => {
    const user = userEvent.setup();
    scanMutate.mockImplementation((_a, opts) => opts.onSuccess(ok("1.000")));
    undoMutate.mockImplementation((_a, opts) => opts.onSuccess(ok("0.000")));
    render(<FulfillmentConsole orderId={7} mode="pick" />);
    await scan(user);
    expect(await screen.findByText("✓ Picked +1.000 / 2.000")).toBeInTheDocument();
    await user.click(undoButton());
    expect(await screen.findByText(/↶ Picked undone · now 0\.000 \/ 2\.000/)).toBeInTheDocument();
    expect(scanMutate).toHaveBeenCalledTimes(1);
    expect(undoMutate).toHaveBeenCalledTimes(1);
    expect(refetch).not.toHaveBeenCalled();
    expect(scanInput()).toBeEnabled();
  });

  it("a verified rejection keeps its definitive copy, does not refresh and does not lock", async () => {
    const user = userEvent.setup();
    scanMutate.mockImplementation((_a, opts) =>
      opts.onError(new ApiError({ status: 409, message: "PRODUCT_NOT_IN_ORDER", requestId: "req-77" })),
    );
    render(<FulfillmentConsole orderId={7} mode="pick" />);
    await scan(user);
    expect(await screen.findByText(/isn.t on this order.*Request req-77/i)).toBeInTheDocument();
    expect(refetch).not.toHaveBeenCalled();
    expect(scanInput()).toBeEnabled();
  });

  it("the scanner dedupe window still collapses a repeat of the same code into one request", async () => {
    const user = userEvent.setup();
    scanMutate.mockImplementation((_a, opts) => opts.onSuccess(ok("1.000")));
    render(<FulfillmentConsole orderId={7} mode="pick" />);
    await scan(user);
    await user.type(scanInput(), "885000000009{Enter}"); // same code, clock not advanced
    expect(scanMutate).toHaveBeenCalledTimes(1);
  });
});
