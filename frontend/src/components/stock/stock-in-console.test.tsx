import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { DEFAULT_SCANNER_TIMING } from "@/components/work/use-scanner";
import { ApiError } from "@/lib/api/errors";

/* ------------------------------- mocks -------------------------------- */

const push = vi.fn();
let searchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => searchParams,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/components/work/camera-barcode-scanner", () => ({ CameraBarcodeScanner: () => null }));
vi.mock("@/components/work/use-beep", () => ({
  useBeep: () => ({
    enabled: false,
    setEnabled: vi.fn(),
    tone: vi.fn(),
    beepOk: vi.fn(),
    beepBad: vi.fn(),
    beepDone: vi.fn(),
  }),
}));

const NON_BATCH = {
  id: 5,
  sku: "WH-SALT",
  product_name: "Sea Salt 500g",
  is_active: true,
  track_batch: false,
  track_expiry: false,
  barcode: "880000000005",
};
const BATCH = {
  id: 6,
  sku: "WH-LOT",
  product_name: "Lot Widget",
  is_active: true,
  track_batch: true,
  track_expiry: false,
  barcode: "880000000006",
};

const DATED = {
  id: 7,
  sku: "WH-DATED",
  product_name: "Dated Widget",
  is_active: true,
  track_batch: true,
  track_expiry: true,
  barcode: "880000000007",
};

const resolveBarcode = vi.fn();
vi.mock("@/lib/query/sales", () => ({ resolveBarcode: (...a: unknown[]) => resolveBarcode(...a) }));

// R4.3: the review's before → after estimate reads the MAIN / DEFAULT balance
const MAIN_BALANCE = {
  id: 1, product_id: 5, warehouse_id: 1, location_id: 11, batch_id: null, batch_lot_no: null,
  on_hand_qty: "10.000", reserved_qty: "0.000", available_qty: "10.000", is_transit: false,
  batch_expiry_date: null, days_to_expiry: null, is_expired: false, as_of_date: "2026-10-17",
};
vi.mock("@/lib/query/warehouses", () => ({
  useWarehouses: () => ({
    data: [{ id: 1, warehouse_code: "MAIN", locations: [{ id: 11, location_code: "DEFAULT" }] }],
    isError: false,
  }),
}));
vi.mock("@/lib/query/hooks", () => ({
  useAllProductStock: () => ({ data: { items: [MAIN_BALANCE] }, isLoading: false, isError: false }),
  useProducts: () => ({ data: { items: [NON_BATCH, BATCH, DATED] }, isFetching: false }),
}));

let preselectData: unknown = undefined;
vi.mock("@/lib/query/products", () => ({
  useProduct: () => ({ data: preselectData }),
}));

const saveMutate = vi.fn();
let saveState = { isPending: false, isError: false, error: null as unknown, reset: vi.fn() };
vi.mock("@/lib/query/stock", () => ({
  useSaveStockInSession: () => ({ mutate: saveMutate, ...saveState }),
}));

import { StockInConsole } from "./stock-in-console";

/* R4 review before commit (D-R4-4): Save is now Review, then an explicit Confirm. */
const reviewButton = (n?: number) =>
  screen.getByRole("button", { name: n === undefined ? /review stock in/i : new RegExp(`review stock in \\(${n}\\)`, "i") });
/** open the review (unless a failed confirm left it open) and confirm — the existing save */
async function reviewAndConfirm(user: ReturnType<typeof userEvent.setup>) {
  if (!screen.queryByRole("dialog")) await user.click(reviewButton());
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: /^confirm /i }));
}
import { LanguageProvider } from "@/lib/i18n/client";
import { LanguageSwitch } from "@/components/shell/language-switch";

/* ------------------------------- helpers ----------------------------- */

async function pick(user: ReturnType<typeof userEvent.setup>, name: RegExp) {
  await user.click(screen.getByRole("combobox", { name: /search products/i }));
  const option = await screen.findByRole("option", { name });
  await user.click(within(option).getByRole("button"));
}

async function startScanning(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /start scanning/i }));
}

/*
 * Deterministic scanner clock. useScanner ignores a repeat of the same code
 * inside DEFAULT_SCANNER_TIMING.dedupeMs, measured with Date.now(). On a fast
 * runner two back-to-back scans of the same barcode can land inside that
 * window, so a deliberate second scan was silently de-duplicated (a CI-only
 * failure). Date.now() is pinned per test and only moves when a test says so.
 */
let clock = 0;
let nowSpy: MockInstance<() => number>;

/** A deliberate new scan: step the clock well past the dedupe window first. */
async function scan(user: ReturnType<typeof userEvent.setup>, code: string) {
  clock += DEFAULT_SCANNER_TIMING.dedupeMs + 1_000;
  await typeScan(user, code);
}

/** Type a scan at the current clock (no time passes — used for bounce tests). */
async function typeScan(user: ReturnType<typeof userEvent.setup>, code: string) {
  const input = screen.getByLabelText("Barcode scan input");
  await user.click(input);
  await user.type(input, `${code}{Enter}`);
}

function resolvesTo(product: { id: number; product_name: string }) {
  resolveBarcode.mockResolvedValueOnce({ product, batches: [], barcode: "x", context: "stock_in" });
}

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks keeps queued mockResolvedValueOnce values; a response queued
  // for a scan that never reached the backend must not leak into the next test.
  resolveBarcode.mockReset();
  clock = 1_700_000_000_000;
  nowSpy = vi.spyOn(Date, "now").mockImplementation(() => clock);
  try {
    window.sessionStorage.clear();
  } catch {
    /* ignore */
  }
  saveState = { isPending: false, isError: false, error: null, reset: vi.fn() };
  searchParams = new URLSearchParams();
  preselectData = undefined;
});

afterEach(() => {
  nowSpy.mockRestore();
});

/* ------------------------------- tests ------------------------------- */

describe("StockInConsole — setup", () => {
  it("requires a product before scanning can start", async () => {
    const user = userEvent.setup();
    render(<StockInConsole />);
    expect(screen.queryByRole("button", { name: /start scanning/i })).not.toBeInTheDocument();
    await pick(user, /Sea Salt 500g/);
    expect(screen.getByRole("button", { name: /start scanning/i })).toBeEnabled();
  });

  it("keeps scanning disabled for a batch product until a lot number is entered", async () => {
    const user = userEvent.setup();
    render(<StockInConsole />);
    await pick(user, /Lot Widget/);
    expect(screen.getByRole("button", { name: /start scanning/i })).toBeDisabled();
    await user.type(screen.getByPlaceholderText("LOT-…"), "LOT-A");
    expect(screen.getByRole("button", { name: /start scanning/i })).toBeEnabled();
  });
});

describe("StockInConsole — scan session", () => {
  it("a matched scan increments the local count and moves no stock", async () => {
    const user = userEvent.setup();
    render(<StockInConsole />);
    await pick(user, /Sea Salt 500g/);
    await startScanning(user);

    resolvesTo({ id: 5, product_name: "Sea Salt 500g" });
    await scan(user, "880000000005");

    expect(await screen.findByText(/Matched — scanned 1/i)).toBeInTheDocument();
    expect(screen.getByText("1", { selector: "span.font-bold" })).toBeInTheDocument();
    expect(saveMutate).not.toHaveBeenCalled();
  });

  it("a wrong registered product does not change the count", async () => {
    const user = userEvent.setup();
    render(<StockInConsole />);
    await pick(user, /Sea Salt 500g/);
    await startScanning(user);

    resolvesTo({ id: 99, product_name: "Something Else" });
    await scan(user, "889999999999");

    expect(await screen.findByText(/Wrong product/i)).toBeInTheDocument();
    expect(screen.getByText("0", { selector: "span.font-bold" })).toBeInTheDocument();
    expect(saveMutate).not.toHaveBeenCalled();
  });

  it("an unknown barcode does not change the count", async () => {
    const user = userEvent.setup();
    render(<StockInConsole />);
    await pick(user, /Sea Salt 500g/);
    await startScanning(user);

    resolveBarcode.mockRejectedValueOnce(new ApiError({ status: 404, message: "Product not found" }));
    await scan(user, "870000000000");

    expect(await screen.findByText(/product not registered/i)).toBeInTheDocument();
    expect(screen.getByText("0", { selector: "span.font-bold" })).toBeInTheDocument();
  });

  it("Undo last scan decrements the local count only", async () => {
    const user = userEvent.setup();
    render(<StockInConsole />);
    await pick(user, /Sea Salt 500g/);
    await startScanning(user);

    resolvesTo({ id: 5, product_name: "Sea Salt 500g" });
    await scan(user, "880000000005");
    expect(await screen.findByText(/Matched — scanned 1/i)).toBeInTheDocument();
    resolvesTo({ id: 5, product_name: "Sea Salt 500g" });
    await scan(user, "880000000005");
    expect(await screen.findByText(/Matched — scanned 2/i)).toBeInTheDocument();
    expect(resolveBarcode).toHaveBeenCalledTimes(2);
    expect(screen.getByText("2", { selector: "span.font-bold" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /undo last scan/i }));
    expect(screen.getByText("1", { selector: "span.font-bold" })).toBeInTheDocument();
    expect(screen.getByText(/↶ .* undo −1/)).toBeInTheDocument();
    expect(saveMutate).not.toHaveBeenCalled();
  });

  it("warns when the count goes over an expected quantity but still allows Save", async () => {
    const user = userEvent.setup();
    render(<StockInConsole />);
    await pick(user, /Sea Salt 500g/);
    await user.type(screen.getByPlaceholderText("0.000"), "1");
    await startScanning(user);

    resolvesTo({ id: 5, product_name: "Sea Salt 500g" });
    await scan(user, "880000000005");
    expect(await screen.findByText(/Matched — scanned 1/i)).toBeInTheDocument();
    resolvesTo({ id: 5, product_name: "Sea Salt 500g" });
    await scan(user, "880000000005");
    expect(await screen.findByText(/Matched — scanned 2/i)).toBeInTheDocument();

    expect(await screen.findByText(/Over expected quantity/i)).toBeInTheDocument();
    expect(reviewButton(2)).toBeEnabled();
  });

  it("ignores a bounced repeat of the same barcode inside the dedupe window", async () => {
    const user = userEvent.setup();
    render(<StockInConsole />);
    await pick(user, /Sea Salt 500g/);
    await startScanning(user);

    resolvesTo({ id: 5, product_name: "Sea Salt 500g" });
    await scan(user, "880000000005");
    expect(await screen.findByText(/Matched — scanned 1/i)).toBeInTheDocument();

    clock += DEFAULT_SCANNER_TIMING.dedupeMs - 1; // still inside the window
    await typeScan(user, "880000000005");

    expect(resolveBarcode).toHaveBeenCalledTimes(1);
    expect(screen.getByText("1", { selector: "span.font-bold" })).toBeInTheDocument();
  });

  it("counts a repeat of the same barcode once the dedupe window has passed", async () => {
    const user = userEvent.setup();
    render(<StockInConsole />);
    await pick(user, /Sea Salt 500g/);
    await startScanning(user);

    resolvesTo({ id: 5, product_name: "Sea Salt 500g" });
    await scan(user, "880000000005");
    expect(await screen.findByText(/Matched — scanned 1/i)).toBeInTheDocument();

    clock += DEFAULT_SCANNER_TIMING.dedupeMs; // exactly at the edge: a new scan
    resolvesTo({ id: 5, product_name: "Sea Salt 500g" });
    await typeScan(user, "880000000005");

    expect(await screen.findByText(/Matched — scanned 2/i)).toBeInTheDocument();
    expect(resolveBarcode).toHaveBeenCalledTimes(2);
    expect(screen.getByText("2", { selector: "span.font-bold" })).toBeInTheDocument();
  });
});

describe("StockInConsole — save-once", () => {
  async function toCountOne(user: ReturnType<typeof userEvent.setup>) {
    render(<StockInConsole />);
    await pick(user, /Sea Salt 500g/);
    await startScanning(user);
    resolvesTo({ id: 5, product_name: "Sea Salt 500g" });
    await scan(user, "880000000005");
  }

  it("Save sends exactly one mutation with an accumulated quantity + idempotency key", async () => {
    const user = userEvent.setup();
    await toCountOne(user);

    await reviewAndConfirm(user);
    expect(saveMutate).toHaveBeenCalledTimes(1);
    const [args] = saveMutate.mock.calls[0];
    expect(args.body).toEqual({ endpoint: "stock/in", json: { product_id: 5, quantity: "1" } });
    expect(typeof args.idempotencyKey).toBe("string");
    expect(args.idempotencyKey.length).toBeGreaterThan(8);
  });

  it("shows the success panel only after the backend response", async () => {
    const user = userEvent.setup();
    saveMutate.mockImplementation((_a, opts) =>
      opts.onSuccess({ productId: 5, productName: "Sea Salt 500g", savedQuantity: "1.000", currentStock: "9.000", lotNo: null }),
    );
    await toCountOne(user);
    await reviewAndConfirm(user);

    expect(await screen.findByText("Stock saved")).toBeInTheDocument();
    expect(screen.getByText(/On hand/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /scan next product/i })).toBeInTheDocument();
  });

  it("reuses the same idempotency key when a failed Save is retried", async () => {
    const user = userEvent.setup();
    saveMutate.mockImplementation((_a, opts) =>
      opts.onError(new ApiError({ status: 500, message: "boom", requestId: "req-1" })),
    );
    await toCountOne(user);

    await reviewAndConfirm(user);
    await reviewAndConfirm(user);

    expect(saveMutate).toHaveBeenCalledTimes(2);
    const k1 = saveMutate.mock.calls[0][0].idempotencyKey;
    const k2 = saveMutate.mock.calls[1][0].idempotencyKey;
    expect(k1).toBe(k2);
    // session preserved: still on the scan screen with the count intact
    expect(screen.getByText("1", { selector: "span.font-bold" })).toBeInTheDocument();
  });

  it("forces a new session on an idempotency-mismatch 409 (no silent new key)", async () => {
    const user = userEvent.setup();
    saveMutate.mockImplementation((_a, opts) =>
      opts.onError(
        new ApiError({ status: 409, message: "Idempotency-Key already used with a different payload", requestId: "req-2" }),
      ),
    );
    await toCountOne(user);
    await reviewAndConfirm(user);

    expect(await screen.findByText(/can no longer be saved/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /start new stock-in session/i })).toBeInTheDocument();
    // Save is blocked until a new session is started
    expect(reviewButton(1)).toBeDisabled();
  });
});

describe("StockInConsole — deep-link preselect (?product=)", () => {
  it("preselects the product named by ?product= without starting a scan session", async () => {
    searchParams = new URLSearchParams("product=5");
    preselectData = { id: 5, sku: "WH-SALT", product_name: "Sea Salt 500g", track_batch: false, track_expiry: false };

    render(<StockInConsole />);

    // Product is selected (combobox switches from search input to a value
    // button) but scanning has not begun — the operator still confirms
    // "Start scanning" explicitly.
    // R4: the product also appears in the "Selected item" side card
    expect((await screen.findAllByText("Sea Salt 500g")).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /start scanning/i })).toBeEnabled();
    expect(screen.queryByLabelText("Barcode scan input")).not.toBeInTheDocument();
  });

  it("ignores a missing/invalid ?product= (falls back to manual picker)", async () => {
    searchParams = new URLSearchParams("product=not-a-number");
    render(<StockInConsole />);
    expect(screen.queryByRole("button", { name: /start scanning/i })).not.toBeInTheDocument();
  });
});

/* ------------------- R3.0 characterization (pre-refactor) ------------------- */

describe("StockInConsole — characterization (R3.0)", () => {

  async function countScans(user: ReturnType<typeof userEvent.setup>, product: { id: number; product_name: string }, n: number) {
    for (let i = 1; i <= n; i++) {
      resolvesTo(product);
      await scan(user, "88000000000x");
      expect(await screen.findByText(new RegExp(`Matched — scanned ${i}`, "i"))).toBeInTheDocument();
    }
  }

  it("non-batch body: the integer scan count as a plain string, trimmed remark, expected never sent", async () => {
    const user = userEvent.setup();
    render(<StockInConsole />);
    await pick(user, /Sea Salt 500g/);
    await user.type(screen.getByPlaceholderText("0.000"), "5");
    await user.type(screen.getByPlaceholderText("e.g. opening count"), "  opening  ");
    await startScanning(user);
    await countScans(user, { id: 5, product_name: "Sea Salt 500g" }, 3);
    await reviewAndConfirm(user);
    expect(saveMutate).toHaveBeenCalledTimes(1);
    expect(saveMutate.mock.calls[0][0]).toEqual({
      body: { endpoint: "stock/in", json: { product_id: 5, quantity: "3", remark: "opening" } },
      idempotencyKey: expect.stringMatching(/^stockin-/),
    });
  });

  it("batch body: POST batches with the trimmed lot and no dates for a batch-only product", async () => {
    const user = userEvent.setup();
    render(<StockInConsole />);
    await pick(user, /Lot Widget/);
    await user.type(screen.getByPlaceholderText("LOT-…"), "  LOT-A  ");
    await startScanning(user);
    await countScans(user, { id: 6, product_name: "Lot Widget" }, 1);
    await reviewAndConfirm(user);
    expect(saveMutate.mock.calls[0][0].body).toEqual({
      endpoint: "batches",
      json: { product_id: 6, lot_no: "LOT-A", quantity: "1" },
    });
  });

  it("batch + expiry body carries both dates; an already-expired lot is flagged but not blocked", async () => {
    const user = userEvent.setup();
    render(<StockInConsole />);
    await pick(user, /Dated Widget/);
    expect(screen.getByRole("button", { name: /start scanning/i })).toBeDisabled(); // lot + dates required
    await user.type(screen.getByPlaceholderText("LOT-…"), "LOT-OLD");
    fireEvent.change(screen.getByLabelText("Manufacturing date"), { target: { value: "2000-01-01" } });
    fireEvent.change(screen.getByLabelText("Expiry date"), { target: { value: "2000-01-02" } });
    expect(screen.getByText(/accepted, not blocked/i)).toBeInTheDocument();
    await startScanning(user);
    await countScans(user, { id: 7, product_name: "Dated Widget" }, 1);
    await reviewAndConfirm(user);
    expect(saveMutate.mock.calls[0][0].body).toEqual({
      endpoint: "batches",
      json: { product_id: 7, lot_no: "LOT-OLD", quantity: "1", mfg_date: "2000-01-01", expiry_date: "2000-01-02" },
    });
  });

  it("an expected quantity with more than 3 decimals keeps Start scanning disabled", async () => {
    const user = userEvent.setup();
    render(<StockInConsole />);
    await pick(user, /Sea Salt 500g/);
    await user.type(screen.getByPlaceholderText("0.000"), "1.2345");
    expect(screen.getByRole("button", { name: /start scanning/i })).toBeDisabled();
  });

  it("reload (unmount + remount) keeps the scanning session, count and the SAME key for an unresolved Save", async () => {
    const user = userEvent.setup();
    saveMutate.mockImplementation((_a, opts) => opts.onError(new ApiError({ status: 503, message: "down", requestId: "r" })));
    const first = render(<StockInConsole />);
    await pick(user, /Sea Salt 500g/);
    await startScanning(user);
    await countScans(user, { id: 5, product_name: "Sea Salt 500g" }, 2);
    await reviewAndConfirm(user);
    const k1 = saveMutate.mock.calls[0][0].idempotencyKey;
    first.unmount();

    render(<StockInConsole />);
    expect(screen.getByLabelText("Barcode scan input")).toBeInTheDocument(); // still scanning
    expect(screen.getByText("2", { selector: "span.font-bold" })).toBeInTheDocument();
    await reviewAndConfirm(user);
    expect(saveMutate).toHaveBeenCalledTimes(2);
    expect(saveMutate.mock.calls[1][0]).toEqual(saveMutate.mock.calls[0][0]);
    expect(saveMutate.mock.calls[1][0].idempotencyKey).toBe(k1);
  });

  it("Save is disabled and inert while a save is pending (restored draft)", async () => {
    const user = userEvent.setup();
    const first = render(<StockInConsole />);
    await pick(user, /Sea Salt 500g/);
    await startScanning(user);
    await countScans(user, { id: 5, product_name: "Sea Salt 500g" }, 1);
    first.unmount();

    saveState = { ...saveState, isPending: true };
    render(<StockInConsole />);
    const button = screen.getByRole("button", { name: /saving…/i });
    expect(button).toBeDisabled();
    await user.click(button);
    expect(saveMutate).not.toHaveBeenCalled();
  });

  it("a non-mismatch 409 keeps the session and key (toast only), unlike the payload mismatch", async () => {
    const user = userEvent.setup();
    saveMutate.mockImplementation((_a, opts) => opts.onError(new ApiError({ status: 409, message: "Not enough stock", requestId: "r9" })));
    render(<StockInConsole />);
    await pick(user, /Sea Salt 500g/);
    await startScanning(user);
    await countScans(user, { id: 5, product_name: "Sea Salt 500g" }, 1);
    await reviewAndConfirm(user);
    expect(screen.queryByText(/can no longer be saved/i)).not.toBeInTheDocument();
    // R4: the failure is shown inside the open review sheet, whose Confirm retries with the same key
    expect(within(screen.getByRole("dialog")).getByRole("button", { name: /^confirm /i })).toBeEnabled();
  });

  it("the mismatch predicate is status 409 + /different payload/i (case-insensitive substring)", async () => {
    const user = userEvent.setup();
    saveMutate.mockImplementation((_a, opts) =>
      opts.onError(new ApiError({ status: 409, message: "key reused with a DIFFERENT PAYLOAD here", requestId: "r" })),
    );
    render(<StockInConsole />);
    await pick(user, /Sea Salt 500g/);
    await startScanning(user);
    await countScans(user, { id: 5, product_name: "Sea Salt 500g" }, 1);
    await reviewAndConfirm(user);
    expect(await screen.findByText(/can no longer be saved/i)).toBeInTheDocument();
  });

  it("the same message with a non-409 status is NOT treated as a mismatch", async () => {
    const user = userEvent.setup();
    saveMutate.mockImplementation((_a, opts) =>
      opts.onError(new ApiError({ status: 422, message: "Idempotency-Key already used with a different payload", requestId: "r" })),
    );
    render(<StockInConsole />);
    await pick(user, /Sea Salt 500g/);
    await startScanning(user);
    await countScans(user, { id: 5, product_name: "Sea Salt 500g" }, 1);
    await reviewAndConfirm(user);
    expect(screen.queryByText(/can no longer be saved/i)).not.toBeInTheDocument();
  });

  it("mismatch recovery: 'Start new stock-in session' clears the session and the next save uses a NEW key", async () => {
    const user = userEvent.setup();
    saveMutate.mockImplementationOnce((_a, opts) =>
      opts.onError(new ApiError({ status: 409, message: "Idempotency-Key already used with a different payload", requestId: "r" })),
    );
    render(<StockInConsole />);
    await pick(user, /Sea Salt 500g/);
    await startScanning(user);
    await countScans(user, { id: 5, product_name: "Sea Salt 500g" }, 1);
    await reviewAndConfirm(user);
    const k1 = saveMutate.mock.calls[0][0].idempotencyKey;
    await user.click(await screen.findByRole("button", { name: /start new stock-in session/i }));

    expect(screen.queryByLabelText("Barcode scan input")).not.toBeInTheDocument(); // back to setup, no product
    expect(screen.queryByRole("button", { name: /start scanning/i })).not.toBeInTheDocument();
    await pick(user, /Sea Salt 500g/);
    await startScanning(user);
    await countScans(user, { id: 5, product_name: "Sea Salt 500g" }, 1);
    await reviewAndConfirm(user);
    expect(saveMutate.mock.calls[1][0].idempotencyKey).not.toBe(k1);
  });

  it("success rotates the key: the next session's save uses a new key", async () => {
    const user = userEvent.setup();
    saveMutate.mockImplementation((_a, opts) =>
      opts.onSuccess({ productId: 5, productName: "Sea Salt 500g", savedQuantity: "1", currentStock: "2", lotNo: null }),
    );
    render(<StockInConsole />);
    await pick(user, /Sea Salt 500g/);
    await startScanning(user);
    await countScans(user, { id: 5, product_name: "Sea Salt 500g" }, 1);
    await reviewAndConfirm(user);
    const k1 = saveMutate.mock.calls[0][0].idempotencyKey;
    await user.click(screen.getByRole("button", { name: /scan next product/i }));
    await pick(user, /Sea Salt 500g/);
    await startScanning(user);
    await countScans(user, { id: 5, product_name: "Sea Salt 500g" }, 1);
    await reviewAndConfirm(user);
    expect(saveMutate.mock.calls[1][0].idempotencyKey).not.toBe(k1);
  });

  it("a language switch keeps the scanning session, count and key and sends no business request", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    try {
      render(
        <LanguageProvider initialLocale="en">
          <LanguageSwitch />
          <StockInConsole />
        </LanguageProvider>,
      );
      await pick(user, /Sea Salt 500g/);
      await startScanning(user);
      await countScans(user, { id: 5, product_name: "Sea Salt 500g" }, 2);
      const scanInput = screen.getByLabelText("Barcode scan input");
      await user.click(screen.getByRole("button", { name: "ไทย" }));
      await user.click(screen.getByRole("button", { name: "EN" }));
      expect(screen.getByLabelText("Barcode scan input")).toBe(scanInput); // not remounted
      expect(screen.getByText("2", { selector: "span.font-bold" })).toBeInTheDocument();
      expect(saveMutate).not.toHaveBeenCalled();
      expect(resolveBarcode).toHaveBeenCalledTimes(2);
      const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
      expect(fetchMock.mock.calls.every(([url]) => url === "/api/prefs/language")).toBe(true);
      saveMutate.mockImplementation(() => {});
      await reviewAndConfirm(user);
      expect(saveMutate.mock.calls[0][0].body).toEqual({ endpoint: "stock/in", json: { product_id: 5, quantity: "2" } });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("StockInConsole — characterization: resolve purpose (R3.0)", () => {
  it("scans resolve with the 'stock_in' purpose (read-only lookup, no stock moves)", async () => {
    const user = userEvent.setup();
    render(<StockInConsole />);
    await pick(user, /Sea Salt 500g/);
    await startScanning(user);
    resolvesTo({ id: 5, product_name: "Sea Salt 500g" });
    await scan(user, "880000000005");
    expect(await screen.findByText(/Matched — scanned 1/i)).toBeInTheDocument();
    expect(resolveBarcode).toHaveBeenCalledWith("880000000005", "stock_in");
  });
});

/* ------------------- R4 review before commit (D-R4-4) ------------------- */

describe("StockInConsole — R4 review before commit", () => {
  async function scanningWith(user: ReturnType<typeof userEvent.setup>, n: number) {
    render(<StockInConsole />);
    await pick(user, /Sea Salt 500g/);
    await startScanning(user);
    for (let i = 1; i <= n; i++) {
      resolvesTo({ id: 5, product_name: "Sea Salt 500g" });
      await scan(user, "880000000005");
      expect(await screen.findByText(new RegExp(`Matched — scanned ${i}`, "i"))).toBeInTheDocument();
    }
  }

  it("opening the review sends nothing and shows direction, signed quantity and the labelled estimate", async () => {
    const user = userEvent.setup();
    await scanningWith(user, 2);
    await user.click(reviewButton(2));
    const dialog = screen.getByRole("dialog", { name: "Confirm stock in" });
    expect(saveMutate).not.toHaveBeenCalled();
    expect(within(dialog).getByText("Adds stock")).toBeInTheDocument();
    expect(within(dialog).getByText("+2.000")).toBeInTheDocument();
    // MAIN/DEFAULT on hand 10.000 → 12.000, labelled an estimate
    expect(dialog.textContent).toMatch(/10\.000.*12\.000.*estimate/);
    expect(within(dialog).getByText(/retrying reuses the same request key/i)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Confirm +2.000" })).toBeInTheDocument();
  });

  it("Back to edit keeps the count and the key; the later confirm sends the same request", async () => {
    const user = userEvent.setup();
    await scanningWith(user, 1);
    const key = window.sessionStorage.getItem(
      `stock-in:session:${window.sessionStorage.getItem("stock-in:session:active")}`,
    );
    await user.click(reviewButton(1));
    await user.click(screen.getByRole("button", { name: "Back to edit" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("1", { selector: "span.font-bold" })).toBeInTheDocument();
    expect(saveMutate).not.toHaveBeenCalled();
    expect(
      window.sessionStorage.getItem(`stock-in:session:${window.sessionStorage.getItem("stock-in:session:active")}`),
    ).toBe(key);
    await reviewAndConfirm(user);
    expect(saveMutate).toHaveBeenCalledTimes(1);
    expect(saveMutate.mock.calls[0][0].idempotencyKey).toBe(JSON.parse(key!).idempotencyKey);
  });

  it("while the review is open a hardware scan neither counts nor confirms", async () => {
    const user = userEvent.setup();
    await scanningWith(user, 1);
    await user.click(reviewButton(1));
    clock += 5_000;
    await user.keyboard("880000000005{Enter}"); // a scanner wedge types into whatever has focus
    expect(resolveBarcode).toHaveBeenCalledTimes(1); // only the scan before the review
    expect(saveMutate).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("closing the review returns focus to the scan field", async () => {
    const user = userEvent.setup();
    await scanningWith(user, 1);
    await user.click(reviewButton(1));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByLabelText("Barcode scan input")).toHaveFocus();
  });

  it("a failed confirm keeps the sheet open with the error; confirming again reuses the key", async () => {
    const user = userEvent.setup();
    saveMutate.mockImplementationOnce((_a, opts) => opts.onError(new ApiError({ status: 503, message: "down", requestId: "r-1" })));
    await scanningWith(user, 1);
    await reviewAndConfirm(user);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/r-1/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Nothing was posted/)).toBeInTheDocument();
    await reviewAndConfirm(user);
    expect(saveMutate).toHaveBeenCalledTimes(2);
    expect(saveMutate.mock.calls[1][0]).toEqual(saveMutate.mock.calls[0][0]);
  });

  it("success closes the review and links to the ledger for the product (no invented reference)", async () => {
    const user = userEvent.setup();
    saveMutate.mockImplementation((_a, opts) =>
      opts.onSuccess({ productId: 5, productName: "Sea Salt 500g", savedQuantity: "1.000", currentStock: "11.000", lotNo: null }),
    );
    await scanningWith(user, 1);
    await reviewAndConfirm(user);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("link", { name: /view in ledger/i })).toHaveAttribute("href", "/inventory/ledger?product_id=5");
    expect(screen.queryByText(/ST-\d/)).toBeNull();
  });

  it("is translated: Thai step labels, review title and quantity wording", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    try {
      render(
        <LanguageProvider initialLocale="th">
          <StockInConsole />
        </LanguageProvider>,
      );
      expect(screen.getAllByText("รายละเอียด").length).toBeGreaterThan(0);
      expect(screen.getByText("เลือกสินค้าที่จะรับเข้าก่อนเริ่มสแกน")).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

/* --------------------- R4-TQ typed quantity + attempt lock --------------------- */

describe("StockInConsole — R4-TQ typed quantity and the attempt lock", () => {
  const modeRadio = (name: RegExp) => screen.getByRole("radio", { name });
  const qtyField = () => screen.getByLabelText("Quantity received") as HTMLInputElement;
  /** human entry: a paste is never mistaken for a scanner burst */
  async function enterQty(user: ReturnType<typeof userEvent.setup>, text: string) {
    await user.clear(qtyField());
    await user.click(qtyField());
    await user.paste(text);
  }
  async function session(user: ReturnType<typeof userEvent.setup>, scans = 0, product = /Sea Salt 500g/) {
    render(<StockInConsole />);
    await pick(user, product);
    await startScanning(user);
    for (let i = 1; i <= scans; i++) {
      resolvesTo({ id: 5, product_name: "Sea Salt 500g" });
      await scan(user, "880000000005");
      expect(await screen.findByText(new RegExp(`Matched — scanned ${i}`, "i"))).toBeInTheDocument();
    }
  }
  const activeKey = () =>
    JSON.parse(window.sessionStorage.getItem(`stock-in:session:${window.sessionStorage.getItem("stock-in:session:active")}`)!)
      .idempotencyKey as string;
  const attemptKeys = () => Object.keys(window.sessionStorage).filter((k) => k.startsWith("stock-in:attempt:"));

  it("Scan Count is the default, and an R4 draft without entryMode restores as Scan Count with its data", () => {
    window.sessionStorage.setItem("stock-in:session:active", "r4-draft");
    window.sessionStorage.setItem(
      "stock-in:session:r4-draft",
      JSON.stringify({
        idempotencyKey: "stockin-r4",
        lines: {
          0: {
            productId: 5, sku: "WH-SALT", name: "Sea Salt 500g", trackBatch: false, trackExpiry: false,
            lot_no: "", mfg_date: "", expiry_date: "", expected: "", remark: "", count: 3, started: true, trail: [],
          },
        },
      }),
    );
    render(<StockInConsole />);
    expect(modeRadio(/scan count/i)).toHaveAttribute("aria-checked", "true");
    expect(screen.getByLabelText("Barcode scan input")).toBeInTheDocument();
    expect(screen.getByText("3", { selector: "span.font-bold" })).toBeInTheDocument();
    expect(reviewButton(3)).toBeEnabled();
  });

  it("switching to Enter Quantity keeps the scan count (not prefilled, labelled as unused); switching back restores it", async () => {
    const user = userEvent.setup();
    await session(user, 2);
    await user.click(modeRadio(/enter quantity/i));
    expect(qtyField()).toHaveValue("");
    expect(screen.queryByLabelText("Barcode scan input")).toBeNull();
    expect(screen.getByText(/scanned count 2 is kept, but it is not used/i)).toBeInTheDocument();
    expect(reviewButton()).toBeDisabled(); // nothing typed yet
    await user.click(modeRadio(/scan count/i));
    expect(screen.getByText("2", { selector: "span.font-bold" })).toBeInTheDocument();
    expect(reviewButton(2)).toBeEnabled();
    expect(saveMutate).not.toHaveBeenCalled();
  });

  it("a typed 1.25 is reviewed as Entered quantity +1.250 and sent canonically, on the unused draft key", async () => {
    const user = userEvent.setup();
    await session(user, 1);
    const key = activeKey();
    await user.click(modeRadio(/enter quantity/i));
    await enterQty(user, "1.25");
    expect(qtyField()).toHaveValue("1.25"); // raw text is never rewritten
    expect(screen.getByText(/will be recorded as/i).textContent).toMatch(/1\.250/);
    await user.click(reviewButton());
    const dialog = screen.getByRole("dialog");
    expect(saveMutate).not.toHaveBeenCalled();
    expect(within(dialog).getByText("Entered quantity")).toBeInTheDocument();
    expect(within(dialog).getByText("+1.250")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Confirm +1.250" }));
    expect(saveMutate).toHaveBeenCalledTimes(1);
    expect(saveMutate.mock.calls[0][0]).toEqual({
      body: { endpoint: "stock/in", json: { product_id: 5, quantity: "1.250" } },
      idempotencyKey: key,
    });
  });

  it.each([
    ["1.", null],
    ["0", /above zero/i],
    ["-1", /above zero/i],
    ["1.2345", /at most 3 decimal places/i],
    ["1e3", /up to 3 decimal places/i],
    ["abc", /up to 3 decimal places/i],
    ["1000000000000000", /larger than the system can record/i],
  ])("%s cannot be reviewed or sent", async (text, error) => {
    const user = userEvent.setup();
    await session(user, 0);
    await user.click(modeRadio(/enter quantity/i));
    await enterQty(user, text);
    if (error) expect(screen.getByText(error)).toBeInTheDocument();
    expect(reviewButton()).toBeDisabled();
    await user.click(reviewButton());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(saveMutate).not.toHaveBeenCalled();
  });

  it.each([
    ["1", "1.000"],
    ["1.250", "1.250"],
    ["0.001", "0.001"],
    ["5.000", "5.000"],
  ])("typed %s is sent as %s", async (text, sent) => {
    const user = userEvent.setup();
    await session(user, 0);
    await user.click(modeRadio(/enter quantity/i));
    await enterQty(user, text);
    await reviewAndConfirm(user);
    expect(saveMutate.mock.calls[0][0].body.json.quantity).toBe(sent);
  });

  it("a batch product keeps POST /batches with its lot and dates; only the quantity is typed", async () => {
    const user = userEvent.setup();
    render(<StockInConsole />);
    await pick(user, /Lot Widget/);
    await user.type(screen.getByPlaceholderText("LOT-…"), "LOT-7");
    await startScanning(user);
    await user.click(modeRadio(/enter quantity/i));
    await enterQty(user, "0.5");
    await reviewAndConfirm(user);
    expect(saveMutate.mock.calls[0][0].body).toEqual({
      endpoint: "batches",
      json: { product_id: 6, lot_no: "LOT-7", quantity: "0.500" },
    });
  });

  it("Scan Count still sends the bare integer, byte-for-byte as in R4", async () => {
    const user = userEvent.setup();
    await session(user, 2);
    await reviewAndConfirm(user);
    expect(JSON.stringify(saveMutate.mock.calls[0][0].body)).toBe('{"endpoint":"stock/in","json":{"product_id":5,"quantity":"2"}}');
  });

  it("a scanner burst in the quantity field is rejected: nothing typed, nothing counted, Review not opened", async () => {
    const user = userEvent.setup(); // no delay — keystrokes arrive like a wedge scanner
    await session(user, 0);
    await user.click(modeRadio(/enter quantity/i));
    await user.click(qtyField());
    await user.type(qtyField(), "885000000009{Enter}");
    expect(qtyField()).toHaveValue("");
    expect(screen.getByText(/looked like barcode scanner input/i)).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(resolveBarcode).not.toHaveBeenCalled();
    expect(saveMutate).not.toHaveBeenCalled();
  });

  it("deliberate manual typing is accepted, and Enter in the field never opens Review", async () => {
    const user = userEvent.setup({ delay: 60 });
    await session(user, 0);
    await user.click(modeRadio(/enter quantity/i));
    await user.click(qtyField());
    await user.keyboard("12.5");
    expect(qtyField()).toHaveValue("12.5");
    await user.keyboard("{Enter}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(saveMutate).not.toHaveBeenCalled();
  });

  it("the stepper is exact and never goes to zero", async () => {
    const user = userEvent.setup();
    await session(user, 0);
    await user.click(modeRadio(/enter quantity/i));
    expect(screen.getByRole("button", { name: "Decrease by 1" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Increase by 1" }));
    expect(qtyField()).toHaveValue("1.000");
    expect(screen.getByRole("button", { name: "Decrease by 1" })).toBeDisabled();
    await enterQty(user, "0.1");
    await user.click(screen.getByRole("button", { name: "Increase by 1" }));
    expect(qtyField()).toHaveValue("1.100");
  });

  it("Back to edit, a mode switch and a new quantity before Confirm send only the final request, once", async () => {
    const user = userEvent.setup();
    await session(user, 1);
    await user.click(reviewButton(1));
    await user.click(screen.getByRole("button", { name: "Back to edit" }));
    await user.click(modeRadio(/enter quantity/i));
    await enterQty(user, "2.5");
    await reviewAndConfirm(user);
    expect(saveMutate).toHaveBeenCalledTimes(1);
    expect(saveMutate.mock.calls[0][0].body.json.quantity).toBe("2.500");
  });

  it("the mode cannot change while a save is pending", async () => {
    const user = userEvent.setup();
    const first = render(<StockInConsole />);
    await pick(user, /Sea Salt 500g/);
    await startScanning(user);
    first.unmount();
    saveState = { ...saveState, isPending: true };
    render(<StockInConsole />);
    expect(modeRadio(/scan count/i)).toBeDisabled();
    expect(modeRadio(/enter quantity/i)).toBeDisabled();
  });

  it("an uncertain outcome locks mode and quantity; the retry resends the identical body and key", async () => {
    const user = userEvent.setup();
    saveMutate.mockImplementationOnce((_a, opts) => opts.onError(ApiError.network(new TypeError("Failed to fetch"))));
    await session(user, 0);
    await user.click(modeRadio(/enter quantity/i));
    await enterQty(user, "1.25");
    await reviewAndConfirm(user);
    await user.click(screen.getByRole("button", { name: "Back to edit" }));
    expect(screen.getByText(/the result of the last request is unknown/i)).toBeInTheDocument();
    expect(modeRadio(/scan count/i)).toBeDisabled();
    expect(qtyField()).toHaveAttribute("readonly");
    expect(screen.getByRole("button", { name: "Increase by 1" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Retry same request" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Confirm retry +1.250" }));
    expect(saveMutate).toHaveBeenCalledTimes(2);
    expect(saveMutate.mock.calls[1][0]).toEqual(saveMutate.mock.calls[0][0]);
  });

  it("the lock also applies to Scan Count (TQ-2): no scan or undo after an uncertain outcome", async () => {
    const user = userEvent.setup();
    saveMutate.mockImplementationOnce((_a, opts) => opts.onError(new ApiError({ status: 503, message: "down" })));
    await session(user, 1);
    await reviewAndConfirm(user);
    await user.click(screen.getByRole("button", { name: "Back to edit" }));
    expect(screen.getByRole("button", { name: /undo/i })).toBeDisabled();
    const lookups = resolveBarcode.mock.calls.length; // the session's own scan
    resolvesTo({ id: 5, product_name: "Sea Salt 500g" });
    await scan(user, "880000000005");
    expect(resolveBarcode).toHaveBeenCalledTimes(lookups);
    expect(screen.getByText("1", { selector: "span.font-bold" })).toBeInTheDocument();
  });

  it("a reload restores the lock without sending anything; the retry is identical", async () => {
    const user = userEvent.setup();
    saveMutate.mockImplementationOnce((_a, opts) => opts.onError(new ApiError({ status: 502, message: "Upstream request failed." })));
    const first = render(<StockInConsole />);
    await pick(user, /Sea Salt 500g/);
    await startScanning(user);
    await user.click(modeRadio(/enter quantity/i));
    await enterQty(user, "3");
    await reviewAndConfirm(user);
    first.unmount();

    render(<StockInConsole />);
    expect(saveMutate).toHaveBeenCalledTimes(1); // no automatic retry
    expect(screen.getByText(/the result of the last request is unknown/i)).toBeInTheDocument();
    expect(modeRadio(/enter quantity/i)).toBeDisabled();
    expect(qtyField()).toHaveValue("3");
    await user.click(screen.getByRole("button", { name: "Retry same request" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: /^confirm retry/i }));
    expect(saveMutate.mock.calls[1][0]).toEqual(saveMutate.mock.calls[0][0]);
  });

  it("an in-flight attempt found after a reload is uncertain, never retried automatically", async () => {
    const user = userEvent.setup();
    saveMutate.mockImplementationOnce(() => undefined); // the response never arrives
    const first = render(<StockInConsole />);
    await pick(user, /Sea Salt 500g/);
    await startScanning(user);
    resolvesTo({ id: 5, product_name: "Sea Salt 500g" });
    await scan(user, "880000000005");
    await reviewAndConfirm(user);
    first.unmount();
    render(<StockInConsole />);
    expect(saveMutate).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/the result of the last request is unknown/i)).toBeInTheDocument();
  });

  it("a verified first-attempt rejection (404 Product not found) unlocks edits on the same key", async () => {
    const user = userEvent.setup();
    saveMutate.mockImplementationOnce((_a, opts) => opts.onError(new ApiError({ status: 404, message: "Product not found" })));
    await session(user, 0);
    await user.click(modeRadio(/enter quantity/i));
    await enterQty(user, "2");
    await reviewAndConfirm(user);
    await user.click(screen.getByRole("button", { name: "Back to edit" }));
    expect(screen.queryByText(/the result of the last request is unknown/i)).toBeNull();
    expect(modeRadio(/scan count/i)).toBeEnabled();
    expect(attemptKeys()).toEqual([]);
    await enterQty(user, "1");
    await reviewAndConfirm(user);
    expect(saveMutate.mock.calls[1][0].idempotencyKey).toBe(saveMutate.mock.calls[0][0].idempotencyKey);
    expect(saveMutate.mock.calls[1][0].body.json.quantity).toBe("1.000");
  });

  it("an unverified 409 and a rejection after an uncertain attempt both keep the lock", async () => {
    const user = userEvent.setup();
    saveMutate
      .mockImplementationOnce((_a, opts) => opts.onError(ApiError.network(new TypeError("offline"))))
      .mockImplementationOnce((_a, opts) => opts.onError(new ApiError({ status: 404, message: "Product not found" })));
    await session(user, 1);
    await reviewAndConfirm(user);
    await reviewAndConfirm(user); // retry → a verified rejection, but an earlier send's fate is unknown
    await user.click(screen.getByRole("button", { name: "Back to edit" }));
    expect(screen.getByText(/the result of the last request is unknown/i)).toBeInTheDocument();
    expect(modeRadio(/enter quantity/i)).toBeDisabled();
  });

  it("an unverified 409 stays uncertain", async () => {
    const user = userEvent.setup();
    saveMutate.mockImplementationOnce((_a, opts) => opts.onError(new ApiError({ status: 409, message: "Something conflicted" })));
    await session(user, 1);
    await reviewAndConfirm(user);
    await user.click(screen.getByRole("button", { name: "Back to edit" }));
    expect(modeRadio(/enter quantity/i)).toBeDisabled();
  });

  it("abandoning requires the explicit warning dialog; Keep changes nothing; Abandon starts a new key", async () => {
    const user = userEvent.setup();
    saveMutate.mockImplementationOnce((_a, opts) =>
      opts.onError(new ApiError({ status: 503, message: "down", requestId: "req-503" })),
    );
    await session(user, 1);
    const oldKey = activeKey();
    await reviewAndConfirm(user);
    await user.click(screen.getByRole("button", { name: "Back to edit" }));

    await user.click(screen.getByRole("button", { name: "Clear session" }));
    let dialog = screen.getByRole("dialog", { name: "Abandon this session?" });
    expect(within(dialog).getByText(/may already have been recorded/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/does not cancel or reverse anything/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/duplicate stock movement/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/req-503/)).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: /check movement history/i })).toHaveAttribute(
      "href",
      "/inventory/ledger?product_id=5",
    );
    await user.click(within(dialog).getByRole("button", { name: "Keep and retry later" }));
    expect(screen.getByText(/the result of the last request is unknown/i)).toBeInTheDocument();
    expect(attemptKeys()).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Abandon…" }));
    dialog = screen.getByRole("dialog", { name: "Abandon this session?" });
    await user.click(within(dialog).getByRole("button", { name: "Abandon and start a new session" }));
    expect(screen.getByRole("combobox", { name: /search products/i })).toBeInTheDocument(); // back to setup
    expect(activeKey()).not.toBe(oldKey);
    expect(attemptKeys()).toEqual([]);
    expect(saveMutate).toHaveBeenCalledTimes(1);
  });

  it("if the attempt cannot be recorded, nothing is sent", async () => {
    const user = userEvent.setup();
    await session(user, 1);
    const real = Storage.prototype.setItem;
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k: string, v: string) {
      if (k.startsWith("stock-in:attempt:")) throw new Error("QuotaExceededError");
      return real.call(this, k, v);
    });
    try {
      await reviewAndConfirm(user);
      expect(saveMutate).not.toHaveBeenCalled();
      expect(within(screen.getByRole("dialog")).getByText(/nothing was sent/i)).toBeInTheDocument();
    } finally {
      spy.mockRestore();
    }
  });

  it("the mismatch recovery is unchanged: Start new session rotates the key directly", async () => {
    const user = userEvent.setup();
    saveMutate.mockImplementationOnce((_a, opts) =>
      opts.onError(new ApiError({ status: 409, message: "Idempotency-Key already used with a different payload" })),
    );
    await session(user, 1);
    const oldKey = activeKey();
    await reviewAndConfirm(user);
    await user.click(screen.getByRole("button", { name: /start new stock-in session/i }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(activeKey()).not.toBe(oldKey);
    expect(attemptKeys()).toEqual([]);
  });

  it("is translated: Thai mode names and quantity label", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    try {
      window.sessionStorage.setItem("stock-in:session:active", "th-draft");
      window.sessionStorage.setItem(
        "stock-in:session:th-draft",
        JSON.stringify({
          idempotencyKey: "stockin-th",
          lines: { 0: { productId: 5, sku: "WH-SALT", name: "Sea Salt 500g", trackBatch: false, trackExpiry: false, lot_no: "", mfg_date: "", expiry_date: "", expected: "", remark: "", count: 0, started: true, trail: [] } },
        }),
      );
      render(
        <LanguageProvider initialLocale="th">
          <StockInConsole />
        </LanguageProvider>,
      );
      await user.click(screen.getByRole("radio", { name: /กรอกจำนวน/ }));
      expect(screen.getByLabelText("จำนวนที่รับเข้า")).toBeInTheDocument();
      expect(screen.getByText("ทศนิยมได้ไม่เกิน 3 ตำแหน่ง")).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
